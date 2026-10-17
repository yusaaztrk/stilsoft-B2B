using System.Text.Json;
using Asistan.Api.Ai;
using Asistan.Api.Infrastructure;
using Asistan.Api.WhatsApp;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;

namespace Asistan.Api.Messaging;

/// <summary>
/// Asistan ekranının (gelen kutusu) uçları. Hepsi PanelAuth'tan geçer; firma token'dan gelir.
///
/// KAPSAM (2026-10-08): her uç kişinin kapsamını (InboxAccess) çözer. Liste süzgeci kapı
/// SAYILMAZ: tek konuşma uçları da aynı kurala bakar — başka birimin konuşmasına adresle
/// erişmeye çalışan 404 alır (403 değil: konuşmanın varlığı da sızmasın).
///
/// Canlı güncelleme yoklamayla (ekran birkaç saniyede bir yeni mesaj/hareket ister).
/// </summary>
[ApiController]
[Route("api/panel")]
[PanelAuth]
public sealed class ConversationsController : ControllerBase
{
    private const int MaxTextLength = 4096; // WhatsApp metin sınırı
    private const int MaxNoteLength = 2000;

    private readonly MessageStore _store;
    private readonly InboxAccess _access;
    private readonly IWhatsAppClient _wa;
    private readonly ErpCustomerLookup _customers;
    private readonly WhatsAppOptions _options;
    private readonly AiStore _ai;
    private readonly AiQueue _aiQueue;
    private readonly IAiClassifier _classifier;

    public ConversationsController(MessageStore store, InboxAccess access, IWhatsAppClient wa, ErpCustomerLookup customers, IOptions<WhatsAppOptions> options,
        AiStore ai, AiQueue aiQueue, IAiClassifier classifier, OpsStore ops)
    {
        _store = store;
        _ops = ops;
        _ai = ai;
        _aiQueue = aiQueue;
        _classifier = classifier;
        _access = access;
        _wa = wa;
        _customers = customers;
        _options = options.Value;
    }

    private readonly OpsStore _ops;

    private PanelUser Me => PanelAuthAttribute.Current(HttpContext);

    private Task<AgentScope> ScopeAsync(CancellationToken ct) => _access.ResolveAsync(Me, ct);

    /// <summary>Konuşmayı kapsam kontrolüyle getirir; kapsam dışıysa null (uç 404 döner).</summary>
    private async Task<(ConversationRow? Conv, AgentScope Scope)> LoadAsync(long id, CancellationToken ct)
    {
        var scope = await ScopeAsync(ct);
        var c = await _store.GetConversationAsync(Me.TenantCode, id, ct);
        return (c is not null && scope.CanAccess(c.DepartmentId) ? c : null, scope);
    }

    /// <summary>Ekranın üst bandı + kişinin kapsamı (menüde neyin görüneceği).</summary>
    [HttpGet("status")]
    public async Task<IActionResult> Status(CancellationToken ct)
    {
        var scope = await ScopeAsync(ct);
        var pn = _options.PhoneNumberIdFor(Me.TenantCode);
        return Ok(new
        {
            tenantCode = Me.TenantCode,
            userName = Me.UserName,
            numberConfigured = pn is not null,
            canSend = _wa.IsConfigured,
            fakeProvider = _wa.IsFake,
            windowHours = (int)MessageStore.CustomerServiceWindow.TotalHours,
            isAdmin = scope.IsAdmin,
            aiProvider = _classifier.Provider,
            aiEnabled = _classifier.Provider is not null && (await _ai.GetSettingsAsync(Me.TenantCode, ct)).Enabled,
            canSeeAll = scope.CanSeeAll,
            departmentIds = scope.DepartmentIds,
            sla = await SlaDtoAsync(ct)
        });
    }

    /// <summary>Klasör ve birim sayıları (kişinin kapsamında) + birim listesi.</summary>
    [HttpGet("summary")]
    public async Task<IActionResult> Summary(CancellationToken ct)
    {
        var scope = await ScopeAsync(ct);
        var sla = await _ops.GetSlaAsync(Me.TenantCode, ct);
        var (folders, depCounts) = await _store.SummaryAsync(Me.TenantCode, scope, ct, sla.LateMinutes);
        var departments = await _store.ListDepartmentsAsync(Me.TenantCode, includeInactive: false, ct);
        var byId = depCounts.ToDictionary(x => x.DepartmentId);
        return Ok(new
        {
            folders = new
            {
                waiting = folders.Waiting,
                important = folders.Important,
                answered = folders.Answered,
                unassigned = scope.CanSeeAll ? folders.Unassigned : 0,
                unread = folders.Unread,
                oldestWaitingSince = folders.OldestWaitingSince,
                urgent = folders.Urgent,
                late = folders.Late
            },
            sla = new { warnMinutes = sla.WarnMinutes, lateMinutes = sla.LateMinutes },
            departments = departments
                .Where(d => scope.CanSeeAll || scope.DepartmentIds.Contains(d.Id))
                .Select(d => new
                {
                    id = d.Id,
                    code = d.Code,
                    name = d.Name,
                    waiting = byId.TryGetValue(d.Id, out var x) ? x.Waiting : 0,
                    important = byId.TryGetValue(d.Id, out var y) ? y.Important : 0,
                    open = byId.TryGetValue(d.Id, out var z) ? z.Open : 0,
                    late = byId.TryGetValue(d.Id, out var l) ? l.Late : 0
                }),
            // Devir menüsü için: kişi konuşmayı HER birime devredebilir (yalnız kendi birimine değil).
            allDepartments = departments.Select(d => new { id = d.Id, name = d.Name })
        });
    }

    [HttpGet("conversations")]
    public async Task<IActionResult> List([FromQuery] string? folder, [FromQuery] int? departmentId, [FromQuery] string? q,
        [FromQuery] int page = 1, [FromQuery] int pageSize = 50, CancellationToken ct = default)
    {
        var scope = await ScopeAsync(ct);
        if (folder == Folders.Unassigned && !scope.CanSeeAll) return Ok(new { items = Array.Empty<object>(), total = 0, page, pageSize });
        page = Math.Max(1, page);
        pageSize = Math.Clamp(pageSize, 1, 200);
        var (items, total) = await _store.ListConversationsAsync(Me.TenantCode, scope, folder, departmentId, q, page, pageSize, ct);
        return Ok(new { items = items.Select(ToDto), total, page, pageSize });
    }

    [HttpGet("conversations/{id:long}")]
    public async Task<IActionResult> Get(long id, CancellationToken ct)
    {
        var (c, _) = await LoadAsync(id, ct);
        return c is null ? NotFound() : Ok(ToDto(c));
    }

    /// <summary>
    /// Mesajlar + hareketler (devir, önem, iç not) + "şu an bakanlar". İlk açılışta son mesajlar;
    /// yoklamada <paramref name="afterId"/>/<paramref name="afterEventId"/> ile yalnız yeniler ve
    /// <paramref name="statusSince"/>'ten beri tiki değişen giden mesajlar. Her çağrı kişiyi
    /// "bakıyor" olarak işaretler.
    /// </summary>
    [HttpGet("conversations/{id:long}/messages")]
    public async Task<IActionResult> Messages(long id, [FromQuery] long? afterId, [FromQuery] long? afterEventId, [FromQuery] DateTimeOffset? statusSince,
        [FromQuery] int take = 200, CancellationToken ct = default)
    {
        var (c, scope) = await LoadAsync(id, ct);
        if (c is null) return NotFound();

        var serverTime = DateTimeOffset.UtcNow;
        var messages = await _store.ListMessagesAsync(Me.TenantCode, id, afterId, Math.Clamp(take, 1, 500), ct);
        var statuses = statusSince is null
            ? new List<(long Id, string Status, string? Error)>()
            : await _store.StatusesSinceAsync(Me.TenantCode, id, statusSince.Value.AddSeconds(-2), ct);
        var events = await _store.ListEventsAsync(Me.TenantCode, id, afterEventId, ct);
        var viewers = await _store.TouchViewerAsync(Me.TenantCode, id, scope.UserName, ct);
        var draft = await _ai.GetPendingDraftAsync(Me.TenantCode, id, ct);

        return Ok(new
        {
            conversation = ToDto(c),
            draft = draft is null ? null : ToDto(draft),
            messages = messages.Select(ToDto),
            statuses = statuses.Select(s => new { id = s.Id, status = s.Status, error = s.Error }),
            events = events.Select(ToDto),
            viewers,
            serverTime
        });
    }

    public sealed class SendRequest
    {
        public string? Text { get; set; }
    }

    [HttpPost("conversations/{id:long}/messages")]
    public async Task<IActionResult> Send(long id, [FromBody] SendRequest request, CancellationToken ct)
    {
        var text = (request.Text ?? string.Empty).Trim();
        if (text.Length == 0) return BadRequest(new { message = "Mesaj boş olamaz." });
        if (text.Length > MaxTextLength) return BadRequest(new { message = $"Mesaj en fazla {MaxTextLength} karakter olabilir." });

        var (c, scope) = await LoadAsync(id, ct);
        if (c is null) return NotFound();
        return await SendCoreAsync(c, scope, text, null, ct);
    }

    private async Task<IActionResult> SendCoreAsync(ConversationRow c, AgentScope scope, string text, long? draftId, CancellationToken ct)
    {
        var id = c.Id;
        if (!_wa.IsConfigured)
        {
            return StatusCode(StatusCodes.Status503ServiceUnavailable, new { message = "WhatsApp gönderimi henüz yapılandırılmadı (Meta erişim anahtarı yok)." });
        }

        // 24 saat penceresi: Meta zaten reddederdi; önceden söylemek "gönderildi sanıp kaybolan
        // mesaj" yerine personele ne yapacağını anlatır.
        if (c.LastInboundAt is null || DateTimeOffset.UtcNow - c.LastInboundAt.Value > MessageStore.CustomerServiceWindow)
        {
            return Conflict(new
            {
                code = "WINDOW_CLOSED",
                message = "Müşterinin son mesajının üzerinden 24 saat geçti. WhatsApp kuralı gereği, müşteri tekrar yazana kadar yalnız onaylı şablon mesaj gönderilebilir (şablon gönderimi sonraki aşamada eklenecek)."
            });
        }

        var messageId = await _store.InsertOutboundAsync(Me.TenantCode, id, text, scope.UserName, ct, draftId);
        var result = await _wa.SendTextAsync(c.PhoneNumberId, c.WaId, text, ct);
        await _store.CompleteOutboundAsync(Me.TenantCode, messageId, result, ct);

        var saved = await _store.GetMessageAsync(Me.TenantCode, messageId, ct);
        if (!result.Ok)
        {
            return StatusCode(StatusCodes.Status502BadGateway, new { message = "Mesaj gönderilemedi: " + result.Error, item = saved is null ? null : ToDto(saved) });
        }
        return Ok(new { item = saved is null ? null : ToDto(saved) });
    }

    [HttpPost("conversations/{id:long}/read")]
    public async Task<IActionResult> MarkRead(long id, CancellationToken ct)
    {
        var (c, _) = await LoadAsync(id, ct);
        if (c is null) return NotFound();
        var lastInbound = await _store.MarkReadAsync(Me.TenantCode, id, ct);
        // Müşterinin ekranında mavi tik: yalnız gerçekten okunduğunda (ekranda açıldığında).
        if (lastInbound is not null) await _wa.MarkReadAsync(c.PhoneNumberId, lastInbound, ct);
        return Ok(new { success = true });
    }

    public sealed class StatusRequest
    {
        public string? Status { get; set; }
    }

    [HttpPost("conversations/{id:long}/status")]
    public async Task<IActionResult> SetStatus(long id, [FromBody] StatusRequest request, CancellationToken ct)
    {
        var s = (request.Status ?? string.Empty).Trim().ToLowerInvariant();
        if (s is not ("open" or "closed")) return BadRequest(new { message = "Durum 'open' ya da 'closed' olmalı." });
        var (c, scope) = await LoadAsync(id, ct);
        if (c is null) return NotFound();
        if (c.Status == s) return Ok(new { success = true });
        await _store.SetStatusAsync(Me.TenantCode, id, s, ct);
        await _store.LogEventAsync(Me.TenantCode, id, "status", scope.UserName, new { status = s }, ct);
        return Ok(new { success = true });
    }

    public sealed class RouteRequest
    {
        /// <summary>Hedef birim; null = atanmamış (yalnız "hepsini gör" yetkisi olan yapabilir).</summary>
        public int? DepartmentId { get; set; }
    }

    /// <summary>
    /// Birime yönlendir / devret. Kişi konuşmayı kendi kapsamındaysa HER birime devredebilir
    /// (yanlış birime düşen konuşmayı doğru yere atmak için); devrettikten sonra konuşma onun
    /// kapsamından çıkabilir — ekran bunu "devredildi" diye gösterir.
    /// </summary>
    [HttpPost("conversations/{id:long}/route")]
    public async Task<IActionResult> Route(long id, [FromBody] RouteRequest request, CancellationToken ct)
    {
        var (c, scope) = await LoadAsync(id, ct);
        if (c is null) return NotFound();

        if (request.DepartmentId is null && !scope.CanSeeAll)
            return StatusCode(StatusCodes.Status403Forbidden, new { message = "Atanmamış kuyruğa yalnız tüm mesajları gören kişiler gönderebilir." });

        if (request.DepartmentId is int dep)
        {
            var departments = await _store.ListDepartmentsAsync(Me.TenantCode, includeInactive: false, ct);
            if (!departments.Any(d => d.Id == dep)) return BadRequest(new { message = "Birim bulunamadı ya da pasif." });
        }

        await _store.RouteAsync(Me.TenantCode, id, request.DepartmentId, scope.UserName, ct);
        var after = await _store.GetConversationAsync(Me.TenantCode, id, ct);
        return Ok(new { success = true, stillVisible = after is not null && scope.CanAccess(after.DepartmentId) });
    }

    public sealed class PriorityRequest
    {
        public string? Priority { get; set; }
    }

    [HttpPost("conversations/{id:long}/priority")]
    public async Task<IActionResult> SetPriority(long id, [FromBody] PriorityRequest request, CancellationToken ct)
    {
        var p = (request.Priority ?? string.Empty).Trim().ToLowerInvariant();
        if (p is not ("normal" or "important" or "urgent")) return BadRequest(new { message = "Önem 'normal', 'important' (Önemli) ya da 'urgent' (Acil) olmalı." });
        var (c, scope) = await LoadAsync(id, ct);
        if (c is null) return NotFound();
        await _store.SetPriorityAsync(Me.TenantCode, id, p, scope.UserName, ct);
        return Ok(new { success = true });
    }

    public sealed class NoteRequest
    {
        public string? Text { get; set; }
    }

    /// <summary>İç not — müşteriye gitmez; birim arkadaşlarına "şunu konuştum, şuna bakıyorum" bilgisi.</summary>
    [HttpPost("conversations/{id:long}/notes")]
    public async Task<IActionResult> AddNote(long id, [FromBody] NoteRequest request, CancellationToken ct)
    {
        var text = (request.Text ?? string.Empty).Trim();
        if (text.Length == 0) return BadRequest(new { message = "Not boş olamaz." });
        if (text.Length > MaxNoteLength) return BadRequest(new { message = $"Not en fazla {MaxNoteLength} karakter olabilir." });
        var (c, scope) = await LoadAsync(id, ct);
        if (c is null) return NotFound();
        await _store.AddNoteAsync(Me.TenantCode, id, text, scope.UserName, ct);
        return Ok(new { success = true });
    }

    public sealed class DraftSendRequest
    {
        /// <summary>Düzeltilmiş metin; boşsa taslak AYNEN gönderilir.</summary>
        public string? Text { get; set; }
    }

    /// <summary>
    /// Asistan taslağını onayla ve gönder (gerekirse düzeltilmiş metinle). Taslak artık bekleyen değilse
    /// (başkası gönderdi, yok saydı ya da müşteri yeni yazdı ve yeni taslak geldi) 409 — eski taslak gitmesin.
    /// </summary>
    [HttpPost("conversations/{id:long}/drafts/{draftId:long}/send")]
    public async Task<IActionResult> SendDraft(long id, long draftId, [FromBody] DraftSendRequest? request, CancellationToken ct)
    {
        var (c, scope) = await LoadAsync(id, ct);
        if (c is null) return NotFound();
        var draft = await _ai.GetDraftAsync(Me.TenantCode, draftId, ct);
        if (draft is null || draft.ConversationId != id) return NotFound();
        if (draft.Status != "pending")
            return Conflict(new { code = "DRAFT_NOT_PENDING", message = "Bu taslak artık geçerli değil (gönderilmiş, yok sayılmış ya da yenisi gelmiş)." });

        var text = string.IsNullOrWhiteSpace(request?.Text) ? draft.Body : request!.Text!.Trim();
        if (text.Length > MaxTextLength) return BadRequest(new { message = $"Mesaj en fazla {MaxTextLength} karakter olabilir." });
        return await SendCoreAsync(c, scope, text, draftId, ct);
    }

    [HttpPost("conversations/{id:long}/drafts/{draftId:long}/discard")]
    public async Task<IActionResult> DiscardDraft(long id, long draftId, CancellationToken ct)
    {
        var (c, scope) = await LoadAsync(id, ct);
        if (c is null) return NotFound();
        return await _ai.DiscardDraftAsync(Me.TenantCode, id, draftId, scope.UserName, ct)
            ? Ok(new { success = true })
            : Conflict(new { code = "DRAFT_NOT_PENDING", message = "Bu taslak artık geçerli değil." });
    }

    /// <summary>Asistanı bu konuşma için yeniden çalıştır (hata aldıysa ya da taslak beğenilmediyse). Ücretli çağrıdır.</summary>
    [HttpPost("conversations/{id:long}/ai/retry")]
    public async Task<IActionResult> RetryAi(long id, CancellationToken ct)
    {
        var (c, _) = await LoadAsync(id, ct);
        if (c is null) return NotFound();
        if (_classifier.Provider is null)
            return Conflict(new { code = "AI_OFF", message = "Yapay zekâ sağlayıcısı seçilmedi; asistan kapalı." });
        var settings = await _ai.GetSettingsAsync(Me.TenantCode, ct);
        if (!settings.Enabled) return Conflict(new { code = "AI_DISABLED", message = "Asistan Ayarlar'dan kapatılmış." });
        if (!c.AwaitingReply) return Conflict(new { code = "NOT_WAITING", message = "Konuşma cevap beklemiyor; taslak gerekmiyor." });
        _aiQueue.Enqueue(Me.TenantCode, id, force: true);
        return Accepted(new { success = true });
    }

    /// <summary>Cari eşleşmesini yeniden yap (müşteri sonradan cari açıldıysa ya da telefonu düzeltildiyse).</summary>
    [HttpPost("conversations/{id:long}/rematch")]
    public async Task<IActionResult> Rematch(long id, CancellationToken ct)
    {
        var (c, _) = await LoadAsync(id, ct);
        if (c is null) return NotFound();
        var matches = await _customers.FindByPhoneAsync(Me.TenantCode, c.WaId, ct);
        await _store.SetCustomerMatchAsync(Me.TenantCode, id, matches, ct);
        return Ok(new { matches = matches.Select(m => new { customerCode = m.CustomerCode, name = m.Name }) });
    }

    /// <summary>
    /// Medya (fotoğraf, ses, belge). Meta'nın indirme adresi token istediği için tarayıcıya
    /// verilemez; servis aracılık eder. Ekran bunu Authorization başlığıyla çekip blob olarak gösterir.
    /// </summary>
    [HttpGet("messages/{id:long}/media")]
    public async Task<IActionResult> Media(long id, CancellationToken ct)
    {
        var m = await _store.GetMessageAsync(Me.TenantCode, id, ct);
        if (m is null || string.IsNullOrWhiteSpace(m.MediaId)) return NotFound();
        var (c, _) = await LoadAsync(m.ConversationId, ct);
        if (c is null) return NotFound();

        var media = await _wa.DownloadMediaAsync(m.MediaId, ct);
        if (media is null) return StatusCode(StatusCodes.Status502BadGateway, new { message = "Medya WhatsApp'tan alınamadı (süresi dolmuş olabilir)." });

        Response.Headers.CacheControl = "private, max-age=3600";
        return File(media.Value.Content, m.MediaMime ?? media.Value.ContentType, m.MediaFilename);
    }

    private async Task<object> SlaDtoAsync(CancellationToken ct)
    {
        var sla = await _ops.GetSlaAsync(Me.TenantCode, ct);
        return new { warnMinutes = sla.WarnMinutes, lateMinutes = sla.LateMinutes };
    }

    /// <summary>
    /// Hazır cevaplar (açık olanlar). Herkes görür; kişi yalnız o konuşmanın birimine ait olanları ve
    /// genel (birimsiz) olanları ekranda seçer — süzme ekranda, çünkü devirle birim değişebiliyor.
    /// Yönetimi Ayarlar'da (yalnız yönetici).
    /// </summary>
    [HttpGet("quick-replies")]
    public async Task<IActionResult> QuickReplies(CancellationToken ct)
    {
        var list = await _ops.ListQuickRepliesAsync(Me.TenantCode, activeOnly: true, ct);
        return Ok(list.Select(q => new { id = q.Id, departmentId = q.DepartmentId, title = q.Title, body = q.Body }));
    }

    [HttpPost("quick-replies/{id:int}/used")]
    public async Task<IActionResult> QuickReplyUsed(int id, CancellationToken ct)
    {
        await _ops.MarkQuickReplyUsedAsync(Me.TenantCode, id, ct);
        return Ok(new { success = true });
    }

    private static object ToDto(ConversationRow c) => new
    {
        id = c.Id,
        waId = c.WaId,
        phone = "+" + c.WaId,
        contactName = c.ContactName,
        customerCode = c.CustomerCode,
        customerName = c.CustomerName,
        customerMatchCount = c.CustomerMatchCount,
        status = c.Status,
        unreadCount = c.UnreadCount,
        lastMessageAt = c.LastMessageAt,
        lastMessagePreview = c.LastMessagePreview,
        lastMessageDirection = c.LastMessageDirection,
        lastInboundAt = c.LastInboundAt,
        windowOpen = c.LastInboundAt is not null && DateTimeOffset.UtcNow - c.LastInboundAt.Value <= MessageStore.CustomerServiceWindow,
        windowClosesAt = c.LastInboundAt?.Add(MessageStore.CustomerServiceWindow),
        departmentId = c.DepartmentId,
        departmentName = c.DepartmentName,
        priority = c.Priority,
        awaitingReply = c.AwaitingReply,
        waitingSince = c.WaitingSince,
        lastReplyBy = c.LastReplyBy,
        lastReplyAt = c.LastReplyAt,
        ai = new
        {
            summary = c.AiSummary,
            topic = c.AiTopic,
            needsHuman = c.AiNeedsHuman,
            reason = c.AiReason,
            error = c.AiError,
            updatedAt = c.AiUpdatedAt
        }
    };

    private static object ToDto(AiDraftRow d) => new
    {
        id = d.Id,
        body = d.Body,
        needsHuman = d.NeedsHuman,
        topic = d.Topic,
        reason = d.Reason,
        departmentCode = d.DepartmentCode,
        basedOnMessageId = d.BasedOnMessageId,
        createdAt = d.CreatedAt,
        // Asistanın taslağı yazarken baktığı kayıtlar: [{name, query, ok, summary, ms}]
        toolCalls = d.ToolCallsJson is null ? (JsonElement?)null : JsonDocument.Parse(d.ToolCallsJson).RootElement.Clone()
    };

    private static object ToDto(MessageRow m) => new
    {
        id = m.Id,
        direction = m.Direction,
        type = m.MsgType,
        typeLabel = MessageStore.TypeLabel(m.MsgType),
        body = m.Body,
        hasMedia = !string.IsNullOrWhiteSpace(m.MediaId),
        mediaMime = m.MediaMime,
        mediaFilename = m.MediaFilename,
        status = m.Status,
        error = m.ErrorText,
        sentBy = m.SentBy,
        fromDraft = m.AiDraftId is not null,
        at = m.WaTimestamp ?? m.CreatedAt
    };

    private static object ToDto(EventRow e) => new
    {
        id = e.Id,
        kind = e.Kind,
        actor = e.Actor,
        data = e.DataJson is null ? (JsonElement?)null : JsonDocument.Parse(e.DataJson).RootElement.Clone(),
        at = e.CreatedAt
    };
}
