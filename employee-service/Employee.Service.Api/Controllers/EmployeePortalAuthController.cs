using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using B2B.Erp.Api.Data;
using B2B.Erp.Api.Core.Security;
using B2B.Erp.Api.Entities;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.IdentityModel.Tokens;

namespace B2B.Erp.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
// Giris ucu anonim ve kullanici adi + sifre aliyor: kaba kuvvet denemesine acik.
[Microsoft.AspNetCore.RateLimiting.EnableRateLimiting("auth")]
public sealed class EmployeePortalAuthController : ControllerBase
{
    private readonly IServiceProvider _serviceProvider;
    private readonly MasterDbContext _masterDbContext;
    private readonly IConfiguration _configuration;

    public EmployeePortalAuthController(IServiceProvider serviceProvider, MasterDbContext masterDbContext, IConfiguration configuration)
    {
        _serviceProvider = serviceProvider;
        _masterDbContext = masterDbContext;
        _configuration = configuration;
    }


    /// <summary>
    /// HESAP BAZLI deneme kilidi.
    ///
    /// <para>Mevcut hız sınırı IP başınaydı (dakikada 10 istek). Personel şifreleri kısa ve
    /// basit olduğu için tek bir hesabı farklı IP'lerden denemek serbest kalıyordu. Belirli
    /// sayıda hatalı denemeden sonra o KULLANICI ADI bir süre kilitlenir; doğru şifre girilince
    /// sayaç sıfırlanır.</para>
    ///
    /// <para>Bellekte tutulur: tek süreçli kurulum için yeterli, kilit sunucu yeniden
    /// başlayınca kalkar. Çok örnekli kuruluma geçilirse ortak bir depoya taşınmalı.</para>
    /// </summary>
    private static readonly System.Collections.Concurrent.ConcurrentDictionary<string, (int Count, DateTime LockedUntil)> FailedLogins = new(StringComparer.OrdinalIgnoreCase);

    private const int MaxFailedAttempts = 5;
    private static readonly TimeSpan LockoutDuration = TimeSpan.FromMinutes(15);

    private static TimeSpan? GetLockRemaining(string username)
    {
        if (!FailedLogins.TryGetValue(username, out var state)) return null;
        var remaining = state.LockedUntil - DateTime.UtcNow;
        return remaining > TimeSpan.Zero ? remaining : null;
    }

    private static void RegisterFailedLogin(string username)
    {
        FailedLogins.AddOrUpdate(
            username,
            _ => (1, DateTime.MinValue),
            (_, prev) =>
            {
                var count = prev.Count + 1;
                var lockedUntil = count >= MaxFailedAttempts
                    ? DateTime.UtcNow.Add(LockoutDuration)
                    : prev.LockedUntil;
                return (count, lockedUntil);
            });
    }

    private static void ClearFailedLogins(string username) => FailedLogins.TryRemove(username, out _);

    /// <summary>
    /// Portal oturum süresi. Personel telefonuna kurulu uygulamadan mesai başlatıyor;
    /// 12 saatlik jeton her vardiyada yeniden giriş demekti ve QR/yüz ile mesai başlatma
    /// akışını kesiyordu. Kullanıcı kararı: oturumdan düşme olmasın.
    ///
    /// <para><c>appsettings.json</c> → <c>JwtSettings:PortalTokenDays</c> ile kısaltılabilir.</para>
    /// </summary>
    private int PortalTokenDays => Math.Max(1, _configuration.GetValue("JwtSettings:PortalTokenDays", 365));

    public sealed class LoginRequest
    {
        public string Username { get; set; } = string.Empty;
        public string Password { get; set; } = string.Empty;
        public string? TenantCode { get; set; }
    }

    public sealed class LoginResponse
    {
        public string AccessToken { get; set; } = string.Empty;
        public string RefreshToken { get; set; } = string.Empty;
        public int EmployeeId { get; set; }
        public string EmployeeName { get; set; } = string.Empty;
        public bool IsSuperSuperAdmin { get; set; }

        /// <summary>
        /// ERP'de acilmis bir yonetici hesabiyla girildi. Bu kullanicinin personel kaydi
        /// YOKTUR: self-servis sayfalari (Bilgilerim, QR Okut, Yuzle Giris/Cikis) gizlenir.
        /// </summary>
        public bool IsErpManager { get; set; }

        /// <summary>
        /// Rolun acik olan personel portali sayfa anahtarlari (`Pages.Key`, modul `employee`).
        /// Portal menusunu ve rotalarini bu listeye gore suzer. SSA icin butun aktif sayfalar,
        /// calisan girisinde bos doner (self-servis sayfalari yetki kapisina girmez).
        /// </summary>
        public List<string> AllowedPages { get; set; } = new();
    }

    /// <summary>
    /// `employee` modulunde role ACIK olan sayfa anahtarlari.
    ///
    /// <para>Navigasyon uzerinden degil dogrudan `RoleId` ile sorgulanir: bu serviste
    /// <c>Role</c> icin bir eslestirme dosyasi yok, navigasyonu kullanmak EF'i sozlesmeye
    /// gore uydurdugu bir tabloya goturur.</para>
    ///
    /// <para>Portalin eski tek satiri olan `calisan` disarida birakilir: o ERP'nin kendi
    /// Calisan ekrani, portal sayfasi degil.</para>
    /// </summary>
    private static async Task<List<string>> GetEmployeeModulePageKeysAsync(
        AppDbContext dbContext,
        int roleId,
        CancellationToken cancellationToken)
    {
        var allowedPageIds = dbContext.RolePagePermissions
            .AsNoTracking()
            .Where(rpp => rpp.RoleId == roleId && rpp.CanAccess)
            .Select(rpp => rpp.PageId);

        return await dbContext.Pages
            .AsNoTracking()
            .Where(p => p.IsActive
                        && p.ModuleKey == "employee"
                        && p.Key != "calisan"
                        && allowedPageIds.Contains(p.Id))
            .OrderBy(p => p.SortOrder)
            .Select(p => p.Key)
            .ToListAsync(cancellationToken);
    }

    /// <summary>`employee` modulundeki butun aktif portal sayfalari (SSA icin).</summary>
    private static async Task<List<string>> GetAllEmployeeModulePageKeysAsync(
        AppDbContext dbContext,
        CancellationToken cancellationToken)
    {
        return await dbContext.Pages
            .AsNoTracking()
            .Where(p => p.IsActive && p.ModuleKey == "employee" && p.Key != "calisan")
            .OrderBy(p => p.SortOrder)
            .Select(p => p.Key)
            .ToListAsync(cancellationToken);
    }

    /// <summary>Giris isteginde kullanilan firma kodu (govde ya da baslik).</summary>
    private string ResolveRequestTenantCode()
    {
        if (HttpContext.Items.TryGetValue("TenantCode", out var item) && item is string fromItems && !string.IsNullOrWhiteSpace(fromItems))
        {
            return fromItems.Trim().ToUpperInvariant();
        }

        if (Request.Headers.TryGetValue("X-Tenant-Code", out var header))
        {
            var value = header.ToString();
            if (!string.IsNullOrWhiteSpace(value)) return value.Trim().ToUpperInvariant();
        }

        if (Request.Query.TryGetValue("tenant", out var query))
        {
            var value = query.ToString();
            if (!string.IsNullOrWhiteSpace(value)) return value.Trim().ToUpperInvariant();
        }

        return string.Empty;
    }

    public sealed class ErpHandoverRequest
    {
        public string? Token { get; set; }
        public string? TenantCode { get; set; }
    }

    /// <summary>
    /// ERP'den (bayi) gelen DEVİR: orada açık olan oturumu burada bir portal oturumuna çevirir.
    ///
    /// <para>Neden var: "Personele Geç" düğmesi bugüne kadar yalnızca firma kodunu taşıyordu,
    /// kullanıcı zaten giriş yapmışken portalda TEKRAR şifre soruluyordu. ServiceOps yönünde
    /// bu sorun `/api/auth/exchange` ile çözülmüştü; personel yönünde çözülmemişti.</para>
    ///
    /// <para><b>Süre DEVRALINIR, yeniden başlatılmaz.</b> Normal portal girişi
    /// <see cref="PortalTokenDays"/> günlük token üretir; devirde bu yapılırsa ERP'de 59 dakikası
    /// kalmış bir oturum portalda günlerce yaşayan AYRI bir oturuma dönüşür ve ERP'den çıkan
    /// kullanıcı portalda açık kalır. Bu yüzden yeni token, gelen ERP token'ının bitiş anını
    /// birebir devralır.</para>
    ///
    /// <para>Kapı, şifreyle girişteki ile AYNI: <c>Users.EmployeeAccess</c> + rolüne açılmış en az
    /// bir <c>employee</c> sayfası. İmza doğrulanmış bir token "bu kişi ERP'de kim" sorusunu
    /// cevaplar, "portala girebilir mi" sorusunu DEĞİL — o kapı ayrıca işletilir. Aksi hâlde
    /// kutusu olmayan her ERP kullanıcısı devir yoluyla içeri girerdi.</para>
    /// </summary>
    [HttpPost("exchange")]
    [AllowAnonymous]
    public async Task<IActionResult> ExchangeErpToken([FromBody] ErpHandoverRequest request, CancellationToken cancellationToken)
    {
        if (request is null || string.IsNullOrWhiteSpace(request.Token))
        {
            return BadRequest(new { success = false, message = "Devir bilgisi eksik." });
        }

        var jwtSettings = _configuration.GetSection("JwtSettings");
        var secretKey = jwtSettings["SecretKey"];
        var issuer = jwtSettings["Issuer"];
        var audience = jwtSettings["Audience"];

        if (string.IsNullOrWhiteSpace(secretKey) || string.IsNullOrWhiteSpace(issuer) || string.IsNullOrWhiteSpace(audience))
        {
            return StatusCode(StatusCodes.Status500InternalServerError, new { success = false, message = "JWT ayarları eksik" });
        }

        /*
          İMZA ANAHTARI — İKİ ADAY, SIRAYLA.

          Geliştirmede iki servis aynı `SecretKey`i taşıyor ve tek anahtar yetiyordu. CANLIDA
          ise her sitenin kendi `appsettings.Production.json`ı var ve anahtarlar AYRI
          (ölçüldü: erp ...73168A, personel ...820136). Tek anahtarla doğrulayan ilk sürüm bu
          yüzden her devri "Bayi oturumu doğrulanamadı" diye reddediyordu.

          Anahtarları eşitlemek çözüm DEĞİL: ortak anahtar, ERP'de üretilmiş HERHANGİ bir
          token'ı personel API'sinde de geçerli kılar ve daha önce kapatılmış olan "kutusu
          olmayan kullanıcı portala girer" açığını geri getirir. Bunun yerine ERP'nin anahtarı
          `ErpJwt:SecretKey` ile AYRI tanıtılır — ERP'nin ServiceOps token'ını doğrularken
          kullandığı `ServiceOps:JwtKey` deseninin aynısı.

          Kendi anahtarı yine de aday listesinde kalır; tek anahtarlı geliştirme kurulumu
          ayar eklemeden çalışmaya devam etsin diye.
        */
        var candidateKeys = new List<string>();
        var erpKey = _configuration["ErpJwt:SecretKey"];
        if (!string.IsNullOrWhiteSpace(erpKey)) candidateKeys.Add(erpKey.Trim());
        candidateKeys.Add(secretKey);

        var erpIssuer = _configuration["ErpJwt:Issuer"];
        var erpAudience = _configuration["ErpJwt:Audience"];
        var expectedIssuer = string.IsNullOrWhiteSpace(erpIssuer) ? issuer : erpIssuer.Trim();
        var expectedAudience = string.IsNullOrWhiteSpace(erpAudience) ? audience : erpAudience.Trim();

        ClaimsPrincipal? principal = null;
        JwtSecurityToken? incoming = null;
        Exception? lastFailure = null;

        foreach (var key in candidateKeys)
        {
            try
            {
                principal = new JwtSecurityTokenHandler().ValidateToken(
                    request.Token,
                    new TokenValidationParameters
                    {
                        ValidateIssuerSigningKey = true,
                        IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(key)),
                        ValidateIssuer = true,
                        ValidIssuer = expectedIssuer,
                        ValidateAudience = true,
                        ValidAudience = expectedAudience,
                        ValidateLifetime = true,
                        ClockSkew = TimeSpan.FromMinutes(1)
                    },
                    out var validated);

                incoming = (JwtSecurityToken)validated;
                break;
            }
            catch (Exception ex)
            {
                lastFailure = ex;
            }
        }

        if (principal is null || incoming is null)
        {
            // Sebep loglanır, döndürülmez: "imza yanlış" ile "süresi dolmuş" ayrımını dışarı
            // vermek, deneyen birine hangi yarıda çalışması gerektiğini söyler.
            Console.WriteLine($"[ERP_HANDOVER] rejected: {lastFailure?.GetType().Name}: {lastFailure?.Message}");
            return Unauthorized(new { success = false, message = "Bayi oturumu doğrulanamadı." });
        }

        var username = (principal.FindFirst(ClaimTypes.Name)?.Value ?? string.Empty).Trim();
        var tenantCode = (request.TenantCode ?? principal.FindFirst("TenantCode")?.Value
                          ?? principal.FindFirst("tenantCode")?.Value ?? string.Empty).Trim().ToUpperInvariant();

        if (string.IsNullOrWhiteSpace(username) || string.IsNullOrWhiteSpace(tenantCode))
        {
            return BadRequest(new { success = false, message = "Devir bilgisi eksik." });
        }

        // Firma kodu isteğe bağlanmadan `AppDbContext` çözülemez ve uç 500 verir; giriş ucunda
        // da aynı sıra geçerli (bkz. ResolveRequestTenantCode).
        HttpContext.Items["TenantCode"] = tenantCode;
        Request.Headers["X-Tenant-Code"] = tenantCode;

        var dbContext = _serviceProvider.GetRequiredService<AppDbContext>();

        var erpUser = await dbContext.Users
            .AsNoTracking()
            .FirstOrDefaultAsync(x => x.IsActive
                                     && x.EmployeeAccess
                                     && EF.Functions.ILike(x.Username, username), cancellationToken);

        if (erpUser is null)
        {
            return StatusCode(StatusCodes.Status403Forbidden, new
            {
                success = false,
                message = "Bu hesabın personel portalı yetkisi yok."
            });
        }

        var allowedPages = await GetEmployeeModulePageKeysAsync(dbContext, erpUser.RoleId, cancellationToken);
        if (allowedPages.Count == 0)
        {
            return StatusCode(StatusCodes.Status403Forbidden, new
            {
                success = false,
                message = "Rolünüze tanımlı personel sayfası yok. Yöneticinizden Rol Yetkileri > Çalışan Yönetimi altından yetki isteyin."
            });
        }

        var placeholderEmployeeId = await dbContext.Set<Employee>()
            .AsNoTracking()
            .Where(x => x.IsActive)
            .Select(x => (int?)x.Id)
            .FirstOrDefaultAsync(cancellationToken) ?? 0;

        var displayName = string.IsNullOrWhiteSpace(erpUser.Unvan) ? erpUser.Username : erpUser.Unvan.Trim();

        var claims = new List<Claim>
        {
            new Claim(ClaimTypes.Name, erpUser.Username),
            new Claim("EmployeeId", placeholderEmployeeId.ToString()),
            new Claim("EmployeeName", displayName),
            new Claim("ErpUserId", erpUser.Id.ToString()),
            new Claim("RoleId", erpUser.RoleId.ToString()),
            new Claim("IsErpManager", "1"),
            new Claim("TenantCode", tenantCode)
        };

        var creds = new SigningCredentials(new SymmetricSecurityKey(Encoding.UTF8.GetBytes(secretKey)), SecurityAlgorithms.HmacSha256);

        // Bitiş DEVRALINIR. `notBefore` şimdiye çekilir: gelen token'ın `nbf`'i geçmişte kalmış
        // olabilir ve onu kopyalamak yeni token'ı gereksizce geçmişte başlatırdı.
        var now = DateTime.UtcNow;
        var expires = incoming.ValidTo > now ? incoming.ValidTo : now.AddMinutes(1);

        var token = new JwtSecurityToken(
            issuer: issuer,
            audience: audience,
            claims: claims,
            notBefore: now,
            expires: expires,
            signingCredentials: creds);

        return Ok(new
        {
            success = true,
            data = new LoginResponse
            {
                AccessToken = new JwtSecurityTokenHandler().WriteToken(token),
                RefreshToken = string.Empty,
                EmployeeId = placeholderEmployeeId,
                EmployeeName = displayName,
                IsSuperSuperAdmin = false,
                IsErpManager = true,
                AllowedPages = allowedPages
            }
        });
    }

    [HttpPost("login")]
    [AllowAnonymous]
    public async Task<IActionResult> Login([FromBody] LoginRequest request, CancellationToken cancellationToken)
    {
        var username = (request.Username ?? string.Empty).Trim();
        // Sifre Trim EDILMEZ: bosluk ile biten sifre gecerli bir sifredir ve kirpmak
        // kullaniciyi kendi hesabindan disari atar.
        var password = request.Password ?? string.Empty;

        if (string.IsNullOrWhiteSpace(username) || string.IsNullOrWhiteSpace(password))
        {
            return BadRequest(new { success = false, message = "Kullanıcı adı ve şifre zorunludur" });
        }

        // Hesap kilitliyse şifre hiç doğrulanmaz.
        var lockRemaining = GetLockRemaining(username);
        if (lockRemaining.HasValue)
        {
            return StatusCode(StatusCodes.Status429TooManyRequests, new
            {
                success = false,
                message = $"Çok fazla hatalı deneme. {Math.Ceiling(lockRemaining.Value.TotalMinutes)} dakika sonra tekrar deneyin."
            });
        }

        // 1. Check if the login user is a SuperSuperAdmin in the Master database
        var globalUser = await _masterDbContext.GlobalUsers
            .AsNoTracking()
            .FirstOrDefaultAsync(x => x.IsActive && EF.Functions.ILike(x.Username, username), cancellationToken);

        if (globalUser is not null && globalUser.IsSuperSuperAdmin)
        {
            bool ssaIsPasswordValid = false;
            if (PasswordHasher.IsHashed(globalUser.PasswordHash))
            {
                ssaIsPasswordValid = PasswordHasher.VerifyPassword(password, globalUser.PasswordHash);
            }
            else
            {
                ssaIsPasswordValid = (password == globalUser.PasswordHash);
            }

            if (!ssaIsPasswordValid)
            {
                RegisterFailedLogin(username);
                return Unauthorized(new { success = false, message = "Hatalı kullanıcı adı veya şifre" });
            }

            ClearFailedLogins(username);

            var reqTenantCode = (request.TenantCode ?? string.Empty).Trim();
            if (string.IsNullOrWhiteSpace(reqTenantCode))
            {
                return BadRequest(new { success = false, message = "Süper yönetici girişi için Firma Kodu (TenantCode) zorunlu" });
            }

            var tenant = await _masterDbContext.Tenants
                .AsNoTracking()
                .FirstOrDefaultAsync(x => x.IsActive && EF.Functions.ILike(x.Code, reqTenantCode), cancellationToken);
            if (tenant is null)
            {
                return BadRequest(new { success = false, message = "Belirtilen firma kodu geçersiz veya pasif" });
            }

            // Route AppDbContext resolver to the requested tenant DB connection
            HttpContext.Items["TenantCode"] = reqTenantCode;

            // Find an active employee in the tenant DB to act as the target identity
            var ssaDbContext = _serviceProvider.GetRequiredService<AppDbContext>();
            var empSsa = await ssaDbContext.Set<Employee>()
                .FirstOrDefaultAsync(x => x.IsActive, cancellationToken);

            if (empSsa is null)
            {
                empSsa = new Employee
                {
                    Id = 999999,
                    FirstName = "Super",
                    LastName = "SuperAdmin",
                    Mail = globalUser.Mail,
                    Username = globalUser.Username
                };
            }

            var ssaJwtSettings = _configuration.GetSection("JwtSettings");
            var ssaSecretKey = ssaJwtSettings["SecretKey"];
            var ssaIssuer = ssaJwtSettings["Issuer"];
            var ssaAudience = ssaJwtSettings["Audience"];

            if (string.IsNullOrWhiteSpace(ssaSecretKey) || string.IsNullOrWhiteSpace(ssaIssuer) || string.IsNullOrWhiteSpace(ssaAudience))
            {
                return StatusCode(StatusCodes.Status500InternalServerError, new { success = false, message = "JWT ayarları eksik" });
            }

            var ssaNow = DateTime.UtcNow;
            var ssaClaims = new List<Claim>
            {
                new Claim(ClaimTypes.Name, username),
                new Claim("EmployeeId", empSsa.Id.ToString()),
                new Claim("EmployeeName", ($"{empSsa.FirstName} {empSsa.LastName}").Trim()),
                new Claim("TenantId", tenant.Id.ToString()),
                new Claim("TenantCode", tenant.Code),
                new Claim("IsSuperSuperAdmin", "1")
            };

            var ssaSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(ssaSecretKey));
            var ssaCreds = new SigningCredentials(ssaSigningKey, SecurityAlgorithms.HmacSha256);

            var ssaToken = new JwtSecurityToken(
                issuer: ssaIssuer,
                audience: ssaAudience,
                claims: ssaClaims,
                notBefore: ssaNow,
                expires: ssaNow.AddDays(PortalTokenDays),
                signingCredentials: ssaCreds);

            var ssaAccessToken = new JwtSecurityTokenHandler().WriteToken(ssaToken);

            return Ok(new
            {
                success = true,
                data = new LoginResponse
                {
                    AccessToken = ssaAccessToken,
                    RefreshToken = string.Empty,
                    EmployeeId = empSsa.Id,
                    // Super yonetici kimligi olarak firmadaki ilk personel kaydi kullaniliyor
                    // (token'in bir EmployeeId'ye ihtiyaci var), ama EKRANDA o personelin adi
                    // gorunmemeli: yonetici kendi adi yerine "TUGBA SIDAL" yaziyordu.
                    EmployeeName = globalUser.Username,
                    IsSuperSuperAdmin = true,
                    // SSA'nin da personel kaydi yok: yonetici gibi davranir, self-servis
                    // sayfalari gizlenir ve butun portal sayfalari acik gelir.
                    IsErpManager = true,
                    AllowedPages = await GetAllEmployeeModulePageKeysAsync(ssaDbContext, cancellationToken)
                }
            });
        }

        // 2. ERP kullanicisi — portala YONETICI olarak girer
        // Firma kodu GOVDEDEN de okunur.
        //
        // `ResolveRequestTenantCode` yalnizca HttpContext.Items / `X-Tenant-Code` basligi /
        // `?tenant=` sorgusuna bakiyor; govdedeki `tenantCode` alanini gormuyordu. Basligi
        // gondermeyip yalnizca govdeye yazan bir istemcide kod bos kaliyor, `AppDbContext`
        // cozulemiyor ve uc "Firma kodu cozumlenemedi" ile 500 veriyordu — kimlik dogru olsa
        // bile. SSA dali zaten `request.TenantCode` okuyordu; asagisi da ayni kaynagi tanisin.
        var normTenantCode = ResolveRequestTenantCode();
        if (string.IsNullOrWhiteSpace(normTenantCode) && !string.IsNullOrWhiteSpace(request.TenantCode))
        {
            normTenantCode = request.TenantCode.Trim().ToUpperInvariant();
        }
        if (!string.IsNullOrWhiteSpace(normTenantCode))
        {
            HttpContext.Items["TenantCode"] = normTenantCode;
        }

        var dbContext = _serviceProvider.GetRequiredService<AppDbContext>();

        // ERP'de acilmis bir YONETICI hesabi mi? Bu kullanicilarin `Employees` tablosuyla
        // hicbir bagi yoktur; calisan kayitlari portalin icinden aciliyor.
        //
        // Kapi CIFT kademeli:
        //   1) kullanici bazli  -> `Users.EmployeeAccess` (ERP'deki "Calisan Yonetimi" kutusu)
        //   2) rol bazli        -> `RolePagePermissions` uzerinden `employee` modulu sayfalari
        //
        // SUPER ADMIN BYPASS'I BILEREK YOK: ServiceOps kapisinda `IsSuperAdmin || ...` var,
        // burada yok. Kutu isaretlenmeden kimse giremez, sayfalar herkese kapali dogar.
        //
        // Kutusu olmayan (ya da pasif) kullanici bulunmamis sayilir ve akis calisan girisine
        // duser: ayni kullanici adini tasiyan bir personel varsa onun girisi bozulmaz.
        var erpUser = await dbContext.Users
            .AsNoTracking()
            .FirstOrDefaultAsync(x => x.IsActive
                                     && x.EmployeeAccess
                                     && EF.Functions.ILike(x.Username, username), cancellationToken);

        if (erpUser is not null && !string.IsNullOrWhiteSpace(erpUser.Password))
        {
            // ERP ve personel servisi ayri `PasswordHasher` kopyalari tasiyor ama ikisi de
            // BCrypt ve ayni onekleri taniyor; ERP'nin urettigi hash burada dogrulanabilir.
            bool erpPasswordValid = PasswordHasher.IsHashed(erpUser.Password)
                ? PasswordHasher.VerifyPassword(password, erpUser.Password)
                : password == erpUser.Password;

            if (!erpPasswordValid)
            {
                RegisterFailedLogin(username);
                return Unauthorized(new { success = false, message = "Hatalı kullanıcı adı veya şifre" });
            }

            var erpAllowedPages = await GetEmployeeModulePageKeysAsync(dbContext, erpUser.RoleId, cancellationToken);
            if (erpAllowedPages.Count == 0)
            {
                // Kutu isaretli ama rolune tek bir personel sayfasi bile acilmamis: iceride
                // gorecegi hicbir sey yok. Bos bir panele almak yerine sebebi soyle.
                return StatusCode(StatusCodes.Status403Forbidden, new
                {
                    success = false,
                    message = "Rolünüze tanımlı personel sayfası yok. Yöneticinizden Rol Yetkileri > Çalışan Yönetimi altından yetki isteyin."
                });
            }

            ClearFailedLogins(username);

            var erpJwtSettings = _configuration.GetSection("JwtSettings");
            var erpSecretKey = erpJwtSettings["SecretKey"];
            var erpIssuer = erpJwtSettings["Issuer"];
            var erpAudience = erpJwtSettings["Audience"];

            if (string.IsNullOrWhiteSpace(erpSecretKey) || string.IsNullOrWhiteSpace(erpIssuer) || string.IsNullOrWhiteSpace(erpAudience))
            {
                return StatusCode(StatusCodes.Status500InternalServerError, new { success = false, message = "JWT ayarları eksik" });
            }

            // Token bir `EmployeeId` istiyor ama bu kullanicinin personel kaydi YOK. SSA dali
            // ayni sorunu firmadaki ilk personel kaydini yer tutucu koyarak cozuyor; ayni
            // desen burada da kullaniliyor. Self-servis sayfalari (Bilgilerim, QR Okut, Yuzle
            // Giris/Cikis) bu kullanicilara gosterilmez — o sayfalar yer tutucu personelin
            // verisini gosterirdi.
            var placeholderEmployeeId = await dbContext.Set<Employee>()
                .AsNoTracking()
                .Where(x => x.IsActive)
                .Select(x => (int?)x.Id)
                .FirstOrDefaultAsync(cancellationToken) ?? 0;

            var erpDisplayName = string.IsNullOrWhiteSpace(erpUser.Unvan) ? erpUser.Username : erpUser.Unvan.Trim();

            var erpNow = DateTime.UtcNow;
            var erpClaims = new List<Claim>
            {
                new Claim(ClaimTypes.Name, erpUser.Username),
                new Claim("EmployeeId", placeholderEmployeeId.ToString()),
                new Claim("EmployeeName", erpDisplayName),
                new Claim("ErpUserId", erpUser.Id.ToString()),
                // RoleId claim'i `PageAuthorizationFilter`'i CALISTIRIR. Personel girisinde bu
                // claim hic yok ve filtre o durumda aciga dusuyor; yonetici girisinde rol
                // kapisinin sunucu tarafinda da islemesi icin yaziliyor.
                new Claim("RoleId", erpUser.RoleId.ToString()),
                new Claim("IsErpManager", "1")
            };

            var erpLoginTenantCode = string.IsNullOrWhiteSpace(request.TenantCode)
                ? normTenantCode
                : request.TenantCode.Trim().ToUpperInvariant();
            if (!string.IsNullOrWhiteSpace(erpLoginTenantCode))
            {
                erpClaims.Add(new Claim("TenantCode", erpLoginTenantCode));
            }

            var erpSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(erpSecretKey));
            var erpCreds = new SigningCredentials(erpSigningKey, SecurityAlgorithms.HmacSha256);

            var erpToken = new JwtSecurityToken(
                issuer: erpIssuer,
                audience: erpAudience,
                claims: erpClaims,
                notBefore: erpNow,
                expires: erpNow.AddDays(PortalTokenDays),
                signingCredentials: erpCreds);

            return Ok(new
            {
                success = true,
                data = new LoginResponse
                {
                    AccessToken = new JwtSecurityTokenHandler().WriteToken(erpToken),
                    RefreshToken = string.Empty,
                    EmployeeId = placeholderEmployeeId,
                    EmployeeName = erpDisplayName,
                    IsSuperSuperAdmin = false,
                    IsErpManager = true,
                    AllowedPages = erpAllowedPages
                }
            });
        }

        // 3. Fallback to normal employee login
        var emp = await dbContext.Set<Employee>()
            .FirstOrDefaultAsync(x => x.IsActive
                                     && x.Username != null
                                     && x.Username == username, cancellationToken);

        if (emp is null || string.IsNullOrWhiteSpace(emp.Password))
        {
            RegisterFailedLogin(username);
            return Unauthorized(new { success = false, message = "Hatalı kullanıcı adı veya şifre" });
        }


        bool isPasswordValid = false;
        string storedPassword = emp.Password;
        if (PasswordHasher.IsHashed(storedPassword))
        {
            isPasswordValid = PasswordHasher.VerifyPassword(password, storedPassword);
        }
        else
        {
            isPasswordValid = (password == storedPassword);
            if (isPasswordValid)
            {
                try
                {
                    emp.Password = PasswordHasher.HashPassword(password);
                    await dbContext.SaveChangesAsync(cancellationToken);

                }
                catch
                {
                    // Ignore
                }
            }
        }

        if (!isPasswordValid)
        {
            RegisterFailedLogin(username);
            return Unauthorized(new { success = false, message = "Hatalı kullanıcı adı veya şifre" });
        }

        ClearFailedLogins(username);

        var jwtSettings = _configuration.GetSection("JwtSettings");
        var secretKey = jwtSettings["SecretKey"];
        var issuer = jwtSettings["Issuer"];
        var audience = jwtSettings["Audience"];

        if (string.IsNullOrWhiteSpace(secretKey) || string.IsNullOrWhiteSpace(issuer) || string.IsNullOrWhiteSpace(audience))
        {
            return StatusCode(StatusCodes.Status500InternalServerError, new { success = false, message = "JWT ayarları eksik" });
        }

        var now = DateTime.UtcNow;
        var claims = new List<Claim>
        {
            new Claim(ClaimTypes.Name, username),
            new Claim("EmployeeId", emp.Id.ToString()),
            new Claim("EmployeeName", ($"{emp.FirstName} {emp.LastName}").Trim())
        };

        // Firma kodu token'a yazilir. Boylece sonraki isteklerde firma, istemcinin
        // gonderdigi basliktan degil imzali token'dan cozulur; kullanici localStorage'daki
        // firma kodunu degistirerek baska firmanin verisine gecemez.
        var loginTenantCode = string.IsNullOrWhiteSpace(request.TenantCode)
            ? ResolveRequestTenantCode()
            : request.TenantCode.Trim().ToUpperInvariant();
        if (!string.IsNullOrWhiteSpace(loginTenantCode))
        {
            claims.Add(new Claim("TenantCode", loginTenantCode));
        }

        var signingKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(secretKey));
        var creds = new SigningCredentials(signingKey, SecurityAlgorithms.HmacSha256);

        var token = new JwtSecurityToken(
            issuer: issuer,
            audience: audience,
            claims: claims,
            notBefore: now,
            expires: now.AddDays(PortalTokenDays),
            signingCredentials: creds);

        var accessToken = new JwtSecurityTokenHandler().WriteToken(token);

        return Ok(new
        {
            success = true,
            data = new LoginResponse
            {
                AccessToken = accessToken,
                RefreshToken = string.Empty,
                EmployeeId = emp.Id,
                EmployeeName = ($"{emp.FirstName} {emp.LastName}").Trim(),
                IsSuperSuperAdmin = false
            }
        });
    }

    [HttpGet("tenants")]
    [AllowAnonymous]
    public async Task<IActionResult> GetTenants(CancellationToken cancellationToken)
    {
        var tenants = await _masterDbContext.Tenants
            .AsNoTracking()
            .Where(x => x.IsActive)
            .OrderBy(x => x.Name)
            .Select(x => new
            {
                code = x.Code,
                name = x.Name
            })
            .ToListAsync(cancellationToken);

        return Ok(new { success = true, data = tenants });
    }
}

