using System.Net.Http.Json;
using System.Security.Claims;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Npgsql;

namespace Asistan.Api.Infrastructure;

/// <summary>
/// Asistan ekranının (asistan.example.com) girişi. İki yol, ikisi de B2B kullanıcısıyla:
///
///  1. Şifreyle: firma + kullanıcı adı + şifre → ERP'nin KENDİ giriş ucuna sunucudan sunucuya
///     sorulur (şifre burada doğrulanmaz, saklanmaz, günlüğe yazılmaz). ERP'nin döndürdüğü token
///     bir kez doğrulanır ve asistanın token'ına çevrilir.
///  2. Devirle: B2B'de "Asistan'a Geç" → adres çubuğunda B2B token'ı → /exchange.
///
/// Her iki yolda da giriş yetkisi (B2B Kullanıcılar → "Asistan (WhatsApp)", bkz. PageAccess) GİRİŞTE kontrol edilir: yetkisiz
/// kullanıcı oturum açamaz, "yetkiniz yok" der. Ayrı kullanıcı listesi YOK.
/// </summary>
[ApiController]
[Route("api/auth")]
public sealed class AuthController : ControllerBase
{
    private readonly AsistanTokens _tokens;
    private readonly PageAccess _access;
    private readonly TenantDb _db;
    private readonly IHttpClientFactory _http;
    private readonly IConfiguration _configuration;
    private readonly ILogger<AuthController> _log;

    public AuthController(AsistanTokens tokens, PageAccess access, TenantDb db, IHttpClientFactory http, IConfiguration configuration, ILogger<AuthController> log)
    {
        _tokens = tokens;
        _access = access;
        _db = db;
        _http = http;
        _configuration = configuration;
        _log = log;
    }

    /// <summary>Giriş ekranındaki firma listesi (yalnız kod ve ad).</summary>
    [HttpGet("tenants")]
    public async Task<IActionResult> Tenants(CancellationToken ct)
    {
        await using var conn = new NpgsqlConnection(_db.BuildConnectionString("b2b_erp_master"));
        await conn.OpenAsync(ct);
        await using var cmd = new NpgsqlCommand(
            "SELECT \"Code\", COALESCE(\"Name\", \"Code\") FROM public.\"Tenants\" WHERE \"IsActive\" = true ORDER BY \"Name\"", conn);
        var list = new List<object>();
        await using var r = await cmd.ExecuteReaderAsync(ct);
        while (await r.ReadAsync(ct)) list.Add(new { code = r.GetString(0), name = r.GetString(1) });
        return Ok(list);
    }

    public sealed class LoginRequest
    {
        public string? TenantCode { get; set; }
        public string? Username { get; set; }
        public string? Password { get; set; }
    }

    [HttpPost("login")]
    [EnableRateLimiting("login")]
    public async Task<IActionResult> Login([FromBody] LoginRequest request, CancellationToken ct)
    {
        if (!_tokens.IsConfigured) return StatusCode(StatusCodes.Status503ServiceUnavailable, new { message = "Giriş yapılandırılmamış (AsistanJwt / B2BJwt anahtarı yok)." });

        var tenant = (request.TenantCode ?? string.Empty).Trim();
        var username = (request.Username ?? string.Empty).Trim();
        if (tenant.Length == 0 || username.Length == 0 || string.IsNullOrEmpty(request.Password))
        {
            return BadRequest(new { message = "Firma, kullanıcı adı ve şifre zorunlu." });
        }

        var erpBase = (_configuration["Erp:BaseUrl"] ?? string.Empty).TrimEnd('/');
        if (erpBase.Length == 0) return StatusCode(StatusCodes.Status503ServiceUnavailable, new { message = "ERP adresi yapılandırılmamış." });

        string? erpToken;
        try
        {
            var client = _http.CreateClient("erp");
            using var msg = new HttpRequestMessage(HttpMethod.Post, $"{erpBase}/api/auth/login")
            {
                Content = JsonContent.Create(new { username, password = request.Password, tenantCode = tenant })
            };
            msg.Headers.Add("X-Tenant-Code", tenant);
            // ERP'nin giriş kaydında asistan sunucusu değil gerçek kullanıcı görünsün.
            var ip = HttpContext.Connection.RemoteIpAddress?.ToString();
            if (!string.IsNullOrWhiteSpace(ip)) msg.Headers.Add("X-Forwarded-For", ip);

            using var resp = await client.SendAsync(msg, ct);
            var text = await resp.Content.ReadAsStringAsync(ct);
            if (!resp.IsSuccessStatusCode)
            {
                var message = TryMessage(text) ?? "Kullanıcı adı veya şifre hatalı.";
                return StatusCode(resp.StatusCode == System.Net.HttpStatusCode.Unauthorized ? 401 : 502, new { message });
            }

            using var doc = JsonDocument.Parse(text);
            erpToken = doc.RootElement.TryGetProperty("data", out var d) && d.TryGetProperty("accessToken", out var t) ? t.GetString() : null;
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or JsonException)
        {
            _log.LogWarning(ex, "ERP girişine ulaşılamadı");
            return StatusCode(StatusCodes.Status502BadGateway, new { message = "ERP'ye ulaşılamadı, biraz sonra tekrar deneyin." });
        }

        if (string.IsNullOrWhiteSpace(erpToken)) return StatusCode(StatusCodes.Status502BadGateway, new { message = "ERP oturum bilgisi döndürmedi." });
        return await IssueFromB2BAsync(erpToken, tenant, ct);
    }

    public sealed class ExchangeRequest
    {
        public string? Token { get; set; }
        public string? TenantCode { get; set; }
    }

    /// <summary>B2B'den "Asistan'a Geç": B2B token'ı bir kez doğrulanır, asistan token'ı döner.</summary>
    [HttpPost("exchange")]
    [EnableRateLimiting("exchange")]
    public async Task<IActionResult> Exchange([FromBody] ExchangeRequest request, CancellationToken ct)
    {
        if (!_tokens.IsConfigured) return StatusCode(StatusCodes.Status503ServiceUnavailable, new { message = "Giriş yapılandırılmamış." });
        if (string.IsNullOrWhiteSpace(request.Token)) return BadRequest(new { message = "Devir bilgisi eksik." });
        return await IssueFromB2BAsync(request.Token.Trim(), request.TenantCode, ct);
    }

    [HttpGet("me")]
    [PanelAuth]
    public IActionResult Me()
    {
        var me = PanelAuthAttribute.Current(HttpContext);
        return Ok(new { userName = me.UserName, tenantCode = me.TenantCode, isSsa = me.IsSsa });
    }

    private async Task<IActionResult> IssueFromB2BAsync(string b2bToken, string? requestedTenant, CancellationToken ct)
    {
        var validated = _tokens.ValidateB2B(b2bToken);
        if (validated is null) return Unauthorized(new { message = "Oturum doğrulanamadı; lütfen tekrar giriş yapın." });

        var (principal, expires) = validated.Value;
        var isSsa = principal.FindFirst("IsSuperSuperAdmin")?.Value == "1";

        // Gerçek B2B token'ı firmayı TenantId (master Tenants.Id) olarak taşır; TenantCode
        // yalnız bazı eski/özel token'larda var. İkisi de yoksa firmasız (SSA) oturumdur.
        var tokenTenant = principal.FindFirst("TenantCode")?.Value;
        if (string.IsNullOrWhiteSpace(tokenTenant) && int.TryParse(principal.FindFirst("TenantId")?.Value, out var tenantId))
        {
            try
            {
                tokenTenant = await _db.TenantCodeByIdAsync(tenantId, ct);
            }
            catch (NpgsqlException ex)
            {
                _log.LogError(ex, "Firma kimliği çözülemedi ({TenantId})", tenantId);
                return StatusCode(StatusCodes.Status503ServiceUnavailable, new { message = "Firma bilgisi okunamadı." });
            }
        }

        // Firma TOKEN'dan. İstek başka firma diyorsa reddedilir; yalnız SSA (firmasız yönetici)
        // istenen firmaya girebilir.
        string? tenant = tokenTenant;
        if (!string.IsNullOrWhiteSpace(requestedTenant) && !string.Equals(requestedTenant.Trim(), tokenTenant, StringComparison.OrdinalIgnoreCase))
        {
            if (!isSsa) return StatusCode(StatusCodes.Status403Forbidden, new { message = "Bu firmaya giriş yetkiniz yok." });
            tenant = requestedTenant;
        }

        string tenantCode;
        try
        {
            tenantCode = TenantDb.Normalize(tenant);
        }
        catch (InvalidOperationException)
        {
            return StatusCode(StatusCodes.Status403Forbidden, new { message = "Firma bilgisi yok." });
        }

        var userName = principal.Identity?.Name ?? principal.FindFirst(ClaimTypes.Name)?.Value ?? "?";
        int? roleId = int.TryParse(principal.FindFirst("RoleId")?.Value, out var r) ? r : null;

        try
        {
            if (!await _access.IsAllowedAsync(tenantCode, isSsa, userName, ct))
            {
                return StatusCode(StatusCodes.Status403Forbidden, new { message = "Asistan programına giriş yetkiniz yok. Yöneticiniz B2B → Kullanıcılar sayfasında \"Asistan (WhatsApp)\" kutusunu işaretleyebilir." });
            }
        }
        catch (Exception ex) when (ex is NpgsqlException or InvalidOperationException)
        {
            _log.LogError(ex, "Sayfa yetkisi okunamadı ({Tenant})", tenantCode);
            return StatusCode(StatusCodes.Status503ServiceUnavailable, new { message = "Yetki kontrol edilemedi." });
        }

        var user = new PanelUser(tenantCode, userName, isSsa);
        var token = _tokens.Issue(user, roleId, expires);
        var own = _tokens.ValidateOwn(token);
        return Ok(new
        {
            token,
            expiresAt = own?.ExpiresUtc,
            user = new { userName, tenantCode, isSsa }
        });
    }

    private static string? TryMessage(string json)
    {
        try
        {
            using var doc = JsonDocument.Parse(json);
            return doc.RootElement.TryGetProperty("message", out var m) ? m.GetString() : null;
        }
        catch (JsonException)
        {
            return null;
        }
    }
}
