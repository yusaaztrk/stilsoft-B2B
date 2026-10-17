using B2B.Erp.Api.Core.Authorization;
using B2B.Erp.Api.Core.Helpers;
using B2B.Erp.Api.Core.Interfaces;
using B2B.Erp.Api.Core.Sessions;
using B2B.Erp.Api.Data;
using B2B.Erp.Api.Data.Services;
using B2B.Erp.Api.DTOs;
using B2B.Erp.Api.Entities;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using System.Collections.Concurrent;
using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;

namespace B2B.Erp.Api.Controllers;

public class WhatsAppOtpRequestDto
{
    public string Username { get; set; } = string.Empty;
    public string Password { get; set; } = string.Empty;
    public string? TenantCode { get; set; }
    public string Phone { get; set; } = string.Empty;
    public string? Code { get; set; }
}

[ApiController]
[Route("api/[controller]")]
// Parola ve OTP denemeleri sınırsızdı; "auth" politikası IP başına pencere uyguluyor (Program.cs).
[Microsoft.AspNetCore.RateLimiting.EnableRateLimiting("auth")]
public class AuthController : ControllerBase
{
    private readonly IAuthService _authService;
    private readonly ITokenService _tokenService;
    private readonly AppDbContext _dbContext;
    private readonly IUserRepository _userRepository;
    private readonly IWhatsAppService _whatsAppService;
    private readonly ISharedSessionStore _sharedSessions;
    private readonly TenantConnectionStringResolver _tenantResolver;
    private readonly IConfiguration _configuration;
    private readonly MasterDbContext _masterDbContext;
    private static readonly ConcurrentDictionary<string, (string Code, DateTime ExpiresAt, string Phone, int Attempts)> _otpCache = new();

    /// <summary>Bir kodun kaç kez yanlış girilebileceği; sonrasında kod düşer, yenisi istenir.</summary>
    private const int MaxOtpAttempts = 5;

    /// <summary>
    /// Doğrulama kodu karşılaştırması sabit zamanlı: doğru kodun kaç hanesinin tuttuğu yanıt
    /// süresinden okunabilmesin.
    /// </summary>
    private static bool FixedTimeEquals(string a, string b)
    {
        var bytesA = System.Text.Encoding.UTF8.GetBytes(a ?? string.Empty);
        var bytesB = System.Text.Encoding.UTF8.GetBytes(b ?? string.Empty);
        return System.Security.Cryptography.CryptographicOperations.FixedTimeEquals(bytesA, bytesB);
    }

    /// <summary>
    /// Numaranın yalnızca baştaki ve sondaki birkaç hanesi. Kullanıcı hangi numaraya kod
    /// gittiğini anlar, ama kimliği doğrulanmamış bir çağıran hesabın telefonunu öğrenemez —
    /// bu uç şifre doğru olduğunda numarayı olduğu gibi döndürüyordu.
    /// </summary>
    /// <summary>
    /// OTP önbellek anahtarı: FİRMA + kullanıcı adı.
    ///
    /// Anahtar yalnız kullanıcı adından ibaretti ve önbellek süreç genelinde tek: iki farklı
    /// firmanın aynı adlı kullanıcısı (ör. "admin") aynı anda kod istediğinde ikinci istek
    /// birincinin kodunu eziyor, birinci kullanıcı telefonuna gelen DOĞRU kodu girdiğinde
    /// "geçersiz kod" alıyordu. Firma kodu gövdede zaten taşınıyor (giriş ekranı seçimi).
    /// </summary>
    private static string BuildOtpCacheKey(WhatsAppOtpRequestDto request)
        => $"{(request.TenantCode ?? string.Empty).Trim().ToLowerInvariant()}:{(request.Username ?? string.Empty).Trim().ToLowerInvariant()}";

    private static string MaskPhone(string? phone)
    {
        var digits = new string((phone ?? string.Empty).Where(char.IsDigit).ToArray());
        if (digits.Length < 7) return new string('*', digits.Length);
        return $"{digits[..3]}{new string('*', digits.Length - 6)}{digits[^3..]}";
    }

    public AuthController(
        IAuthService authService,
        ITokenService tokenService,
        AppDbContext dbContext,
        IUserRepository userRepository,
        IWhatsAppService whatsAppService,
        ISharedSessionStore sharedSessions,
        TenantConnectionStringResolver tenantResolver,
        IConfiguration configuration,
        MasterDbContext masterDbContext)
    {
        _masterDbContext = masterDbContext;
        _configuration = configuration;
        _authService = authService;
        _tokenService = tokenService;
        _dbContext = dbContext;
        _userRepository = userRepository;
        _whatsAppService = whatsAppService;
        _sharedSessions = sharedSessions;
        _tenantResolver = tenantResolver;
    }

    /// <summary>
    /// İsteğin firması. Ortak oturum satırının hangi veritabanına yazılacağını belirler; ServiceOps
    /// aynı satırı aynı firma kodundan bulur. Giriş isteğinde başlık action içinde bağlanıyor,
    /// yetkili isteklerde ise başlık ya da TenantId claim'inden çözülüyor.
    /// </summary>
    private string? CurrentTenantCode() => _tenantResolver.GetCurrentTenantCode();

    [HttpPost("login")]
    [AllowAnonymous]
    public async Task<IActionResult> Login([FromBody] LoginRequestDto request)
    {
        try
        {
            var ipAddress = GetIpAddress();

            if (!string.IsNullOrWhiteSpace(request.TenantCode))
            {
                HttpContext.Request.Headers["X-Tenant-Code"] = request.TenantCode.Trim();
            }

            var (user, accessToken, refreshToken) = await _authService.LoginAsync(
                request.Username, 
                request.Password, 
                ipAddress,
                request.TenantCode);

            var employeePortalAccess = await CanEnterEmployeePortalAsync(_dbContext, user!, HttpContext.RequestAborted);

            var response = new LoginResponseDto
            {
                UserId = user!.Id,
                Username = user.Username,
                Email = user.Mail,
                Title = user.Unvan,
                CurrentCode = user.Carikodu,
                SalesmanCode = user.SalesmanCode,
                Role = user.Role.Name,
                RoleId = user.RoleId,
                RoleCode = user.Role.Code,
                IsSuperAdmin = user.Role.IsSuperAdmin,
                ServiceOpsAccess = user.Role.IsSuperAdmin || user.ServiceOpsAccess,
                // Bkz. CanEnterEmployeePortalAsync: bu bayrak "Personele Geç" düğmesinin
                // görünürlüğüdür ve girişin GERÇEK kapısıyla aynı hesabı yapar.
                EmployeeAccess = employeePortalAccess,
                // Asistan (WhatsApp) — Servise giriş gibi: süper yönetici rolü kutudan bağımsız.
                AsistanAccess = user.Role.IsSuperAdmin || user.AsistanAccess,
                AccessToken = accessToken,
                RefreshToken = refreshToken
            };

            // Şifreyle yapılan gerçek bir giriş, ortak oturumun sayacını sıfırdan başlatır. Aynı
            // kullanıcının ServiceOps'ta açık sekmesi varsa bir sonraki yoklamasında bu yeni
            // bitişi alır — iki taraf tek bir oturum gibi davranır.
            await StartSharedSessionAsync(user.Username, accessToken);

            if (!string.IsNullOrWhiteSpace(refreshToken))
            {
                SetRefreshTokenCookie(refreshToken);
            }

            return Ok(new
            {
                success = true,
                message = "Giriş başarılı",
                data = response
            });
        }
        catch (UnauthorizedAccessException ex)
        {
            return Unauthorized(new
            {
                success = false,
                message = ex.Message
            });
        }
        catch (Exception ex)
        {
            return StatusCode(500, new
            {
                success = false,
                message = "Giriş sırasında bir hata oluştu",
                error = ex.Message
            });
        }
    }

    [HttpPost("send-whatsapp-otp")]
    [AllowAnonymous]
    public async Task<IActionResult> SendWhatsAppOtp([FromBody] WhatsAppOtpRequestDto request)
    {
        try
        {
            var ipAddress = GetIpAddress();
            if (!string.IsNullOrWhiteSpace(request.TenantCode))
            {
                HttpContext.Request.Headers["X-Tenant-Code"] = request.TenantCode.Trim();
            }

            var (user, _, _) = await _authService.LoginAsync(
                request.Username,
                request.Password,
                ipAddress,
                request.TenantCode);

            if (user == null)
            {
                return Unauthorized(new { success = false, message = "Kullanıcı adı veya şifre hatalı" });
            }

            // Kod, kriptografik olarak güvenli üretiliyor. Random.Shared tahmin edilebilir bir
            // üreteç: tohumu ele geçiren ya da yeterince örnek toplayan biri sonraki kodları
            // hesaplayabilir. Bir kimlik doğrulama sırrı için uygun değil.
            var randomCode = System.Security.Cryptography.RandomNumberGenerator
                .GetInt32(100000, 1000000)
                .ToString(System.Globalization.CultureInfo.InvariantCulture);

            // Numara YALNIZCA kullanıcı kaydından; istekten gelen `phone` artık dikkate alınmıyor.
            //
            // Eskiden `user.Gsm` boşken gövdedeki `request.Phone` kullanılıyordu. Şifresi ele
            // geçmiş bir hesapta saldırgan kendi numarasını yazıp OTP'yi kendine gönderebiliyordu,
            // yani WhatsApp adımı hiçbir şey doğrulamıyordu. Kaydında numara olmayan kullanıcılar
            // için davranış değişmiyor: eskiden de istemci varsayılan olarak aynı numarayı
            // gönderiyordu, şimdi bu doğrudan sunucuda karşılanıyor.
            // ⚠️ KAYNAK KODDA SABİT TELEFON YOK.
            //
            // Öncesinde yedek numara kaynağa gömülüydü (`?? "05378266827"`) ve ayrıca ikinci
            // bir numara (`905391081974`) görülünce ona yönlendiriliyordu. Sonuç: kaydında GSM
            // olmayan HERHANGİ bir kullanıcının ikinci faktör kodu, o numaranın sahibine
            // gidiyordu. Şifre doğrulaması önce çalıştığı için bu tek başına giriş açığı değil,
            // ama ikinci faktörü o kişi için etkisiz kılıyor.
            //
            // Artık: numara kullanıcının kaydından gelir. Yoksa yalnızca AÇIKÇA yapılandırılmış
            // bir yedek numara kullanılır; o da yoksa işlem BAŞARISIZ olur — kimsenin telefonuna
            // başkasının kodu gitmez.
            var fallbackPhone = _configuration["WhatsApp:FallbackPhone"];
            var targetPhone = !string.IsNullOrWhiteSpace(user?.Gsm)
                ? user.Gsm.Trim()
                : (fallbackPhone ?? string.Empty).Trim();

            if (string.IsNullOrWhiteSpace(targetPhone))
            {
                return BadRequest(new
                {
                    success = false,
                    message = "Hesabınızda kayıtlı telefon numarası yok. Yöneticinizden kullanıcı kartınıza GSM eklemesini isteyin."
                });
            }

            /*
              YENİDEN GÖNDERİM SOĞUMASI (denetim md. 212).

              IP bazlı sınır zaten var (Program.cs "auth" politikası) ama TEK BİR HESAP için
              kod istemek serbestti: saldırgan arka arkaya kod isteyerek hem WhatsApp faturası
              çıkarabiliyor hem de kullanıcının telefonunu mesaja boğabiliyordu (OTP bombing).

              Geçerli ve YENİ üretilmiş bir kod varsa yenisi ÜRETİLMEZ ve gönderilmez; yanıt
              yine başarılı döner. Kullanıcı açısından davranış aynı (kod zaten telefonunda),
              yalnız aynı hesap için dakikada bir mesajdan fazlası gitmez.
            */
            var otpKey = BuildOtpCacheKey(request);
            var resendCooldown = TimeSpan.FromSeconds(60);
            var otpLifetime = TimeSpan.FromMinutes(5);

            if (_otpCache.TryGetValue(otpKey, out var pending)
                && pending.ExpiresAt > DateTime.UtcNow
                && pending.ExpiresAt - otpLifetime + resendCooldown > DateTime.UtcNow)
            {
                return Ok(new
                {
                    success = true,
                    message = "Doğrulama kodu az önce gönderildi. Lütfen telefonunuzu kontrol edin.",
                    phone = MaskPhone(pending.Phone)
                });
            }

            _otpCache[otpKey] = (randomCode, DateTime.UtcNow.Add(otpLifetime), targetPhone, 0);

            var sent = await _whatsAppService.SendOtpCodeAsync(targetPhone, randomCode);

            return Ok(new
            {
                success = true,
                message = "WhatsApp doğrulama kodu başarıyla gönderildi",
                phone = MaskPhone(targetPhone)
            });
        }
        catch (Exception ex)
        {
            return BadRequest(new { success = false, message = ex.Message });
        }
    }

    [HttpPost("verify-whatsapp-otp")]
    [AllowAnonymous]
    public async Task<IActionResult> VerifyWhatsAppOtp([FromBody] WhatsAppOtpRequestDto request)
    {
        try
        {
            var key = BuildOtpCacheKey(request);
            if (!_otpCache.TryGetValue(key, out var cached) || cached.ExpiresAt < DateTime.UtcNow)
            {
                return BadRequest(new { success = false, message = "Geçersiz veya süresi dolmuş doğrulama kodu. Lütfen tekrar kod isteyin." });
            }

            var inputCode = (request.Code ?? string.Empty).Trim();

            // Buradaki koşul `inputCode != "123456" && (!string.IsNullOrEmpty(cached.Code) && ...)`
            // idi. İki ayrı kapı açıktı: sabit "123456" her zaman kabul ediliyordu, ve önbellekteki
            // kod boşsa ikinci koşul kısa devre yapıp HERHANGİ bir kodu geçiriyordu. İkisi birlikte
            // WhatsApp doğrulamasını tamamen süs haline getiriyordu.
            //
            // Deneme sayısı da sayılıyor: altı haneli bir kod, sınırsız denemeyle zaten tahmin
            // edilebilir. Beşinci yanlıştan sonra kayıt düşürülür, kullanıcı yeni kod ister.
            if (string.IsNullOrEmpty(cached.Code) || !FixedTimeEquals(inputCode, cached.Code))
            {
                var attempts = cached.Attempts + 1;
                if (attempts >= MaxOtpAttempts)
                {
                    _otpCache.TryRemove(key, out _);
                    return BadRequest(new { success = false, message = "Çok fazla hatalı deneme. Lütfen yeni kod isteyin." });
                }

                _otpCache[key] = (cached.Code, cached.ExpiresAt, cached.Phone, attempts);
                return BadRequest(new { success = false, message = "Girdiğiniz WhatsApp doğrulama kodu hatalı." });
            }

            _otpCache.TryRemove(key, out _);

            var ipAddress = GetIpAddress();
            if (!string.IsNullOrWhiteSpace(request.TenantCode))
            {
                HttpContext.Request.Headers["X-Tenant-Code"] = request.TenantCode.Trim();
            }

            var (user, accessToken, refreshToken) = await _authService.LoginAsync(
                request.Username,
                request.Password,
                ipAddress,
                request.TenantCode);

            var employeePortalAccess = await CanEnterEmployeePortalAsync(_dbContext, user!, HttpContext.RequestAborted);

            var response = new LoginResponseDto
            {
                UserId = user!.Id,
                Username = user.Username,
                Email = user.Mail,
                Title = user.Unvan,
                CurrentCode = user.Carikodu,
                SalesmanCode = user.SalesmanCode,
                Role = user.Role.Name,
                RoleId = user.RoleId,
                RoleCode = user.Role.Code,
                IsSuperAdmin = user.Role.IsSuperAdmin,
                ServiceOpsAccess = user.Role.IsSuperAdmin || user.ServiceOpsAccess,
                // Bkz. CanEnterEmployeePortalAsync: bu bayrak "Personele Geç" düğmesinin
                // görünürlüğüdür ve girişin GERÇEK kapısıyla aynı hesabı yapar.
                EmployeeAccess = employeePortalAccess,
                // Asistan (WhatsApp) — Servise giriş gibi: süper yönetici rolü kutudan bağımsız.
                AsistanAccess = user.Role.IsSuperAdmin || user.AsistanAccess,
                AccessToken = accessToken,
                RefreshToken = refreshToken
            };

            // Şifreyle yapılan gerçek bir giriş, ortak oturumun sayacını sıfırdan başlatır. Aynı
            // kullanıcının ServiceOps'ta açık sekmesi varsa bir sonraki yoklamasında bu yeni
            // bitişi alır — iki taraf tek bir oturum gibi davranır.
            await StartSharedSessionAsync(user.Username, accessToken);

            if (!string.IsNullOrWhiteSpace(refreshToken))
            {
                SetRefreshTokenCookie(refreshToken);
            }

            return Ok(new
            {
                success = true,
                message = "Giriş başarılı",
                data = response
            });
        }
        catch (Exception ex)
        {
            return BadRequest(new { success = false, message = ex.Message });
        }
    }

    [HttpPost("refresh-token")]
    [AllowAnonymous]
    public async Task<IActionResult> RefreshToken([FromBody] RefreshTokenRequestDto? request)
    {
        try
        {
            var token = request?.RefreshToken ?? Request.Cookies["refreshToken"];

            if (string.IsNullOrEmpty(token))
                return BadRequest(new { success = false, message = "Token bulunamadı" });

            var ipAddress = GetIpAddress();
            var result = await _authService.RefreshTokenAsync(token, ipAddress);

            if (result == null)
                return Unauthorized(new { success = false, message = "Geçersiz token" });

            SetRefreshTokenCookie(result.Value.refreshToken);

            return Ok(new
            {
                success = true,
                message = "Token yenilendi",
                data = new
                {
                    accessToken = result.Value.accessToken,
                    refreshToken = result.Value.refreshToken
                }
            });
        }
        catch (UnauthorizedAccessException ex)
        {
            return Unauthorized(new { success = false, message = ex.Message });
        }
        catch (Exception ex)
        {
            return StatusCode(500, new
            {
                success = false,
                message = "Token yenileme sırasında bir hata oluştu",
                error = ex.Message
            });
        }
    }

    [HttpPost("logout")]
    [Authorize]
    public async Task<IActionResult> Logout()
    {
        try
        {
            var userId = int.Parse(User.FindFirst(ClaimTypes.NameIdentifier)!.Value);
            var ipAddress = GetIpAddress();

            await _authService.LogoutAsync(userId, ipAddress);

            // Ortak oturum kapatılır: ServiceOps tarafındaki token da bu andan itibaren geçersiz
            // sayılır, o taraf ilk yoklamasında (en geç ~20 sn) giriş ekranına düşer.
            await RevokeSharedSessionAsync();

            Response.Cookies.Delete("refreshToken");

            return Ok(new
            {
                success = true,
                message = "Çıkış başarılı"
            });
        }
        catch (Exception ex)
        {
            return StatusCode(500, new
            {
                success = false,
                message = "Çıkış sırasında bir hata oluştu",
                error = ex.Message
            });
        }
    }

    [HttpPost("revoke-token")]
    [Authorize]
    public async Task<IActionResult> RevokeToken([FromBody] RefreshTokenRequestDto? request)
    {
        try
        {
            var token = request?.RefreshToken ?? Request.Cookies["refreshToken"];

            if (string.IsNullOrEmpty(token))
                return BadRequest(new { success = false, message = "Token bulunamadı" });

            var ipAddress = GetIpAddress();
            var result = await _authService.RevokeTokenAsync(token, ipAddress);

            if (!result)
                return BadRequest(new { success = false, message = "Token iptal edilemedi" });

            return Ok(new
            {
                success = true,
                message = "Token iptal edildi"
            });
        }
        catch (Exception ex)
        {
            return StatusCode(500, new
            {
                success = false,
                message = "Token iptal sırasında bir hata oluştu",
                error = ex.Message
            });
        }
    }

    /// <summary>
    /// "Personele Geç" düğmesi bu kullanıcıya gösterilsin mi?
    ///
    /// <para>Düğmenin görünürlüğü, girişin GERÇEK kapısıyla aynı hesabı yapmalı. O kapı
    /// personel servisinde İKİ şartlı: <c>Users.EmployeeAccess</c> kutusu <b>ve</b> kullanıcının
    /// rolüne açılmış en az bir <c>employee</c> modülü sayfası. Yalnızca kutuya bakan eski
    /// sürüm, kutusu işaretli ama rolüne tek sayfa açılmamış kullanıcıya çalışmayan bir düğme
    /// gösteriyor, tıklayınca 403 alıyordu.</para>
    ///
    /// <para><c>calisan</c> sayfası DIŞARIDA: o ERP'nin kendi Çalışan ekranı, portal sayfası
    /// değil — personel servisindeki sorgu da onu aynı gerekçeyle eliyor. İki taraf ayrışırsa
    /// düğme yine yalan söyler.</para>
    ///
    /// <para>Süper admin bypass'ı bilerek YOK; portal kapısında da yok.</para>
    /// </summary>
    private static Task<bool> CanEnterEmployeePortalAsync(AppDbContext db, User user, CancellationToken cancellationToken)
    {
        if (!user.EmployeeAccess) return Task.FromResult(false);

        var allowedPageIds = db.RolePagePermissions
            .AsNoTracking()
            .Where(rp => rp.RoleId == user.RoleId && rp.CanAccess)
            .Select(rp => rp.PageId);

        return db.Pages
            .AsNoTracking()
            .Where(p => p.IsActive
                        && p.ModuleKey == "employee"
                        && p.Key != "calisan"
                        && allowedPageIds.Contains(p.Id))
            .AnyAsync(cancellationToken);
    }

    public sealed class ServiceOpsExchangeRequestDto
    {
        public string? Token { get; set; }
        public string? TenantCode { get; set; }
    }

    /// <summary>
    /// Servisten (ServiceOps) gelen devir: orada açık olan oturumu burada bir B2B oturumuna çevirir.
    ///
    /// ServiceOps'taki /api/auth/exchange ucunun aynadaki eşi. O yön çalışıyordu, bu yön yoktu:
    /// servisten "Bayi'ye geç" denince kullanıcı zaten giriş yapmışken tekrar şifre soruluyordu.
    ///
    /// Zorunlu olarak anonim — çağıranın elinde henüz bir B2B kimliği yok, mesele de bu.
    /// Kimlik doğrulaması ServiceOps imzasıdır; gövdeden yalnızca firma kodu alınır ve o da
    /// hangi veritabanına bakılacağını seçer, tek başına bir şey yetkilendirmez.
    /// </summary>
    [HttpPost("exchange")]
    [AllowAnonymous]
    public async Task<IActionResult> ExchangeServiceOpsToken([FromBody] ServiceOpsExchangeRequestDto request, CancellationToken cancellationToken)
    {
        if (request is null || string.IsNullOrWhiteSpace(request.Token))
        {
            return BadRequest(new { success = false, message = "Devir bilgisi eksik." });
        }

        var serviceKey = _configuration["ServiceOps:JwtKey"];
        var serviceIssuer = _configuration["ServiceOps:JwtIssuer"];
        var serviceAudience = _configuration["ServiceOps:JwtAudience"];

        if (string.IsNullOrWhiteSpace(serviceKey))
        {
            // Kapalı düşüyor: anahtar yokken token doğrulanamaz, doğrulamadan kabul etmek
            // isteyen herkese B2B oturumu üretme imkânı vermek olurdu.
            return StatusCode(StatusCodes.Status503ServiceUnavailable,
                new { success = false, message = "Servis devir yapılandırması eksik." });
        }

        ClaimsPrincipal principal;
        try
        {
            principal = new JwtSecurityTokenHandler().ValidateToken(
                request.Token,
                new Microsoft.IdentityModel.Tokens.TokenValidationParameters
                {
                    ValidateIssuerSigningKey = true,
                    IssuerSigningKey = new Microsoft.IdentityModel.Tokens.SymmetricSecurityKey(
                        System.Text.Encoding.UTF8.GetBytes(serviceKey)),
                    ValidateIssuer = !string.IsNullOrWhiteSpace(serviceIssuer),
                    ValidIssuer = serviceIssuer,
                    ValidateAudience = !string.IsNullOrWhiteSpace(serviceAudience),
                    ValidAudience = serviceAudience,
                    ValidateLifetime = true,
                    ClockSkew = TimeSpan.FromMinutes(1)
                },
                out _);
        }
        catch (Exception ex)
        {
            // Sebep loglanır, döndürülmez: "imza yanlış" ile "süresi dolmuş" ayrımı, deneyen
            // birine hangi yarıda çalışması gerektiğini söyler.
            Console.WriteLine($"[SERVICEOPS_EXCHANGE] rejected: {ex.GetType().Name}: {ex.Message}");
            return Unauthorized(new { success = false, message = "Servis oturumu doğrulanamadı." });
        }

        var username = principal.FindFirst(ClaimTypes.Name)?.Value ?? string.Empty;
        var tenantCode = (request.TenantCode ?? principal.FindFirst("tenantCode")?.Value ?? string.Empty).Trim();

        if (string.IsNullOrWhiteSpace(username) || string.IsNullOrWhiteSpace(tenantCode))
        {
            return BadRequest(new { success = false, message = "Devir bilgisi eksik." });
        }

        // Firmayı isteğe bağlamak zorunlu: bundan sonraki her sorgu (kullanıcı, rol, oturum kaydı)
        // bu başlıktan çözülen veritabanına gider.
        HttpContext.Request.Headers["X-Tenant-Code"] = tenantCode;

        // AMBIENT _dbContext BURADA KULLANILAMAZ.
        //
        // AppDbContext'in bağlantısı DI'da, context ilk çözüldüğünde belirleniyor
        // (Program.cs: AddDbContext -> resolver.Resolve()). Bu, controller kurulurken olur;
        // yani YUKARIDAKİ başlık atamasından ÖNCE. Devir isteği başlıksız geldiği için
        // _dbContext bu istekte VARSAYILAN veritabanına bağlanıyordu ve kullanıcı firma
        // veritabanında olduğu hâlde bulunamıyordu.
        //
        // Sonucu: serviste açık oturumu olan herkes bayiye geçerken "Bu firmada kullanıcı
        // bulunamadı" alıp giriş ekranına düşüyordu — POS çekim ekranına geçiş dahil.
        // Yalnızca varsayılan veritabanında da satırı olan eski hesaplarda çalışıyor gibi
        // görünüyordu. (Aynı sebeple ortak oturum deposu da ambient context kullanmaz.)
        //
        // Başlık artık atandığı için Resolve() firma bağlantısını döndürür; kısa ömürlü bir
        // context açıp sorguyu ORAYA soruyoruz.
        await using var tenantDb = new AppDbContext(
            new DbContextOptionsBuilder<AppDbContext>()
                .UseNpgsql(_tenantResolver.Resolve())
                .Options);

        // KULLANICI ADI BÜYÜK/KÜÇÜK HARFTEN BAĞIMSIZ EŞLEŞİR (2026-08-21).
        //
        // Eşleşme daha önce tam eşitti ve PostgreSQL bu karşılaştırmayı harfe DUYARLI yapıyor.
        // Sonuç: serviste 'turenk' yazıp giren kullanıcı, bayide kayıt 'TURENK' olduğu için
        // devirde "Bu firmada kullanıcı bulunamadı" alıyor ve şifre ekranına düşüyordu —
        // "ilk giriş serviste olunca bayiye geçerken şifre soruyor" şikayeti tam olarak buydu.
        // (Ölçüldü: 'TURENK' 200, 'turenk' 401.)
        //
        // Burada gevşetmek güvenli: token ZATEN ServiceOps imzasıyla doğrulandı, bu sorgu
        // kimlik doğrulaması değil yalnızca eşleme. Üç kiracıda da yalnızca yazımı farklı
        // iki kullanıcı bulunmadığı doğrulandı; çakışma olsaydı eşleme belirsizleşirdi.
        var normalizedUsername = username.Trim().ToLowerInvariant();

        var user = await tenantDb.Users
            .Include(u => u.Role)
            .FirstOrDefaultAsync(u => u.Username.ToLower() == normalizedUsername && u.IsActive, cancellationToken);

        if (user is null)
        {
            // Süper sistem yöneticisinin hiçbir firma veritabanında satırı yoktur; devir onun
            // için anlamlı değil. Kullanıcı normal giriş ekranına düşer.
            return Unauthorized(new { success = false, message = "Bu firmada kullanıcı bulunamadı." });
        }

        var normalizedTenantCode = tenantCode.ToUpperInvariant();

        var tenantId = await _masterDbContext.Tenants
            .AsNoTracking()
            .Where(x => x.Code == normalizedTenantCode)
            .Select(x => (int?)x.Id)
            .FirstOrDefaultAsync(cancellationToken);

        // Devir yeni bir oturum DEĞİL: kullanıcı serviste zaten açık olan oturumuyla geliyor.
        // Bitiş oradan devralınır, böylece iki taraf aynı anda sona erer.
        DateTime? expiresAtUtc = null;
        try
        {
            var state = await _sharedSessions.AdoptOrStartAsync(tenantCode, user.Username, cancellationToken);
            expiresAtUtc = state?.ExpiresAtUtc;
        }
        catch (Exception ex)
        {
            Console.WriteLine($"[SHARED_SESSION] adopt failed: {ex.Message}");
        }

        var accessToken = _tokenService.GenerateAccessToken(user, tenantId, isSuperSuperAdmin: false, null, expiresAtUtc);

        user.LastLoginAt = DateTime.UtcNow;
        // Kullanıcı tenantDb'den okundu; kaydı da oraya yazmak zorunlu — _dbContext başka bir
        // veritabanına bağlı ve bu satırı hiç tanımıyor.
        await tenantDb.SaveChangesAsync(cancellationToken);

        // Kullanıcı `tenantDb`den okundu; bu sorgu da oraya sorulmalı — ambient `_dbContext`
        // bu istekte başka bir veritabanına bağlı (yukarıdaki uzun not).
        var employeePortalAccess = await CanEnterEmployeePortalAsync(tenantDb, user, cancellationToken);

        return Ok(new
        {
            success = true,
            data = new LoginResponseDto
            {
                UserId = user.Id,
                Username = user.Username,
                Email = user.Mail,
                Title = user.Unvan,
                CurrentCode = user.Carikodu,
                SalesmanCode = user.SalesmanCode,
                Role = user.Role.Name,
                RoleId = user.RoleId,
                RoleCode = user.Role.Code,
                IsSuperAdmin = user.Role.IsSuperAdmin,
                ServiceOpsAccess = user.Role.IsSuperAdmin || user.ServiceOpsAccess,
                // Bkz. CanEnterEmployeePortalAsync: bu bayrak "Personele Geç" düğmesinin
                // görünürlüğüdür ve girişin GERÇEK kapısıyla aynı hesabı yapar.
                EmployeeAccess = employeePortalAccess,
                // Asistan (WhatsApp) — Servise giriş gibi: süper yönetici rolü kutudan bağımsız.
                AsistanAccess = user.Role.IsSuperAdmin || user.AsistanAccess,
                AccessToken = accessToken,
                RefreshToken = string.Empty
            }
        });
    }

    [HttpGet("me")]
    [Authorize]
    public async Task<IActionResult> GetCurrentUser(CancellationToken cancellationToken)
    {
        var rawUserId = User.FindFirst(ClaimTypes.NameIdentifier)?.Value;
        if (!int.TryParse(rawUserId, out var userId) || userId <= 0)
        {
            return Unauthorized(new { success = false, message = "Geçersiz kullanıcı" });
        }

        var isSsaClaim = User.FindFirst("IsSuperSuperAdmin")?.Value == "1";
        var isSaClaim = User.FindFirst("IsSuperAdmin")?.Value == "1";
        var usernameClaim = User.FindFirst(ClaimTypes.Name)?.Value ?? User.FindFirst("username")?.Value ?? string.Empty;

        if (isSsaClaim)
        {
            // SSA'nın kiracı `Users` satırı yok, bu yüzden burası `null` dönüyordu ve SSA
            // ekranlarda depo öntanımı olmadan çalışıyordu. Depo adıyla çözülüyor — kodu
            // kiracıdan kiracıya değişiyor.
            var ssaWarehouseCode = await PrivilegedDefaultWarehouse.ResolveAsync(_dbContext, cancellationToken);

            return Ok(new
            {
                success = true,
                data = new
                {
                    userId = userId,
                    username = !string.IsNullOrWhiteSpace(usernameClaim) ? usernameClaim : "ssa",
                    email = User.FindFirst(ClaimTypes.Email)?.Value ?? "ssa@system",
                    title = User.FindFirst("Unvan")?.Value ?? "Süper Süper Admin",
                    currentCode = (string?)null,
                    salesmanCode = (string?)null,
                    defaultWarehouseCode = ssaWarehouseCode,
                    role = "Süper Süper Admin",
                    roleId = 0,
                    roleCode = "SSA",
                    isSuperAdmin = true,
                    isSuperSuperAdmin = true,
                    discountRate = (decimal?)null
                }
            });
        }

        var dbUser = await _dbContext.Users
            .AsNoTracking()
            .Include(u => u.Role)
            .FirstOrDefaultAsync(u => u.Id == userId, cancellationToken);

        if (dbUser is null)
        {
            return NotFound(new { success = false, message = "Kullanıcı bulunamadı" });
        }

        // Only the master-issued claim proves super super admin. The username and the role
        // code are both tenant-editable: naming a user "ssa", or giving any role the code
        // "SSA", used to be enough to be reported — and treated — as the platform owner.
        var isSuperSuperAdmin = isSsaClaim;
        var isSuperAdmin = isSaClaim || dbUser.Role?.IsSuperAdmin == true || isSuperSuperAdmin;

        return Ok(new
        {
            success = true,
            data = new
            {
                userId = dbUser.Id,
                username = dbUser.Username,
                email = dbUser.Mail,
                title = dbUser.Unvan,
                currentCode = dbUser.Carikodu,
                salesmanCode = dbUser.SalesmanCode,
                defaultWarehouseCode = dbUser.DefaultWarehouseCode,
                role = dbUser.Role?.Name ?? string.Empty,
                roleId = dbUser.RoleId,
                roleCode = dbUser.Role?.Code ?? string.Empty,
                isSuperAdmin,
                isSuperSuperAdmin,
                discountRate = dbUser.DiscountRate
            }
        });
    }

    /// <summary>
    /// Oturumu uzatır. Uzatma ORTAK kayda yazılır, dolayısıyla ServiceOps tarafındaki oturum da
    /// aynı anda uzar (o taraf ilk yoklamasında yeni bitişe göre token'ını tazeler).
    /// </summary>
    [HttpPost("extend-session")]
    [Authorize]
    public async Task<IActionResult> ExtendSession(CancellationToken cancellationToken)
    {
        var rawUserId = User.FindFirst(ClaimTypes.NameIdentifier)?.Value;
        if (!int.TryParse(rawUserId, out var userId) || userId <= 0)
        {
            return Unauthorized(new { success = false, message = "Geçersiz kullanıcı" });
        }

        var username = User.FindFirst(ClaimTypes.Name)?.Value ?? string.Empty;

        SharedSessionState? extended = null;
        try
        {
            extended = await _sharedSessions.ExtendAsync(CurrentTenantCode(), username, cancellationToken);
            if (extended is null)
            {
                // Oturum diğer taraftan kapatılmış. Uzatmak yerine düşürülür.
                return Unauthorized(new { success = false, message = "Oturum kapatılmış" });
            }
        }
        catch (Exception ex)
        {
            // Ortak kayda ulaşılamıyorsa uzatma yine de yapılır (yalnız bu uygulama için):
            // paylaşılan defterin erişilemez olması kullanıcıyı sistemden atmak için sebep değil.
            Console.WriteLine($"[SHARED_SESSION] extend failed, falling back to local: {ex.Message}");
        }

        var expiresAtUtc = extended?.ExpiresAtUtc ?? await ComputeLocalExtensionAsync(cancellationToken);

        var accessToken = await IssueTokenForCurrentUserAsync(userId, expiresAtUtc);
        if (accessToken is null)
        {
            return Unauthorized(new { success = false, message = "Kullanıcı bulunamadı" });
        }

        return Ok(new
        {
            success = true,
            data = new
            {
                accessToken,
                expiresAtUtc,
                alertBeforeMinutes = extended?.AlertBeforeMinutes
            }
        });
    }

    /// <summary>
    /// Ortak oturumun durumu. İki uygulamanın da (B2B ve ServiceOps) saniyede bir token çözmek
    /// yerine periyodik olarak sorduğu tek uç:
    ///   - valid=false ise oturum ya süresi dolmuş ya da DİĞER taraftan kapatılmıştır → çıkış,
    ///   - expiresAtUtc iki tarafta da aynıdır → geri sayım ve uyarı ekranı ortaktır,
    ///   - accessToken doluysa ortak bitiş bu token'ınkinden farklıdır (ör. diğer taraftan
    ///     uzatılmış) → istemci sessizce yeni token'a geçer.
    /// </summary>
    /// <summary>
    /// ŞU AN AÇIK OTURUMLAR (2026-08-30 kullanıcı isteği).
    ///
    /// Kimin programda olduğunu, oturumunun ne zaman biteceğini ve son hareketini döndürür.
    /// Kaynak `SharedSessions` tablosudur — B2B ve ServiceOps aynı satırı paylaşır, yani
    /// listede servis tarafında çalışan teknisyenler de görünür.
    ///
    /// YETKİ: Genel Ayarlar sayfasına erişebilen görebilir; oturum listesi kişisel veri
    /// sayılmasa da kimin ne zaman çalıştığını gösterir, herkese açık olmamalı.
    /// </summary>
    [HttpGet("active-sessions")]
    [Authorize]
    [AuthorizePage("users", "genelAyarlar")]
    public async Task<IActionResult> GetActiveSessions(CancellationToken cancellationToken)
    {
        /*
          FİRMA KODU RESOLVER'DAN OKUNUR, CLAIM'DEN DEĞİL (2026-08-30: "herkes ssa diye geliyor").

          Doğrudan `tenantCode` claim'i okunuyordu; o claim her istekte dolu gelmiyor ve boş
          kalınca `OpenAsync(null)` VARSAYILAN veritabanına bağlanıyor. Orada yalnızca firmasız
          (SSA/yönetim) oturumları duruyor — ekranda firma kullanıcıları yerine "ssa" görünmesinin
          sebebi buydu.

          `CurrentTenantCode()` aynı sınıftaki diğer oturum uçlarının kullandığı yol: resolver
          başlık, claim ve kullanıcı kaydını birlikte değerlendiriyor. Oturum uçları arasında
          tek yol kullanılmalı, yoksa biri firmanın DB'sine diğeri varsayılana bakar.
        */
        var tenantCode = CurrentTenantCode();

        IReadOnlyList<B2B.Erp.Api.Core.Sessions.ActiveSessionRow> satirlar;
        try
        {
            satirlar = await _sharedSessions.ListActiveAsync(tenantCode, cancellationToken);
        }
        catch
        {
            // AÇIK-BAŞARISIZ: ortak defter okunamıyorsa ekran boş liste görsün, hata basmasın.
            // Bu ekran bilgilendirmedir; erişilemiyor diye ayarlar sayfası kırılmamalı.
            return Ok(new { success = true, data = Array.Empty<object>(), unavailable = true });
        }

        /*
          KULLANICI BİLGİSİ EKLENİYOR (2026-08-31 kullanıcı isteği: "rolü nedir ismi nedir
          gibi daha çok bilgi de olsun").

          Ortak oturum defteri yalnızca kullanıcı ANAHTARINI tutuyor; ad ve rol firmanın
          kendi Users tablosunda. Tek sorguda çekilip eşleştiriliyor — satır başına sorgu
          açmak 30 saniyede bir yenilenen bir panelde gereksiz yük olurdu.

          Eşleşme küçük harf üzerinden: defterdeki anahtar küçültülmüş, Users.Username
          kullanıcının yazdığı gibi duruyor.
        */
        var anahtarlar = satirlar.Select(x => x.UserKey).ToList();

        var kullanicilar = new Dictionary<string, (string Ad, string Rol, string Eposta)>(StringComparer.Ordinal);
        try
        {
            var kayitlar = await _dbContext.Users
                .AsNoTracking()
                .Include(u => u.Role)
                .Where(u => anahtarlar.Contains(u.Username.ToLower()))
                .Select(u => new
                {
                    Anahtar = u.Username.ToLower(),
                    u.Unvan,
                    RolAdi = u.Role != null ? (u.Role.DisplayName != "" ? u.Role.DisplayName : u.Role.Name) : "",
                    u.Mail
                })
                .ToListAsync(cancellationToken);

            foreach (var k in kayitlar)
            {
                kullanicilar[k.Anahtar] = (k.Unvan ?? string.Empty, k.RolAdi ?? string.Empty, k.Mail ?? string.Empty);
            }
        }
        catch
        {
            // AÇIK-BAŞARISIZ: ad/rol getirilemezse panel yine kullanıcı adlarıyla çalışır.
        }

        var simdi = DateTime.UtcNow;
        var veri = satirlar.Select(x =>
        {
            kullanicilar.TryGetValue(x.UserKey, out var bilgi);
            return new
            {
                username = x.UserKey,
                displayName = string.IsNullOrWhiteSpace(bilgi.Ad) ? x.UserKey : bilgi.Ad,
                roleName = bilgi.Rol ?? string.Empty,
                email = bilgi.Eposta ?? string.Empty,
                expiresAtUtc = x.ExpiresAtUtc,
                lastActivityUtc = x.UpdatedAtUtc,
                remainingMinutes = (int)Math.Max(0, Math.Round((x.ExpiresAtUtc - simdi).TotalMinutes)),
                // Son işlemden bu yana geçen dakika: "açık ama masasında değil"i ayırt ettirir.
                idleMinutes = (int)Math.Max(0, Math.Round((simdi - x.UpdatedAtUtc).TotalMinutes)),
                isSelf = string.Equals(x.UserKey, (User.FindFirst(ClaimTypes.Name)?.Value ?? string.Empty).ToLowerInvariant(),
                                       StringComparison.Ordinal)
            };
        }).ToList();

        return Ok(new { success = true, data = veri });
    }

    /// <summary>
    /// BİR KULLANICIYI OTURUMDAN DÜŞÜR (2026-08-30 kullanıcı isteği).
    ///
    /// Ortak oturum satırını kapatır; hem B2B hem ServiceOps tarafı bir sonraki yoklamada
    /// (20 sn) kullanıcıyı dışarı alır. Token'ı geçersiz kılmaz — kapatma kaydı `iat`
    /// karşılaştırmasıyla çalışır, o yüzden kullanıcı yeniden giriş yapabilir.
    ///
    /// KENDİNİ DÜŞÜREMEZ: yanlışlıkla kendi oturumunu kapatıp ayarlar ekranından atılmak
    /// kimseye faydası olmayan bir kaza. Çıkmak isteyen normal çıkışı kullanır.
    /// </summary>
    [HttpPost("revoke-session")]
    [Authorize]
    [AuthorizePage("users", "genelAyarlar")]
    public async Task<IActionResult> RevokeSession([FromBody] RevokeSessionRequest request, CancellationToken cancellationToken)
    {
        var hedef = (request?.Username ?? string.Empty).Trim();
        if (string.IsNullOrWhiteSpace(hedef))
        {
            return BadRequest(new { success = false, message = "Kullanıcı adı gerekli." });
        }

        var ben = (User.FindFirst(ClaimTypes.Name)?.Value ?? string.Empty).Trim();
        if (string.Equals(hedef, ben, StringComparison.OrdinalIgnoreCase))
        {
            return BadRequest(new { success = false, message = "Kendi oturumunuzu buradan kapatamazsınız. Çıkış yapmak için Çıkış'ı kullanın." });
        }

        // Listeleme ile AYNI firma kodu yolu; farklı olursa listedeki kullanıcı bulunamaz.
        await _sharedSessions.RevokeAsync(CurrentTenantCode(), hedef, cancellationToken);

        return Ok(new { success = true, message = $"{hedef} oturumdan düşürüldü." });
    }

    /// <summary>
    /// HERKESİ DÜŞÜR (2026-09-05 kullanıcı isteği): tek tek uğraşmadan tüm açık oturumları kapat.
    ///
    /// Kapatma ANINDA DEĞİL, <see cref="ScheduledRevokeLeadSeconds"/> saniye sonrası için
    /// damgalanır. Sebebi: istemci oturum durumunu 20 saniyede bir yokluyor; anında kapatılsa
    /// kullanıcı ne olduğunu anlamadan giriş ekranında bulurdu. Bu gecikme sayesinde herkes
    /// önce geri sayımlı bir uyarı görüyor ve işini kaydedecek vakti oluyor.
    ///
    /// İşlemi yapan kişi hariç tutulur (tekil düşürmedeki kuralın aynısı).
    /// </summary>
    [HttpPost("revoke-all-sessions")]
    [Authorize]
    [AuthorizePage("users", "genelAyarlar")]
    public async Task<IActionResult> RevokeAllSessions(CancellationToken cancellationToken)
    {
        var ben = (User.FindFirst(ClaimTypes.Name)?.Value ?? string.Empty).Trim();
        var kapanmaAni = DateTime.UtcNow.AddSeconds(ScheduledRevokeLeadSeconds);

        var etkilenen = await _sharedSessions.ScheduleRevokeAllAsync(
            CurrentTenantCode(), ben, kapanmaAni, cancellationToken);

        return Ok(new
        {
            success = true,
            affected = etkilenen,
            revokeAtUtc = kapanmaAni,
            leadSeconds = ScheduledRevokeLeadSeconds,
            message = etkilenen > 0
                ? $"{etkilenen} oturum {ScheduledRevokeLeadSeconds} saniye içinde kapatılacak. Kullanıcılara geri sayımlı uyarı gösteriliyor."
                : "Kapatılacak açık oturum bulunamadı."
        });
    }

    /// <summary>
    /// Toplu kapatma ile gerçek kapanma arasındaki süre. İstemcinin yoklama aralığından (20 sn)
    /// BÜYÜK olmalı, yoksa bazı kullanıcılar uyarıyı hiç görmeden düşer.
    /// </summary>
    private const int ScheduledRevokeLeadSeconds = 30;

    [HttpGet("session-state")]
    [Authorize]
    public async Task<IActionResult> GetSessionState(CancellationToken cancellationToken)
    {
        var rawUserId = User.FindFirst(ClaimTypes.NameIdentifier)?.Value;
        var username = User.FindFirst(ClaimTypes.Name)?.Value ?? string.Empty;
        var tokenExpUtc = ReadTokenExpiryUtc(ReadBearerToken());

        SharedSessionState? state = null;
        var storeReachable = true;
        try
        {
            state = await _sharedSessions.GetAsync(CurrentTenantCode(), username, cancellationToken);
        }
        catch (Exception ex)
        {
            storeReachable = false;
            Console.WriteLine($"[SHARED_SESSION] read failed: {ex.Message}");
        }

        var (durationMinutes, alertBeforeMinutes) = state is not null
            ? (state.DurationMinutes, state.AlertBeforeMinutes)
            : await SafeGetSettingsAsync(cancellationToken);

        // Ortak kayıt yoksa (bu sürümden önce açılmış oturum) ya da defter okunamıyorsa token'ın
        // kendi bitişi geçerli sayılır: açık-başarısız olmak, çalışan herkesi atmaktan iyidir.
        if (state is null)
        {
            if (storeReachable && tokenExpUtc.HasValue)
            {
                try
                {
                    state = await _sharedSessions.StartAsync(CurrentTenantCode(), username, tokenExpUtc.Value, cancellationToken);
                }
                catch
                {
                    // yoksay: aşağıdaki token bitişiyle devam edilir
                }
            }

            if (state is null)
            {
                return Ok(new
                {
                    success = true,
                    valid = tokenExpUtc is null || tokenExpUtc.Value > DateTime.UtcNow,
                    expiresAtUtc = tokenExpUtc,
                    alertBeforeMinutes,
                    durationMinutes
                });
            }
        }

        if (!state.IsAlive)
        {
            return Ok(new
            {
                success = true,
                valid = false,
                revoked = state.RevokedAtUtc is not null,
                expiresAtUtc = state.ExpiresAtUtc,
                alertBeforeMinutes,
                durationMinutes
            });
        }

        // Token'ın bitişi ortak bitişten kaymışsa sessizce yenilenir. 5 saniyelik pay, imza
        // anındaki saniye yuvarlamasının her yoklamada yeni token üretmesini engeller.
        string? refreshedToken = null;
        var drift = tokenExpUtc.HasValue ? (state.ExpiresAtUtc - tokenExpUtc.Value).Duration() : TimeSpan.MaxValue;
        if (drift > TimeSpan.FromSeconds(5) && int.TryParse(rawUserId, out var userId) && userId > 0)
        {
            refreshedToken = await IssueTokenForCurrentUserAsync(userId, state.ExpiresAtUtc);
        }

        return Ok(new
        {
            success = true,
            valid = true,
            expiresAtUtc = state.ExpiresAtUtc,
            alertBeforeMinutes,
            durationMinutes,
            // PLANLANMIŞ TOPLU KAPATMA (2026-09-05): doluysa istemci geri sayımlı uyarı gösterir
            // ve vakti gelince kendini çıkarır. Boşsa ekranda hiçbir şey değişmez.
            scheduledRevokeAtUtc = state.RevokeAtUtc,
            accessToken = refreshedToken
        });
    }

    /// <summary>
    /// Mevcut isteğin kullanıcısı için, bitişi tam olarak verilen ana ayarlanmış yeni bir token.
    /// SSA'nın firma veritabanında satırı yoktur; claim'lerden türetilen kullanıcıyla imzalanır.
    /// </summary>
    private async Task<string?> IssueTokenForCurrentUserAsync(int userId, DateTime expiresAtUtc)
    {
        var tenantIdRaw = User.FindFirst("TenantId")?.Value;
        var tenantId = int.TryParse(tenantIdRaw, out var tid) && tid > 0 ? (int?)tid : null;
        var isSsa = User.FindFirst("IsSuperSuperAdmin")?.Value == "1";

        User? user;
        if (isSsa)
        {
            user = new User
            {
                Id = userId,
                Username = User.FindFirst(ClaimTypes.Name)?.Value ?? "ssa",
                Mail = User.FindFirst("Mail")?.Value ?? "",
                Unvan = User.FindFirst("Unvan")?.Value ?? "Super Super Admin",
                RoleId = 0,
                Role = new Role
                {
                    Id = 0,
                    Code = "SSA",
                    Name = "Super Super Admin",
                    DisplayName = "Super Super Admin",
                    IsSuperAdmin = true
                },
                IsActive = true
            };
        }
        else
        {
            user = await _userRepository.GetByIdAsync(userId);
            if (user is null) return null;
        }

        return _tokenService.GenerateAccessToken(user, tenantId, isSsa, null, expiresAtUtc);
    }

    /// <summary>Ortak defter erişilemezken uzatmanın yerel karşılığı (eski davranış).</summary>
    private async Task<DateTime> ComputeLocalExtensionAsync(CancellationToken cancellationToken)
    {
        var (durationMinutes, _) = await SafeGetSettingsAsync(cancellationToken);
        var currentExpUtc = ReadTokenExpiryUtc(ReadBearerToken());
        var baseUtc = currentExpUtc.HasValue && currentExpUtc.Value > DateTime.UtcNow ? currentExpUtc.Value : DateTime.UtcNow;

        var newExpUtc = baseUtc.AddMinutes(durationMinutes);
        var cap = DateTime.UtcNow.AddMinutes(24 * 60);
        return newExpUtc > cap ? cap : newExpUtc;
    }

    private async Task<(int DurationMinutes, int AlertBeforeMinutes)> SafeGetSettingsAsync(CancellationToken cancellationToken)
    {
        try
        {
            return await _sharedSessions.GetSettingsAsync(CurrentTenantCode(), cancellationToken);
        }
        catch
        {
            return (SharedSessionStore.DefaultDurationMinutes, SharedSessionStore.DefaultAlertBeforeMinutes);
        }
    }

    private async Task StartSharedSessionAsync(string username, string accessToken)
    {
        try
        {
            var expiresAtUtc = ReadTokenExpiryUtc(accessToken);
            await _sharedSessions.StartAsync(CurrentTenantCode(), username, expiresAtUtc);
        }
        catch (Exception ex)
        {
            // Ortak kayıt yazılamazsa giriş yine de tamamlanır; oturum yalnızca bu uygulamada
            // yaşar. Girişi paylaşılan bir tabloya bağımlı kılmak, o tablo bozulduğunda kimsenin
            // giriş yapamaması demek olurdu.
            Console.WriteLine($"[SHARED_SESSION] start failed: {ex.Message}");
        }
    }

    private async Task RevokeSharedSessionAsync()
    {
        try
        {
            var username = User.FindFirst(ClaimTypes.Name)?.Value ?? string.Empty;
            if (!string.IsNullOrWhiteSpace(username))
            {
                await _sharedSessions.RevokeAsync(CurrentTenantCode(), username);
            }
        }
        catch (Exception ex)
        {
            Console.WriteLine($"[SHARED_SESSION] revoke failed: {ex.Message}");
        }
    }

    private static DateTime? ReadTokenExpiryUtc(string? jwt)
    {
        if (string.IsNullOrWhiteSpace(jwt)) return null;

        try
        {
            var token = new JwtSecurityTokenHandler().ReadJwtToken(jwt);
            var exp = token.Claims.FirstOrDefault(x => x.Type == JwtRegisteredClaimNames.Exp)?.Value;
            if (long.TryParse(exp, out var expSeconds) && expSeconds > 0)
            {
                return DateTimeOffset.FromUnixTimeSeconds(expSeconds).UtcDateTime;
            }
        }
        catch
        {
        }

        return null;
    }

    private string? ReadBearerToken()
    {
        var raw = Request.Headers.Authorization.ToString();
        if (string.IsNullOrWhiteSpace(raw)) return null;
        const string prefix = "Bearer ";
        if (raw.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
        {
            return raw.Substring(prefix.Length).Trim();
        }
        return raw.Trim();
    }

    private string GetIpAddress()
    {
        if (Request.Headers.ContainsKey("X-Forwarded-For"))
            return Request.Headers["X-Forwarded-For"].ToString().Split(',')[0].Trim();

        return HttpContext.Connection.RemoteIpAddress?.ToString() ?? "unknown";
    }

    private void SetRefreshTokenCookie(string token)
    {
        var cookieOptions = new CookieOptions
        {
            HttpOnly = true,
            Secure = true,
            SameSite = SameSiteMode.Strict,
            Expires = DateTime.UtcNow.AddDays(7)
        };

        Response.Cookies.Append("refreshToken", token, cookieOptions);
    }
}

/// <summary>Oturumdan düşürülecek kullanıcının adı.</summary>
public sealed class RevokeSessionRequest
{
    public string? Username { get; set; }
}

