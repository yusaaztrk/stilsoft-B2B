using System.Globalization;
using System.Security.Claims;
using B2B.Erp.Api.Core.Authorization;
using B2B.Erp.Api.Core.Logging;
using B2B.Erp.Api.Core.Services;
using B2B.Erp.Api.Data;
using B2B.Erp.Api.Entities;
using B2B.Erp.Api.Features.FaturaTakip;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace B2B.Erp.Api.Controllers;

/// <summary>
/// FATURA TAKİP (2026-09-15). Kesilen faturanın teknisyene atanıp müşteriye imzalatılması ve
/// geri getirilmesi. Kurallar <see cref="InvoiceTrackingService"/>'te; bu sınıf yalnızca yetki
/// kapıları ve istek biçimi.
///
/// İki kapı var:
///  - B2B ekranı: oturum + sayfa yetkileri (faturaTakip / Planla / Durum / Basim).
///  - Servis (teknisyen) uçları <c>field/*</c>: kişisel oturum YOK, sunucu-sunucu anahtarı
///    (<c>ServiceOps:InternalApiKey</c>). Teknisyen kimliğini ServiceOps kendi oturumundan
///    çözüp gönderiyor; burada o kimliğe ATANMIŞ olma şartı ayrıca uygulanıyor.
/// </summary>
[ApiController]
[Route("api/invoice-tracking")]
[Authorize]
public sealed class InvoiceTrackingController : ControllerBase
{
    private const int MaxPhotosPerRequest = 5;

    private readonly AppDbContext _db;
    private readonly InvoiceTrackingService _tracking;
    private readonly FieldTechnicianDirectory _technicians;
    private readonly InvoiceTrackingPhotoStore _photos;
    private readonly IUserActivityLogger _activity;
    private readonly IServiceOpsNotificationBridge _notifications;
    private readonly ILogger<InvoiceTrackingController> _logger;

    public InvoiceTrackingController(
        AppDbContext db,
        InvoiceTrackingService tracking,
        FieldTechnicianDirectory technicians,
        InvoiceTrackingPhotoStore photos,
        IUserActivityLogger activity,
        IServiceOpsNotificationBridge notifications,
        ILogger<InvoiceTrackingController> logger)
    {
        _db = db;
        _tracking = tracking;
        _technicians = technicians;
        _photos = photos;
        _activity = activity;
        _notifications = notifications;
        _logger = logger;
    }

    private string Username => User.FindFirst(ClaimTypes.Name)?.Value ?? User.Identity?.Name ?? "System";

    /// <summary>Geçmişte "kim yaptı" okunur olsun: "Ad Soyad (kullanıcı)".</summary>
    private TrackingActor B2BActor
    {
        get
        {
            var fullName = User.FindFirst("Unvan")?.Value?.Trim();
            var name = string.IsNullOrWhiteSpace(fullName) || string.Equals(fullName, Username, StringComparison.OrdinalIgnoreCase)
                ? Username
                : $"{fullName} ({Username})";
            return new TrackingActor(name, InvoiceTrackingSources.B2B);
        }
    }

    private string? TenantCode =>
        Request.Headers["X-Tenant-Code"].FirstOrDefault()
        ?? User.FindFirst("TenantCode")?.Value
        ?? User.FindFirst("tenantCode")?.Value;

    private static DateTime? ParseDay(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return null;
        var formats = new[] { "yyyy-MM-dd", "dd.MM.yyyy" };
        return DateTime.TryParseExact(raw.Trim(), formats, CultureInfo.InvariantCulture, DateTimeStyles.None, out var d)
            ? InvoiceTrackingService.AsDocumentDate(d)
            : null;
    }

    private IActionResult Fail(InvoiceTrackingException ex) => BadRequest(new { success = false, message = ex.Message });

    // =========================================================================================
    // B2B EKRANI
    // =========================================================================================

    [HttpGet("settings")]
    [AuthorizePage("invoice", "faturaTakip")]
    public async Task<IActionResult> GetSettings(CancellationToken ct)
    {
        return Ok(new
        {
            success = true,
            data = new
            {
                startDate = await _tracking.GetStartDateAsync(ct),
                today = _tracking.Today
            }
        });
    }

    [HttpGet("technicians")]
    [AuthorizePage("invoice", "faturaTakip")]
    public async Task<IActionResult> GetTechnicians(CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(TenantCode))
        {
            return BadRequest(new { success = false, message = "Firma kodu çözülemedi." });
        }

        var list = await _technicians.GetAsync(TenantCode, ct);
        if (list is null)
        {
            return StatusCode(502, new { success = false, message = "Teknisyen listesi servisten alınamadı. Atama şu an yapılamaz; liste ve durum işlemleri çalışıyor." });
        }

        return Ok(new { success = true, data = list });
    }

    [HttpGet("list")]
    [AuthorizePage("invoice", "faturaTakip")]
    public async Task<IActionResult> List(
        [FromQuery] string? view,
        [FromQuery] string? date,
        [FromQuery] string? from,
        [FromQuery] string? to,
        [FromQuery] Guid? technicianId,
        [FromQuery] string? invoiceFrom,
        [FromQuery] string? invoiceTo,
        CancellationToken ct)
    {
        var rows = await _tracking.ListAsync(User, view ?? InvoiceTrackingViews.Unplanned, ParseDay(date), ParseDay(from), ParseDay(to), technicianId, ct,
            ParseDay(invoiceFrom), ParseDay(invoiceTo));
        return Ok(new { success = true, data = rows });
    }

    [HttpGet("summary")]
    [AuthorizePage("invoice", "faturaTakip")]
    public async Task<IActionResult> Summary(
        [FromQuery] string? date,
        [FromQuery] Guid? technicianId,
        [FromQuery] string? invoiceFrom,
        [FromQuery] string? invoiceTo,
        CancellationToken ct)
    {
        var summary = await _tracking.SummaryAsync(User, ParseDay(date), technicianId, ct, ParseDay(invoiceFrom), ParseDay(invoiceTo));
        return Ok(new { success = true, data = summary });
    }

    public sealed class AssignRequest
    {
        public List<int> InvoiceIds { get; set; } = new();
        public Guid TechnicianId { get; set; }
        public string? PlannedDate { get; set; }
        public string? Note { get; set; }
    }

    [HttpPost("assign")]
    [AuthorizePage("invoice", "faturaTakipPlanla")]
    public async Task<IActionResult> Assign([FromBody] AssignRequest request, CancellationToken ct)
    {
        var ids = request?.InvoiceIds?.Where(x => x > 0).Distinct().ToList() ?? new List<int>();
        if (ids.Count == 0) return BadRequest(new { success = false, message = "Fatura seçilmedi." });
        if (ids.Count > 500) return BadRequest(new { success = false, message = "Tek seferde en fazla 500 fatura atanabilir." });

        var day = ParseDay(request!.PlannedDate);
        if (day is null) return BadRequest(new { success = false, message = "Plan günü seçilmedi." });

        if (string.IsNullOrWhiteSpace(TenantCode)) return BadRequest(new { success = false, message = "Firma kodu çözülemedi." });

        // Teknisyen adı istemciden ALINMIYOR: kimlik listede olmalı, ad ve kullanıcı adı oradan.
        var technicians = await _technicians.GetAsync(TenantCode, ct);
        if (technicians is null)
        {
            return StatusCode(502, new { success = false, message = "Teknisyen listesi servisten alınamadı, atama yapılamadı." });
        }

        var technician = technicians.FirstOrDefault(t => t.Id == request.TechnicianId);
        if (technician is null) return BadRequest(new { success = false, message = "Seçilen kişi saha teknisyeni değil ya da pasif." });

        var invoices = await _tracking.LoadVisibleAsync(User, ids, ct);
        if (invoices.Count != ids.Count)
        {
            return BadRequest(new { success = false, message = "Seçilen faturaların bir kısmı bulunamadı ya da bu listede yer almıyor." });
        }

        try
        {
            await _tracking.AssignAsync(invoices, technician, day.Value, request.Note, B2BActor, ct);
        }
        catch (InvoiceTrackingException ex)
        {
            return Fail(ex);
        }
        catch (DbUpdateException ex)
        {
            _logger.LogWarning(ex, "[FaturaTakip] Atama kaydedilemedi.");
            return Conflict(new { success = false, message = "Aynı faturalar şu an başka biri tarafından da güncellendi. Listeyi yenileyip tekrar deneyin." });
        }

        await _activity.LogAsync("invoice", "faturaTakip", "Assign",
            $"{ids.Count} fatura {technician.Name} adına {day.Value:dd.MM.yyyy} gününe planlandı",
            details: new { invoiceIds = ids, technician = technician.Name, plannedDate = day, request.Note },
            cancellationToken: ct);

        if (!string.IsNullOrWhiteSpace(technician.Username))
        {
            try
            {
                await _notifications.MirrorAsync(new[] { technician.Username },
                    "Fatura Takip",
                    $"{day.Value:dd.MM.yyyy} için size {ids.Count} fatura atandı.",
                    ct);
            }
            catch (Exception ex)
            {
                // Bildirim düşse de atama yapıldı; kullanıcıya hata gösterilmez.
                _logger.LogWarning(ex, "[FaturaTakip] Atama bildirimi gönderilemedi.");
            }
        }

        return Ok(new { success = true, message = $"{ids.Count} fatura {technician.Name} adına planlandı." });
    }

    public sealed class InvoiceIdsRequest
    {
        public List<int> InvoiceIds { get; set; } = new();
        public string? Note { get; set; }
    }

    [HttpPost("unassign")]
    [AuthorizePage("invoice", "faturaTakipPlanla")]
    public async Task<IActionResult> Unassign([FromBody] InvoiceIdsRequest request, CancellationToken ct)
    {
        var ids = request?.InvoiceIds?.Where(x => x > 0).Distinct().ToList() ?? new List<int>();
        if (ids.Count == 0) return BadRequest(new { success = false, message = "Fatura seçilmedi." });

        var invoices = await _tracking.LoadVisibleAsync(User, ids, ct);
        var changed = await _tracking.UnassignAsync(invoices, request!.Note, B2BActor, ct);

        await _activity.LogAsync("invoice", "faturaTakip", "Unassign",
            $"{changed} faturanın planı kaldırıldı", details: new { invoiceIds = ids, request.Note }, cancellationToken: ct);

        return Ok(new { success = true, message = changed == 0 ? "Planlı fatura yoktu." : $"{changed} faturanın planı kaldırıldı." });
    }

    public sealed class StatusRequest
    {
        public string? Note { get; set; }
    }

    [HttpPost("{invoiceId:int}/complete")]
    [AuthorizePage("invoice", "faturaTakipDurum")]
    public async Task<IActionResult> Complete(int invoiceId, [FromBody] StatusRequest? request, CancellationToken ct)
    {
        var invoices = await _tracking.LoadVisibleAsync(User, new[] { invoiceId }, ct);
        if (!invoices.TryGetValue(invoiceId, out var inv)) return NotFound(new { success = false, message = "Fatura bulunamadı." });

        try
        {
            await _tracking.CompleteAsync(invoiceId, inv.InvoiceNo, request?.Note, B2BActor, null, ct, inv.CreateTime);
        }
        catch (InvoiceTrackingException ex)
        {
            return Fail(ex);
        }

        await _activity.LogAsync("invoice", "faturaTakip", "Complete", $"Fatura imzalı döndü: {inv.InvoiceNo}",
            recordId: invoiceId.ToString(), details: new { request?.Note }, cancellationToken: ct);
        return Ok(new { success = true, message = $"{inv.InvoiceNo} tamamlandı." });
    }

    [HttpPost("{invoiceId:int}/fail")]
    [AuthorizePage("invoice", "faturaTakipDurum")]
    public async Task<IActionResult> MarkFailed(int invoiceId, [FromBody] StatusRequest? request, CancellationToken ct)
    {
        var invoices = await _tracking.LoadVisibleAsync(User, new[] { invoiceId }, ct);
        if (!invoices.TryGetValue(invoiceId, out var inv)) return NotFound(new { success = false, message = "Fatura bulunamadı." });

        try
        {
            await _tracking.FailAsync(invoiceId, request?.Note, B2BActor, null, ct);
        }
        catch (InvoiceTrackingException ex)
        {
            return Fail(ex);
        }

        await _activity.LogAsync("invoice", "faturaTakip", "Fail", $"Fatura teslim edilemedi: {inv.InvoiceNo}",
            recordId: invoiceId.ToString(), details: new { request?.Note }, cancellationToken: ct);
        return Ok(new { success = true, message = $"{inv.InvoiceNo} teslim edilemedi olarak işaretlendi ve planlama listesine döndü." });
    }

    [HttpPost("{invoiceId:int}/reopen")]
    [AuthorizePage("invoice", "faturaTakipDurum")]
    public async Task<IActionResult> Reopen(int invoiceId, [FromBody] StatusRequest? request, CancellationToken ct)
    {
        var invoices = await _tracking.LoadVisibleAsync(User, new[] { invoiceId }, ct);
        if (!invoices.TryGetValue(invoiceId, out var inv)) return NotFound(new { success = false, message = "Fatura bulunamadı." });

        try
        {
            await _tracking.ReopenAsync(invoiceId, inv.InvoiceNo, inv.CreateTime, request?.Note, B2BActor, ct);
        }
        catch (InvoiceTrackingException ex)
        {
            return Fail(ex);
        }

        await _activity.LogAsync("invoice", "faturaTakip", "Reopen", $"Fatura takibi geri alındı: {inv.InvoiceNo}",
            recordId: invoiceId.ToString(), details: new { request?.Note }, cancellationToken: ct);
        return Ok(new { success = true, message = $"{inv.InvoiceNo} planlama listesine geri alındı." });
    }

    [HttpPost("{invoiceId:int}/note")]
    [AuthorizePage("invoice", "faturaTakip")]
    public async Task<IActionResult> AddNote(int invoiceId, [FromBody] StatusRequest? request, CancellationToken ct)
    {
        var invoices = await _tracking.LoadVisibleAsync(User, new[] { invoiceId }, ct);
        if (!invoices.TryGetValue(invoiceId, out var inv)) return NotFound(new { success = false, message = "Fatura bulunamadı." });

        try
        {
            await _tracking.AddNoteAsync(invoiceId, inv.InvoiceNo, request?.Note ?? string.Empty, B2BActor, null, ct);
        }
        catch (InvoiceTrackingException ex)
        {
            return Fail(ex);
        }

        return Ok(new { success = true, message = "Not eklendi." });
    }

    [HttpPost("{invoiceId:int}/photos")]
    [AuthorizePage("invoice", "faturaTakipDurum")]
    [RequestSizeLimit(InvoiceTrackingPhotoStore.MaxBytes * MaxPhotosPerRequest + 1024 * 1024)]
    public async Task<IActionResult> UploadPhotos(int invoiceId, [FromForm] List<IFormFile> files, [FromForm] string? note, CancellationToken ct)
    {
        var invoices = await _tracking.LoadVisibleAsync(User, new[] { invoiceId }, ct);
        if (!invoices.TryGetValue(invoiceId, out var inv)) return NotFound(new { success = false, message = "Fatura bulunamadı." });
        if (files is null || files.Count == 0) return BadRequest(new { success = false, message = "Görsel seçilmedi." });
        if (files.Count > MaxPhotosPerRequest) return BadRequest(new { success = false, message = $"Tek seferde en fazla {MaxPhotosPerRequest} görsel." });

        try
        {
            var ev = await _tracking.AddNoteAsync(invoiceId, inv.InvoiceNo,
                string.IsNullOrWhiteSpace(note) ? "Görsel eklendi." : note, B2BActor, null, ct);
            await SavePhotosAsync(invoiceId, ev.Id, files, B2BActor, ct);
        }
        catch (InvoiceTrackingException ex)
        {
            return Fail(ex);
        }
        catch (InvalidDataException ex)
        {
            return BadRequest(new { success = false, message = ex.Message });
        }

        return Ok(new { success = true, message = "Görsel eklendi." });
    }

    [HttpGet("{invoiceId:int}/history")]
    [AuthorizePage("invoice", "faturaTakip")]
    public async Task<IActionResult> History(int invoiceId, CancellationToken ct)
    {
        var invoices = await _tracking.LoadVisibleAsync(User, new[] { invoiceId }, ct);
        if (!invoices.ContainsKey(invoiceId)) return NotFound(new { success = false, message = "Fatura bulunamadı." });

        return Ok(new { success = true, data = await _tracking.HistoryAsync(invoiceId, ct) });
    }

    [HttpGet("photos/{photoId:long}")]
    [AuthorizePage("invoice", "faturaTakip")]
    public async Task<IActionResult> GetPhoto(long photoId, CancellationToken ct)
    {
        var photo = await _db.InvoiceTrackingPhotos.AsNoTracking().FirstOrDefaultAsync(p => p.Id == photoId, ct);
        if (photo is null) return NotFound();

        var invoices = await _tracking.LoadVisibleAsync(User, new[] { photo.InvoiceId }, ct);
        if (!invoices.ContainsKey(photo.InvoiceId)) return NotFound();

        var path = _photos.ResolvePath(photo.FileName);
        return path is null ? NotFound() : PhysicalFile(path, "image/webp");
    }

    // Tek öznitelik: birden fazla AuthorizePage VEYA ile değerlendiriliyor, sayfa anahtarı
    // eklenseydi basım yetkisi olmayan herkes de rota basabilirdi.
    [HttpGet("route")]
    [AuthorizePage("invoice", "faturaTakipBasim")]
    public async Task<IActionResult> Route([FromQuery] string? date, [FromQuery] Guid? technicianId, CancellationToken ct)
    {
        var day = ParseDay(date) ?? _tracking.Today;
        var rows = await _tracking.RouteAsync(User, day, technicianId, ct);
        return Ok(new { success = true, data = new { date = day, rows } });
    }

    // =========================================================================================
    // SERVİS (TEKNİSYEN) UÇLARI — sunucu-sunucu anahtarıyla
    // =========================================================================================

    private static TrackingActor FieldActor(string? actorName) =>
        new(string.IsNullOrWhiteSpace(actorName) ? "Teknisyen" : actorName.Trim(), InvoiceTrackingSources.Field);

    [HttpGet("field/list")]
    [InternalApiKey("ServiceOps:InternalApiKey")]
    public async Task<IActionResult> FieldList([FromQuery] Guid? technicianId, [FromQuery] int daysAhead = 7, CancellationToken ct = default)
    {
        var rows = await _tracking.FieldListAsync(technicianId, daysAhead, ct);
        return Ok(new { success = true, data = rows });
    }

    [HttpPost("field/{invoiceId:int}/deliver")]
    [InternalApiKey("ServiceOps:InternalApiKey")]
    [RequestSizeLimit(InvoiceTrackingPhotoStore.MaxBytes * MaxPhotosPerRequest + 1024 * 1024)]
    public Task<IActionResult> FieldDeliver(int invoiceId, [FromForm] FieldStatusForm form, CancellationToken ct)
        => FieldStatusAsync(invoiceId, form, delivered: true, ct);

    [HttpPost("field/{invoiceId:int}/fail")]
    [InternalApiKey("ServiceOps:InternalApiKey")]
    [RequestSizeLimit(InvoiceTrackingPhotoStore.MaxBytes * MaxPhotosPerRequest + 1024 * 1024)]
    public Task<IActionResult> FieldFail(int invoiceId, [FromForm] FieldStatusForm form, CancellationToken ct)
        => FieldStatusAsync(invoiceId, form, delivered: false, ct);

    public sealed class FieldStatusForm
    {
        public Guid TechnicianId { get; set; }
        public string? ActorName { get; set; }
        public string? Note { get; set; }
        public List<IFormFile>? Files { get; set; }
    }

    private async Task<IActionResult> FieldStatusAsync(int invoiceId, FieldStatusForm form, bool delivered, CancellationToken ct)
    {
        if (form is null || form.TechnicianId == Guid.Empty)
        {
            return BadRequest(new { success = false, message = "Teknisyen kimliği yok." });
        }

        var files = form.Files ?? new List<IFormFile>();
        if (files.Count > MaxPhotosPerRequest)
        {
            return BadRequest(new { success = false, message = $"Tek seferde en fazla {MaxPhotosPerRequest} görsel." });
        }

        var tracking = await _db.InvoiceTrackings.AsNoTracking().FirstOrDefaultAsync(t => t.InvoiceId == invoiceId, ct);
        var actor = FieldActor(form.ActorName);

        // Görseller DURUMDAN ÖNCE doğrulanıp kaydediliyor: bozuk dosya yüzünden durum
        // değişip görselin yarım kalması, teknisyenin "yükledim" sanıp gitmesi demek.
        var saved = new List<InvoiceTrackingPhotoStore.SavedPhoto>();
        try
        {
            foreach (var file in files)
            {
                saved.Add(await _photos.SaveAsync(file, ct));
            }
        }
        catch (InvalidDataException ex)
        {
            return BadRequest(new { success = false, message = ex.Message });
        }

        InvoiceTrackingEvent ev;
        try
        {
            ev = delivered
                ? await _tracking.CompleteAsync(invoiceId, tracking?.InvoiceNo ?? string.Empty, form.Note, actor, form.TechnicianId, ct)
                : await _tracking.FailAsync(invoiceId, form.Note, actor, form.TechnicianId, ct);
        }
        catch (InvoiceTrackingException ex)
        {
            return Fail(ex);
        }

        foreach (var photo in saved)
        {
            await _tracking.AttachPhotoAsync(invoiceId, ev.Id, photo, actor, ct);
        }

        return Ok(new
        {
            success = true,
            message = delivered ? "Teslim edildi olarak kaydedildi." : "Teslim edilemedi olarak kaydedildi."
        });
    }

    [HttpGet("field/photos/{photoId:long}")]
    [InternalApiKey("ServiceOps:InternalApiKey")]
    public async Task<IActionResult> FieldPhoto(long photoId, [FromQuery] Guid? technicianId, CancellationToken ct)
    {
        var photo = await _db.InvoiceTrackingPhotos.AsNoTracking().FirstOrDefaultAsync(p => p.Id == photoId, ct);
        if (photo is null) return NotFound();

        // Teknisyen yalnızca kendisine atanmış (ya da bir zaman atanmış) faturanın görselini görür.
        if (technicianId.HasValue)
        {
            var related = await _db.InvoiceTrackings.AsNoTracking()
                              .AnyAsync(t => t.InvoiceId == photo.InvoiceId && t.TechnicianId == technicianId.Value, ct)
                          || await _db.InvoiceTrackingEvents.AsNoTracking()
                              .AnyAsync(e => e.InvoiceId == photo.InvoiceId && e.TechnicianId == technicianId.Value, ct);
            if (!related) return NotFound();
        }

        var path = _photos.ResolvePath(photo.FileName);
        return path is null ? NotFound() : PhysicalFile(path, "image/webp");
    }

    [HttpGet("field/{invoiceId:int}/history")]
    [InternalApiKey("ServiceOps:InternalApiKey")]
    public async Task<IActionResult> FieldHistory(int invoiceId, [FromQuery] Guid? technicianId, CancellationToken ct)
    {
        if (technicianId.HasValue)
        {
            var related = await _db.InvoiceTrackings.AsNoTracking()
                              .AnyAsync(t => t.InvoiceId == invoiceId && t.TechnicianId == technicianId.Value, ct)
                          || await _db.InvoiceTrackingEvents.AsNoTracking()
                              .AnyAsync(e => e.InvoiceId == invoiceId && e.TechnicianId == technicianId.Value, ct);
            if (!related) return NotFound();
        }

        return Ok(new { success = true, data = await _tracking.HistoryAsync(invoiceId, ct) });
    }

    private async Task SavePhotosAsync(int invoiceId, long eventId, IEnumerable<IFormFile> files, TrackingActor actor, CancellationToken ct)
    {
        foreach (var file in files)
        {
            var saved = await _photos.SaveAsync(file, ct);
            await _tracking.AttachPhotoAsync(invoiceId, eventId, saved, actor, ct);
        }
    }
}
