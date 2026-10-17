using System.Net.Http.Headers;
using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using ServiceOps.Api.Services;
using ServiceOps.Infrastructure.Data;

namespace ServiceOps.Api.Controllers;

/// <summary>
/// FATURA TAKİP — teknisyen ekranı (2026-09-15).
///
/// Veri ServiceOps'ta DEĞİL, B2B ERP'de (faturanın kendisi orada). Bu sınıf yalnızca vekil:
/// ERP'nin <c>api/invoice-tracking/field/*</c> uçlarına sunucu-sunucu anahtarıyla gider.
///
/// KİMLİK İSTEMCİDEN ALINMAZ. Teknisyen kimliği oturumdan (<see cref="IServiceOpsPermissionService.GetScopeAsync"/>)
/// çözülür; istemci başka bir teknisyenin kimliğini gönderemez (ServiceRecords'ta
/// <c>?technicianId=</c> ile başkasının işini görme açığı yaşanmıştı). Yalnızca
/// <c>faturaTakip.tumIsleriGorme</c> kapsamı olan yönetici listeyi süzebilir; durum değiştirmek
/// ise her zaman yalnızca faturanın atandığı teknisyene açık (ERP ayrıca doğruluyor).
/// </summary>
[ApiController]
[Route("api/invoice-tracking")]
[Authorize]
public sealed class InvoiceTrackingController : ControllerBase
{
    private const string PageKey = "faturaTakip";

    private readonly IHttpClientFactory _httpClientFactory;
    private readonly IConfiguration _configuration;
    private readonly IServiceOpsPermissionService _permissions;
    private readonly ApplicationDbContext _context;
    private readonly ILogger<InvoiceTrackingController> _logger;

    public InvoiceTrackingController(
        IHttpClientFactory httpClientFactory,
        IConfiguration configuration,
        IServiceOpsPermissionService permissions,
        ApplicationDbContext context,
        ILogger<InvoiceTrackingController> logger)
    {
        _httpClientFactory = httpClientFactory;
        _configuration = configuration;
        _permissions = permissions;
        _context = context;
        _logger = logger;
    }

    private string? TenantCode()
    {
        var code = User.FindFirstValue("tenantCode") ?? User.FindFirstValue("tenant");
        if (string.IsNullOrWhiteSpace(code) && Request.Headers.TryGetValue("X-Tenant-Code", out var hdr)) code = hdr.ToString();
        if (string.IsNullOrWhiteSpace(code)) code = _configuration["ErpApi:ServiceAccount:TenantCode"];
        return string.IsNullOrWhiteSpace(code) ? null : code.Trim();
    }

    private HttpRequestMessage ErpRequest(HttpMethod method, string path, string tenantCode)
    {
        var request = new HttpRequestMessage(method, path);
        request.Headers.Add("X-Internal-Key", _configuration["ServiceOps:InternalApiKey"] ?? string.Empty);
        request.Headers.Add("X-Tenant-Code", tenantCode);
        return request;
    }

    /// <summary>Üst sistemin 401/403'ü dışarı sızmaz: istemci onu "oturumun düştü" sanıp çıkış yapar.</summary>
    private IActionResult Upstream(HttpResponseMessage res, string body)
    {
        var status = res.StatusCode is System.Net.HttpStatusCode.Unauthorized or System.Net.HttpStatusCode.Forbidden
            ? StatusCodes.Status502BadGateway
            : (int)res.StatusCode;
        return string.IsNullOrWhiteSpace(body)
            ? StatusCode(status, new { success = false, message = "B2B ERP isteği reddetti." })
            : new ContentResult { StatusCode = status, Content = body, ContentType = "application/json" };
    }

    private async Task<string> ActorNameAsync(Guid technicianId, CancellationToken ct)
    {
        var tech = await _context.Technicians.AsNoTracking()
            .Where(t => t.Id == technicianId)
            .Select(t => new { t.FirstName, t.LastName })
            .FirstOrDefaultAsync(ct);
        var name = tech is null ? null : $"{tech.FirstName} {tech.LastName}".Trim();
        var username = User.Identity?.Name;
        if (string.IsNullOrWhiteSpace(name)) return username ?? "Teknisyen";
        return string.IsNullOrWhiteSpace(username) ? name : $"{name} ({username})";
    }

    [HttpGet("list")]
    public async Task<IActionResult> List([FromQuery] Guid? technicianId, [FromQuery] int daysAhead = 7, CancellationToken ct = default)
    {
        var scope = await _permissions.GetScopeAsync(User, PageKey, ct);
        if (!scope.CanAccess)
        {
            /*
              "YETKİN YOK" İLE "TEKNİSYEN KAYDIN YOK" AYRI ŞEYLER (2026-09-18 canlı bildirimi:
              rolde Fatura Takip AÇIK olmasına rağmen ekran "İstek başarısız (403)" veriyordu).

              `GetScopeAsync`, sayfa yetkisi olan ama "tüm işleri görme" kapsamı OLMAYAN
              kullanıcıyı teknisyen kimliğine düşürüyor; kimlik yoksa kapsam None oluyor ve
              burası 403 dönüyordu. Oysa sayfa açık: kullanıcının eksik olan tek şeyi servis
              tarafındaki teknisyen kaydı (oturum ilk açılışta bağlanır). O durumda kapı değil,
              boş liste + ne yapılacağını söyleyen mesaj doğru cevap.
            */
            if (await _permissions.HasPageAsync(User, PageKey, ct))
            {
                return Ok(new
                {
                    success = true,
                    data = Array.Empty<object>(),
                    message = "Hesabınız bir teknisyen kaydına bağlı değil. Çıkış yapıp tekrar giriş yapın; sorun sürerse Servis → Teknisyenler'den bu kullanıcıyı ekleyin."
                });
            }
            return Forbid();
        }

        Guid? effective = scope.CanViewAll ? technicianId : scope.TechnicianId;
        if (!scope.CanViewAll && !effective.HasValue)
        {
            return Ok(new { success = true, data = Array.Empty<object>(), message = "Hesabınız bir teknisyen kaydına bağlı değil." });
        }

        var tenant = TenantCode();
        if (tenant is null) return BadRequest(new { success = false, message = "Firma kodu çözülemedi." });

        var path = $"api/invoice-tracking/field/list?daysAhead={Math.Clamp(daysAhead, 0, 14)}" +
                   (effective.HasValue ? $"&technicianId={effective.Value}" : string.Empty);

        try
        {
            var client = _httpClientFactory.CreateClient("ErpApi");
            using var req = ErpRequest(HttpMethod.Get, path, tenant);
            using var res = await client.SendAsync(req, ct);
            var body = await res.Content.ReadAsStringAsync(ct);
            return res.IsSuccessStatusCode ? Content(body, "application/json") : Upstream(res, body);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "[FaturaTakip] ERP listesi alınamadı.");
            return StatusCode(502, new { success = false, message = "B2B ERP'ye ulaşılamadı. Tekrar deneyin." });
        }
    }

    [HttpPost("{invoiceId:int}/deliver")]
    [RequestSizeLimit(80_000_000)]
    public Task<IActionResult> Deliver(int invoiceId, [FromForm] string? note, [FromForm] List<IFormFile>? files, CancellationToken ct)
        => StatusAsync(invoiceId, "deliver", note, files, ct);

    [HttpPost("{invoiceId:int}/fail")]
    [RequestSizeLimit(80_000_000)]
    public Task<IActionResult> Fail(int invoiceId, [FromForm] string? note, [FromForm] List<IFormFile>? files, CancellationToken ct)
        => StatusAsync(invoiceId, "fail", note, files, ct);

    private async Task<IActionResult> StatusAsync(int invoiceId, string action, string? note, List<IFormFile>? files, CancellationToken ct)
    {
        var scope = await _permissions.GetScopeAsync(User, PageKey, ct);
        if (!scope.CanAccess) return Forbid();

        // Yönetici kapsamı bile durum değiştirmeye yetmez: teslim eden, faturanın atandığı kişi.
        if (!scope.TechnicianId.HasValue)
        {
            return StatusCode(403, new { success = false, message = "Durumu yalnızca faturanın atandığı teknisyen değiştirebilir." });
        }

        var list = files ?? new List<IFormFile>();
        if (list.Count > 5) return BadRequest(new { success = false, message = "Tek seferde en fazla 5 görsel." });
        if (list.Any(f => !f.ContentType.StartsWith("image/", StringComparison.OrdinalIgnoreCase)))
        {
            return BadRequest(new { success = false, message = "Yalnızca görsel yüklenebilir." });
        }

        var tenant = TenantCode();
        if (tenant is null) return BadRequest(new { success = false, message = "Firma kodu çözülemedi." });

        using var form = new MultipartFormDataContent
        {
            { new StringContent(scope.TechnicianId.Value.ToString()), "TechnicianId" },
            { new StringContent(await ActorNameAsync(scope.TechnicianId.Value, ct)), "ActorName" },
            { new StringContent(note ?? string.Empty), "Note" }
        };

        foreach (var file in list)
        {
            var content = new StreamContent(file.OpenReadStream());
            content.Headers.ContentType = new MediaTypeHeaderValue(file.ContentType);
            form.Add(content, "Files", string.IsNullOrWhiteSpace(file.FileName) ? "gorsel.jpg" : Path.GetFileName(file.FileName));
        }

        try
        {
            var client = _httpClientFactory.CreateClient("ErpApi");
            client.Timeout = TimeSpan.FromMinutes(2);
            using var req = ErpRequest(HttpMethod.Post, $"api/invoice-tracking/field/{invoiceId}/{action}", tenant);
            req.Content = form;
            using var res = await client.SendAsync(req, ct);
            var body = await res.Content.ReadAsStringAsync(ct);
            return res.IsSuccessStatusCode ? Content(body, "application/json") : Upstream(res, body);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "[FaturaTakip] Durum ERP'ye iletilemedi.");
            return StatusCode(502, new { success = false, message = "B2B ERP'ye ulaşılamadı, kayıt yapılmadı. Tekrar deneyin." });
        }
    }

    [HttpGet("{invoiceId:int}/history")]
    public async Task<IActionResult> History(int invoiceId, CancellationToken ct)
    {
        var scope = await _permissions.GetScopeAsync(User, PageKey, ct);
        if (!scope.CanAccess) return Forbid();
        if (!scope.CanViewAll && !scope.TechnicianId.HasValue) return Forbid();

        var tenant = TenantCode();
        if (tenant is null) return BadRequest(new { success = false, message = "Firma kodu çözülemedi." });

        var path = $"api/invoice-tracking/field/{invoiceId}/history" +
                   (scope.CanViewAll ? string.Empty : $"?technicianId={scope.TechnicianId}");
        try
        {
            var client = _httpClientFactory.CreateClient("ErpApi");
            using var req = ErpRequest(HttpMethod.Get, path, tenant);
            using var res = await client.SendAsync(req, ct);
            var body = await res.Content.ReadAsStringAsync(ct);
            return res.IsSuccessStatusCode ? Content(body, "application/json") : Upstream(res, body);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "[FaturaTakip] Geçmiş alınamadı.");
            return StatusCode(502, new { success = false, message = "B2B ERP'ye ulaşılamadı." });
        }
    }

    [HttpGet("photos/{photoId:long}")]
    public async Task<IActionResult> Photo(long photoId, CancellationToken ct)
    {
        var scope = await _permissions.GetScopeAsync(User, PageKey, ct);
        if (!scope.CanAccess) return Forbid();
        if (!scope.CanViewAll && !scope.TechnicianId.HasValue) return Forbid();

        var tenant = TenantCode();
        if (tenant is null) return BadRequest();

        var path = $"api/invoice-tracking/field/photos/{photoId}" +
                   (scope.CanViewAll ? string.Empty : $"?technicianId={scope.TechnicianId}");
        try
        {
            var client = _httpClientFactory.CreateClient("ErpApi");
            using var req = ErpRequest(HttpMethod.Get, path, tenant);
            using var res = await client.SendAsync(req, ct);
            if (!res.IsSuccessStatusCode) return NotFound();
            var bytes = await res.Content.ReadAsByteArrayAsync(ct);
            return File(bytes, res.Content.Headers.ContentType?.MediaType ?? "image/webp");
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "[FaturaTakip] Görsel alınamadı.");
            return StatusCode(502);
        }
    }
}
