using System.IdentityModel.Tokens.Jwt;
using System.Net.Http;
using System.Security.Claims;
using System.Text;
using System.Security.Cryptography;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.IdentityModel.Tokens;
using Microsoft.EntityFrameworkCore;
using ServiceOps.Infrastructure.Data;
using ServiceOps.Api.Services;
using Npgsql;

namespace ServiceOps.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
public class AuthController : ControllerBase
{
    private readonly IConfiguration _configuration;
    private readonly ApplicationDbContext _context;
    private readonly IHttpClientFactory _httpClientFactory;
    private readonly IServiceOpsPermissionService _permissions;
    private readonly ISharedSessionStore _sharedSessions;

    public AuthController(IConfiguration configuration, ApplicationDbContext context, IHttpClientFactory httpClientFactory, IServiceOpsPermissionService permissions, ISharedSessionStore sharedSessions)
    {
        _configuration = configuration;
        _context = context;
        _httpClientFactory = httpClientFactory;
        _permissions = permissions;
        _sharedSessions = sharedSessions;
    }

    /// <summary>
    /// Bu girişin oturum bitişi. Süre bayideki "JWT Süre Yönetimi" ayarından gelir ve ortak
    /// kayda yazılır; servis tarafında ayrı bir süre ayarı yoktur (eskiden sabit 8 saatti).
    ///
    /// <paramref name="adopt"/> true iken açık bir oturum varsa BİTİŞİ ONDAN alınır — devir (SSO)
    /// yeni bir oturum başlatmaz, var olanı devralır. Şifreyle yapılan gerçek girişte ise sayaç
    /// sıfırdan başlar.
    ///
    /// <paramref name="neverExpires"/> TEKNİSYENLER İÇİN: oturum kendiliğinden kapanmaz.
    /// Saha telefonu cepteyken "oturumunuz bitiyor" penceresine kimse basmıyor, token ölüyor ve
    /// arka plandaki konum servisi sessizce duruyordu — telefonun nerede olduğu görünmez oluyordu.
    /// Ofis kullanıcıları bayideki süre ayarına tabi kalmaya devam eder.
    /// </summary>
    private const int TechnicianSessionYears = 10;

    private async Task<DateTime> ResolveSessionExpiryAsync(string tenantCode, string username, bool adopt, CancellationToken cancellationToken, bool neverExpires = false)
    {
        // "Süresiz"i temsil eden uzak bir tarih. Kolon NOT NULL olduğu için null yazılamıyor;
        // ayrıca uzak-ama-gerçek bir tarih, oturumun hiç kapatılamadığı bir duruma değil, gerekirse
        // elle düşürülebilen (RevokedAtUtc) normal bir kayda karşılık geliyor.
        var farFuture = DateTime.UtcNow.AddYears(TechnicianSessionYears);

        try
        {
            // StartAsync'e AÇIK bir tarih geçmek 24 saatlik tavanı atlar; tavan yalnızca ayardan
            // türetilen sürelere ve ExtendAsync'e uygulanıyor.
            if (neverExpires)
            {
                var techState = await _sharedSessions.StartAsync(tenantCode, username, farFuture, cancellationToken);
                return techState.ExpiresAtUtc;
            }

            var state = adopt
                ? await _sharedSessions.AdoptOrStartAsync(tenantCode, username, cancellationToken)
                : await _sharedSessions.StartAsync(tenantCode, username, null, cancellationToken);

            return state.ExpiresAtUtc;
        }
        catch (Exception ex)
        {
            // Ortak defter yazılamıyorsa giriş yine de tamamlanır: oturum yalnızca bu uygulamada
            // yaşar. Girişi paylaşılan bir tabloya bağımlı kılmak, o tablo bozulduğunda sahadaki
            // hiç kimsenin giriş yapamaması demek olurdu.
            Console.WriteLine($"[SHARED_SESSION] start failed for '{username}'@'{tenantCode}': {ex.Message}");
            if (neverExpires) return farFuture;
            var (duration, _) = await _sharedSessions.GetSettingsAsync(tenantCode, cancellationToken);
            return DateTime.UtcNow.AddMinutes(duration);
        }
    }

    /// <summary>
    /// B2B rolleri arasindan SAHA TEKNISYENI olanlar.
    ///
    /// Artik yalnizca sunu belirliyor: kullaniciya bir Technician kaydi baglanip baglanmayacagi,
    /// yani islerin "sadece bana atananlar" olarak kapsamlanip kapsamlanmayacagi. Hangi sayfalarin
    /// ACILDIGI ile ilgisi YOK — o karar tek basina rol yetkilerine ait.
    ///
    /// Eskiden rol kodunda "servis" / "tech" gecmesi yeterliydi. "ServisMudur" da "servis"
    /// iceriyor, dolayisiyla Servis Muduru saha teknisyeni sayiliyordu.
    ///
    /// Tam eslesme kullaniliyor: yeni bir saha rolu eklendiginde buraya da eklenmeli.
    /// </summary>
    private static readonly HashSet<string> FieldTechnicianRoleCodes = new(StringComparer.OrdinalIgnoreCase)
    {
        "ServisPersonel",
        "Technician",
        "Teknisyen",
        "KlimaEkibi",
        "SahaMontajEkibi"
    };

    private static bool IsFieldTechnicianRole(string? roleCode, string? roleName)
        => (!string.IsNullOrWhiteSpace(roleCode) && FieldTechnicianRoleCodes.Contains(roleCode.Trim()))
        || (!string.IsNullOrWhiteSpace(roleName) && FieldTechnicianRoleCodes.Contains(roleName.Trim()));

    [HttpPost("login")]
    [AllowAnonymous]
    public async Task<ActionResult<LoginResponse>> Login([FromBody] LoginRequest request, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(request.Username) || string.IsNullOrWhiteSpace(request.Password))
            return BadRequest("Username ve password zorunludur");

        // Firma kodunu isteğin GÖVDESİNDEN bağla.
        //
        // Tenant çözücü normalde X-Tenant-Code başlığına bakıyor, ama giriş isteği o başlığı
        // taşımıyor (henüz oturum yok, istemci ham fetch ile gönderiyor). Başlık yoksa çözücü
        // varsayılan `serviceops_dev` veritabanına düşüyordu — yani firma veritabanındaki
        // ServiceUsers satırları HİÇ GÖRÜLMÜYOR, teknisyen girişleri kullanıcı bulunamadı diye
        // en sondaki dala kayıyordu.
        if (!string.IsNullOrWhiteSpace(request.TenantCode))
        {
            HttpContext.Items["TenantCode"] = request.TenantCode.Trim();
        }

        // 1. Resolve master connection string pointing to b2b_erp_master
        string? masterConn = null;
        try
        {
            var baseConn = _configuration.GetConnectionString("DefaultConnection") 
                           ?? _configuration.GetConnectionString("ServiceOpsBase");
            if (!string.IsNullOrWhiteSpace(baseConn))
            {
                var connBuilder = new NpgsqlConnectionStringBuilder(baseConn)
                {
                    Database = "b2b_erp_master"
                };
                masterConn = connBuilder.ConnectionString;
            }
        }
        catch (Exception ex)
        {
            Console.WriteLine($"Error building master connection string: {ex.Message}");
        }

        if (string.IsNullOrWhiteSpace(masterConn))
        {
            masterConn = "Host=localhost;Port=5434;Database=b2b_erp_master;Username=b2b;Password=b2b";
        }

        if (string.IsNullOrWhiteSpace(request.TenantCode) && string.Equals(request.Username?.Trim(), "ssa", StringComparison.OrdinalIgnoreCase))
        {
            try
            {
                using (var conn = new NpgsqlConnection(masterConn))
                {
                    await conn.OpenAsync(cancellationToken);
                    using (var cmd = new NpgsqlCommand("SELECT \"Code\" FROM public.\"Tenants\" WHERE \"ServiceOpsEnabled\" = true LIMIT 1", conn))
                    {
                        var firstTenantCode = await cmd.ExecuteScalarAsync(cancellationToken) as string;
                        if (!string.IsNullOrWhiteSpace(firstTenantCode))
                        {
                            request.TenantCode = firstTenantCode;
                        }
                    }
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine($"Error resolving default tenant for ssa: {ex.Message}");
            }

            if (string.IsNullOrWhiteSpace(request.TenantCode))
            {
                request.TenantCode = "SERVIS"; // Fallback default
            }
        }

        if (string.IsNullOrWhiteSpace(request.TenantCode))
            return BadRequest("TenantCode zorunludur");

        // 2. Check global admin user
        bool isGlobalAdmin = false;
        bool isSuperSuperAdmin = false;
        Guid? globalUserId = null;
        string? globalUsername = null;

        try
        {
            using (var conn = new NpgsqlConnection(masterConn))
            {
                await conn.OpenAsync(cancellationToken);
                using (var cmd = new NpgsqlCommand())
                {
                    cmd.Connection = conn;
                    cmd.CommandText = @"
                        SELECT gu.""Id"", gu.""Username"", gu.""PasswordHash"", gu.""IsSuperSuperAdmin"", gu.""IsActive"",
                               (SELECT t.""Code"" 
                                FROM public.""GlobalUserTenants"" gut 
                                INNER JOIN public.""Tenants"" t ON gut.""TenantId"" = t.""Id"" 
                                WHERE gut.""GlobalUserId"" = gu.""Id"" AND gut.""IsActive"" = true AND LOWER(t.""Code"") = @tenantCode LIMIT 1) as MappedTenantCode
                        FROM public.""GlobalUsers"" gu
                        WHERE LOWER(gu.""Username"") = @username 
                        LIMIT 1";
                    
                    cmd.Parameters.AddWithValue("username", request.Username.Trim().ToLowerInvariant());
                    cmd.Parameters.AddWithValue("tenantCode", request.TenantCode.Trim().ToLowerInvariant());

                    using (var reader = await cmd.ExecuteReaderAsync(cancellationToken))
                    {
                        if (await reader.ReadAsync(cancellationToken))
                        {
                            var dbId = reader.GetInt32(0);
                            var dbUsername = reader.GetString(1);
                            var dbPasswordHash = reader.GetString(2);
                            var dbIsSuperSuperAdmin = reader.GetBoolean(3);
                            var dbIsActive = reader.GetBoolean(4);
                            var isMapped = !reader.IsDBNull(5);

                            bool passwordMatch = string.Equals(request.Password, dbPasswordHash, StringComparison.Ordinal) 
                                                 || VerifyPassword(request.Password, dbPasswordHash);

                            if (!passwordMatch)
                            {
                                return Unauthorized("Kullanıcı adı veya şifre hatalı");
                            }

                            if (!dbIsActive)
                            {
                                return Unauthorized("Kullanıcı aktif değil");
                            }

                            if (dbIsSuperSuperAdmin)
                            {
                                isGlobalAdmin = true;
                                isSuperSuperAdmin = true;
                                globalUserId = DeterministicGuidFromString($"global:{dbId}");
                                globalUsername = dbUsername;
                            }
                            else
                            {
                                if (isMapped)
                                {
                                    isGlobalAdmin = true;
                                    globalUserId = DeterministicGuidFromString($"global:{dbId}");
                                    globalUsername = dbUsername;
                                }
                                else
                                {
                                    return Unauthorized("Bu firmaya giriş yetkiniz yok");
                                }
                            }
                        }
                    }
                }
            }
        }
        catch (Exception ex)
        {
            Console.WriteLine($"Global user check error: {ex.Message}");
        }

        if (isGlobalAdmin && globalUserId.HasValue && globalUsername != null)
        {
            var userRole = isSuperSuperAdmin ? "SuperAdmin" : "Admin";
            // isSuperSuperAdmin burada GlobalUsers.IsSuperSuperAdmin DB kolonundan geliyor —
            // kim olduğuna/adına bakılmaz, gerçek bir bayrak.
            var expiresAtGlobal = await ResolveSessionExpiryAsync(request.TenantCode, globalUsername, adopt: false, cancellationToken);
            var accessTokenGlobal = CreateJwt(globalUserId.Value, globalUsername, userRole, request.TenantCode, null, null, null, "Hayri Demirci", isSuperAdmin: isSuperSuperAdmin, expiresAtUtc: expiresAtGlobal);

            return Ok(new LoginResponse
            {
                AccessToken = accessTokenGlobal,
                ExpiresAt = expiresAtGlobal,
                TenantCode = request.TenantCode,
                User = new LoginUser
                {
                    Id = globalUserId.Value,
                    Name = globalUsername,
                    Role = userRole,
                    TechnicianId = null
                }
            });
        }

        // 3. Try B2B ERP Authentication
        try
        {
            var erpBaseUrl = _configuration["ErpApi:BaseUrl"];
            if (!string.IsNullOrWhiteSpace(erpBaseUrl))
            {
                var client = _httpClientFactory.CreateClient();
                client.BaseAddress = new Uri(erpBaseUrl);

                var erpRequest = new
                {
                    tenantCode = request.TenantCode,
                    username = request.Username,
                    password = request.Password
                };

                var erpContent = new StringContent(
                    System.Text.Json.JsonSerializer.Serialize(erpRequest),
                    Encoding.UTF8,
                    "application/json"
                );

                var erpMsg = new HttpRequestMessage(HttpMethod.Post, "api/auth/login")
                {
                    Content = erpContent
                };
                erpMsg.Headers.Add("X-Tenant-Code", request.TenantCode);

                var erpResponse = await client.SendAsync(erpMsg, cancellationToken);
                if (erpResponse.IsSuccessStatusCode)
                {
                    var responseBody = await erpResponse.Content.ReadAsStringAsync(cancellationToken);
                    using var doc = System.Text.Json.JsonDocument.Parse(responseBody);
                    if (doc.RootElement.TryGetProperty("success", out var successProp) && successProp.GetBoolean() &&
                        doc.RootElement.TryGetProperty("data", out var dataProp))
                    {
                        // isB2bSuperAdmin B2B'nin KENDİ login yanıtından geliyor (server tarafında
                        // zaten claim'e dayalı olarak hesaplanmış) — kullanıcı adına "ssa" yazıp
                        // yazmadığına burada tekrar bakılmıyor, o kontrol B2B'de zaten yapıldı.
                        var isB2bSuperAdmin = dataProp.TryGetProperty("isSuperAdmin", out var saProp) && saProp.GetBoolean();
                        var b2bUsername = dataProp.GetProperty("username").GetString() ?? request.Username;
                        var hasAccess = (dataProp.TryGetProperty("serviceOpsAccess", out var accProp) && accProp.GetBoolean())
                                        || isB2bSuperAdmin;
                        if (hasAccess)
                        {
                            var b2bUserId = dataProp.GetProperty("userId").GetInt32();
                            var b2bCurrentCode = dataProp.TryGetProperty("currentCode", out var ccProp) ? ccProp.GetString() : null;
                            var roleCode = dataProp.TryGetProperty("roleCode", out var rcProp) ? rcProp.GetString() : null;
                            var roleName = dataProp.TryGetProperty("role", out var rnProp) ? rnProp.GetString() : null;

                            // "Admin"/"SuperAdmin" etiketi burada da yalnızca GÖRÜNÜM — asıl sayfa
                            // yetkisi kullanıcı adından B2B'deki gerçek RoleId'ye gidip
                            // RolePagePermissions'tan okunuyor (GetGrantedKeysAsync). Bayi/AltBayi
                            // dahil teknisyen olmayan herkes eskiden buraya "Admin" düşüyordu ve
                            // bu, IsSuperAdmin() içindeki role=="Admin" kısayoluyla YANLIŞLIKLA tam
                            // yetkiye dönüşüyordu; o kısayol kaldırıldığı için artık zararsız bir
                            // etiket, gerçek yetkiyi DEĞİŞTİRMİYOR.
                            var expectedRole = "Admin";
                            if (isB2bSuperAdmin)
                            {
                                expectedRole = "SuperAdmin";
                            }
                            else if (IsFieldTechnicianRole(roleCode, roleName))
                            {
                                expectedRole = "Technician";
                            }

                            var userGuid = DeterministicGuidFromString($"b2b:{request.TenantCode?.Trim().ToUpperInvariant()}:{b2bUserId}");
                            var localUser = await _context.ServiceUsers
                                .FirstOrDefaultAsync(u => u.Id == userGuid, cancellationToken);

                            if (localUser == null)
                            {
                                localUser = await _context.ServiceUsers
                                    .Include(u => u.Technician)
                                    .FirstOrDefaultAsync(u => EF.Functions.ILike(u.Username, b2bUsername) && (u.TenantCode == request.TenantCode || u.TenantCode == null), cancellationToken);
                            }

                            if (localUser == null)
                            {
                                localUser = new ServiceOps.Domain.Entities.ServiceUser
                                {
                                    Id = userGuid,
                                    Username = b2bUsername,
                                    IsActive = true,
                                    TenantCode = request.TenantCode,
                                    DealerCode = b2bCurrentCode,
                                    LastLoginAt = DateTime.UtcNow
                                };

                                if (expectedRole == "Technician")
                                {
                                    var tech = new ServiceOps.Domain.Entities.Technician
                                    {
                                        Id = Guid.NewGuid(),
                                        EmployeeNumber = $"TECH-B2B-{DateTime.UtcNow:yyyyMMdd}-{new Random().Next(1000, 9999)}",
                                        FirstName = b2bUsername,
                                        LastName = "B2B",
                                        Phone = "",
                                        Email = "",
                                        UserId = b2bUsername,
                                        TenantCode = request.TenantCode,
                                        IsActive = true,
                                        CreatedAt = DateTime.UtcNow
                                    };
                                    _context.Technicians.Add(tech);
                                    localUser.TechnicianId = tech.Id;
                                }

                                _context.ServiceUsers.Add(localUser);
                            }
                            else
                            {
                                localUser.Username = b2bUsername;
                                localUser.IsActive = true;
                                localUser.TenantCode = request.TenantCode;
                                localUser.DealerCode = b2bCurrentCode;
                                localUser.LastLoginAt = DateTime.UtcNow;

                                if (expectedRole == "Technician" && !localUser.TechnicianId.HasValue)
                                {
                                    // Kullanıcı adı eşleşmesi HARFE DUYARSIZ (ILike) — hemen
                                    // yukarıdaki `ServiceUsers` araması da öyle. Tam eşitlikle
                                    // arandığında yazımı farklı gelen kullanıcı mevcut teknisyeni
                                    // bulamayıp her devirde yeni bir `TECH-B2B-…` hayalet kaydı
                                    // açıyor; kişi kendi işlerini ve rol yetkilerini kaybediyordu.
                                    var tech = await _context.Technicians
                                        .FirstOrDefaultAsync(t => EF.Functions.ILike(t.UserId!, b2bUsername) && t.TenantCode == request.TenantCode, cancellationToken);
                                    if (tech == null)
                                    {
                                        tech = new ServiceOps.Domain.Entities.Technician
                                        {
                                            Id = Guid.NewGuid(),
                                            EmployeeNumber = $"TECH-B2B-{DateTime.UtcNow:yyyyMMdd}-{new Random().Next(1000, 9999)}",
                                            FirstName = b2bUsername,
                                            LastName = "B2B",
                                            Phone = "",
                                            Email = "",
                                            UserId = b2bUsername,
                                            TenantCode = request.TenantCode,
                                            IsActive = true,
                                            CreatedAt = DateTime.UtcNow
                                        };
                                        _context.Technicians.Add(tech);
                                    }
                                    localUser.TechnicianId = tech.Id;
                                }
                                else if (expectedRole != "Technician" && localUser.TechnicianId.HasValue)
                                {
                                    // The link is dropped when the role moves off Technician. It
                                    // was only ever set, never cleared, so an account promoted in
                                    // B2B kept its technician id and carried it in the token —
                                    // and a token holding a technicianId reads as a technician
                                    // everywhere, which locked the user out of most of the app.
                                    // The Technician row itself is left alone; its work stays put
                                    // and logging back in as one relinks by username.
                                    localUser.TechnicianId = null;
                                }

                                _context.ServiceUsers.Update(localUser);
                            }

                            await _context.SaveChangesAsync(cancellationToken);

                            // Rol doğrudan B2B'den türetilen değerdir. Eskiden eşleme satırına
                            // yazılıp oradan geri okunuyordu; o kolon kaldırıldı ve zaten fazladan
                            // bir tur atmaktan başka bir şey yapmıyordu.
                            var tokenRole = expectedRole;
                            string? techRolesStr = null;
                            if (localUser.TechnicianId.HasValue)
                            {
                                var tech = await _context.Technicians
                                    .FirstOrDefaultAsync(t => t.Id == localUser.TechnicianId.Value, cancellationToken);
                                if (tech != null && tech.Roles != null)
                                {
                                    techRolesStr = string.Join(",", tech.Roles);
                                }
                            }

                            // Teknisyende oturum kapanmaz: telefon sahada, kimse uyarı penceresine
                            // basamıyor ve oturum ölünce arka plan konum servisi de susuyor.
                            var expiresAtDb = await ResolveSessionExpiryAsync(
                                request.TenantCode!, localUser.Username, adopt: false, cancellationToken,
                                neverExpires: tokenRole == "Technician");
                            var accessTokenDb = CreateJwt(localUser.Id, localUser.Username, tokenRole, request.TenantCode!, localUser.TechnicianId, localUser.DealerCode, techRolesStr, isSuperAdmin: isB2bSuperAdmin, expiresAtUtc: expiresAtDb);

                            return Ok(new LoginResponse
                            {
                                AccessToken = accessTokenDb,
                                ExpiresAt = expiresAtDb,
                                TenantCode = request.TenantCode,
                                User = new LoginUser
                                {
                                    Id = localUser.Id,
                                    Name = localUser.Username,
                                    Role = tokenRole,
                                    TechnicianId = localUser.TechnicianId,
                                    DealerCode = localUser.DealerCode
                                }
                            });
                        }
                        else
                        {
                            return Unauthorized("Service-Ops modülüne giriş yetkiniz bulunmamaktadır.");
                        }
                    }
                }
            }
        }
        catch (Exception ex)
        {
            Console.WriteLine($"B2B ERP integration authentication error: {ex.Message}");
        }

        // 4. YEREL ŞİFRE YOLU KALDIRILDI.
        //
        // Burada `ServiceUsers.PasswordHash` ile ikinci bir kimlik doğrulama vardı. Aynı kişinin
        // şifresi iki yerde (B2B'de BCrypt, burada SHA256) tutuluyordu ve tek bir işlemde birlikte
        // güncellenmiyordu — şifre değiştirme uçlarından biri birini, diğeri ötekini yazıyor,
        // hangisinin geçerli olduğu belirsizleşiyordu. Rol de aynı şekilde iki yerdeydi.
        //
        // Artık TEK KAYNAK B2B `Users`: kimlik doğrulama yukarıdaki B2B dalında yapılır, sayfa
        // yetkisi `Users.RoleId → RolePagePermissions`'tan okunur. `ServiceUsers` yalnızca
        // kullanıcı adını teknisyen kaydına bağlayan eşleme satırıdır.
        //
        // BUNUN BEDELİ: B2B API'sine ulaşılamadığında ServiceOps'a giriş yapılamaz. Önceden bu
        // durumda yerel şifreyle girilebiliyordu. Bilinçli tercih (kullanıcı kararı).

        // 5. Hiçbir kaynakta bulunamadı → REDDET.
        //
        // Burada bir "demo modu" vardı: kullanıcı hiçbir yerde bulunamazsa kullanıcı adından
        // türetilmiş bir kimlikle GEÇERLİ BİR TOKEN üretiliyordu. Şifre hiç kontrol edilmiyordu.
        // Yani API'ye ulaşabilen herkes, uydurma bir kullanıcı adı ve rastgele bir şifreyle
        // istediği firmaya oturum açabiliyordu — kimlik doğrulaması fiilen yoktu.
        // Doğrulandı (2026-08-07): "boyle_bir_kullanici_yok_12345" / "tamamen_yanlis" → HTTP 200.
        return Unauthorized("Kullanıcı adı veya şifre hatalı");
    }

    // POST technician-login KALDIRILDI.
    //
    // Ayri bir teknisyen giris ucuydu: once yerel ServiceUsers.PasswordHash ile dogruluyor,
    // olmazsa B2B'ye dusuyordu. Yerel sifre kalktigi icin ilk dali anlamsiz kaldi; ikinci dal
    // ise zaten /login'in yaptigi seyin kopyasiydi. Web giris sayfasi da bunu yalnizca /login
    // hata verirse yedek olarak cagiriyordu, yani ek bir yetenek saglamiyordu.
    //
    // KAYBEDILEN TEK SEY: bu uc telefon numarasiyla da giris kabul ediyordu
    // (Technician.Phone eslesmesi). /login yalnizca kullanici adi ile calisir.

    [HttpGet("me")]
    [Authorize]
    public ActionResult<object> Me()
    {
        var sub = User.FindFirstValue(JwtRegisteredClaimNames.Sub) ?? User.FindFirstValue(ClaimTypes.NameIdentifier);
        var name = User.FindFirstValue(ClaimTypes.Name) ?? User.Identity?.Name ?? "";
        var role = User.FindFirstValue(ClaimTypes.Role) ?? User.FindFirstValue("role") ?? "";
        var tenantCode = User.FindFirstValue("tenantCode") ?? "";
        var technicianId = User.FindFirstValue("technicianId");

        return Ok(new
        {
            id = sub,
            name,
            role,
            tenantCode,
            technicianId
        });
    }

    [HttpGet("permissions")]
    [Authorize]
    public async Task<ActionResult> GetPermissions(CancellationToken cancellationToken)
    {
        var username = User.FindFirstValue(ClaimTypes.Name) ?? User.Identity?.Name ?? "";
        var tenantCode = User.FindFirstValue("tenantCode") ?? "";
        Console.WriteLine($"[PERMISSIONS_API] GetPermissions requested by Username: '{username}', TenantCode: '{tenantCode}'");

        if (string.IsNullOrWhiteSpace(username) || string.IsNullOrWhiteSpace(tenantCode))
        {
            // Still says whether the session is unrestricted. Leaving the field off made the
            // client fall back to reading it off the token, which is the guess this endpoint
            // exists to replace — and a session with no tenant is typically the management one.
            // Yalnızca claim'e bakılır — rol adı stringine değil.
            var unrestricted = User.FindFirstValue("IsSuperSuperAdmin") == "1"
                || User.FindFirstValue("isSuperAdmin") == "true";

            return Ok(new { success = true, isSuperAdmin = unrestricted, allowedPageKeys = Array.Empty<string>() });
        }

        // 1. Resolve master connection string
        string? masterConn = null;
        try
        {
            var baseConn = _configuration.GetConnectionString("DefaultConnection") 
                           ?? _configuration.GetConnectionString("ServiceOpsBase");
            if (!string.IsNullOrWhiteSpace(baseConn))
            {
                var connBuilder = new NpgsqlConnectionStringBuilder(baseConn)
                {
                    Database = "b2b_erp_master"
                };
                masterConn = connBuilder.ConnectionString;
            }
        }
        catch { }

        if (string.IsNullOrWhiteSpace(masterConn))
        {
            masterConn = "Host=localhost;Port=5434;Database=b2b_erp_master;Username=b2b;Password=b2b";
        }

        // 2. Resolve tenant B2B database name
        string? b2bDbName = null;
        try
        {
            using (var conn = new NpgsqlConnection(masterConn))
            {
                await conn.OpenAsync(cancellationToken);
                using (var cmd = new NpgsqlCommand("SELECT \"DbName\" FROM public.\"Tenants\" WHERE LOWER(\"Code\") = @tenantCode LIMIT 1", conn))
                {
                    cmd.Parameters.AddWithValue("tenantCode", tenantCode.ToLowerInvariant());
                    b2bDbName = await cmd.ExecuteScalarAsync(cancellationToken) as string;
                }
            }
        }
        catch { }

        if (string.IsNullOrWhiteSpace(b2bDbName))
        {
            b2bDbName = "b2b_erp";
        }

        // 3. Build connection string for tenant B2B database
        string? b2bConnStr = null;
        try
        {
            var baseConn = _configuration.GetConnectionString("DefaultConnection") 
                           ?? _configuration.GetConnectionString("ServiceOpsBase");
            if (!string.IsNullOrWhiteSpace(baseConn))
            {
                var connBuilder = new NpgsqlConnectionStringBuilder(baseConn)
                {
                    Database = b2bDbName
                };
                b2bConnStr = connBuilder.ConnectionString;
            }
        }
        catch { }

        if (string.IsNullOrWhiteSpace(b2bConnStr))
        {
            b2bConnStr = $"Host=localhost;Port=5434;Database={b2bDbName};Username=b2b;Password=b2b";
        }

        // 4. Retrieve role and permissions
        var allowedPageKeys = new List<string>();
        int? roleId = null;
        bool isSuperAdmin = false;

        try
        {
            using (var conn = new NpgsqlConnection(b2bConnStr))
            {
                await conn.OpenAsync(cancellationToken);

                // Claim'e dayalı ssa/süper admin kısayolu DIŞINDA burada artık hiçbir kullanıcı
                // adı ya da rol-adı stringi süper admin saymıyor. "ssa"/"superadmin"/"SuperAdmin"/
                // "Admin" karşılaştırmaları kaldırıldı — bunlardan biri (role claim'i "Admin" olan
                // HERKES) DB'ye hiç sorulmadan tam yetki alıyordu, oysa B2B'den gelen teknisyen
                // olmayan her kullanıcı (Bayi/AltBayi dahil) varsayılan olarak "Admin" claim'iyle
                // geliyordu. Gerçek süper admin kararı DB'deki role satırının kendi
                // `IsSuperAdmin` bayrağından (aşağıdaki sorgu) geliyor — bu, kod içinde rol ADI
                // hardcode etmek değil, veriye bakmak.
                var isSsaClaim = User.FindFirstValue("IsSuperSuperAdmin") == "1" || User.FindFirstValue("isSuperAdmin") == "true";

                if (isSsaClaim)
                {
                    isSuperAdmin = true;
                }
                else
                {
                    using (var cmd = new NpgsqlCommand(@"
                        SELECT u.""RoleId"", r.""IsSuperAdmin""
                        FROM public.""Users"" u
                        LEFT JOIN public.""Roles"" r ON u.""RoleId"" = r.""Id""
                        WHERE LOWER(u.""Username"") = @username AND u.""IsActive"" = true
                        LIMIT 1", conn))
                    {
                        cmd.Parameters.AddWithValue("username", username.ToLowerInvariant());
                        using (var reader = await cmd.ExecuteReaderAsync(cancellationToken))
                        {
                            if (await reader.ReadAsync(cancellationToken))
                            {
                                roleId = reader.IsDBNull(0) ? (int?)null : reader.GetInt32(0);
                                if (!reader.IsDBNull(1) && reader.GetBoolean(1))
                                {
                                    isSuperAdmin = true;
                                }
                            }
                        }
                    }
                }

                var technicianIdStr = User.FindFirstValue("technicianId");
                Guid? techId = null;
                if (Guid.TryParse(technicianIdStr, out var parsedId))
                {
                    techId = parsedId;
                }

                if (isSuperAdmin)
                {
                    using (var cmd = new NpgsqlCommand("SELECT \"Key\" FROM public.\"Pages\" WHERE \"ModuleKey\" = 'serviceOps' AND \"IsActive\" = true", conn))
                    using (var reader = await cmd.ExecuteReaderAsync(cancellationToken))
                    {
                        while (await reader.ReadAsync(cancellationToken))
                        {
                            allowedPageKeys.Add(reader.GetString(0));
                        }
                    }

                    // Add all sub-permissions explicitly for SuperAdmin / SSA
                    var subKeys = new[]
                    {
                        "dashboard",
                        "montajKabul.yeniKabul",
                        "montajKabul.kabulDuzenle",
                        "montajYonetimi.planlama",
                        "montajYonetimi.teslimat",
                        "montajYonetimi.geriPlanlama",
                        "buyukEvAletleriKabul.yeniKabul",
                        "buyukUrun.planlama",
                        "buyukUrun.sahaPlanlama",
                        "buyukUrun.atolye",
                        "buyukUrun.hazirTeslimat",
                        "buyukUrun.teslimattakiler",
                        "buyukUrun.islemKaydet",
                        "buyukUrun.yedekParca",
                        "kucukUrunKabul.yeniKabul",
                        "atolyeAriza.atolye",
                        "atolyeAriza.hazirTeslimat",
                        "atolyeAriza.teslimattakiler",
                        "atolyeAriza.islemKaydet",
                        "atolyeAriza.yedekParca",
                        "kargoTakibi.durumGuncelle",
                        "kargoPlanlama.yeniPlan",
                        "teknisyenler.yeniTeknisyen",
                        "teknisyenler.teknisyenDuzenle",
                        "teknisyenler.sifreDegistir",
                        "musterilerBayiler.yeniMusteri",
                        "musterilerBayiler.musteriDuzenle",
                        "stok.yeniStok",
                        "stok.stokGuncelle",
                        "aracDepolari.depoTransfer",
                        "hakedis",
                        "hakedis.tumIsleriGorme",
                        "hakedis.sadeceKendiIsleri"
                    };
                    foreach (var k in subKeys)
                    {
                        if (!allowedPageKeys.Contains(k)) allowedPageKeys.Add(k);
                    }
                }
                else
                {

                    // 2. Query RolePagePermissions for roleId
                    if (!roleId.HasValue && string.Equals(User.FindFirstValue(ClaimTypes.Role) ?? User.FindFirstValue("role") ?? "", "Technician", StringComparison.OrdinalIgnoreCase))
                    {
                        using (var cmd = new NpgsqlCommand("SELECT \"Id\" FROM public.\"Roles\" WHERE \"Code\" = 'ServisPersonel' LIMIT 1", conn))
                        {
                            var idObj = await cmd.ExecuteScalarAsync(cancellationToken);
                            if (idObj != null)
                            {
                                roleId = Convert.ToInt32(idObj);
                            }
                        }
                    }

                    if (roleId.HasValue)
                    {
                        using (var cmd = new NpgsqlCommand(@"
                            SELECT p.""Key""
                            FROM public.""RolePagePermissions"" rp
                            INNER JOIN public.""Pages"" p ON rp.""PageId"" = p.""Id""
                            WHERE rp.""RoleId"" = @roleId AND p.""ModuleKey"" = 'serviceOps' AND rp.""CanAccess"" = true AND p.""IsActive"" = true", conn))
                        {
                            cmd.Parameters.AddWithValue("roleId", roleId.Value);
                            using (var reader = await cmd.ExecuteReaderAsync(cancellationToken))
                            {
                                while (await reader.ReadAsync(cancellationToken))
                                {
                                    var pageKey = reader.GetString(0);
                                    if (!allowedPageKeys.Contains(pageKey))
                                    {
                                        allowedPageKeys.Add(pageKey);
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
        catch (Exception ex)
        {
            Console.WriteLine($"Error retrieving permissions from B2B DB: {ex.Message}");
        }

        var scopeRoots = allowedPageKeys
            .Select(k => k.Contains('.') ? k[..k.LastIndexOf('.')] : k)
            .Append("dashboard")
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();
        var pageScopes = await _permissions.GetPageScopesAsync(User, scopeRoots, cancellationToken);

        Console.WriteLine($"[PERMISSIONS_API] Resolved RoleId: '{roleId}', IsSuperAdmin: {isSuperAdmin}, AllowedPageKeys Count: {allowedPageKeys.Count}, Keys: '{string.Join(",", allowedPageKeys)}'");

        // isSuperAdmin is part of the answer, not something the client should re-derive. It used
        // to work this out from the role claim on its own, which fails whenever that claim is an
        // array (["SuperAdmin","Admin"]) — an SSA was then treated as an ordinary user and held
        // to allowedPageKeys, which for SSA is only a partial hand-written list. Unrestricted is
        // a decision this endpoint has already made; it now says so.
        return Ok(new { success = true, isSuperAdmin, allowedPageKeys, pageScopes });
    }

    /// <summary>
    /// Exchanges a B2B ERP session for a ServiceOps one.
    ///
    /// The two APIs sign with different keys and declare different issuers, so an ERP token
    /// is not and must not become a credential here — every request carrying one was rejected,
    /// which is what bounced a signed-in user back to the login screen. Rather than widening
    /// this API to accept another issuer's tokens, the ERP token is verified once, against the
    /// ERP's own parameters, and discarded: what the caller gets back is an ordinary
    /// ServiceOps token this API issued itself.
    ///
    /// Anonymous by necessity — the caller has no ServiceOps credential yet; that is the point.
    /// The ERP signature is the authentication.
    /// </summary>
    [HttpPost("exchange")]
    [AllowAnonymous]
    public async Task<IActionResult> ExchangeB2BToken([FromBody] ExchangeRequest request, CancellationToken cancellationToken)
    {
        if (request == null || string.IsNullOrWhiteSpace(request.Token))
        {
            return BadRequest(new { success = false, message = "Devir bilgisi eksik." });
        }

        var erpKey = _configuration["B2BJwt:SecretKey"];
        var erpIssuer = _configuration["B2BJwt:Issuer"];
        var erpAudience = _configuration["B2BJwt:Audience"];

        if (string.IsNullOrWhiteSpace(erpKey))
        {
            // Failing closed: without the ERP key nothing can be verified, and accepting the
            // token unverified would let anyone mint a ServiceOps session.
            return StatusCode(StatusCodes.Status503ServiceUnavailable,
                new { success = false, message = "B2B devir yapılandırması eksik." });
        }

        ClaimsPrincipal principal;
        try
        {
            principal = new JwtSecurityTokenHandler().ValidateToken(
                request.Token,
                new TokenValidationParameters
                {
                    ValidateIssuerSigningKey = true,
                    IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(erpKey)),
                    ValidateIssuer = !string.IsNullOrWhiteSpace(erpIssuer),
                    ValidIssuer = erpIssuer,
                    ValidateAudience = !string.IsNullOrWhiteSpace(erpAudience),
                    ValidAudience = erpAudience,
                    ValidateLifetime = true,
                    ClockSkew = TimeSpan.FromMinutes(1)
                },
                out _);
        }
        catch (Exception ex)
        {
            // The reason is logged, never returned: distinguishing "bad signature" from
            // "expired" tells a probe which half to work on.
            Console.WriteLine($"[B2B_EXCHANGE] rejected: {ex.GetType().Name}: {ex.Message}");
            return Unauthorized(new { success = false, message = "B2B oturumu doğrulanamadı." });
        }

        var username = principal.FindFirst(ClaimTypes.Name)?.Value ?? string.Empty;
        var tenantCode = (request.TenantCode ?? string.Empty).Trim();

        if (string.IsNullOrWhiteSpace(username) || string.IsNullOrWhiteSpace(tenantCode))
        {
            return BadRequest(new { success = false, message = "Devir bilgisi eksik." });
        }

        // Identity comes from the verified token, never from the request body: the tenant is
        // the only field the caller supplies, and it selects a database rather than granting
        // anything on its own.
        var roleCode = principal.FindFirst("RoleCode")?.Value
                       ?? principal.FindFirst(ClaimTypes.Role)?.Value
                       ?? string.Empty;

        var isSuperAdmin = principal.FindFirst("IsSuperAdmin")?.Value == "1"
                           || principal.FindFirst("IsSuperSuperAdmin")?.Value == "1";

        /*
          DEVİRDE TEKNİSYEN KİMLİĞİ KAYBOLUYORDU (2026-09-18 canlı bildirimi: rolde Fatura Takip
          açık olduğu hâlde ekran "İstek başarısız (403)" veriyordu).

          Normal girişte (`Login`) saha teknisyeni, servis tarafındaki teknisyen kaydına
          bağlanıyor ve kimlik token'a yazılıyor. B2B'den "Servise Geç" ile gelen devirde ise
          `technicianId: null` gidiyordu. Teknisyen kapsamıyla çalışan ekranlar (Fatura Takip
          gibi) "kimin işleri?" sorusunu cevaplayamayınca kapsam None'a düşüyor ve kapı 403
          veriyor — kullanıcı bunu yetki sanıyor.

          Kimlik İSTEKTEN DEĞİL, veritabanından çözülüyor: doğrulanmış token'daki kullanıcı adı
          ile servis kaydı aranıyor. Rolü saha teknisyeni olmayan kullanıcıda hiçbir şey
          değişmiyor.
        */
        Guid? handoverTechnicianId = null;
        string? handoverTechnicianRoles = null;
        if (!isSuperAdmin && IsFieldTechnicianRole(roleCode, null))
        {
            var serviceUser = await _context.ServiceUsers
                .FirstOrDefaultAsync(u => EF.Functions.ILike(u.Username, username), cancellationToken);
            handoverTechnicianId = serviceUser?.TechnicianId;

            if (!handoverTechnicianId.HasValue)
            {
                var tech = await _context.Technicians
                    .FirstOrDefaultAsync(t => t.UserId != null && EF.Functions.ILike(t.UserId!, username), cancellationToken);
                handoverTechnicianId = tech?.Id;
            }

            if (handoverTechnicianId.HasValue)
            {
                var tech = await _context.Technicians
                    .FirstOrDefaultAsync(t => t.Id == handoverTechnicianId.Value, cancellationToken);
                if (tech?.Roles != null && tech.Roles.Length > 0)
                {
                    handoverTechnicianRoles = string.Join(",", tech.Roles);
                }
            }
        }

        // Etiket normal girişteki `expectedRole` ile aynı olmalı: kimliği bulunan saha
        // teknisyeni burada da "Technician" sayılır, yoksa iki giriş yolu aynı kişiye farklı
        // davranırdı.
        var role = isSuperAdmin
            ? "SuperAdmin"
            : handoverTechnicianId.HasValue
                ? "Technician"
                : (string.IsNullOrWhiteSpace(roleCode) ? "User" : roleCode);

        var subject = principal.FindFirst(ClaimTypes.NameIdentifier)?.Value ?? username;
        var userId = DeterministicGuidFromString($"b2b:{tenantCode}:{subject}");

        // Devir yeni bir oturum DEĞİL: kullanıcı bayide zaten açık olan oturumuyla geliyor.
        // Bitiş oradan devralınır, böylece iki taraf aynı anda sona erer.
        var expiresAtUtc = await ResolveSessionExpiryAsync(tenantCode, username, adopt: true, cancellationToken);

        var serviceToken = CreateJwt(
            userId,
            username,
            role,
            tenantCode,
            technicianId: handoverTechnicianId,
            dealerCode: principal.FindFirst("Carikodu")?.Value,
            technicianRoles: handoverTechnicianRoles,
            fullName: principal.FindFirst("Unvan")?.Value,
            isSuperAdmin: isSuperAdmin,
            expiresAtUtc: expiresAtUtc);

        return Ok(new
        {
            success = true,
            accessToken = serviceToken,
            tenantCode,
            username,
            role,
            expiresAtUtc
        });
    }

    /// <summary>
    /// Ortak oturumun durumu — B2B'deki aynı adlı uçla birebir aynı sözleşme.
    ///
    /// Ekranlar bunu periyodik olarak sorar:
    ///   - valid=false ise oturum bitmiş ya da DİĞER taraftan (bayi / başka cihaz) kapatılmıştır,
    ///   - expiresAtUtc iki uygulamada da aynıdır → geri sayım ve uyarı ekranı ortak,
    ///   - accessToken doluysa ortak bitiş değişmiştir (ör. bayiden uzatılmıştır) → istemci
    ///     sessizce yeni token'a geçer.
    /// </summary>
    [HttpGet("session-state")]
    [Authorize]
    public async Task<IActionResult> GetSessionState(CancellationToken cancellationToken)
    {
        var username = User.FindFirstValue(ClaimTypes.Name) ?? string.Empty;
        var tenantCode = User.FindFirstValue("tenantCode") ?? string.Empty;
        var tokenExpUtc = ReadTokenExpiryUtc();

        if (string.IsNullOrWhiteSpace(tenantCode) || string.IsNullOrWhiteSpace(username))
        {
            // Firmasız oturum (yönetim girişi) ortak deftere yazılmaz; token'ın kendi bitişi geçerli.
            return Ok(new
            {
                success = true,
                valid = tokenExpUtc is null || tokenExpUtc.Value > DateTime.UtcNow,
                expiresAtUtc = tokenExpUtc,
                alertBeforeMinutes = SharedSessionStore.DefaultAlertBeforeMinutes,
                durationMinutes = SharedSessionStore.DefaultDurationMinutes
            });
        }

        SharedSessionState? state = null;
        var storeReachable = true;
        try
        {
            state = await _sharedSessions.GetAsync(tenantCode, username, cancellationToken);
        }
        catch (Exception ex)
        {
            storeReachable = false;
            Console.WriteLine($"[SHARED_SESSION] read failed: {ex.Message}");
        }

        var (durationMinutes, alertBeforeMinutes) = state is not null
            ? (state.DurationMinutes, state.AlertBeforeMinutes)
            : await _sharedSessions.GetSettingsAsync(tenantCode, cancellationToken);

        // Kayıt yoksa (bu sürümden önce açılmış oturum) token'ın kendi bitişi kayda geçirilir.
        if (state is null)
        {
            if (storeReachable && tokenExpUtc.HasValue)
            {
                try
                {
                    state = await _sharedSessions.StartAsync(tenantCode, username, tokenExpUtc.Value, cancellationToken);
                }
                catch
                {
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

        // 5 saniyelik pay: imza anındaki yuvarlama yüzünden her yoklamada token üretilmesin.
        string? refreshedToken = null;
        var drift = tokenExpUtc.HasValue ? (state.ExpiresAtUtc - tokenExpUtc.Value).Duration() : TimeSpan.MaxValue;
        if (drift > TimeSpan.FromSeconds(5))
        {
            refreshedToken = IssueTokenForCurrentUser(state.ExpiresAtUtc);
        }

        return Ok(new
        {
            success = true,
            valid = true,
            expiresAtUtc = state.ExpiresAtUtc,
            alertBeforeMinutes,
            durationMinutes,
            accessToken = refreshedToken
        });
    }

    /// <summary>
    /// Oturumu uzatır. Uzatma ORTAK kayda yazılır: bayi tarafındaki oturum da aynı anda uzar.
    /// </summary>
    [HttpPost("extend-session")]
    [Authorize]
    public async Task<IActionResult> ExtendSession(CancellationToken cancellationToken)
    {
        var username = User.FindFirstValue(ClaimTypes.Name) ?? string.Empty;
        var tenantCode = User.FindFirstValue("tenantCode") ?? string.Empty;

        if (string.IsNullOrWhiteSpace(username))
        {
            return Unauthorized(new { success = false, message = "Geçersiz kullanıcı" });
        }

        DateTime expiresAtUtc;
        int? alertBeforeMinutes = null;

        if (string.IsNullOrWhiteSpace(tenantCode))
        {
            var current = ReadTokenExpiryUtc();
            var baseUtc = current.HasValue && current.Value > DateTime.UtcNow ? current.Value : DateTime.UtcNow;
            expiresAtUtc = baseUtc.AddMinutes(SharedSessionStore.DefaultDurationMinutes);
        }
        else
        {
            SharedSessionState? extended = null;
            try
            {
                extended = await _sharedSessions.ExtendAsync(tenantCode, username, cancellationToken);
                if (extended is null)
                {
                    // Oturum diğer taraftan kapatılmış: uzatmak yerine düşürülür.
                    return Unauthorized(new { success = false, message = "Oturum kapatılmış" });
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[SHARED_SESSION] extend failed, falling back to local: {ex.Message}");
            }

            if (extended is not null)
            {
                expiresAtUtc = extended.ExpiresAtUtc;
                alertBeforeMinutes = extended.AlertBeforeMinutes;
            }
            else
            {
                var (duration, alert) = await _sharedSessions.GetSettingsAsync(tenantCode, cancellationToken);
                var current = ReadTokenExpiryUtc();
                var baseUtc = current.HasValue && current.Value > DateTime.UtcNow ? current.Value : DateTime.UtcNow;
                expiresAtUtc = baseUtc.AddMinutes(duration);
                alertBeforeMinutes = alert;
            }
        }

        var accessToken = IssueTokenForCurrentUser(expiresAtUtc);
        return Ok(new { success = true, data = new { accessToken, expiresAtUtc, alertBeforeMinutes } });
    }

    /// <summary>
    /// Çıkış. Ortak kayda "kapatıldı" yazar: bayi tarafındaki oturum da düşer.
    /// </summary>
    [HttpPost("logout")]
    [Authorize]
    public async Task<IActionResult> Logout(CancellationToken cancellationToken)
    {
        var username = User.FindFirstValue(ClaimTypes.Name) ?? string.Empty;
        var tenantCode = User.FindFirstValue("tenantCode") ?? string.Empty;

        if (!string.IsNullOrWhiteSpace(username) && !string.IsNullOrWhiteSpace(tenantCode))
        {
            try
            {
                await _sharedSessions.RevokeAsync(tenantCode, username, cancellationToken);
            }
            catch (Exception ex)
            {
                // Çıkış istemcide her hâlükârda tamamlanır; burada başarısızlık, kullanıcıyı
                // çıkamamış durumda bırakmamalı.
                Console.WriteLine($"[SHARED_SESSION] revoke failed: {ex.Message}");
            }
        }

        return Ok(new { success = true });
    }

    /// <summary>Mevcut isteğin kimliğiyle, bitişi tam olarak verilen ana ayarlanmış yeni token.</summary>
    private string IssueTokenForCurrentUser(DateTime expiresAtUtc)
    {
        var sub = User.FindFirstValue(JwtRegisteredClaimNames.Sub) ?? User.FindFirstValue(ClaimTypes.NameIdentifier) ?? string.Empty;
        var userId = Guid.TryParse(sub, out var parsed) ? parsed : Guid.Empty;
        var username = User.FindFirstValue(ClaimTypes.Name) ?? string.Empty;
        var tenantCode = User.FindFirstValue("tenantCode") ?? string.Empty;
        var technicianIdRaw = User.FindFirstValue("technicianId");
        var technicianId = Guid.TryParse(technicianIdRaw, out var techId) ? techId : (Guid?)null;

        // Rol, süper admin bayrağı ve teknisyen bilgileri yeniden hesaplanmaz, MEVCUT token'dan
        // taşınır: bu uç yalnızca süreyi tazeler, yetkiyi yeniden vermez.
        var isSuperAdmin = User.FindFirstValue("IsSuperSuperAdmin") == "1" || User.FindFirstValue("isSuperAdmin") == "true";
        var role = isSuperAdmin ? "SuperAdmin" : (User.FindFirstValue(ClaimTypes.Role) ?? User.FindFirstValue("role") ?? "User");

        return CreateJwt(
            userId,
            username,
            role,
            tenantCode,
            technicianId,
            User.FindFirstValue("dealerCode"),
            User.FindFirstValue("technicianRoles"),
            User.FindFirstValue("fullName"),
            isSuperAdmin,
            expiresAtUtc);
    }

    /// <summary>
    /// Token'ın bitişi. Claim üzerinden değil ham token'dan okunuyor: JwtBearer gelen claim
    /// adlarını eşliyor ve `exp` gibi kayıtlı alanların principal üzerindeki adı sürüme bağlı.
    /// </summary>
    private DateTime? ReadTokenExpiryUtc()
    {
        var raw = Request.Headers.Authorization.ToString().Trim();
        if (raw.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase)) raw = raw.Substring(7).Trim();
        if (string.IsNullOrWhiteSpace(raw)) return null;

        try
        {
            var token = new JwtSecurityTokenHandler().ReadJwtToken(raw);
            var exp = token.Claims.FirstOrDefault(x => x.Type == JwtRegisteredClaimNames.Exp)?.Value;
            if (long.TryParse(exp, out var seconds) && seconds > 0)
            {
                return DateTimeOffset.FromUnixTimeSeconds(seconds).UtcDateTime;
            }
        }
        catch
        {
        }

        return null;
    }

    public sealed class ExchangeRequest
    {
        public string Token { get; set; } = string.Empty;
        public string TenantCode { get; set; } = string.Empty;
    }

    /// <summary>
    /// `role` etiketi ekranlarda görüntü/uyumluluk için kalmaya devam eder ama artık bir yetki
    /// KARARI değildir — süper admin bypass'ı yalnızca `isSuperAdmin` parametresi (çağıran yerde
    /// GERÇEKTEN kanıtlanmış bir bayraktan: GlobalUsers.IsSuperSuperAdmin ya da B2B login
    /// yanıtındaki isSuperAdmin) true verildiğinde IsSuperSuperAdmin/isSuperAdmin claim'lerini
    /// yazar. "SuperAdmin" veya "Admin" string'i tek başına artık hiçbir şey açmaz.
    /// </summary>
    private string CreateJwt(Guid userId, string username, string role, string tenantCode, Guid? technicianId, string? dealerCode, string? technicianRoles = null, string? fullName = null, bool isSuperAdmin = false, DateTime? expiresAtUtc = null)
    {
        var issuer = _configuration["Jwt:Issuer"];
        var audience = _configuration["Jwt:Audience"];
        var key = _configuration["Jwt:Key"];

        if (string.IsNullOrWhiteSpace(key))
            throw new InvalidOperationException("Jwt:Key bulunamadı");

        var claims = new List<Claim>
        {
            new(JwtRegisteredClaimNames.Sub, userId.ToString()),
            new(ClaimTypes.Name, username),
            new("tenantCode", tenantCode),
            // Açıkça yazılıyor: "bu token çıkıştan önce mi üretildi" kararı buna bakıyor
            // (bkz. SharedSessionRevocationGuard).
            new(JwtRegisteredClaimNames.Iat, DateTimeOffset.UtcNow.ToUnixTimeSeconds().ToString(), ClaimValueTypes.Integer64),
        };

        if (!string.IsNullOrWhiteSpace(fullName))
        {
            claims.Add(new Claim("fullName", fullName));
            claims.Add(new Claim(ClaimTypes.GivenName, fullName));
        }

        if (isSuperAdmin)
        {
            claims.Add(new Claim("IsSuperSuperAdmin", "1"));
            claims.Add(new Claim("isSuperAdmin", "true"));
        }

        if (string.Equals(role, "SuperAdmin", StringComparison.OrdinalIgnoreCase))
        {
            claims.Add(new Claim(ClaimTypes.Role, "SuperAdmin"));
            claims.Add(new Claim(ClaimTypes.Role, "Admin"));
            claims.Add(new Claim("role", "SuperAdmin"));
            claims.Add(new Claim("role", "Admin"));
        }
        else
        {
            claims.Add(new Claim(ClaimTypes.Role, role));
            claims.Add(new Claim("role", role));
        }

        if (technicianId.HasValue)
            claims.Add(new Claim("technicianId", technicianId.Value.ToString()));

        if (!string.IsNullOrEmpty(dealerCode))
            claims.Add(new Claim("dealerCode", dealerCode));

        if (!string.IsNullOrEmpty(technicianRoles))
            claims.Add(new Claim("technicianRoles", technicianRoles));

        var signingKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(key));
        var creds = new SigningCredentials(signingKey, SecurityAlgorithms.HmacSha256);

        // Bitiş, ortak oturum kaydından gelir (bayideki JWT süre ayarı). Verilmediyse — yalnızca
        // ortak defter okunamadığında olur — eski davranışa düşülür.
        var expires = expiresAtUtc.HasValue && expiresAtUtc.Value > DateTime.UtcNow
            ? expiresAtUtc.Value.ToUniversalTime()
            : DateTime.UtcNow.AddMinutes(SharedSessionStore.DefaultDurationMinutes);

        var token = new JwtSecurityToken(
            issuer: issuer,
            audience: audience,
            claims: claims,
            expires: expires,
            signingCredentials: creds);

        return new JwtSecurityTokenHandler().WriteToken(token);
    }

    private static Guid DeterministicGuidFromString(string input)
    {
        using var sha1 = System.Security.Cryptography.SHA1.Create();
        var hash = sha1.ComputeHash(Encoding.UTF8.GetBytes(input));
        var guidBytes = new byte[16];
        Array.Copy(hash, guidBytes, 16);
        return new Guid(guidBytes);
    }

    /// <summary>
    /// `GlobalUsers.PasswordHash` doğrulaması.
    ///
    /// BCRYPT DESTEĞİ ŞART: bu tablo B2B tarafından yazılıyor ve B2B şifreleri BCrypt ile
    /// saklıyor (`$2a$...`, 60 karakter). Burada yalnızca SHA256 karşılaştırması yapılıyordu,
    /// dolayısıyla BCrypt'li bir global kullanıcı ASLA eşleşmiyordu.
    ///
    /// Sonucu sinsiydi: global kullanıcı kontrolü B2B doğrulamasından ÖNCE çalışıyor ve
    /// eşleşmezse oracıkta 401 dönüyor — yani kullanıcı bayiye aynı şifreyle girebilirken
    /// servise hiç giremiyordu ve istek B2B'ye hiç ulaşmıyordu. ("Bayiye giriyor, servise
    /// girmiyor" şikâyeti buydu.)
    ///
    /// Üç biçim de kabul ediliyor: BCrypt (B2B'nin yazdığı), SHA256+Base64 (ServiceOps'un eski
    /// biçimi) ve düz metin (çok eski kayıtlar).
    /// </summary>
    private static bool VerifyPassword(string password, string passwordHash)
    {
        if (string.IsNullOrWhiteSpace(passwordHash)) return false;

        if (passwordHash.StartsWith("$2a$", StringComparison.Ordinal)
            || passwordHash.StartsWith("$2b$", StringComparison.Ordinal)
            || passwordHash.StartsWith("$2y$", StringComparison.Ordinal)
            || passwordHash.StartsWith("$2x$", StringComparison.Ordinal))
        {
            try
            {
                return BCrypt.Net.BCrypt.Verify(password, passwordHash);
            }
            catch
            {
                // Bozuk/kesik hash: eşleşmedi say. Burada patlamak girişi 500'e çevirirdi.
                return false;
            }
        }

        using var sha = SHA256.Create();
        var bytes = sha.ComputeHash(Encoding.UTF8.GetBytes(password));
        var computed = Convert.ToBase64String(bytes);
        return string.Equals(computed, passwordHash, StringComparison.Ordinal);
    }
}

public sealed class LoginRequest
{
    public string TenantCode { get; set; } = string.Empty;
    public string Username { get; set; } = string.Empty;
    public string Password { get; set; } = string.Empty;
}

public sealed class LoginResponse
{
    public string AccessToken { get; set; } = string.Empty;
    public DateTime ExpiresAt { get; set; }
    public string TenantCode { get; set; } = string.Empty;
    public LoginUser User { get; set; } = new();
}

public sealed class LoginUser
{
    public Guid Id { get; set; }
    public string Name { get; set; } = string.Empty;
    public string Role { get; set; } = string.Empty;
    public Guid? TechnicianId { get; set; }
    public string? DealerCode { get; set; }
}
