using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Npgsql;
using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using System.Linq;

namespace ServiceOps.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
[Authorize]
public class ErpController : ControllerBase
{
    private readonly IConfiguration _configuration;
    private readonly IHttpClientFactory _httpClientFactory;
    private readonly ServiceOps.Infrastructure.Data.ApplicationDbContext _context;
    private readonly ServiceOps.Api.Services.IServiceOpsPermissionService _permissions;

    public ErpController(
        IConfiguration configuration,
        IHttpClientFactory httpClientFactory,
        ServiceOps.Infrastructure.Data.ApplicationDbContext context,
        ServiceOps.Api.Services.IServiceOpsPermissionService permissions)
    {
        _configuration = configuration;
        _httpClientFactory = httpClientFactory;
        _context = context;
        _permissions = permissions;
    }

    /// <summary>
    /// Başka bir personelin araç deposuna erişim izni var mı?
    ///
    /// admin/technician-* uçları teknisyen kimliğini yoldan alıyor ve HİÇBİR kontrol yapmıyordu:
    /// [Authorize] dışında bir engel olmadığı için herhangi bir saha personeli başka bir
    /// personelin araç stoğunu okuyabiliyor, hatta onun deposundan satış yapabiliyordu.
    /// Kural: kendi aracın serbest; başkasınınki 'aracDepolari' sayfasında tüm kayıtları görme
    /// yetkisi ister.
    /// </summary>
    /// <summary>
    /// Servis faturası kesme yetkisi.
    ///
    /// Saha personeli kendi üzerindeki işi tamamlarken fatura kesebilmeli; ama BAŞKASININ
    /// kaydına kesememeli. Yönetici (tüm kayıtlar kapsamı) her kayda kesebilir.
    ///
    /// Kayıt kimliği hiç gönderilmediyse — ki bu, faturayı hiçbir servise bağlamayan bir
    /// istektir — yalnızca yönetici kapsamı kabul edilir.
    /// </summary>
    /// <summary>
    /// Fatura kapısının baktığı sayfa anahtarları — ALT SEKMELER DAHİL.
    ///
    /// Buraya yalnızca kök anahtarlar (`buyukUrun`, `atolyeAriza`, `montajYonetimi`) yazılıydı ve
    /// bu, servis faturasını fiilen çalışmaz hâle getiriyordu: yetkiler bu kurulumda SEKME
    /// düzeyinde veriliyor. Servis Müdürü'nde `atolyeAriza.teslimattakiler.tumIsleriGorme` var ama
    /// `atolyeAriza.tumIsleriGorme` YOK; kapı kök anahtarı sorduğu için kapsam "kendi işleri"ne
    /// düşüyor, müdürün teknisyen kaydı da olmadığı için sonuç `false` → 403.
    ///
    /// Sonuç kullanıcıya hiç görünmüyordu: istemci fatura çağrısını `catch { console.error }` ile
    /// yutuyor, "Teslimat başarıyla planlandı" diyordu. Girilen ücret ve yedek parçalar satış
    /// faturasına hiç düşmüyordu. (Kullanıcı bildirimi, 2026-08-11.)
    ///
    /// Aynı tuzak montaj tarafında `GetWidestScopeAsync` ile çözülmüştü; kural aynı olmalı.
    /// </summary>
    private static readonly string[] InvoicePageKeys =
    {
        "buyukUrun",
        "buyukUrun.planlama", "buyukUrun.sahaPlanlama", "buyukUrun.atolye",
        "buyukUrun.hazirTeslimat", "buyukUrun.teslimattakiler",
        "atolyeAriza",
        "atolyeAriza.atolye", "atolyeAriza.hazirTeslimat", "atolyeAriza.teslimattakiler",
        "montajYonetimi",
        "montajYonetimi.planlama", "montajYonetimi.teslimat"
    };

    private async Task<bool> CanInvoiceServiceRecordAsync(Guid? serviceRecordId, CancellationToken cancellationToken)
    {
        foreach (var pageKey in InvoicePageKeys)
        {
            var scope = await _permissions.GetScopeAsync(User, pageKey, cancellationToken);
            if (scope.Kind == ServiceOps.Api.Services.ServiceOpsScopeKind.All) return true;
        }

        if (!serviceRecordId.HasValue) return false;

        var technicianId = _permissions.GetTechnicianId(User);
        if (!technicianId.HasValue) return false;

        // Kendi üzerine atanmış iş: kaydın kendisinde ya da bir montaj görevinde.
        return await _context.ServiceRecords
            .AsNoTracking()
            .AnyAsync(s => s.Id == serviceRecordId.Value
                           && (s.AssignedTechnicianId == technicianId.Value
                               || s.InstallationTasks.Any(t => t.AssignedTechnicianId == technicianId.Value)),
                cancellationToken);
    }

    private async Task<string?> GetB2BConnectionStringAsync(CancellationToken cancellationToken)
    {
        var tenantCode = GetTenantCode();
        if (string.IsNullOrWhiteSpace(tenantCode)) return null;

        var baseConn = _configuration.GetConnectionString("DefaultConnection") 
                       ?? _configuration.GetConnectionString("ServiceOpsBase");
        if (string.IsNullOrWhiteSpace(baseConn)) return null;

        try
        {
            var masterBuilder = new NpgsqlConnectionStringBuilder(baseConn) { Database = "b2b_erp_master" };
            string? dbName = null;
            await using (var master = new NpgsqlConnection(masterBuilder.ConnectionString))
            {
                await master.OpenAsync(cancellationToken);
                await using var cmd = new NpgsqlCommand("SELECT \"DbName\" FROM public.\"Tenants\" WHERE LOWER(\"Code\") = @tenantCode LIMIT 1", master);
                cmd.Parameters.AddWithValue("tenantCode", tenantCode.Trim().ToLowerInvariant());
                dbName = await cmd.ExecuteScalarAsync(cancellationToken) as string;
            }

            var tenantBuilder = new NpgsqlConnectionStringBuilder(baseConn)
            {
                Database = string.IsNullOrWhiteSpace(dbName) ? "b2b_erp" : dbName
            };
            return tenantBuilder.ConnectionString;
        }
        catch
        {
            var fallback = new NpgsqlConnectionStringBuilder(baseConn) { Database = "b2b_erp" };
            return fallback.ConnectionString;
        }
    }

    private async Task<List<int>> GetAssignedWarehouseCodesAsync(CancellationToken cancellationToken)
    {
        var list = new List<int>();

        // ARAÇ DEPOSU İLE KULLANICI DEPO YETKİSİ BİRLEŞİMDİR — biri diğerini bastırmaz.
        //
        // İki hata birden vardı:
        // 1. Teknisyen dalı araç deposunu bulunca ERKEN DÖNÜYORDU; aynı kişinin B2B'deki depo
        //    yetkisi (ör. atölye deposu) tamamen düşüyordu.
        // 2. Dala girme koşulu rol dizesinin TAM "Technician" olmasıydı. Saha ekibi
        //    (`SahaMontajEkibi`) ve klimacılar (`KlimaEkibi`) bu dizeyi taşımadığı için araç
        //    depoları hiç görünmüyordu — oysa araç tam da onlarda. Kullanıcı 2026-08-13'te
        //    sayfayı bu üç role açtırdı; ölçüt artık rol adı değil, oturumun bir teknisyen
        //    kaydına bağlı OLUP OLMADIĞI.
        var techId = _permissions.GetTechnicianId(User);
        if (techId.HasValue)
        {
            var tech = await _context.Technicians
                .AsNoTracking()
                .FirstOrDefaultAsync(t => t.Id == techId.Value && t.IsActive, cancellationToken);
            if (tech != null && tech.WarehouseCode.HasValue && tech.WarehouseCode.Value > 0)
            {
                list.Add(tech.WarehouseCode.Value);
            }
        }

        var username = User.FindFirstValue(ClaimTypes.Name) ?? User.Identity?.Name ?? "";
        if (string.IsNullOrWhiteSpace(username)) return Distinct(list);

        var connStr = await GetB2BConnectionStringAsync(cancellationToken);
        if (string.IsNullOrWhiteSpace(connStr)) return Distinct(list);

        try
        {
            await using (var conn = new NpgsqlConnection(connStr))
            {
                await conn.OpenAsync(cancellationToken);
                var sql = @"
                    SELECT uw.""WarehouseCode"" 
                    FROM public.""UserWarehouses"" uw
                    JOIN public.""Users"" u ON uw.""UserId"" = u.""Id""
                    WHERE LOWER(u.""Username"") = @username AND u.""IsActive"" = true
                    
                    UNION
                    
                    SELECT u.""DefaultWarehouseCode""
                    FROM public.""Users"" u
                    WHERE LOWER(u.""Username"") = @username AND u.""IsActive"" = true AND u.""DefaultWarehouseCode"" IS NOT NULL";
                
                await using var cmd = new NpgsqlCommand(sql, conn);
                cmd.Parameters.AddWithValue("username", username.Trim().ToLowerInvariant());
                await using var reader = await cmd.ExecuteReaderAsync(cancellationToken);
                while (await reader.ReadAsync(cancellationToken))
                {
                    list.Add(reader.GetInt32(0));
                }
            }
        }
        catch (Exception ex)
        {
            Console.WriteLine($"[Erp] Failed to fetch UserWarehouses: {ex.Message}");
        }

        return Distinct(list);

        // Araç deposu aynı zamanda kullanıcıya da atanmış olabilir; liste `= ANY(@codes)`
        // sorgusuna gittiği için tekrar zararsız, ama kolon sayacı ve arayüz listesi ikizleniyordu.
        static List<int> Distinct(List<int> codes) => codes.Distinct().ToList();
    }

    private async Task<bool> CanReachTechnicianWarehouseAsync(Guid technicianId, CancellationToken cancellationToken)
    {
        if (_permissions.IsSuperAdmin(User))
        {
            return true;
        }

        var assignedWarehouses = await GetAssignedWarehouseCodesAsync(cancellationToken);
        if (assignedWarehouses.Count == 0) return false;

        var tech = await _context.Technicians
            .AsNoTracking()
            .FirstOrDefaultAsync(t => t.Id == technicianId && t.IsActive, cancellationToken);
        if (tech == null) return false;

        return tech.WarehouseCode.HasValue && assignedWarehouses.Contains(tech.WarehouseCode.Value);
    }

    [HttpGet("users")]
    public async Task<IActionResult> GetUsers(CancellationToken cancellationToken)
    {
        var erpToken = await GetErpTokenAsync(cancellationToken);
        var client = _httpClientFactory.CreateClient("ErpApi");
        var request = new HttpRequestMessage(HttpMethod.Get, "api/users");
        if (!string.IsNullOrEmpty(erpToken))
            request.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", erpToken);

        var resolvedTenant = GetTenantCode();
        request.Headers.Add("X-Tenant-Code", resolvedTenant);

        try
        {
            var res = await client.SendAsync(request, cancellationToken);
            var bodyText = await res.Content.ReadAsStringAsync(cancellationToken);
            if (!res.IsSuccessStatusCode)
            {
                return UpstreamProblem(bodyText, res);
            }

            using var doc = System.Text.Json.JsonDocument.Parse(bodyText);
            var success = doc.RootElement.GetProperty("success").GetBoolean();
            if (!success) return BadRequest(new { success = false, message = "Kullanıcılar alınamadı" });

            var rawItems = doc.RootElement.GetProperty("data").EnumerateArray();
            var mappedList = new List<object>();

            foreach (var item in rawItems)
            {
                var id = item.GetProperty("id").GetInt32();
                var username = item.TryGetProperty("username", out var u) ? u.GetString() ?? "" : "";
                var email = item.TryGetProperty("mail", out var m) ? m.GetString() : null;
                var unvan = item.TryGetProperty("unvan", out var unv) ? unv.GetString() ?? "" : "";
                var isActive = item.TryGetProperty("isActive", out var act) ? act.GetBoolean() : true;
                var roleCode = item.TryGetProperty("roleCode", out var rc) ? rc.GetString() : null;
                var roleName = item.TryGetProperty("roleName", out var rn) ? rn.GetString() : null;
                var createdAt = item.TryGetProperty("createdAt", out var ca) ? ca.GetString() : null;

                // Split unvan into firstName and lastName as a best effort
                string? firstName = null;
                string? lastName = null;
                if (!string.IsNullOrWhiteSpace(unvan))
                {
                    var parts = unvan.Split(' ', StringSplitOptions.RemoveEmptyEntries);
                    if (parts.Length > 0)
                    {
                        firstName = parts[0];
                        if (parts.Length > 1)
                        {
                            lastName = string.Join(" ", parts.Skip(1));
                        }
                    }
                }

                mappedList.Add(new
                {
                    id,
                    username,
                    email,
                    firstName,
                    lastName,
                    isActive,
                    roleCode,
                    roleName,
                    tenantCode = resolvedTenant,
                    createdAt
                });
            }

            return Ok(new { success = true, data = mappedList });
        }
        catch (Exception ex)
        {
            return Problem(ex.Message, statusCode: 500);
        }
    }

    // EnsureUsersTableAsync KALDIRILDI.
    //
    // Hiçbir yerden çağrılmıyordu ama elle yazılmış bir CREATE TABLE "ServiceUsers" taşıyordu ve
    // şema EF modeliyle uyuşmuyordu: "Id" burada integer, modelde uuid. Ayrıca artık var olmayan
    // Password/Email/FirstName/LastName/RoleCode/RoleName kolonlarını yaratıyordu.
    //
    // Bu tam olarak TenantConnectionStringResolver'ın "legacy ServiceUsers" diye tespit edip
    // DROP ettiği tablodur — yani biri bu metodu tekrar bağlasa, bir taraf tabloyu bozuk
    // yaratacak, öbür taraf her açılışta silecekti. ServiceUsers artık EF migration'larıyla
    // yönetiliyor; elle DDL yazılmamalı.

    private static string? _erpToken = null;
    private static DateTime _erpTokenExpiry = DateTime.MinValue;

    private async Task<string?> GetErpTokenAsync(CancellationToken ct)
    {
        if (_erpToken != null && DateTime.UtcNow < _erpTokenExpiry) return _erpToken;

        var client = _httpClientFactory.CreateClient("ErpApi");
        
        // Program.cs'teki GetCachedErpToken ile AYNI kural. İkinci kopya olduğu için
        // biri düzeltilip diğeri unutulursa yarısı çalışan bir sistem kalır: ürün listesi
        // Program.cs'ten, bu controller'daki uçlar buradan token alıyor.
        // Sessiz yer tutucular ("ssa" / "123" / "SERVIS") kaldırıldı — gerekçe orada yazılı.
        var tenantCode = (_configuration["ErpApi:ServiceAccount:TenantCode"] ?? "").Trim();
        var username = (_configuration["ErpApi:ServiceAccount:Username"] ?? "").Trim();
        var password = _configuration["ErpApi:ServiceAccount:Password"] ?? "";

        if (string.IsNullOrWhiteSpace(username) || string.IsNullOrWhiteSpace(password))
        {
            Console.WriteLine("[ERP_AUTH_CONFIG] ErpApi:ServiceAccount:Username / Password ayarlı değil — appsettings.Production.json'a eklenmeli.");
            return null;
        }

        if (string.Equals(username, "ssa", StringComparison.OrdinalIgnoreCase))
        {
            tenantCode = "";
        }
        else if (string.IsNullOrWhiteSpace(tenantCode))
        {
            Console.WriteLine($"[ERP_AUTH_CONFIG] '{username}' firmaya bağlı bir hesap ama ErpApi:ServiceAccount:TenantCode boş. Firma kodu yazılmalı.");
            return null;
        }
        var body = System.Text.Json.JsonSerializer.Serialize(new { tenantCode, username, password });

        try
        {
            var request = new HttpRequestMessage(HttpMethod.Post, "api/auth/login")
            {
                Content = new StringContent(body, System.Text.Encoding.UTF8, "application/json")
            };
            request.Headers.Add("X-Tenant-Code", tenantCode);

            var res = await client.SendAsync(request, ct);
            if (!res.IsSuccessStatusCode)
            {
                var errBody = await res.Content.ReadAsStringAsync(ct);
                Console.WriteLine($"[ERP_AUTH_DEBUG] Login failed with status {res.StatusCode}. Response: {errBody}");
                return null;
            }
            var json = await res.Content.ReadAsStringAsync(ct);
            using var doc = System.Text.Json.JsonDocument.Parse(json);
            
            var token = doc.RootElement.TryGetProperty("accessToken", out var t1) ? t1.GetString()
                : doc.RootElement.TryGetProperty("data", out var d) && d.TryGetProperty("accessToken", out var t2) ? t2.GetString()
                : null;

            if (!string.IsNullOrEmpty(token))
            {
                _erpToken = token;
                var expiry = DateTime.UtcNow.AddMinutes(2); // Fallback to 2 minutes
                try
                {
                    var parts = token.Split('.');
                    if (parts.Length > 1)
                    {
                        var payloadBase64 = parts[1].Replace('-', '+').Replace('_', '/');
                        switch (payloadBase64.Length % 4)
                        {
                            case 2: payloadBase64 += "=="; break;
                            case 3: payloadBase64 += "="; break;
                        }
                        var payloadBytes = Convert.FromBase64String(payloadBase64);
                        var payloadJson = System.Text.Encoding.UTF8.GetString(payloadBytes);
                        using var payloadDoc = System.Text.Json.JsonDocument.Parse(payloadJson);
                        if (payloadDoc.RootElement.TryGetProperty("exp", out var expProp))
                        {
                            var expSeconds = expProp.GetInt64();
                            expiry = DateTimeOffset.FromUnixTimeSeconds(expSeconds).UtcDateTime.AddSeconds(-15);
                        }
                    }
                }
                catch (Exception ex)
                {
                    Console.WriteLine($"[ERP_AUTH] Expiry parse error in ErpController: {ex.Message}");
                }
                _erpTokenExpiry = expiry;
                Console.WriteLine($"[ERP_AUTH] ErpController Token expiry set to: {_erpTokenExpiry} (UTC), Current time: {DateTime.UtcNow} (UTC)");
            }
            return _erpToken;
        }
        catch { return null; }
    }

    private string GetTenantCode()
    {
        var tenantCode = User.FindFirstValue("tenantCode") ?? User.FindFirstValue("tenant") ?? "";
        if (string.IsNullOrWhiteSpace(tenantCode))
        {
            tenantCode = Request.Headers.TryGetValue("X-Tenant-Code", out var hdr) ? hdr.ToString() : "";
        }
        if (string.IsNullOrWhiteSpace(tenantCode))
        {
            tenantCode = _configuration["ErpApi:ServiceAccount:TenantCode"] ?? "";
        }
        if (string.IsNullOrWhiteSpace(tenantCode))
        {
            tenantCode = "SERVIS";
        }
        return tenantCode;
    }

    /// <summary>
    /// Bu controller B2B ERP'ye vekillik eder. Üst sistemin durum kodunu OLDUĞU GİBİ geri vermek
    /// bir hataydı: ERP servis hesabının token'ı düştüğünde B2B 401 döndürüyor, biz de 401
    /// döndürüyorduk ve istemcideki global 401 işleyicisi bunu "oturumun bitti" sanıp kullanıcıyı
    /// login'e atıyordu. "Saha Ekibi'ne / Ayarlar'a basınca sistemden atılıyorum" şikâyetinin
    /// kaynağı buydu — kullanıcının oturumu geçerliydi, bizim ERP bağlantımız değildi.
    /// 401/403 artık 502'ye (Bad Gateway) çevriliyor: bu bizim tarafımızın sorunu, kullanıcının değil.
    /// </summary>
    private IActionResult UpstreamProblem(string bodyText, HttpResponseMessage res)
    {
        var status = res.StatusCode is System.Net.HttpStatusCode.Unauthorized or System.Net.HttpStatusCode.Forbidden
            ? StatusCodes.Status502BadGateway
            : (int)res.StatusCode;

        return Problem(
            detail: string.IsNullOrWhiteSpace(bodyText) ? res.ReasonPhrase : bodyText,
            statusCode: status,
            title: status == StatusCodes.Status502BadGateway ? "B2B ERP bağlantısı reddedildi" : null);
    }

    /// <summary>
    /// Sorguyla gelen firma kodunu doğrular.
    ///
    /// Bu üç uç (depo / kasa / banka) `?tenantCode=` parametresini KOŞULSUZ kabul ediyordu: bir
    /// firmadaki herhangi bir kullanıcı başka firmanın kod adını yazıp o firmanın kasa ve banka
    /// tanımlarını okuyabiliyordu. Parametrenin meşru bir kullanımı var — süper admin, teknisyen
    /// formunda başka firmanın teknisyenini düzenlerken o firmanın listesini görmeli — ama
    /// yalnızca ona açık.
    /// </summary>
    private async Task<string> ResolveRequestedTenantAsync(string? requestedTenant, CancellationToken cancellationToken)
    {
        var ownTenant = GetTenantCode();

        if (string.IsNullOrWhiteSpace(requestedTenant)) return ownTenant;
        if (string.Equals(requestedTenant, ownTenant, StringComparison.OrdinalIgnoreCase)) return ownTenant;

        var scope = await _permissions.GetScopeAsync(User, "teknisyenler", cancellationToken);
        return scope.Kind == ServiceOps.Api.Services.ServiceOpsScopeKind.All ? requestedTenant.Trim() : ownTenant;
    }

    [HttpGet("warehouses")]
    public async Task<IActionResult> GetWarehouses([FromQuery] string? tenantCode, CancellationToken cancellationToken)
    {
        var erpToken = await GetErpTokenAsync(cancellationToken);
        var client = _httpClientFactory.CreateClient("ErpApi");
        var request = new HttpRequestMessage(HttpMethod.Get, "api/warehouses");
        if (!string.IsNullOrEmpty(erpToken))
            request.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", erpToken);

        var resolvedTenant = await ResolveRequestedTenantAsync(tenantCode, cancellationToken);
        request.Headers.Add("X-Tenant-Code", resolvedTenant);

        try
        {
            var res = await client.SendAsync(request, cancellationToken);
            var bodyText = await res.Content.ReadAsStringAsync(cancellationToken);
            return res.IsSuccessStatusCode
                ? Content(bodyText, "application/json")
                : UpstreamProblem(bodyText, res);
        }
        catch (Exception ex)
        {
            return Problem(ex.Message, statusCode: 500);
        }
    }

    [HttpGet("cash-accounts")]
    public async Task<IActionResult> GetCashAccounts([FromQuery] string? tenantCode, CancellationToken cancellationToken)
    {
        var erpToken = await GetErpTokenAsync(cancellationToken);
        var client = _httpClientFactory.CreateClient("ErpApi");
        var request = new HttpRequestMessage(HttpMethod.Get, "api/cashaccounts");
        if (!string.IsNullOrEmpty(erpToken))
            request.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", erpToken);

        var resolvedTenant = await ResolveRequestedTenantAsync(tenantCode, cancellationToken);
        request.Headers.Add("X-Tenant-Code", resolvedTenant);

        try
        {
            var res = await client.SendAsync(request, cancellationToken);
            var bodyText = await res.Content.ReadAsStringAsync(cancellationToken);
            return res.IsSuccessStatusCode
                ? Content(bodyText, "application/json")
                : UpstreamProblem(bodyText, res);
        }
        catch (Exception ex)
        {
            return Problem(ex.Message, statusCode: 500);
        }
    }

    [HttpGet("bank-accounts")]
    public async Task<IActionResult> GetBankAccounts([FromQuery] string? tenantCode, CancellationToken cancellationToken)
    {
        var erpToken = await GetErpTokenAsync(cancellationToken);
        var client = _httpClientFactory.CreateClient("ErpApi");
        var request = new HttpRequestMessage(HttpMethod.Get, "api/bankaccountdefinitions");
        if (!string.IsNullOrEmpty(erpToken))
            request.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", erpToken);

        var resolvedTenant = await ResolveRequestedTenantAsync(tenantCode, cancellationToken);
        request.Headers.Add("X-Tenant-Code", resolvedTenant);

        try
        {
            var res = await client.SendAsync(request, cancellationToken);
            var bodyText = await res.Content.ReadAsStringAsync(cancellationToken);
            return res.IsSuccessStatusCode
                ? Content(bodyText, "application/json")
                : UpstreamProblem(bodyText, res);
        }
        catch (Exception ex)
        {
            return Problem(ex.Message, statusCode: 500);
        }
    }

    [HttpGet("my-warehouses")]
    public async Task<IActionResult> GetMyWarehouses(CancellationToken cancellationToken)
    {
        var connStr = await GetB2BConnectionStringAsync(cancellationToken);
        if (string.IsNullOrWhiteSpace(connStr))
        {
            return Ok(new { success = true, data = Array.Empty<object>() });
        }

        var isSuperAdmin = _permissions.IsSuperAdmin(User);
        var assignedWarehouses = await GetAssignedWarehouseCodesAsync(cancellationToken);

        var list = new List<object>();

        try
        {
            await using (var conn = new NpgsqlConnection(connStr))
            {
                await conn.OpenAsync(cancellationToken);
                
                string sql;
                if (isSuperAdmin)
                {
                    sql = @"
                        SELECT ""WarehouseCode"", ""Name"", ""IsVehicle"", ""Plate"", ""DriverName""
                        FROM public.""Warehouses""
                        WHERE ""IsActive"" = true
                        ORDER BY ""WarehouseCode""";
                }
                else
                {
                    if (assignedWarehouses.Count == 0)
                    {
                        return Ok(new { success = true, data = Array.Empty<object>() });
                    }
                    sql = @"
                        SELECT ""WarehouseCode"", ""Name"", ""IsVehicle"", ""Plate"", ""DriverName""
                        FROM public.""Warehouses""
                        WHERE ""IsActive"" = true AND ""WarehouseCode"" = ANY(@assignedCodes)
                        ORDER BY ""WarehouseCode""";
                }

                await using var cmd = new NpgsqlCommand(sql, conn);
                if (!isSuperAdmin)
                {
                    cmd.Parameters.AddWithValue("assignedCodes", assignedWarehouses);
                }

                await using var reader = await cmd.ExecuteReaderAsync(cancellationToken);
                while (await reader.ReadAsync(cancellationToken))
                {
                    list.Add(new
                    {
                        warehouseCode = reader.GetInt32(0),
                        name = reader.IsDBNull(1) ? null : reader.GetString(1),
                        isVehicle = reader.GetBoolean(2),
                        plate = reader.IsDBNull(3) ? null : reader.GetString(3),
                        driverName = reader.IsDBNull(4) ? null : reader.GetString(4)
                    });
                }
            }
        }
        catch (Exception ex)
        {
            return StatusCode(500, new { success = false, message = ex.Message });
        }

        return Ok(new { success = true, data = list });
    }

    [HttpGet("warehouses/{warehouseCode:int}/inventory")]
    public async Task<IActionResult> GetWarehouseInventoryDirect(int warehouseCode, [FromQuery] string? q, CancellationToken cancellationToken)
    {
        if (!_permissions.IsSuperAdmin(User))
        {
            var assignedWarehouses = await GetAssignedWarehouseCodesAsync(cancellationToken);
            if (!assignedWarehouses.Contains(warehouseCode))
            {
                return Forbid();
            }
        }

        var erpToken = await GetErpTokenAsync(cancellationToken);
        if (string.IsNullOrEmpty(erpToken))
        {
            return StatusCode(500, new { success = false, message = "B2B ERP bağlantı hatası" });
        }

        var qs = q != null ? $"?q={Uri.EscapeDataString(q)}" : "";
        var client = _httpClientFactory.CreateClient("ErpApi");
        var reqMessage = new HttpRequestMessage(HttpMethod.Get, $"api/warehouses/{warehouseCode}/inventory{qs}");
        reqMessage.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", erpToken);
        var tenantCode = GetTenantCode();
        if (!string.IsNullOrEmpty(tenantCode))
        {
            reqMessage.Headers.Add("X-Tenant-Code", tenantCode);
        }

        try
        {
            var res = await client.SendAsync(reqMessage, cancellationToken);
            var bodyText = await res.Content.ReadAsStringAsync(cancellationToken);
            if (!res.IsSuccessStatusCode)
            {
                return UpstreamProblem(bodyText, res);
            }

            using var doc = System.Text.Json.JsonDocument.Parse(bodyText);
            var success = doc.RootElement.GetProperty("success").GetBoolean();
            if (!success) return BadRequest(new { success = false, message = "Envanter alınamadı" });

            var rawItems = doc.RootElement.GetProperty("data").GetProperty("items").EnumerateArray();
            var mappedList = new List<object>();

            foreach (var item in rawItems)
            {
                var stockCode = item.GetProperty("stockCode").GetString() ?? "";
                var name = item.GetProperty("stockName").GetString() ?? "";
                var balance = item.GetProperty("balance").GetDecimal();
                var minStock = item.GetProperty("minStock").GetDecimal();

                bool isSparePart = stockCode.Contains("PARCA", StringComparison.OrdinalIgnoreCase) 
                                   || name.Contains("Parça", StringComparison.OrdinalIgnoreCase)
                                   || name.Contains("Yedek", StringComparison.OrdinalIgnoreCase);

                mappedList.Add(new
                {
                    type = isSparePart ? "SparePart" : "Product",
                    id = stockCode,
                    productId = stockCode,
                    productName = name,
                    name = name,
                    partNumber = stockCode,
                    quantity = balance,
                    minStockLevel = minStock
                });
            }

            return Ok(new { success = true, data = mappedList });
        }
        catch (Exception ex)
        {
            return StatusCode(500, new { success = false, message = ex.Message });
        }
    }

    [HttpGet("technician-stock")]
    public async Task<IActionResult> GetTechnicianStock([FromQuery] string? q, CancellationToken cancellationToken)
    {
        var username = User.FindFirstValue(ClaimTypes.Name) ?? User.Identity?.Name ?? "";
        var tech = await _context.Technicians
            .FirstOrDefaultAsync(t => t.UserId == username && t.IsActive, cancellationToken);

        if (tech == null)
        {
            return BadRequest(new { success = false, message = "Teknisyen profili bulunamadı" });
        }

        if (!tech.WarehouseCode.HasValue || tech.WarehouseCode.Value <= 0)
        {
            return Ok(new { success = true, data = Array.Empty<object>() });
        }

        var erpToken = await GetErpTokenAsync(cancellationToken);
        if (string.IsNullOrEmpty(erpToken))
        {
            return StatusCode(500, new { success = false, message = "B2B ERP bağlantı hatası" });
        }

        var qs = q != null ? $"?q={Uri.EscapeDataString(q)}" : "";
        var client = _httpClientFactory.CreateClient("ErpApi");
        var reqMessage = new HttpRequestMessage(HttpMethod.Get, $"api/warehouses/{tech.WarehouseCode.Value}/inventory{qs}");
        reqMessage.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", erpToken);
        var tenantCode = User.FindFirstValue("tenantCode") ?? User.FindFirstValue("tenant") ?? tech.TenantCode ?? "";
        if (!string.IsNullOrEmpty(tenantCode))
        {
            reqMessage.Headers.Add("X-Tenant-Code", tenantCode);
        }

        try
        {
            var res = await client.SendAsync(reqMessage, cancellationToken);
            var bodyText = await res.Content.ReadAsStringAsync(cancellationToken);
            if (!res.IsSuccessStatusCode)
            {
                return UpstreamProblem(bodyText, res);
            }

            using var doc = System.Text.Json.JsonDocument.Parse(bodyText);
            var success = doc.RootElement.GetProperty("success").GetBoolean();
            if (!success) return BadRequest(new { success = false, message = "Envanter alınamadı" });

            var rawItems = doc.RootElement.GetProperty("data").GetProperty("items").EnumerateArray();
            var mappedList = new List<object>();

            foreach (var item in rawItems)
            {
                var stockCode = item.GetProperty("stockCode").GetString() ?? "";
                var name = item.GetProperty("stockName").GetString() ?? "";
                var balance = item.GetProperty("balance").GetDecimal();
                var minStock = item.GetProperty("minStock").GetDecimal();

                bool isSparePart = stockCode.Contains("PARCA", StringComparison.OrdinalIgnoreCase) 
                                   || name.Contains("Parça", StringComparison.OrdinalIgnoreCase)
                                   || name.Contains("Yedek", StringComparison.OrdinalIgnoreCase);

                mappedList.Add(new
                {
                    type = isSparePart ? "SparePart" : "Product",
                    id = stockCode,
                    productId = stockCode,
                    productName = name,
                    name = name,
                    partNumber = stockCode,
                    quantity = balance,
                    minStockLevel = minStock
                });
            }

            return Ok(new { success = true, data = mappedList });
        }
        catch (Exception ex)
        {
            return StatusCode(500, new { success = false, message = ex.Message });
        }
    }

    [HttpPost("technician-sale")]
    public async Task<IActionResult> CreateTechnicianSale([FromBody] TechnicianSaleRequest request, CancellationToken cancellationToken)
    {
        var username = User.FindFirstValue(ClaimTypes.Name) ?? User.Identity?.Name ?? "";
        var tech = await _context.Technicians
            .FirstOrDefaultAsync(t => t.UserId == username && t.IsActive, cancellationToken);

        if (tech == null)
        {
            return BadRequest(new { success = false, message = "Teknisyen profili bulunamadı" });
        }

        if (!tech.WarehouseCode.HasValue || tech.WarehouseCode.Value <= 0)
        {
            return BadRequest(new { success = false, message = "Size atanmış aktif bir depo bulunmamaktadır" });
        }

        var paymentMethod = (request.PaymentMethod ?? string.Empty).Trim();
        int? accountId = null;

        if (string.Equals(paymentMethod, "Cash", StringComparison.OrdinalIgnoreCase))
        {
            if (!tech.CashAccountId.HasValue || tech.CashAccountId.Value <= 0)
            {
                return BadRequest(new { success = false, message = "Teknisyen profiline tanımlı kasa hesabı bulunmamaktadır" });
            }
            accountId = tech.CashAccountId.Value;
        }
        else if (string.Equals(paymentMethod, "Bank", StringComparison.OrdinalIgnoreCase))
        {
            if (request.UsePos == true)
            {
                if (!tech.PosAccountId.HasValue || tech.PosAccountId.Value <= 0)
                {
                    return BadRequest(new { success = false, message = "Teknisyen profiline tanımlı Sanal POS banka hesabı bulunmamaktadır" });
                }
                accountId = tech.PosAccountId.Value;
            }
            else
            {
                if (!tech.BankAccountId.HasValue || tech.BankAccountId.Value <= 0)
                {
                    return BadRequest(new { success = false, message = "Teknisyen profiline tanımlı banka hesabı bulunmamaktadır" });
                }
                accountId = tech.BankAccountId.Value;
            }
        }
        else if (string.Equals(paymentMethod, "OpenAccount", StringComparison.OrdinalIgnoreCase))
        {
            if (request.CashAmount.HasValue && request.CashAmount.Value > 0)
            {
                if (!tech.CashAccountId.HasValue || tech.CashAccountId.Value <= 0)
                {
                    return BadRequest(new { success = false, message = "Teknisyen profiline tanımlı kasa hesabı bulunmamaktadır" });
                }
                accountId = tech.CashAccountId.Value;
            }
        }

        var erpToken = await GetErpTokenAsync(cancellationToken);
        if (string.IsNullOrEmpty(erpToken))
        {
            return StatusCode(500, new { success = false, message = "B2B ERP bağlantı hatası" });
        }

        var client = _httpClientFactory.CreateClient("ErpApi");
        var erpRequest = new
        {
            CustomerCode = request.CustomerCode,
            WarehouseCode = tech.WarehouseCode.Value,
            PaymentMethod = paymentMethod,
            AccountId = accountId,
            CashAmount = request.CashAmount,
            Lines = request.Lines.Select(l => new { l.StockCode, l.Quantity }).ToList()
        };

        var reqMessage = new HttpRequestMessage(HttpMethod.Post, "api/invoices/create-direct-vehicle-sale")
        {
            Content = JsonContent.Create(erpRequest)
        };
        reqMessage.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", erpToken);
        var tenantCode = User.FindFirstValue("tenantCode") ?? User.FindFirstValue("tenant") ?? tech.TenantCode ?? "";
        if (!string.IsNullOrEmpty(tenantCode))
        {
            reqMessage.Headers.Add("X-Tenant-Code", tenantCode);
        }

        try
        {
            var res = await client.SendAsync(reqMessage, cancellationToken);
            var bodyText = await res.Content.ReadAsStringAsync(cancellationToken);
            return res.IsSuccessStatusCode
                ? Content(bodyText, "application/json")
                : UpstreamProblem(bodyText, res);
        }
        catch (Exception ex)
        {
            return StatusCode(500, new { success = false, message = ex.Message });
        }
    }

    /// <summary>
    /// HIZLI SERVİS SATIŞI — SİPARİŞ olarak düşer, fatura KESİLMEZ (kullanıcı kararı, 2026-08-21).
    ///
    /// <para>
    /// Önce `create-direct-vehicle-sale` kullanılıyordu; o uç siparişi `Status = 1` ile açıp
    /// faturayı ANINDA kesiyor, dolayısıyla kayıt yalnızca <b>Fatura Dökümü</b>nde görünüyor ve
    /// <b>Satış Faturası</b> ekranına hiç düşmüyordu. Burada yalnızca sipariş oluşturuluyor;
    /// faturayı ofis, Satış Faturası ekranından kesiyor.
    /// </para>
    ///
    /// <para>
    /// Depo, kullanıcının YETKİLİ olduğu depolardan biri olmak zorunda
    /// (<see cref="GetAssignedWarehouseCodesAsync"/> araç deposu + B2B depo yetkisi birleşimi).
    /// Kod istemciden geliyor, bu yüzden burada doğrulanıyor — aksi halde ekran başkasının
    /// deposundan satış yapabilirdi. Seçilen depo kalemlere `DepoKodu` olarak damgalanıyor ki
    /// Satış Faturası ekranında "işlemi yapan depo" olarak gelsin; damgalanmazsa faturayı
    /// kesen kişinin varsayılan deposundan düşer.
    /// </para>
    ///
    /// <para>Miktar, o depodaki BAKİYEYİ aşamaz: satılan mal fiilen o depodan çıkıyor.</para>
    /// </summary>
    [HttpPost("quick-service-order")]
    public async Task<IActionResult> CreateQuickServiceOrder(
        [FromBody] QuickServiceOrderRequest request,
        CancellationToken cancellationToken)
    {
        var customerCode = (request?.CustomerCode ?? string.Empty).Trim();
        if (string.IsNullOrWhiteSpace(customerCode))
        {
            return BadRequest(new { success = false, message = "Cari seçilmedi" });
        }

        var lines = (request?.Lines ?? new List<TechnicianSaleLineDto>())
            .Where(l => !string.IsNullOrWhiteSpace(l.StockCode) && l.Quantity > 0)
            .ToList();

        if (lines.Count == 0)
        {
            return BadRequest(new { success = false, message = "Sepet boş" });
        }

        // 0 "atanmamış" demek; negatif depo kodları (-20, -21) geçerlidir.
        if (request!.WarehouseCode == 0)
        {
            return BadRequest(new { success = false, message = "Depo seçilmedi" });
        }

        if (!_permissions.IsSuperAdmin(User))
        {
            var assigned = await GetAssignedWarehouseCodesAsync(cancellationToken);
            if (!assigned.Contains(request.WarehouseCode))
            {
                return StatusCode(403, new { success = false, message = "Bu depodan satış yetkiniz yok" });
            }
        }

        var erpToken = await GetErpTokenAsync(cancellationToken);
        if (string.IsNullOrEmpty(erpToken))
        {
            return StatusCode(500, new { success = false, message = "B2B ERP bağlantı hatası" });
        }

        var client = _httpClientFactory.CreateClient("ErpApi");
        var tenantCode = GetTenantCode();

        HttpRequestMessage NewRequest(HttpMethod method, string url)
        {
            var m = new HttpRequestMessage(method, url);
            m.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", erpToken);
            if (!string.IsNullOrEmpty(tenantCode)) m.Headers.Add("X-Tenant-Code", tenantCode);
            return m;
        }

        // 1) STOK KONTROLÜ — depo bakiyesi. Ekran da sınırlıyor ama orası yalnızca kazayla
        //    yapılanı önler; asıl kontrol burada.
        var invReq = NewRequest(HttpMethod.Get, $"api/warehouses/{request.WarehouseCode}/inventory");
        var invRes = await client.SendAsync(invReq, cancellationToken);
        var invBody = await invRes.Content.ReadAsStringAsync(cancellationToken);
        if (!invRes.IsSuccessStatusCode) return UpstreamProblem(invBody, invRes);

        var balances = new Dictionary<string, decimal>(StringComparer.OrdinalIgnoreCase);
        using (var invDoc = System.Text.Json.JsonDocument.Parse(invBody))
        {
            if (invDoc.RootElement.TryGetProperty("data", out var invData)
                && invData.TryGetProperty("items", out var invItems))
            {
                foreach (var it in invItems.EnumerateArray())
                {
                    var sc = it.TryGetProperty("stockCode", out var scEl) ? scEl.GetString() : null;
                    if (string.IsNullOrWhiteSpace(sc)) continue;
                    balances[sc.Trim()] = it.TryGetProperty("balance", out var bEl) && bEl.TryGetDecimal(out var b) ? b : 0m;
                }
            }
        }

        foreach (var l in lines)
        {
            var have = balances.TryGetValue(l.StockCode.Trim(), out var bal) ? bal : 0m;
            if (l.Quantity > have)
            {
                return BadRequest(new
                {
                    success = false,
                    message = $"{l.StockCode}: depoda {have:0.##} adet var, {l.Quantity:0.##} adet satılamaz."
                });
            }
        }

        // 2) FİYAT — cariye göre ERP hesaplar (fiyat grubu, döviz, iskonto orada çözülür).
        var priceReq = NewRequest(HttpMethod.Post, "api/invoices/calculate-direct-sale-prices");
        priceReq.Content = JsonContent.Create(new
        {
            CustomerCode = customerCode,
            StockCodes = lines.Select(l => l.StockCode.Trim()).ToList()
        });
        var priceRes = await client.SendAsync(priceReq, cancellationToken);
        var priceBody = await priceRes.Content.ReadAsStringAsync(cancellationToken);
        if (!priceRes.IsSuccessStatusCode) return UpstreamProblem(priceBody, priceRes);

        var priced = new Dictionary<string, (decimal UnitPrice, decimal TaxRate, string Currency)>(StringComparer.OrdinalIgnoreCase);
        using (var pDoc = System.Text.Json.JsonDocument.Parse(priceBody))
        {
            var root = pDoc.RootElement.TryGetProperty("data", out var pd) ? pd : pDoc.RootElement;
            if (root.ValueKind == System.Text.Json.JsonValueKind.Array)
            {
                foreach (var it in root.EnumerateArray())
                {
                    var sc = it.TryGetProperty("stockCode", out var scEl) ? scEl.GetString() : null;
                    if (string.IsNullOrWhiteSpace(sc)) continue;
                    var up = it.TryGetProperty("unitPrice", out var upEl) && upEl.TryGetDecimal(out var u) ? u : 0m;
                    var tr = it.TryGetProperty("taxRate", out var trEl) && trEl.TryGetDecimal(out var t) ? t : 0m;
                    var cur = it.TryGetProperty("currency", out var cEl) ? (cEl.GetString() ?? "TRY") : "TRY";
                    priced[sc.Trim()] = (up, tr, cur);
                }
            }
        }

        // 3) SİPARİŞ. Teslim carisi = cari: Hızlı Servis'te ayrı teslim adresi kavramı yok.
        var orderLines = new List<object>();
        var sira = 1;
        foreach (var l in lines)
        {
            var key = l.StockCode.Trim();
            priced.TryGetValue(key, out var p);
            orderLines.Add(new
            {
                StokKodu = key,
                Miktar = l.Quantity,
                Fiyat = p.UnitPrice,
                KdvOran = p.TaxRate,
                CurrencyTypeId = MapCurrencyToTypeId(p.Currency),
                Sira = sira++,
                Montaj = false,
                DepoKodu = request.WarehouseCode
            });
        }

        var orderReq = NewRequest(HttpMethod.Post, "api/salesorders/confirm");

        // İŞLEMİ YAPAN GERÇEK KULLANICI. Vekil B2B'ye servis hesabıyla (ssa) gittiği için
        // sipariş "ssa" adına yazılıyor ve Satış Faturası ekranında sahadaki teknisyen yerine
        // ssa görünüyordu. B2B bu başlığı yalnızca iç anahtar doğruysa kabul eder.
        var actingUser = User.FindFirstValue(ClaimTypes.Name) ?? User.Identity?.Name;
        if (!string.IsNullOrWhiteSpace(actingUser))
        {
            orderReq.Headers.Add("X-Acting-User", actingUser);
            var internalKey = _configuration["ServiceOps:InternalApiKey"];
            if (!string.IsNullOrWhiteSpace(internalKey))
            {
                orderReq.Headers.Add("X-ServiceOps-Key", internalKey);
            }
        }

        orderReq.Content = JsonContent.Create(new
        {
            CariKodu = customerCode,
            TeslimCariKodu = customerCode,
            Lines = orderLines
        });

        try
        {
            var res = await client.SendAsync(orderReq, cancellationToken);
            var bodyText = await res.Content.ReadAsStringAsync(cancellationToken);
            return res.IsSuccessStatusCode
                ? Content(bodyText, "application/json")
                : UpstreamProblem(bodyText, res);
        }
        catch (Exception ex)
        {
            return StatusCode(500, new { success = false, message = ex.Message });
        }
    }

    /// <summary>
    /// Günlük satışlar — "Günlük Tahsilatlar" ekranını besler. Yetki B2B tarafında
    /// <c>users/gunlukTahsilat</c> anahtarıyla kontrol edilir; burada vekillik yapılır.
    /// </summary>
    [HttpGet("daily-sales")]
    public async Task<IActionResult> GetDailySales(
        [FromQuery] DateTime date,
        [FromQuery] string? username,
        CancellationToken cancellationToken)
    {
        var erpToken = await GetErpTokenAsync(cancellationToken);
        if (string.IsNullOrEmpty(erpToken))
        {
            return StatusCode(500, new { success = false, message = "B2B ERP bağlantı hatası" });
        }

        var qs = $"?date={Uri.EscapeDataString(date.ToString("yyyy-MM-dd"))}";
        if (!string.IsNullOrWhiteSpace(username)) qs += $"&username={Uri.EscapeDataString(username)}";

        var client = _httpClientFactory.CreateClient("ErpApi");
        var req = new HttpRequestMessage(HttpMethod.Get, $"api/salesorders/daily-by-user{qs}");
        req.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", erpToken);
        var tenantCode = GetTenantCode();
        if (!string.IsNullOrEmpty(tenantCode)) req.Headers.Add("X-Tenant-Code", tenantCode);

        try
        {
            var res = await client.SendAsync(req, cancellationToken);
            var bodyText = await res.Content.ReadAsStringAsync(cancellationToken);
            return res.IsSuccessStatusCode
                ? Content(bodyText, "application/json")
                : UpstreamProblem(bodyText, res);
        }
        catch (Exception ex)
        {
            return StatusCode(500, new { success = false, message = ex.Message });
        }
    }

    /// <summary>
    /// Döviz kodu → sistemin para birimi kimliği. Kodlama TEK KAYNAKTIR: 1=TRY 2=EUR 3=USD 4=GBP.
    /// Elle sayı yazmak daha önce dolar satırını TL, sterlini dolar damgalamıştı.
    /// </summary>
    private static int MapCurrencyToTypeId(string? currency) =>
        (currency ?? string.Empty).Trim().ToUpperInvariant() switch
        {
            "EUR" => 2,
            "USD" => 3,
            "GBP" => 4,
            _ => 1
        };

    [HttpPost("invoices/create-sales-invoice")]
    public async Task<IActionResult> CreateSalesInvoice([FromBody] System.Text.Json.JsonElement request, CancellationToken cancellationToken)
    {
        var erpToken = await GetErpTokenAsync(cancellationToken);
        if (string.IsNullOrEmpty(erpToken))
        {
            return StatusCode(500, new { success = false, message = "B2B ERP bağlantı hatası" });
        }

        var client = _httpClientFactory.CreateClient("ErpApi");
        var reqMessage = new HttpRequestMessage(HttpMethod.Post, "api/invoices/create-sales-invoice")
        {
            Content = new StringContent(request.GetRawText(), System.Text.Encoding.UTF8, "application/json")
        };
        reqMessage.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", erpToken);
        var resolvedTenant = GetTenantCode();
        reqMessage.Headers.Add("X-Tenant-Code", resolvedTenant);

        try
        {
            var res = await client.SendAsync(reqMessage, cancellationToken);
            var bodyText = await res.Content.ReadAsStringAsync(cancellationToken);
            return res.IsSuccessStatusCode
                ? Content(bodyText, "application/json")
                : UpstreamProblem(bodyText, res);
        }
        catch (Exception ex)
        {
            return StatusCode(500, new { success = false, message = ex.Message });
        }
    }

    /// <summary>
    /// MONTAJ BEDELİ SİPARİŞİ. ServiceOps'ta ELLE montaj kabul kaydı açılınca çağrılır:
    /// montaj fiyatı tanımlı ürünler için o bayiye BEKLEYEN sipariş taslağı oluşturur
    /// (B2B `api/salesorders/montaj-bedeli` — fiyat/oran/net hesabı, hizmet kartı, taslak
    /// kaydı orada). Fatura kesilmez; ofis Satış Faturası ekranından dönüştürür.
    ///
    /// Best-effort: montaj kaydı zaten oluşmuştur, bu çağrı başarısız olursa istemci yalnız
    /// uyarı gösterir — kayıt geri alınmaz.
    /// </summary>
    /// <summary>
    /// Montaj bedeli kredi limiti ÖN KONTROLÜ — montaj kaydı açılmadan önce. Limiti yetmiyorsa
    /// istemci kaydı hiç oluşturmaz.
    /// </summary>
    [HttpPost("montaj-bedeli-siparis/kontrol")]
    public async Task<IActionResult> MontajBedeliSiparisKontrol([FromBody] System.Text.Json.JsonElement request, CancellationToken cancellationToken)
    {
        var erpToken = await GetErpTokenAsync(cancellationToken);
        if (string.IsNullOrEmpty(erpToken))
        {
            return StatusCode(500, new { success = false, message = "B2B ERP bağlantı hatası" });
        }

        var client = _httpClientFactory.CreateClient("ErpApi");
        var reqMessage = new HttpRequestMessage(HttpMethod.Post, "api/salesorders/montaj-bedeli/kontrol")
        {
            Content = new StringContent(request.GetRawText(), System.Text.Encoding.UTF8, "application/json")
        };
        reqMessage.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", erpToken);
        reqMessage.Headers.Add("X-Tenant-Code", GetTenantCode());

        try
        {
            var res = await client.SendAsync(reqMessage, cancellationToken);
            var bodyText = await res.Content.ReadAsStringAsync(cancellationToken);
            return res.IsSuccessStatusCode
                ? Content(bodyText, "application/json")
                : UpstreamProblem(bodyText, res);
        }
        catch (Exception ex)
        {
            return StatusCode(500, new { success = false, message = ex.Message });
        }
    }

    [HttpPost("montaj-bedeli-siparis")]
    public async Task<IActionResult> MontajBedeliSiparis([FromBody] System.Text.Json.JsonElement request, CancellationToken cancellationToken)
    {
        var erpToken = await GetErpTokenAsync(cancellationToken);
        if (string.IsNullOrEmpty(erpToken))
        {
            return StatusCode(500, new { success = false, message = "B2B ERP bağlantı hatası" });
        }

        var client = _httpClientFactory.CreateClient("ErpApi");
        var reqMessage = new HttpRequestMessage(HttpMethod.Post, "api/salesorders/montaj-bedeli")
        {
            Content = new StringContent(request.GetRawText(), System.Text.Encoding.UTF8, "application/json")
        };
        reqMessage.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", erpToken);
        reqMessage.Headers.Add("X-Tenant-Code", GetTenantCode());

        // Sipariş "ssa" yerine gerçek kullanıcı adına yazılsın (Satış Faturası ekranı "İşlemi Yapan").
        var actingUser = User.FindFirstValue(ClaimTypes.Name) ?? User.Identity?.Name;
        var internalKey = _configuration["ServiceOps:InternalApiKey"];
        if (!string.IsNullOrWhiteSpace(actingUser) && !string.IsNullOrWhiteSpace(internalKey))
        {
            reqMessage.Headers.Add("X-Acting-User", actingUser);
            reqMessage.Headers.Add("X-ServiceOps-Key", internalKey);
        }

        try
        {
            var res = await client.SendAsync(reqMessage, cancellationToken);
            var bodyText = await res.Content.ReadAsStringAsync(cancellationToken);
            return res.IsSuccessStatusCode
                ? Content(bodyText, "application/json")
                : UpstreamProblem(bodyText, res);
        }
        catch (Exception ex)
        {
            return StatusCode(500, new { success = false, message = ex.Message });
        }
    }

    /// <summary>Devam eden bir faturalama denemesinin işareti; tamamlanınca gerçek fişe/sipariş no'ya döner.</summary>
    private const string InvoiceClaimPrefix = "PENDING:";

    /// <summary>
    /// Servis faturası. Bir servis kaydı için EN FAZLA BİR KEZ çalışır.
    ///
    /// Tekrarı önlemek için "önce oku, yoksa oluştur" YETMEZ: iki istek (çift tıklama, istemci
    /// yeniden denemesi, iki sekme) aynı anda "faturalanmamış" görüp ikisi de ERP'ye gidebilir ve
    /// aynı servise iki fatura çıkar. Bu yüzden kayıt ERP'ye gitmeden ÖNCE tek bir koşullu
    /// UPDATE ile sahipleniliyor: `IsInvoiced = false` iken `true`ya çeken ilk istek kazanır,
    /// ikincisinin UPDATE'i 0 satır etkiler ve o istek var olan referansı döndürür.
    ///
    /// ERP çağrısı başarısız olursa sahiplenme GERİ ALINIR, aksi halde kayıt hiç faturalanamadan
    /// "faturalandı" işaretli kalır ve kullanıcı bir daha deneyemez.
    /// </summary>
    [HttpPost("invoices/create-service-invoice")]
    public async Task<IActionResult> CreateServiceInvoice([FromBody] System.Text.Json.JsonElement request, CancellationToken cancellationToken)
    {
        Guid? serviceRecordId = null;
        if (request.ValueKind == System.Text.Json.JsonValueKind.Object
            && request.TryGetProperty("serviceRecordId", out var prop)
            && Guid.TryParse(prop.GetString(), out var parsedId))
        {
            serviceRecordId = parsedId;
        }

        // YETKİ: fatura kesmek finansal bir işlem ve bu uçta HİÇBİR kontrol yoktu — oturum açmış
        // herhangi biri, başkasının servis kaydına, istediği carinin adına fatura kesebiliyordu.
        // Kural: kaydı görebiliyor olmak yetmez, o kaydı yönetebiliyor olmak gerekir.
        if (!await CanInvoiceServiceRecordAsync(serviceRecordId, cancellationToken))
        {
            return Forbid();
        }

        // CARİ KODU DOĞRULANMADAN FATURA KESİLMEZ.
        //
        // Uç, istemcinin gönderdiği `customerCode`'u olduğu gibi B2B'ye geçiriyordu. İstemcideki
        // `getDealerCode` ise kodu çözemediğinde sabit `'120-04-000001'` uyduruyordu: cari kodu
        // olmayan HER servis kaydının bedeli o tek hesaba yazılıyordu. Ayrıca DEMOTEST'te
        // `120-01-00001` gibi hane sayısı bozuk kodlar da var (eski test verisi).
        //
        // Kural: kod boşsa ya da biçimi tutmuyorsa istek reddedilir. Sessizce "bir yere" yazmak,
        // yanlış yere yazmanın ta kendisi.
        var customerCode = request.ValueKind == System.Text.Json.JsonValueKind.Object
                           && request.TryGetProperty("customerCode", out var ccProp)
            ? (ccProp.GetString() ?? string.Empty).Trim()
            : string.Empty;

        if (string.IsNullOrWhiteSpace(customerCode))
        {
            return BadRequest(new
            {
                success = false,
                message = "Cari kodu belirlenemedi; fatura oluşturulmadı. Kaydın bayi/cari bilgisini düzeltip tekrar deneyin."
            });
        }

        // B2B cari kodları "120-01-000586" biçiminde: üç bölüm, son bölüm 6 hane.
        if (!System.Text.RegularExpressions.Regex.IsMatch(customerCode, @"^\d{3}-\d{2}-\d{6}$"))
        {
            return BadRequest(new
            {
                success = false,
                message = $"Cari kodu geçersiz görünüyor ({customerCode}); fatura oluşturulmadı. Kaydın cari bilgisini düzeltin."
            });
        }

        var claimToken = $"{InvoiceClaimPrefix}{Guid.NewGuid():N}";

        if (serviceRecordId.HasValue)
        {
            // FATURALANMADAN ÖNCEKİ DURUM BURADA DAMGALANIR (kullanıcı kuralı, 2026-08-13).
            //
            // Fatura silinince kayıt eski durumuna dönmeli: "sahadaysa sahada, atölyedeyse
            // atölyede". Geri alma bunu tahmin ediyordu ve tahmin yanlıştı — aynı kayıt saha,
            // atölye, teslimat ya da montaj akışının herhangi birinden faturaya gidebiliyor.
            // Sahiplenme UPDATE'i zaten atomik; damga da aynı satıra, aynı işlemde yazılıyor
            // ki "faturalandı ama önceki durumu kaydedilmedi" ara hâli hiç oluşmasın.
            var claimed = await _context.ServiceRecords
                .Where(s => s.Id == serviceRecordId.Value && !s.IsInvoiced)
                .ExecuteUpdateAsync(setters => setters
                    .SetProperty(s => s.IsInvoiced, true)
                    .SetProperty(s => s.InvoiceReference, claimToken)
                    .SetProperty(s => s.PreInvoiceStatus, s => s.Status)
                    .SetProperty(s => s.UpdatedAt, DateTime.UtcNow), cancellationToken);

            if (claimed == 0)
            {
                // Ya kayıt yok ya da zaten faturalanmış. Faturalanmışsa mevcut referansı
                // döndürüyoruz: istemci için bu başarılı bir sonuç, ikinci fatura kesilmedi.
                var current = await _context.ServiceRecords
                    .AsNoTracking()
                    .Where(s => s.Id == serviceRecordId.Value)
                    .Select(s => new { s.InvoiceReference })
                    .FirstOrDefaultAsync(cancellationToken);

                if (current == null)
                {
                    return NotFound(new { success = false, message = "Servis kaydı bulunamadı." });
                }

                if (current.InvoiceReference?.StartsWith(InvoiceClaimPrefix, StringComparison.Ordinal) == true)
                {
                    return Conflict(new { success = false, message = "Bu servis kaydı için fatura oluşturma işlemi zaten sürüyor." });
                }

                return Ok(new
                {
                    success = true,
                    alreadyInvoiced = true,
                    data = new { orderNo = current.InvoiceReference, invoiceNo = current.InvoiceReference }
                });
            }
        }

        async Task ReleaseClaimAsync()
        {
            if (!serviceRecordId.HasValue) return;
            await _context.ServiceRecords
                .Where(s => s.Id == serviceRecordId.Value && s.InvoiceReference == claimToken)
                .ExecuteUpdateAsync(setters => setters
                    .SetProperty(s => s.IsInvoiced, false)
                    .SetProperty(s => s.InvoiceReference, (string?)null)
                    .SetProperty(s => s.PreInvoiceStatus, (ServiceOps.Domain.Entities.ServiceStatus?)null), CancellationToken.None);
        }

        var erpToken = await GetErpTokenAsync(cancellationToken);
        if (string.IsNullOrEmpty(erpToken))
        {
            await ReleaseClaimAsync();
            return StatusCode(StatusCodes.Status502BadGateway, new { success = false, message = "B2B ERP bağlantı hatası" });
        }

        // İŞLEMİ YAPANIN ARAÇ DEPOSU İSTEĞE EKLENİR (kullanıcı kuralı, 2026-08-13).
        //
        // B2B'nin ServiceOps `Technicians` tablosuna erişimi yok; "bu parça kimin arabasından
        // çıktı" sorusunun cevabı yalnızca burada var. Fatura taslağının kalemlerine
        // damgalanması için gövdeye ekleniyor. Teknisyen olmayan bir kullanıcı fatura kesiyorsa
        // alan hiç gitmez ve B2B kendi tarafındaki depo yetkisine düşer.
        var forwardedBody = await BuildServiceInvoiceBodyAsync(request, serviceRecordId, cancellationToken);

        var client = _httpClientFactory.CreateClient("ErpApi");
        var reqMessage = new HttpRequestMessage(HttpMethod.Post, "api/invoices/create-service-invoice")
        {
            Content = new StringContent(forwardedBody, System.Text.Encoding.UTF8, "application/json")
        };
        reqMessage.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", erpToken);
        reqMessage.Headers.Add("X-Tenant-Code", GetTenantCode());

        try
        {
            var res = await client.SendAsync(reqMessage, cancellationToken);
            var bodyText = await res.Content.ReadAsStringAsync(cancellationToken);

            if (!res.IsSuccessStatusCode)
            {
                await ReleaseClaimAsync();
                return UpstreamProblem(bodyText, res);
            }

            if (serviceRecordId.HasValue)
            {
                var orderNo = ExtractOrderNo(bodyText) ?? "CREATED";
                await _context.ServiceRecords
                    .Where(s => s.Id == serviceRecordId.Value && s.InvoiceReference == claimToken)
                    .ExecuteUpdateAsync(setters => setters
                        .SetProperty(s => s.InvoiceReference, orderNo)
                        .SetProperty(s => s.UpdatedAt, DateTime.UtcNow), cancellationToken);

                // Faturalama servis geçmişine de düşer: kaydın zaman çizelgesinde "ne zaman,
                // kim tarafından faturalandı" görünmediğinde fatura izi yalnızca B2B tarafında
                // kalıyor ve servis tarafında hiçbir yerden okunamıyordu.
                _context.Activities.Add(new ServiceOps.Domain.Entities.Activity
                {
                    ServiceId = serviceRecordId.Value,
                    Type = ServiceOps.Domain.Entities.ActivityType.System,
                    ActorUserName = User.FindFirstValue(System.Security.Claims.ClaimTypes.Name),
                    Payload = System.Text.Json.JsonSerializer.Serialize(new
                    {
                        field = "Invoice",
                        newValue = orderNo,
                        reason = "Servis satış faturası oluşturuldu.",
                        performedBy = User.FindFirstValue(System.Security.Claims.ClaimTypes.Name) ?? "Sistem"
                    }),
                    CreatedAt = DateTime.UtcNow
                });
                await _context.SaveChangesAsync(cancellationToken);
            }

            return Content(bodyText, "application/json");
        }
        catch (Exception ex)
        {
            await ReleaseClaimAsync();
            return StatusCode(500, new { success = false, message = ex.Message });
        }
    }

    /// <summary>
    /// Servis faturası taslağını iptal eder ve kaydın faturalandı işaretini KALDIRIR.
    ///
    /// Bu vekil ucu yoktu: istemci `/api/erp/invoices/cancel-service-invoice-by-record/{id}`
    /// çağırıyor, uç bulunmadığı için istek 404 alıyor ve taslak B2B tarafında duruyordu.
    /// İşaret temizlenmeden faturalama tek yönlü olurdu — iptal edilen bir servis bir daha
    /// faturalanamazdı (bkz. CreateServiceInvoice'taki sahiplenme).
    /// </summary>
    [HttpDelete("invoices/cancel-service-invoice-by-record/{serviceRecordId:guid}")]
    public async Task<IActionResult> CancelServiceInvoiceByRecord(Guid serviceRecordId, CancellationToken cancellationToken)
    {
        var erpToken = await GetErpTokenAsync(cancellationToken);
        if (string.IsNullOrEmpty(erpToken))
        {
            return StatusCode(StatusCodes.Status502BadGateway, new { success = false, message = "B2B ERP bağlantı hatası" });
        }

        var client = _httpClientFactory.CreateClient("ErpApi");
        var reqMessage = new HttpRequestMessage(
            HttpMethod.Delete,
            $"api/invoices/cancel-service-invoice-by-record/{serviceRecordId}");
        reqMessage.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", erpToken);
        reqMessage.Headers.Add("X-Tenant-Code", GetTenantCode());

        try
        {
            var res = await client.SendAsync(reqMessage, cancellationToken);
            var bodyText = await res.Content.ReadAsStringAsync(cancellationToken);

            if (!res.IsSuccessStatusCode)
            {
                return UpstreamProblem(bodyText, res);
            }

            // Taslak gerçekten silindikten SONRA işaret kaldırılıyor; ters sırada ERP çağrısı
            // patlarsa kayıt faturasız görünüp ikinci bir fatura kesilebilirdi.
            // Damga da temizlenir: kayıt tekrar faturalanacaksa o anki durumu yeniden damgalanmalı,
            // bayat bir damga sonraki geri almada YANLIŞ duruma döndürürdü.
            await _context.ServiceRecords
                .Where(s => s.Id == serviceRecordId)
                .ExecuteUpdateAsync(setters => setters
                    .SetProperty(s => s.IsInvoiced, false)
                    .SetProperty(s => s.InvoiceReference, (string?)null)
                    .SetProperty(s => s.PreInvoiceStatus, (ServiceOps.Domain.Entities.ServiceStatus?)null)
                    .SetProperty(s => s.UpdatedAt, DateTime.UtcNow), cancellationToken);

            return Content(bodyText, "application/json");
        }
        catch (Exception ex)
        {
            return StatusCode(500, new { success = false, message = ex.Message });
        }
    }

    /// <summary>
    /// Servis faturasının B2B'de nereye kadar geldiğini söyler.
    ///
    /// Servis faturası B2B'de doğrudan cari ekstresine yazmaz; bir SATIŞ SİPARİŞİ TASLAĞI
    /// (`SalesOrder`, Status=0) oluşturur. Taslak "Satış Faturası" ekranında faturaya
    /// dönüştürülünce Invoice + CustomerLedgerEntry yazılır ve hareket cari ekstresinde görünür.
    /// Bu iki adımlı akış BİLEREK böyle: servis tarafı kendi finans kaydını üretmiyor, mevcut
    /// satış hattını kullanıyor.
    ///
    /// Servis tarafında bu ara durum hiçbir yerden okunamıyordu — kullanıcı faturayı kestiğini
    /// sanıp ekstrede göremiyor, sebebini de bulamıyordu. Bu uç aradaki durumu görünür yapar.
    /// </summary>
    [HttpGet("service-invoice-status/{serviceRecordId:guid}")]
    public async Task<IActionResult> GetServiceInvoiceStatus(Guid serviceRecordId, CancellationToken cancellationToken)
    {
        var record = await _context.ServiceRecords
            .AsNoTracking()
            .Where(s => s.Id == serviceRecordId)
            .Select(s => new { s.IsInvoiced, s.InvoiceReference, s.DealerCode })
            .FirstOrDefaultAsync(cancellationToken);

        if (record == null) return NotFound(new { success = false, message = "Servis kaydı bulunamadı." });

        if (!record.IsInvoiced || string.IsNullOrWhiteSpace(record.InvoiceReference))
        {
            return Ok(new
            {
                success = true,
                stage = "none",
                label = "Fatura oluşturulmadı",
                orderNo = (string?)null,
                dealerCode = record.DealerCode
            });
        }

        var erpToken = await GetErpTokenAsync(cancellationToken);
        if (string.IsNullOrEmpty(erpToken))
        {
            // Bağlantı yoksa bildiğimiz kadarını söyle; "bilinmiyor" demek yanlış bilgi vermekten iyi.
            return Ok(new
            {
                success = true,
                stage = "unknown",
                label = "Durum sorgulanamadı (ERP bağlantısı yok)",
                orderNo = record.InvoiceReference,
                dealerCode = record.DealerCode
            });
        }

        var client = _httpClientFactory.CreateClient("ErpApi");
        var req = new HttpRequestMessage(HttpMethod.Get, "api/salesorders/uninvoiced-report");
        req.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", erpToken);
        req.Headers.Add("X-Tenant-Code", GetTenantCode());

        var stillDraft = false;
        try
        {
            var res = await client.SendAsync(req, cancellationToken);
            if (res.IsSuccessStatusCode)
            {
                var body = await res.Content.ReadAsStringAsync(cancellationToken);
                stillDraft = body.Contains(record.InvoiceReference, StringComparison.OrdinalIgnoreCase);
            }
        }
        catch
        {
            // Sorgulanamadıysa taslak varsayımına düşmüyoruz; aşağıda "unknown" dönecek.
            return Ok(new
            {
                success = true,
                stage = "unknown",
                label = "Durum sorgulanamadı",
                orderNo = record.InvoiceReference,
                dealerCode = record.DealerCode
            });
        }

        return Ok(new
        {
            success = true,
            stage = stillDraft ? "draft" : "invoiced",
            label = stillDraft
                ? "Satış siparişi oluştu — faturaya dönüştürülmeyi bekliyor (Satış Faturası ekranı)"
                : "Faturalandı — cari ekstresine işlendi",
            orderNo = record.InvoiceReference,
            dealerCode = record.DealerCode
        });
    }

    /// <summary>
    /// Servis fatura taslağı isteğini, kalemlerin çıkış deposunu belirleyecek bilgiyle
    /// zenginleştirir: <c>performerWarehouseCode</c> (teknisyenin araç deposu) ve
    /// <c>performerUsername</c>.
    ///
    /// İstemcinin gönderdiği alanlara DOKUNULMAZ; yalnızca eksik olanlar eklenir. İstemci zaten
    /// bir depo yollamışsa (ileride bir ekran açıkça seçtirebilir) o değer korunur — sunucunun
    /// sessizce üzerine yazması, kullanıcının seçimini yok saymak olurdu.
    ///
    /// Gövde okunamazsa ham metin olduğu gibi geçirilir: faturayı hiç kesememektense deposuz
    /// kesmek yeğdir, ekran depoyu zaten sorabiliyor.
    /// </summary>
    private async Task<string> BuildServiceInvoiceBodyAsync(
        System.Text.Json.JsonElement request,
        Guid? serviceRecordId,
        CancellationToken cancellationToken)
    {
        var raw = request.GetRawText();
        if (request.ValueKind != System.Text.Json.JsonValueKind.Object) return raw;

        // "İŞLEMİ YAPAN" = İŞİ YAPAN TEKNİSYEN, oturumu açan kişi DEĞİL.
        //
        // Önceki hâli oturumun teknisyen kaydına bakıyordu ve iki yönden birden yanlıştı:
        //  - İşi yöneticiler kapatıyor (müdür/ofis). Onların teknisyen kaydı yok, alan hiç
        //    gitmiyordu; B2B de kendi tarafında `User.Identity.Name`e düşüyordu. Ama B2B'ye
        //    giden istek ERP SERVİS HESABIYLA imzalı olduğu için o ad "ssa" çıkıyordu —
        //    kullanıcının bildirdiği hata buydu (fatura satırında "İşlemi Yapan: ssa").
        //  - Depo da yanlış kaynaktan geliyordu: parça, işi yapan teknisyenin arabasından
        //    çıkıyor; ekranı açan kişinin (varsa) arabasından değil.
        //
        // Doğru kaynak kaydın ATANAN TEKNİSYENİ. O da yoksa oturumun kendi teknisyen kaydına,
        // en son da oturum adına düşülüyor.
        Guid? technicianId = null;
        if (serviceRecordId.HasValue)
        {
            technicianId = await _context.ServiceRecords
                .AsNoTracking()
                .Where(r => r.Id == serviceRecordId.Value)
                .Select(r => r.AssignedTechnicianId)
                .FirstOrDefaultAsync(cancellationToken);
        }

        // MÜŞTERİ ADI VE TELEFONU FATURA AÇIKLAMASINA GİDER (2026-08-21 kullanıcı kuralı).
        //
        // B2B'nin servis kaydına erişimi yok; faturada yalnızca ürün adı görünüyor ve hangi
        // müşterinin işi olduğu kâğıttan okunamıyordu. Cari BAYİ olduğu için cari adı da
        // cevap vermiyor — iş sahibi son müşteri. Bu yüzden değerler burada okunup gövdeye
        // ekleniyor; B2B açıklamanın başına yazıyor.
        string? serviceCustomerName = null;
        string? serviceCustomerPhone = null;
        if (serviceRecordId.HasValue)
        {
            var musteri = await _context.ServiceRecords
                .AsNoTracking()
                .Where(r => r.Id == serviceRecordId.Value)
                .Select(r => new { r.CustomerName, r.CustomerPhone })
                .FirstOrDefaultAsync(cancellationToken);

            if (musteri != null)
            {
                serviceCustomerName = string.IsNullOrWhiteSpace(musteri.CustomerName) ? null : musteri.CustomerName.Trim();
                serviceCustomerPhone = string.IsNullOrWhiteSpace(musteri.CustomerPhone) ? null : musteri.CustomerPhone.Trim();
            }
        }

        technicianId ??= _permissions.GetTechnicianId(User);

        int? warehouseCode = null;
        string? technicianName = null;
        if (technicianId.HasValue)
        {
            var tech = await _context.Technicians
                .AsNoTracking()
                .Where(t => t.Id == technicianId.Value && t.IsActive)
                .Select(t => new { t.WarehouseCode, t.FullName })
                .FirstOrDefaultAsync(cancellationToken);

            if (tech != null)
            {
                if (tech.WarehouseCode.HasValue && tech.WarehouseCode.Value > 0) warehouseCode = tech.WarehouseCode.Value;
                if (!string.IsNullOrWhiteSpace(tech.FullName)) technicianName = tech.FullName;
            }
        }

        var username = User.FindFirstValue(ClaimTypes.Name) ?? User.Identity?.Name;
        var performerName = technicianName ?? username;

        var alreadyHasWarehouse = request.TryGetProperty("performerWarehouseCode", out var existing)
                                  && existing.ValueKind == System.Text.Json.JsonValueKind.Number;

        var alreadyHasPerformer = request.TryGetProperty("performerName", out var existingName)
                                  && existingName.ValueKind == System.Text.Json.JsonValueKind.String
                                  && !string.IsNullOrWhiteSpace(existingName.GetString());

        var nothingToAdd = (alreadyHasWarehouse || warehouseCode is null)
                           && (alreadyHasPerformer || string.IsNullOrWhiteSpace(performerName))
                           && string.IsNullOrWhiteSpace(username)
                           && serviceCustomerName is null
                           && serviceCustomerPhone is null;

        if (nothingToAdd) return raw;

        try
        {
            using var doc = System.Text.Json.JsonDocument.Parse(raw);
            var buffer = new System.IO.MemoryStream();
            using (var writer = new System.Text.Json.Utf8JsonWriter(buffer))
            {
                writer.WriteStartObject();
                foreach (var property in doc.RootElement.EnumerateObject())
                {
                    // Boş gelen `performerName` üzerine yazılabilsin diye atlanıyor; istemci
                    // dolu gönderdiyse `alreadyHasPerformer` true olur ve aşağıda eklenmez.
                    if (!alreadyHasPerformer && property.NameEquals("performerName")) continue;
                    property.WriteTo(writer);
                }

                if (!alreadyHasWarehouse && warehouseCode.HasValue)
                {
                    writer.WriteNumber("performerWarehouseCode", warehouseCode.Value);
                }

                if (!alreadyHasPerformer && !string.IsNullOrWhiteSpace(performerName))
                {
                    writer.WriteString("performerName", performerName);
                }

                if (!request.TryGetProperty("performerUsername", out _) && !string.IsNullOrWhiteSpace(username))
                {
                    writer.WriteString("performerUsername", username);
                }

                if (!request.TryGetProperty("serviceCustomerName", out _) && serviceCustomerName is not null)
                {
                    writer.WriteString("serviceCustomerName", serviceCustomerName);
                }

                if (!request.TryGetProperty("serviceCustomerPhone", out _) && serviceCustomerPhone is not null)
                {
                    writer.WriteString("serviceCustomerPhone", serviceCustomerPhone);
                }

                writer.WriteEndObject();
            }

            return System.Text.Encoding.UTF8.GetString(buffer.ToArray());
        }
        catch
        {
            return raw;
        }
    }

    private static string? ExtractOrderNo(string bodyText)
    {
        try
        {
            using var doc = System.Text.Json.JsonDocument.Parse(bodyText);
            var root = doc.RootElement;

            if (root.TryGetProperty("data", out var data) && data.ValueKind == System.Text.Json.JsonValueKind.Object)
            {
                if (data.TryGetProperty("invoiceNo", out var inv) && inv.ValueKind == System.Text.Json.JsonValueKind.String)
                    return inv.GetString();
                if (data.TryGetProperty("orderNo", out var ord) && ord.ValueKind == System.Text.Json.JsonValueKind.String)
                    return ord.GetString();
            }

            if (root.TryGetProperty("invoiceNo", out var rootInv) && rootInv.ValueKind == System.Text.Json.JsonValueKind.String)
                return rootInv.GetString();
            if (root.TryGetProperty("orderNo", out var rootOrd) && rootOrd.ValueKind == System.Text.Json.JsonValueKind.String)
                return rootOrd.GetString();
        }
        catch
        {
            // Yanıt beklenen biçimde değilse referans "CREATED" kalır; fatura yine de kesilmiştir.
        }

        return null;
    }

    [HttpPost("technician-sale/calculate-prices")]
    public async Task<IActionResult> CalculatePrices([FromBody] CalculatePricesRequest request, CancellationToken cancellationToken)
    {
        var username = User.FindFirstValue(ClaimTypes.Name) ?? User.Identity?.Name ?? "";
        var tech = await _context.Technicians
            .FirstOrDefaultAsync(t => t.UserId == username && t.IsActive, cancellationToken);

        if (tech == null)
        {
            return BadRequest(new { success = false, message = "Teknisyen profili bulunamadı" });
        }

        var erpToken = await GetErpTokenAsync(cancellationToken);
        if (string.IsNullOrEmpty(erpToken))
        {
            return StatusCode(500, new { success = false, message = "B2B ERP bağlantı hatası" });
        }

        var client = _httpClientFactory.CreateClient("ErpApi");
        var erpPayload = new
        {
            CustomerCode = request.CustomerCode,
            StockCodes = request.StockCodes
        };

        var reqMessage = new HttpRequestMessage(HttpMethod.Post, "api/invoices/calculate-direct-sale-prices")
        {
            Content = JsonContent.Create(erpPayload)
        };
        reqMessage.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", erpToken);
        var tenantCode = User.FindFirstValue("tenantCode") ?? User.FindFirstValue("tenant") ?? tech.TenantCode ?? "";
        if (!string.IsNullOrEmpty(tenantCode))
        {
            reqMessage.Headers.Add("X-Tenant-Code", tenantCode);
        }

        try
        {
            var res = await client.SendAsync(reqMessage, cancellationToken);
            var bodyText = await res.Content.ReadAsStringAsync(cancellationToken);
            return res.IsSuccessStatusCode
                ? Content(bodyText, "application/json")
                : UpstreamProblem(bodyText, res);
        }
        catch (Exception ex)
        {
            return StatusCode(500, new { success = false, message = ex.Message });
        }
    }

    // GET api/erp/customers ve GET api/erp/dealers BİLEREK BURADA DEĞİL.
    // İkisi de Program.cs'te minimal API olarak kayıtlı (`/api/erp/customers`, `/api/erp/dealers`).
    // Buraya aynı yolla ikinci bir action eklenirse iki uç eşit öncelikle eşleşir ve ASP.NET Core
    // istek anında AmbiguousMatchException atar (HTTP 500) — yani cari/bayi listesi tamamen ölür.
    // Program.cs'teki sürümler ayrıca üst sistemin 401/403'ünü 502'ye çevirir; buradaki proxy
    // action'ların aksine kullanıcıyı oturumdan atmazlar.

    [HttpGet("customers/next-code")]
    public async Task<IActionResult> GetNextCustomerCode([FromQuery] string customerType = "Müşteri", CancellationToken cancellationToken = default)
    {
        var erpToken = await GetErpTokenAsync(cancellationToken);
        if (string.IsNullOrEmpty(erpToken))
            return StatusCode(500, new { success = false, message = "B2B ERP bağlantı hatası" });

        var tenantCode = GetTenantCode();
        var client = _httpClientFactory.CreateClient("ErpApi");
        var qs = $"?customerType={Uri.EscapeDataString(customerType)}";
        var reqMessage = new HttpRequestMessage(HttpMethod.Get, $"api/customers/next-code{qs}");
        reqMessage.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", erpToken);
        reqMessage.Headers.Add("X-Tenant-Code", tenantCode);

        try
        {
            var res = await client.SendAsync(reqMessage, cancellationToken);
            var bodyText = await res.Content.ReadAsStringAsync(cancellationToken);
            return res.IsSuccessStatusCode
                ? Content(bodyText, "application/json")
                : UpstreamProblem(bodyText, res);
        }
        catch (Exception ex)
        {
            return StatusCode(500, new { success = false, message = ex.Message });
        }
    }

    [HttpGet("price-groups")]
    public async Task<IActionResult> GetPriceGroups(CancellationToken cancellationToken)
    {
        var erpToken = await GetErpTokenAsync(cancellationToken);
        if (string.IsNullOrEmpty(erpToken))
            return StatusCode(500, new { success = false, message = "B2B ERP bağlantı hatası" });

        var tenantCode = GetTenantCode();
        var client = _httpClientFactory.CreateClient("ErpApi");
        var reqMessage = new HttpRequestMessage(HttpMethod.Get, "api/pricegroups?includeInactive=false");
        reqMessage.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", erpToken);
        reqMessage.Headers.Add("X-Tenant-Code", tenantCode);

        try
        {
            var res = await client.SendAsync(reqMessage, cancellationToken);
            var bodyText = await res.Content.ReadAsStringAsync(cancellationToken);
            return res.IsSuccessStatusCode
                ? Content(bodyText, "application/json")
                : UpstreamProblem(bodyText, res);
        }
        catch (Exception ex)
        {
            return StatusCode(500, new { success = false, message = ex.Message });
        }
    }

    [HttpPost("customers")]
    public async Task<IActionResult> CreateCustomer([FromBody] System.Text.Json.JsonElement customerPayload, CancellationToken cancellationToken)
    {
        var erpToken = await GetErpTokenAsync(cancellationToken);
        if (string.IsNullOrEmpty(erpToken))
        {
            return StatusCode(500, new { success = false, message = "B2B ERP bağlantı hatası" });
        }

        var client = _httpClientFactory.CreateClient("ErpApi");
        var reqMessage = new HttpRequestMessage(HttpMethod.Post, "api/customers")
        {
            Content = new StringContent(customerPayload.GetRawText(), System.Text.Encoding.UTF8, "application/json")
        };
        reqMessage.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", erpToken);
        
        var tenantCode = User.FindFirstValue("tenantCode") ?? User.FindFirstValue("tenant") ?? GetTenantCode();
        if (!string.IsNullOrEmpty(tenantCode))
        {
            reqMessage.Headers.Add("X-Tenant-Code", tenantCode);
        }

        try
        {
            var res = await client.SendAsync(reqMessage, cancellationToken);
            var bodyText = await res.Content.ReadAsStringAsync(cancellationToken);
            return res.IsSuccessStatusCode
                ? Content(bodyText, "application/json")
                : UpstreamProblem(bodyText, res);
        }
        catch (Exception ex)
        {
            return StatusCode(500, new { success = false, message = ex.Message });
        }
    }

    [HttpGet("admin/technician-stock/{technicianId:guid}")]
    public async Task<IActionResult> GetTechnicianStockAdmin(Guid technicianId, [FromQuery] string? q, CancellationToken cancellationToken)
    {
        if (!await CanReachTechnicianWarehouseAsync(technicianId, cancellationToken))
        {
            return Forbid();
        }

        var tech = await _context.Technicians
            .FirstOrDefaultAsync(t => t.Id == technicianId && t.IsActive, cancellationToken);

        if (tech == null)
        {
            return BadRequest(new { success = false, message = "Teknisyen profili bulunamadı" });
        }

        if (!tech.WarehouseCode.HasValue || tech.WarehouseCode.Value <= 0)
        {
            return Ok(new { success = true, data = Array.Empty<object>() });
        }

        var erpToken = await GetErpTokenAsync(cancellationToken);
        if (string.IsNullOrEmpty(erpToken))
        {
            return StatusCode(500, new { success = false, message = "B2B ERP bağlantı hatası" });
        }

        var qs = q != null ? $"?q={Uri.EscapeDataString(q)}" : "";
        var client = _httpClientFactory.CreateClient("ErpApi");
        var reqMessage = new HttpRequestMessage(HttpMethod.Get, $"api/warehouses/{tech.WarehouseCode.Value}/inventory{qs}");
        reqMessage.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", erpToken);
        var tenantCode = !string.IsNullOrWhiteSpace(tech.TenantCode) ? tech.TenantCode : GetTenantCode();
        if (!string.IsNullOrEmpty(tenantCode))
        {
            reqMessage.Headers.Add("X-Tenant-Code", tenantCode);
        }

        try
        {
            var res = await client.SendAsync(reqMessage, cancellationToken);
            var bodyText = await res.Content.ReadAsStringAsync(cancellationToken);
            if (!res.IsSuccessStatusCode)
            {
                return UpstreamProblem(bodyText, res);
            }

            using var doc = System.Text.Json.JsonDocument.Parse(bodyText);
            var success = doc.RootElement.GetProperty("success").GetBoolean();
            if (!success) return BadRequest(new { success = false, message = "Envanter alınamadı" });

            var rawItems = doc.RootElement.GetProperty("data").GetProperty("items").EnumerateArray();
            var mappedList = new List<object>();

            foreach (var item in rawItems)
            {
                var stockCode = item.GetProperty("stockCode").GetString() ?? "";
                var name = item.GetProperty("stockName").GetString() ?? "";
                var balance = item.GetProperty("balance").GetDecimal();
                var minStock = item.GetProperty("minStock").GetDecimal();

                bool isSparePart = stockCode.Contains("PARCA", StringComparison.OrdinalIgnoreCase) 
                                   || name.Contains("Parça", StringComparison.OrdinalIgnoreCase)
                                   || name.Contains("Yedek", StringComparison.OrdinalIgnoreCase);

                mappedList.Add(new
                {
                    type = isSparePart ? "SparePart" : "Product",
                    id = stockCode,
                    productId = stockCode,
                    productName = name,
                    name = name,
                    partNumber = stockCode,
                    quantity = balance,
                    minStockLevel = minStock
                });
            }

            return Ok(new { success = true, data = mappedList });
        }
        catch (Exception ex)
        {
            return StatusCode(500, new { success = false, message = ex.Message });
        }
    }

    [HttpPost("admin/technician-sale/{technicianId:guid}")]
    public async Task<IActionResult> CreateTechnicianSaleAdmin(Guid technicianId, [FromBody] TechnicianSaleRequest request, CancellationToken cancellationToken)
    {
        if (!await CanReachTechnicianWarehouseAsync(technicianId, cancellationToken))
        {
            return Forbid();
        }

        var tech = await _context.Technicians
            .FirstOrDefaultAsync(t => t.Id == technicianId && t.IsActive, cancellationToken);

        if (tech == null)
        {
            return BadRequest(new { success = false, message = "Teknisyen profili bulunamadı" });
        }

        if (!tech.WarehouseCode.HasValue || tech.WarehouseCode.Value <= 0)
        {
            return BadRequest(new { success = false, message = "Teknisyene atanmış aktif bir depo bulunmamaktadır" });
        }

        var paymentMethod = (request.PaymentMethod ?? string.Empty).Trim();
        int? accountId = null;

        if (string.Equals(paymentMethod, "Cash", StringComparison.OrdinalIgnoreCase))
        {
            if (!tech.CashAccountId.HasValue || tech.CashAccountId.Value <= 0)
            {
                return BadRequest(new { success = false, message = "Teknisyen profiline tanımlı kasa hesabı bulunmamaktadır" });
            }
            accountId = tech.CashAccountId.Value;
        }
        else if (string.Equals(paymentMethod, "Bank", StringComparison.OrdinalIgnoreCase))
        {
            if (request.UsePos == true)
            {
                if (!tech.PosAccountId.HasValue || tech.PosAccountId.Value <= 0)
                {
                    return BadRequest(new { success = false, message = "Teknisyen profiline tanımlı Sanal POS banka hesabı bulunmamaktadır" });
                }
                accountId = tech.PosAccountId.Value;
            }
            else
            {
                if (!tech.BankAccountId.HasValue || tech.BankAccountId.Value <= 0)
                {
                    return BadRequest(new { success = false, message = "Teknisyen profiline tanımlı banka hesabı bulunmamaktadır" });
                }
                accountId = tech.BankAccountId.Value;
            }
        }
        else if (string.Equals(paymentMethod, "OpenAccount", StringComparison.OrdinalIgnoreCase))
        {
            if (request.CashAmount.HasValue && request.CashAmount.Value > 0)
            {
                if (!tech.CashAccountId.HasValue || tech.CashAccountId.Value <= 0)
                {
                    return BadRequest(new { success = false, message = "Teknisyen profiline tanımlı kasa hesabı bulunmamaktadır" });
                }
                accountId = tech.CashAccountId.Value;
            }
        }

        var erpToken = await GetErpTokenAsync(cancellationToken);
        if (string.IsNullOrEmpty(erpToken))
        {
            return StatusCode(500, new { success = false, message = "B2B ERP bağlantı hatası" });
        }

        var client = _httpClientFactory.CreateClient("ErpApi");
        var erpRequest = new
        {
            CustomerCode = request.CustomerCode,
            WarehouseCode = tech.WarehouseCode.Value,
            PaymentMethod = paymentMethod,
            AccountId = accountId,
            CashAmount = request.CashAmount,
            Lines = request.Lines.Select(l => new { l.StockCode, l.Quantity }).ToList()
        };

        var reqMessage = new HttpRequestMessage(HttpMethod.Post, "api/invoices/create-direct-vehicle-sale")
        {
            Content = JsonContent.Create(erpRequest)
        };
        reqMessage.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", erpToken);
        var tenantCode = !string.IsNullOrWhiteSpace(tech.TenantCode) ? tech.TenantCode : GetTenantCode();
        if (!string.IsNullOrEmpty(tenantCode))
        {
            reqMessage.Headers.Add("X-Tenant-Code", tenantCode);
        }

        try
        {
            var res = await client.SendAsync(reqMessage, cancellationToken);
            var bodyText = await res.Content.ReadAsStringAsync(cancellationToken);
            return res.IsSuccessStatusCode
                ? Content(bodyText, "application/json")
                : UpstreamProblem(bodyText, res);
        }
        catch (Exception ex)
        {
            return StatusCode(500, new { success = false, message = ex.Message });
        }
    }

    [HttpPost("admin/technician-sale/calculate-prices/{technicianId:guid}")]
    public async Task<IActionResult> CalculatePricesAdmin(Guid technicianId, [FromBody] CalculatePricesRequest request, CancellationToken cancellationToken)
    {
        if (!await CanReachTechnicianWarehouseAsync(technicianId, cancellationToken))
        {
            return Forbid();
        }

        var tech = await _context.Technicians
            .FirstOrDefaultAsync(t => t.Id == technicianId && t.IsActive, cancellationToken);

        if (tech == null)
        {
            return BadRequest(new { success = false, message = "Teknisyen profili bulunamadı" });
        }

        var erpToken = await GetErpTokenAsync(cancellationToken);
        if (string.IsNullOrEmpty(erpToken))
        {
            return StatusCode(500, new { success = false, message = "B2B ERP bağlantı hatası" });
        }

        var client = _httpClientFactory.CreateClient("ErpApi");
        var erpPayload = new
        {
            CustomerCode = request.CustomerCode,
            StockCodes = request.StockCodes
        };

        var reqMessage = new HttpRequestMessage(HttpMethod.Post, "api/invoices/calculate-direct-sale-prices")
        {
            Content = JsonContent.Create(erpPayload)
        };
        reqMessage.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", erpToken);
        var tenantCode = !string.IsNullOrWhiteSpace(tech.TenantCode) ? tech.TenantCode : GetTenantCode();
        if (!string.IsNullOrEmpty(tenantCode))
        {
            reqMessage.Headers.Add("X-Tenant-Code", tenantCode);
        }

        try
        {
            var res = await client.SendAsync(reqMessage, cancellationToken);
            var bodyText = await res.Content.ReadAsStringAsync(cancellationToken);
            return res.IsSuccessStatusCode
                ? Content(bodyText, "application/json")
                : UpstreamProblem(bodyText, res);
        }
        catch (Exception ex)
        {
            return StatusCode(500, new { success = false, message = ex.Message });
        }
    }


    public class CalculatePricesRequest
    {
        public string CustomerCode { get; set; } = string.Empty;
        public System.Collections.Generic.List<string> StockCodes { get; set; } = new();
    }

    public class TechnicianSaleRequest
    {
        public string CustomerCode { get; set; } = string.Empty;
        public string PaymentMethod { get; set; } = string.Empty; // Cash, Bank, OpenAccount
        public bool? UsePos { get; set; }
        public decimal? CashAmount { get; set; }
        public List<TechnicianSaleLineDto> Lines { get; set; } = new();
    }

    public class TechnicianSaleLineDto
    {
        public string StockCode { get; set; } = string.Empty;
        public decimal Quantity { get; set; }
    }

    public class QuickServiceOrderRequest
    {
        public string CustomerCode { get; set; } = string.Empty;
        public int WarehouseCode { get; set; }
        public List<TechnicianSaleLineDto> Lines { get; set; } = new();
    }
}
