using System.Security.Claims;
using B2B.Erp.Api.Core.Helpers;
using B2B.Erp.Api.Data;
using B2B.Erp.Api.Entities;
using B2B.Erp.Api.Features.InvoiceList;
using Microsoft.EntityFrameworkCore;

namespace B2B.Erp.Api.Features.FaturaTakip;

public static class InvoiceTrackingViews
{
    public const string Unplanned = "planlanmamis";
    public const string Route = "rota";
    public const string Late = "geciken";
    public const string Completed = "tamamlanan";
    public const string All = "tumu";
}

public sealed class InvoiceTrackingRowDto
{
    public int InvoiceId { get; set; }
    public string InvoiceNo { get; set; } = string.Empty;
    public DateTime InvoiceDate { get; set; }
    public string TypeLabel { get; set; } = string.Empty;
    public string CustomerCode { get; set; } = string.Empty;
    public string CustomerName { get; set; } = string.Empty;
    public decimal GrandTotal { get; set; }
    public int CurrencyTypeId { get; set; }

    /// <summary>PLANLANMADI · PLANLANDI · TAMAMLANDI · OTOMATIK_TAMAMLANDI</summary>
    public string Status { get; set; } = string.Empty;
    public Guid? TechnicianId { get; set; }
    public string? TechnicianName { get; set; }
    public DateTime? PlannedDate { get; set; }
    public bool IsLate { get; set; }
    public DateTime? LastFailedDate { get; set; }
    public DateTime? CompletedAt { get; set; }
    public string? CompletedBy { get; set; }
    public int PhotoCount { get; set; }
    public string? LastNote { get; set; }

    /// <summary>Yalnızca rota görünümünde: o günün sonucu (TESLIM_EDILDI / TESLIM_EDILEMEDI / null).</summary>
    public string? RouteOutcome { get; set; }
    public string? RouteOutcomeNote { get; set; }
    public string? RouteTechnicianName { get; set; }
}

public sealed class InvoiceTrackingSummaryDto
{
    public int Unplanned { get; set; }
    public int Route { get; set; }
    public int Late { get; set; }
    public int FailedWaiting { get; set; }
    public int CompletedOnDate { get; set; }
}

public sealed record TrackingActor(string Name, string Source);

public sealed class InvoiceTrackingException : Exception
{
    public InvoiceTrackingException(string message) : base(message) { }
}

/// <summary>
/// Fatura Takip kuralları — B2B ekranı ve servis (teknisyen) uçları AYNI yerden geçer, iki
/// kopya olmasın. Hangi faturanın listeye girdiği Fatura Dökümü'nün temel sorgusundan gelir
/// (bkz. <see cref="InvoiceListBaseQuery"/>); alış tarafı belgeler müşteriye imzalatılmadığı
/// için çıkarılır (2026-09-15 kullanıcı kararı).
/// </summary>
public sealed class InvoiceTrackingService
{
    /// <summary>Genel Ayarlar'da tarih seçilmediyse takibin başladığı gün.</summary>
    public static readonly DateTime DefaultStartDate = new(2026, 9, 15, 0, 0, 0, DateTimeKind.Utc);

    private readonly AppDbContext _db;
    private readonly CompanyClock _clock;

    public InvoiceTrackingService(AppDbContext db, CompanyClock clock)
    {
        _db = db;
        _clock = clock;
    }

    public DateTime Today => _clock.TodayAsDocumentDate();

    public static DateTime AsDocumentDate(DateTime value) => DateTime.SpecifyKind(value.Date, DateTimeKind.Utc);

    public async Task<DateTime> GetStartDateAsync(CancellationToken ct)
    {
        var configured = await _db.Set<JwtSessionSetting>()
            .AsNoTracking()
            .OrderBy(x => x.Id)
            .Select(x => x.InvoiceTrackingStartDate)
            .FirstOrDefaultAsync(ct);

        return AsDocumentDate(configured ?? DefaultStartDate);
    }

    /// <summary>Kullanıcının Fatura Dökümü'nde gördüğü, alış tarafı çıkarılmış faturalar.</summary>
    public async Task<IQueryable<InvoiceListRow>?> VisibleInvoicesAsync(ClaimsPrincipal user, CancellationToken ct)
    {
        var baseQuery = await InvoiceListBaseQuery.BuildAsync(_db, user, ct);
        return baseQuery?.Where(x =>
            x.Type != InvoiceType.PurchaseInvoice
            // HİZMET = alış tarafından türeyen gider faturası (SourcePurchaseInvoiceId dolu);
            // TAMİR ise servis geliri ve kalıyor.
            && !(x.Type == InvoiceType.ServiceInvoice && x.SourcePurchaseInvoiceId != null && x.SourcePurchaseInvoiceId > 0));
    }

    private sealed class JoinedRow
    {
        public InvoiceListRow Invoice { get; set; } = null!;
        public InvoiceTracking? Tracking { get; set; }
    }

    private IQueryable<JoinedRow> Join(IQueryable<InvoiceListRow> invoices) =>
        from r in invoices
        join t in _db.InvoiceTrackings.AsNoTracking() on r.Id equals t.InvoiceId into tj
        from t in tj.DefaultIfEmpty()
        select new JoinedRow { Invoice = r, Tracking = t };

    public async Task<List<InvoiceTrackingRowDto>> ListAsync(
        ClaimsPrincipal user,
        string view,
        DateTime? date,
        DateTime? from,
        DateTime? to,
        Guid? technicianId,
        CancellationToken ct,
        DateTime? invoiceFrom = null,
        DateTime? invoiceTo = null)
    {
        var visible = await VisibleInvoicesAsync(user, ct);
        if (visible is null) return new List<InvoiceTrackingRowDto>();

        var today = Today;
        var startUtc = _clock.CompanyDayStartUtc(await GetStartDateAsync(ct));
        var routeDay = AsDocumentDate(date ?? today);

        var joined = InvoiceDateRange(Join(visible), invoiceFrom, invoiceTo);

        switch ((view ?? string.Empty).Trim().ToLowerInvariant())
        {
            case InvoiceTrackingViews.Route:
            {
                var outcomeIds = _db.InvoiceTrackingEvents.AsNoTracking()
                    .Where(e => e.RouteDate == routeDay
                                && (e.EventType == InvoiceTrackingEventTypes.Delivered || e.EventType == InvoiceTrackingEventTypes.Failed)
                        // Sonradan "durumu geri al" denmişse o sonuç geçersiz: basımda ve
                        // teknisyen ekranında hâlâ "teslim edildi" görünmemeli.
                        && !_db.InvoiceTrackingEvents.Any(r => r.InvoiceId == e.InvoiceId
                                                               && r.EventType == InvoiceTrackingEventTypes.Reopened
                                                               && r.Id > e.Id))
                    .Select(e => e.InvoiceId);

                joined = joined.Where(x =>
                    (x.Tracking != null && x.Tracking.Status == InvoiceTrackingStatus.Planned && x.Tracking.PlannedDate == routeDay)
                    || outcomeIds.Contains(x.Invoice.Id));
                break;
            }
            case InvoiceTrackingViews.Late:
                joined = joined.Where(x => x.Tracking != null
                                           && x.Tracking.Status == InvoiceTrackingStatus.Planned
                                           && x.Tracking.PlannedDate < today);
                break;
            case InvoiceTrackingViews.Completed:
            {
                var fromDay = AsDocumentDate(from ?? today.AddDays(-30));
                var toDay = AsDocumentDate(to ?? today);
                var fromUtc = _clock.CompanyDayStartUtc(fromDay);
                var toUtc = _clock.CompanyDayEndUtc(toDay);
                joined = joined.Where(x => x.Tracking != null
                                           && x.Tracking.Status == InvoiceTrackingStatus.Completed
                                           && x.Tracking.CompletedAt >= fromUtc
                                           && x.Tracking.CompletedAt < toUtc);
                break;
            }
            case InvoiceTrackingViews.All:
            {
                var fromDay = AsDocumentDate(from ?? today.AddDays(-30));
                var toDay = AsDocumentDate(to ?? today).AddDays(1);
                joined = joined.Where(x => x.Invoice.Date >= fromDay && x.Invoice.Date < toDay);
                break;
            }
            default:
                // Planlanmamış: başlangıçtan sonra KAYDEDİLMİŞ ve hiç satırı olmayan, ya da
                // teslim edilemeyip listeye dönmüş fatura.
                joined = joined.Where(x =>
                    (x.Tracking == null && x.Invoice.CreateTime >= startUtc)
                    || (x.Tracking != null && x.Tracking.Status == InvoiceTrackingStatus.Unplanned));
                break;
        }

        if (technicianId.HasValue)
        {
            joined = joined.Where(x => x.Tracking != null && x.Tracking.TechnicianId == technicianId.Value);
        }

        var rows = await joined
            .OrderByDescending(x => x.Invoice.Date)
            .ThenByDescending(x => x.Invoice.Id)
            .Take(3000)
            .ToListAsync(ct);

        var ids = rows.Select(x => x.Invoice.Id).ToList();

        var photoCounts = await _db.InvoiceTrackingPhotos.AsNoTracking()
            .Where(p => ids.Contains(p.InvoiceId))
            .GroupBy(p => p.InvoiceId)
            .Select(g => new { InvoiceId = g.Key, Count = g.Count() })
            .ToDictionaryAsync(x => x.InvoiceId, x => x.Count, ct);

        var lastNotes = (await _db.InvoiceTrackingEvents.AsNoTracking()
                .Where(e => ids.Contains(e.InvoiceId) && e.Note != null && e.Note != "")
                .Select(e => new { e.InvoiceId, e.Note, e.Id })
                .ToListAsync(ct))
            .GroupBy(x => x.InvoiceId)
            .ToDictionary(g => g.Key, g => g.OrderByDescending(x => x.Id).First().Note);

        var routeOutcomes = new Dictionary<int, InvoiceTrackingEvent>();
        if (string.Equals(view, InvoiceTrackingViews.Route, StringComparison.OrdinalIgnoreCase))
        {
            routeOutcomes = (await _db.InvoiceTrackingEvents.AsNoTracking()
                    .Where(e => ids.Contains(e.InvoiceId)
                                && e.RouteDate == routeDay
                                && (e.EventType == InvoiceTrackingEventTypes.Delivered || e.EventType == InvoiceTrackingEventTypes.Failed)
                        // Sonradan "durumu geri al" denmişse o sonuç geçersiz: basımda ve
                        // teknisyen ekranında hâlâ "teslim edildi" görünmemeli.
                        && !_db.InvoiceTrackingEvents.Any(r => r.InvoiceId == e.InvoiceId
                                                               && r.EventType == InvoiceTrackingEventTypes.Reopened
                                                               && r.Id > e.Id))
                    .ToListAsync(ct))
                .GroupBy(e => e.InvoiceId)
                .ToDictionary(g => g.Key, g => g.OrderByDescending(e => e.Id).First());
        }

        return rows.Select(x =>
        {
            var inv = x.Invoice;
            var t = x.Tracking;
            var dto = new InvoiceTrackingRowDto
            {
                InvoiceId = inv.Id,
                InvoiceNo = inv.InvoiceNo,
                InvoiceDate = inv.Date,
                TypeLabel = TypeLabel(inv),
                CustomerCode = inv.CustomerCode,
                CustomerName = inv.CustomerName,
                GrandTotal = inv.GrandTotal,
                CurrencyTypeId = inv.CurrencyTypeId,
                Status = StatusOf(t, inv.CreateTime, startUtc),
                TechnicianId = t?.TechnicianId,
                TechnicianName = t?.TechnicianName,
                PlannedDate = t?.PlannedDate,
                IsLate = t is { Status: InvoiceTrackingStatus.Planned } && t.PlannedDate < today,
                LastFailedDate = t?.LastFailedDate,
                CompletedAt = t?.CompletedAt,
                CompletedBy = t?.CompletedBy,
                PhotoCount = photoCounts.TryGetValue(inv.Id, out var pc) ? pc : 0,
                LastNote = lastNotes.TryGetValue(inv.Id, out var note) ? note : null
            };

            if (routeOutcomes.TryGetValue(inv.Id, out var outcome))
            {
                dto.RouteOutcome = outcome.EventType;
                dto.RouteOutcomeNote = outcome.Note;
                dto.RouteTechnicianName = outcome.TechnicianName;
            }

            return dto;
        }).ToList();
    }

    /// <summary>
    /// ÜST ŞERİTTEKİ FATURA TARİHİ ARALIĞI (2026-10-11, kullanıcı: "fatura takibe üstte iki tarih arası
    /// filtreleme"). Bütün sekmelere VE sayaçlara aynı aralık uygulanır; yoksa sayaç 814 derken liste
    /// 20 satır gösterir. Uçlardan biri boşsa o yön sınırsız.
    /// </summary>
    private IQueryable<JoinedRow> InvoiceDateRange(IQueryable<JoinedRow> joined, DateTime? from, DateTime? to)
    {
        if (from.HasValue)
        {
            var f = AsDocumentDate(from.Value);
            joined = joined.Where(x => x.Invoice.Date >= f);
        }
        if (to.HasValue)
        {
            var t = AsDocumentDate(to.Value).AddDays(1);
            joined = joined.Where(x => x.Invoice.Date < t);
        }
        return joined;
    }

    public async Task<InvoiceTrackingSummaryDto> SummaryAsync(
        ClaimsPrincipal user,
        DateTime? date,
        Guid? technicianId,
        CancellationToken ct,
        DateTime? invoiceFrom = null,
        DateTime? invoiceTo = null)
    {
        var visible = await VisibleInvoicesAsync(user, ct);
        if (visible is null) return new InvoiceTrackingSummaryDto();

        var today = Today;
        var day = AsDocumentDate(date ?? today);
        var startUtc = _clock.CompanyDayStartUtc(await GetStartDateAsync(ct));
        var dayStartUtc = _clock.CompanyDayStartUtc(day);
        var dayEndUtc = _clock.CompanyDayEndUtc(day);

        var joined = InvoiceDateRange(Join(visible), invoiceFrom, invoiceTo);
        if (technicianId.HasValue)
        {
            joined = joined.Where(x => x.Tracking != null && x.Tracking.TechnicianId == technicianId.Value);
        }

        var outcomeIds = _db.InvoiceTrackingEvents.AsNoTracking()
            .Where(e => e.RouteDate == day
                        && (e.EventType == InvoiceTrackingEventTypes.Delivered || e.EventType == InvoiceTrackingEventTypes.Failed)
                        // Sonradan "durumu geri al" denmişse o sonuç geçersiz: basımda ve
                        // teknisyen ekranında hâlâ "teslim edildi" görünmemeli.
                        && !_db.InvoiceTrackingEvents.Any(r => r.InvoiceId == e.InvoiceId
                                                               && r.EventType == InvoiceTrackingEventTypes.Reopened
                                                               && r.Id > e.Id))
            .Select(e => e.InvoiceId);

        return new InvoiceTrackingSummaryDto
        {
            Unplanned = technicianId.HasValue ? 0 : await joined.CountAsync(x =>
                (x.Tracking == null && x.Invoice.CreateTime >= startUtc)
                || (x.Tracking != null && x.Tracking.Status == InvoiceTrackingStatus.Unplanned), ct),
            Route = await joined.CountAsync(x =>
                (x.Tracking != null && x.Tracking.Status == InvoiceTrackingStatus.Planned && x.Tracking.PlannedDate == day)
                || outcomeIds.Contains(x.Invoice.Id), ct),
            Late = await joined.CountAsync(x => x.Tracking != null
                                                && x.Tracking.Status == InvoiceTrackingStatus.Planned
                                                && x.Tracking.PlannedDate < today, ct),
            FailedWaiting = await joined.CountAsync(x => x.Tracking != null
                                                         && x.Tracking.Status == InvoiceTrackingStatus.Unplanned
                                                         && x.Tracking.LastFailedDate != null, ct),
            CompletedOnDate = await joined.CountAsync(x => x.Tracking != null
                                                           && x.Tracking.Status == InvoiceTrackingStatus.Completed
                                                           && x.Tracking.CompletedAt >= dayStartUtc
                                                           && x.Tracking.CompletedAt < dayEndUtc, ct)
        };
    }

    private static string TypeLabel(InvoiceListRow inv) => inv.Type switch
    {
        InvoiceType.SalesInvoice => "SATIŞ",
        InvoiceType.ReturnInvoice => "İADE",
        InvoiceType.ServiceInvoice => "TAMİR",
        InvoiceType.OpenInvoice => "AÇIK",
        _ => ((char)inv.Type).ToString()
    };

    private static string StatusOf(InvoiceTracking? t, DateTime invoiceCreateTime, DateTime startUtc)
    {
        if (t is null) return invoiceCreateTime < startUtc ? "OTOMATIK_TAMAMLANDI" : "PLANLANMADI";
        return t.Status switch
        {
            InvoiceTrackingStatus.Planned => "PLANLANDI",
            InvoiceTrackingStatus.Completed => "TAMAMLANDI",
            _ => "PLANLANMADI"
        };
    }

    // -----------------------------------------------------------------------------------------
    // YAZMA
    // -----------------------------------------------------------------------------------------

    /// <summary>B2B işlemlerinde fatura, kullanıcının listede görebildiği faturalardan olmalı.</summary>
    public async Task<Dictionary<int, InvoiceListRow>> LoadVisibleAsync(ClaimsPrincipal user, IReadOnlyCollection<int> invoiceIds, CancellationToken ct)
    {
        var visible = await VisibleInvoicesAsync(user, ct);
        if (visible is null) return new Dictionary<int, InvoiceListRow>();

        var ids = invoiceIds.Distinct().ToList();
        return await visible.Where(x => ids.Contains(x.Id)).ToDictionaryAsync(x => x.Id, ct);
    }

    private async Task<Dictionary<int, InvoiceTracking>> LoadTrackingsAsync(IEnumerable<int> invoiceIds, CancellationToken ct)
    {
        var ids = invoiceIds.Distinct().ToList();
        return await _db.InvoiceTrackings.Where(t => ids.Contains(t.InvoiceId)).ToDictionaryAsync(t => t.InvoiceId, ct);
    }

    private InvoiceTracking NewTracking(int invoiceId, string invoiceNo, TrackingActor actor) => new()
    {
        InvoiceId = invoiceId,
        InvoiceNo = invoiceNo,
        Status = InvoiceTrackingStatus.Unplanned,
        CreateUser = Truncate(actor.Name, 100),
        CreateTime = DateTime.UtcNow
    };

    private InvoiceTrackingEvent AddEvent(InvoiceTracking t, string type, TrackingActor actor, string? note,
        DateTime? routeDate = null, DateTime? newPlannedDate = null)
    {
        var ev = new InvoiceTrackingEvent
        {
            InvoiceId = t.InvoiceId,
            InvoiceNo = t.InvoiceNo,
            EventType = type,
            RouteDate = routeDate,
            NewPlannedDate = newPlannedDate,
            TechnicianId = t.TechnicianId,
            TechnicianName = t.TechnicianName,
            Note = string.IsNullOrWhiteSpace(note) ? null : Truncate(note.Trim(), 2000),
            Source = actor.Source,
            Actor = Truncate(actor.Name, 200),
            CreatedAt = DateTime.UtcNow
        };
        _db.InvoiceTrackingEvents.Add(ev);
        return ev;
    }

    private static void Touch(InvoiceTracking t, TrackingActor actor)
    {
        t.EditUser = Truncate(actor.Name, 100);
        t.EditTime = DateTime.UtcNow;
    }

    /// <summary>Atama / başka güne alma. Tamamlanmış fatura önce durumu geri alınmadan atanamaz.</summary>
    public async Task<int> AssignAsync(
        IReadOnlyDictionary<int, InvoiceListRow> invoices,
        FieldTechnician technician,
        DateTime plannedDate,
        string? note,
        TrackingActor actor,
        CancellationToken ct)
    {
        var day = AsDocumentDate(plannedDate);
        var trackings = await LoadTrackingsAsync(invoices.Keys, ct);

        var completed = trackings.Values.Where(t => t.Status == InvoiceTrackingStatus.Completed).Select(t => t.InvoiceNo).ToList();
        if (completed.Count > 0)
        {
            throw new InvoiceTrackingException(
                $"Tamamlanmış faturalar atanamaz, önce durumunu geri alın: {string.Join(", ", completed.Take(5))}{(completed.Count > 5 ? "…" : "")}");
        }

        var startUtc = _clock.CompanyDayStartUtc(await GetStartDateAsync(ct));
        var auto = invoices.Values
            .Where(inv => !trackings.ContainsKey(inv.Id) && inv.CreateTime < startUtc)
            .Select(inv => inv.InvoiceNo)
            .ToList();
        if (auto.Count > 0)
        {
            throw new InvoiceTrackingException(
                $"Takip başlangıcından önceki faturalar otomatik tamamlandı sayılıyor, önce durumunu geri alın: {string.Join(", ", auto.Take(5))}{(auto.Count > 5 ? "…" : "")}");
        }

        foreach (var inv in invoices.Values)
        {
            if (!trackings.TryGetValue(inv.Id, out var t))
            {
                t = NewTracking(inv.Id, inv.InvoiceNo, actor);
                _db.InvoiceTrackings.Add(t);
            }

            var wasPlanned = t.Status == InvoiceTrackingStatus.Planned;
            var sameAssignment = wasPlanned && t.TechnicianId == technician.Id && t.PlannedDate == day;
            if (sameAssignment && string.IsNullOrWhiteSpace(note)) continue;

            var previousDay = t.PlannedDate;
            t.Status = InvoiceTrackingStatus.Planned;
            t.TechnicianId = technician.Id;
            t.TechnicianName = Truncate(technician.Name, 200);
            t.TechnicianUsername = technician.Username;
            t.PlannedDate = day;
            Touch(t, actor);

            AddEvent(t, wasPlanned ? InvoiceTrackingEventTypes.Replanned : InvoiceTrackingEventTypes.Planned,
                actor, note, routeDate: previousDay, newPlannedDate: day);
        }

        await _db.SaveChangesAsync(ct);
        return invoices.Count;
    }

    public async Task<int> UnassignAsync(IReadOnlyDictionary<int, InvoiceListRow> invoices, string? note, TrackingActor actor, CancellationToken ct)
    {
        var trackings = await LoadTrackingsAsync(invoices.Keys, ct);
        var changed = 0;

        foreach (var t in trackings.Values.Where(t => t.Status == InvoiceTrackingStatus.Planned))
        {
            var previousDay = t.PlannedDate;
            AddEvent(t, InvoiceTrackingEventTypes.Unplanned, actor, note, routeDate: previousDay);
            t.Status = InvoiceTrackingStatus.Unplanned;
            t.TechnicianId = null;
            t.TechnicianName = null;
            t.TechnicianUsername = null;
            t.PlannedDate = null;
            Touch(t, actor);
            changed++;
        }

        await _db.SaveChangesAsync(ct);
        return changed;
    }

    /// <summary>
    /// Teslim edildi (imzalı döndü). B2B'den planlanmamış bir fatura da doğrudan tamamlanabilir
    /// (müşteri ofise gelip imzalamış olabilir). Servisten gelen istekte fatura o teknisyene
    /// PLANLI olmak zorunda — <paramref name="requiredTechnicianId"/>.
    /// </summary>
    public async Task<InvoiceTrackingEvent> CompleteAsync(
        int invoiceId, string invoiceNo, string? note, TrackingActor actor, Guid? requiredTechnicianId, CancellationToken ct,
        DateTime? invoiceCreateTime = null)
    {
        var trackings = await LoadTrackingsAsync(new[] { invoiceId }, ct);
        trackings.TryGetValue(invoiceId, out var t);

        if (requiredTechnicianId.HasValue)
        {
            EnsureAssignedTo(t, requiredTechnicianId.Value);
        }

        if (t is null && invoiceCreateTime.HasValue
            && invoiceCreateTime.Value < _clock.CompanyDayStartUtc(await GetStartDateAsync(ct)))
        {
            throw new InvoiceTrackingException("Fatura takip başlangıcından önce kesildiği için zaten tamamlandı sayılıyor.");
        }

        if (t is null)
        {
            t = NewTracking(invoiceId, invoiceNo, actor);
            _db.InvoiceTrackings.Add(t);
        }
        else if (t.Status == InvoiceTrackingStatus.Completed)
        {
            throw new InvoiceTrackingException("Fatura zaten tamamlandı.");
        }

        var routeDay = t.Status == InvoiceTrackingStatus.Planned ? t.PlannedDate : null;
        var ev = AddEvent(t, InvoiceTrackingEventTypes.Delivered, actor, note, routeDate: routeDay);

        t.Status = InvoiceTrackingStatus.Completed;
        t.CompletedAt = DateTime.UtcNow;
        t.CompletedBy = Truncate(actor.Name, 200);
        Touch(t, actor);

        await _db.SaveChangesAsync(ct);
        return ev;
    }

    /// <summary>
    /// Teslim edilemedi: o günün rotasında sonuç olarak kalır (olayın RouteDate'i), fatura ise
    /// planlama listesine döner (kullanıcı kararı). Yalnızca planlı fatura için anlamlı.
    /// </summary>
    public async Task<InvoiceTrackingEvent> FailAsync(
        int invoiceId, string? note, TrackingActor actor, Guid? requiredTechnicianId, CancellationToken ct)
    {
        var trackings = await LoadTrackingsAsync(new[] { invoiceId }, ct);
        trackings.TryGetValue(invoiceId, out var t);

        if (requiredTechnicianId.HasValue)
        {
            EnsureAssignedTo(t, requiredTechnicianId.Value);
        }

        if (t is null || t.Status != InvoiceTrackingStatus.Planned)
        {
            throw new InvoiceTrackingException("Yalnızca planlanmış bir fatura için \"teslim edilemedi\" işaretlenebilir.");
        }

        if (string.IsNullOrWhiteSpace(note))
        {
            throw new InvoiceTrackingException("Teslim edilemedi için neden yazılmalı.");
        }

        var routeDay = t.PlannedDate;
        var ev = AddEvent(t, InvoiceTrackingEventTypes.Failed, actor, note, routeDate: routeDay);

        t.Status = InvoiceTrackingStatus.Unplanned;
        t.LastFailedDate = routeDay;
        t.TechnicianId = null;
        t.TechnicianName = null;
        t.TechnicianUsername = null;
        t.PlannedDate = null;
        Touch(t, actor);

        await _db.SaveChangesAsync(ct);
        return ev;
    }

    /// <summary>Tamamlandı (otomatik dahil) → Planlanmadı. Yanlış basılan tik düzeltilebilsin.</summary>
    public async Task ReopenAsync(int invoiceId, string invoiceNo, DateTime invoiceCreateTime, string? note, TrackingActor actor, CancellationToken ct)
    {
        var trackings = await LoadTrackingsAsync(new[] { invoiceId }, ct);
        trackings.TryGetValue(invoiceId, out var t);

        var startUtc = _clock.CompanyDayStartUtc(await GetStartDateAsync(ct));
        var isAutoCompleted = t is null && invoiceCreateTime < startUtc;

        if (t is null)
        {
            if (!isAutoCompleted) throw new InvoiceTrackingException("Fatura zaten planlanmamış durumda.");
            t = NewTracking(invoiceId, invoiceNo, actor);
            _db.InvoiceTrackings.Add(t);
        }
        else if (t.Status != InvoiceTrackingStatus.Completed)
        {
            throw new InvoiceTrackingException("Yalnızca tamamlanmış bir faturanın durumu geri alınabilir.");
        }

        AddEvent(t, InvoiceTrackingEventTypes.Reopened, actor, note);
        t.Status = InvoiceTrackingStatus.Unplanned;
        t.CompletedAt = null;
        t.CompletedBy = null;
        Touch(t, actor);

        await _db.SaveChangesAsync(ct);
    }

    public async Task<InvoiceTrackingEvent> AddNoteAsync(int invoiceId, string invoiceNo, string note, TrackingActor actor, Guid? requiredTechnicianId, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(note)) throw new InvoiceTrackingException("Not boş olamaz.");

        var trackings = await LoadTrackingsAsync(new[] { invoiceId }, ct);
        trackings.TryGetValue(invoiceId, out var t);

        if (requiredTechnicianId.HasValue)
        {
            EnsureAssignedTo(t, requiredTechnicianId.Value);
        }

        if (t is null)
        {
            t = NewTracking(invoiceId, invoiceNo, actor);
            _db.InvoiceTrackings.Add(t);
        }

        var ev = AddEvent(t, InvoiceTrackingEventTypes.Note, actor, note);
        Touch(t, actor);
        await _db.SaveChangesAsync(ct);
        return ev;
    }

    public async Task AttachPhotoAsync(int invoiceId, long? eventId, InvoiceTrackingPhotoStore.SavedPhoto saved, TrackingActor actor, CancellationToken ct)
    {
        _db.InvoiceTrackingPhotos.Add(new InvoiceTrackingPhoto
        {
            InvoiceId = invoiceId,
            EventId = eventId,
            FileName = saved.FileName,
            SizeBytes = saved.SizeBytes,
            Source = actor.Source,
            UploadedBy = Truncate(actor.Name, 200),
            CreatedAt = DateTime.UtcNow
        });
        await _db.SaveChangesAsync(ct);
    }

    private static void EnsureAssignedTo(InvoiceTracking? t, Guid technicianId)
    {
        if (t is null || t.Status != InvoiceTrackingStatus.Planned || t.TechnicianId != technicianId)
        {
            throw new InvoiceTrackingException("Bu fatura size atanmış değil ya da artık planlı değil.");
        }
    }

    public async Task<object> HistoryAsync(int invoiceId, CancellationToken ct)
    {
        var events = await _db.InvoiceTrackingEvents.AsNoTracking()
            .Where(e => e.InvoiceId == invoiceId)
            .OrderByDescending(e => e.Id)
            .ToListAsync(ct);

        var photos = await _db.InvoiceTrackingPhotos.AsNoTracking()
            .Where(p => p.InvoiceId == invoiceId)
            .OrderBy(p => p.Id)
            .Select(p => new { p.Id, p.EventId, p.Source, p.UploadedBy, p.CreatedAt })
            .ToListAsync(ct);

        return new
        {
            events = events.Select(e => new
            {
                e.Id,
                e.EventType,
                e.RouteDate,
                e.NewPlannedDate,
                e.TechnicianName,
                e.Note,
                e.Source,
                e.Actor,
                e.CreatedAt,
                photoIds = photos.Where(p => p.EventId == e.Id).Select(p => p.Id).ToList()
            }),
            photos
        };
    }

    // -----------------------------------------------------------------------------------------
    // TEKNİSYEN (servis) GÖRÜNÜMÜ ve ROTA BASIMI
    // -----------------------------------------------------------------------------------------

    public sealed class FieldInvoiceDto
    {
        public int InvoiceId { get; set; }
        public string InvoiceNo { get; set; } = string.Empty;
        public DateTime InvoiceDate { get; set; }
        public string TypeLabel { get; set; } = string.Empty;
        public string CustomerCode { get; set; } = string.Empty;
        public string CustomerName { get; set; } = string.Empty;
        public string? Phone { get; set; }
        public string? Address { get; set; }
        public decimal GrandTotal { get; set; }
        public int CurrencyTypeId { get; set; }
        public Guid? TechnicianId { get; set; }
        public string? TechnicianName { get; set; }
        public DateTime? PlannedDate { get; set; }
        public string Status { get; set; } = string.Empty;
        public string? Outcome { get; set; }
        public string? OutcomeNote { get; set; }
        public DateTime? OutcomeAt { get; set; }
        public DateTime? MovedTo { get; set; }
        public string? LastNote { get; set; }
        public int PhotoCount { get; set; }
    }

    /// <summary>
    /// Teknisyenin ekranı: bugüne kadar planlı olanlar (gecikenler dahil) + bugün sonuçlananlar.
    /// Fatura görünürlüğü burada KULLANICI kapsamıyla değil atamayla belirlenir: faturayı ofis
    /// atadıysa teknisyen görmeli; <paramref name="technicianId"/> boşsa (yönetici) hepsi.
    /// </summary>
    public async Task<List<FieldInvoiceDto>> FieldListAsync(Guid? technicianId, int daysAhead, CancellationToken ct)
    {
        var today = Today;
        var until = today.AddDays(Math.Clamp(daysAhead, 0, 14));
        var todayStartUtc = _clock.CompanyDayStartUtc(today);

        var planned = _db.InvoiceTrackings.AsNoTracking()
            .Where(t => t.Status == InvoiceTrackingStatus.Planned && t.PlannedDate <= until);
        if (technicianId.HasValue) planned = planned.Where(t => t.TechnicianId == technicianId.Value);

        var plannedRows = await planned.ToListAsync(ct);

        var outcomeQuery = _db.InvoiceTrackingEvents.AsNoTracking()
            .Where(e => e.CreatedAt >= todayStartUtc
                        && (e.EventType == InvoiceTrackingEventTypes.Delivered || e.EventType == InvoiceTrackingEventTypes.Failed)
                        // Sonradan "durumu geri al" denmişse o sonuç geçersiz: basımda ve
                        // teknisyen ekranında hâlâ "teslim edildi" görünmemeli.
                        && !_db.InvoiceTrackingEvents.Any(r => r.InvoiceId == e.InvoiceId
                                                               && r.EventType == InvoiceTrackingEventTypes.Reopened
                                                               && r.Id > e.Id));
        if (technicianId.HasValue) outcomeQuery = outcomeQuery.Where(e => e.TechnicianId == technicianId.Value);
        var outcomes = await outcomeQuery.ToListAsync(ct);

        var ids = plannedRows.Select(t => t.InvoiceId).Concat(outcomes.Select(e => e.InvoiceId)).Distinct().ToList();
        var items = await BuildContactRowsAsync(ids, ct);

        var photoCounts = await _db.InvoiceTrackingPhotos.AsNoTracking()
            .Where(p => ids.Contains(p.InvoiceId))
            .GroupBy(p => p.InvoiceId)
            .Select(g => new { g.Key, Count = g.Count() })
            .ToDictionaryAsync(x => x.Key, x => x.Count, ct);

        var result = new List<FieldInvoiceDto>();
        foreach (var t in plannedRows)
        {
            if (!items.TryGetValue(t.InvoiceId, out var dto)) continue;
            var copy = dto.Clone();
            copy.TechnicianId = t.TechnicianId;
            copy.TechnicianName = t.TechnicianName;
            copy.PlannedDate = t.PlannedDate;
            copy.Status = "PLANLANDI";
            copy.PhotoCount = photoCounts.TryGetValue(t.InvoiceId, out var pc) ? pc : 0;
            result.Add(copy);
        }

        foreach (var e in outcomes.GroupBy(x => x.InvoiceId).Select(g => g.OrderByDescending(x => x.Id).First()))
        {
            if (result.Any(r => r.InvoiceId == e.InvoiceId)) continue;
            if (!items.TryGetValue(e.InvoiceId, out var dto)) continue;
            var copy = dto.Clone();
            copy.TechnicianId = e.TechnicianId;
            copy.TechnicianName = e.TechnicianName;
            copy.PlannedDate = e.RouteDate;
            copy.Status = e.EventType;
            copy.Outcome = e.EventType;
            copy.OutcomeNote = e.Note;
            copy.OutcomeAt = e.CreatedAt;
            copy.PhotoCount = photoCounts.TryGetValue(e.InvoiceId, out var pc) ? pc : 0;
            result.Add(copy);
        }

        return result
            .OrderBy(r => r.Outcome != null)
            .ThenBy(r => r.PlannedDate)
            .ThenBy(r => r.CustomerName)
            .ToList();
    }

    /// <summary>
    /// Günün rotası, teknisyen başına. Şu an o güne planlı olanlar + o günün planıyla sonuçlanmış
    /// (teslim edildi / edilemedi) olanlar. Edilemeyip başka güne alınan faturanın yeni günü
    /// <see cref="FieldInvoiceDto.MovedTo"/>'da.
    /// </summary>
    public async Task<List<FieldInvoiceDto>> RouteAsync(ClaimsPrincipal user, DateTime date, Guid? technicianId, CancellationToken ct)
    {
        var day = AsDocumentDate(date);
        var visible = await VisibleInvoicesAsync(user, ct);
        if (visible is null) return new List<FieldInvoiceDto>();

        var planned = await _db.InvoiceTrackings.AsNoTracking()
            .Where(t => t.Status == InvoiceTrackingStatus.Planned && t.PlannedDate == day)
            .Where(t => !technicianId.HasValue || t.TechnicianId == technicianId.Value)
            .ToListAsync(ct);

        var outcomes = (await _db.InvoiceTrackingEvents.AsNoTracking()
                .Where(e => e.RouteDate == day
                            && (e.EventType == InvoiceTrackingEventTypes.Delivered || e.EventType == InvoiceTrackingEventTypes.Failed)
                        // Sonradan "durumu geri al" denmişse o sonuç geçersiz: basımda ve
                        // teknisyen ekranında hâlâ "teslim edildi" görünmemeli.
                        && !_db.InvoiceTrackingEvents.Any(r => r.InvoiceId == e.InvoiceId
                                                               && r.EventType == InvoiceTrackingEventTypes.Reopened
                                                               && r.Id > e.Id))
                .Where(e => !technicianId.HasValue || e.TechnicianId == technicianId.Value)
                .ToListAsync(ct))
            .GroupBy(e => e.InvoiceId)
            .Select(g => g.OrderByDescending(e => e.Id).First())
            .ToList();

        var candidateIds = planned.Select(t => t.InvoiceId).Concat(outcomes.Select(e => e.InvoiceId)).Distinct().ToList();
        var visibleIds = await visible.Where(x => candidateIds.Contains(x.Id)).Select(x => x.Id).ToListAsync(ct);
        var items = await BuildContactRowsAsync(visibleIds, ct);

        var current = await _db.InvoiceTrackings.AsNoTracking()
            .Where(t => visibleIds.Contains(t.InvoiceId))
            .ToDictionaryAsync(t => t.InvoiceId, ct);

        var result = new List<FieldInvoiceDto>();
        foreach (var e in outcomes)
        {
            if (!items.TryGetValue(e.InvoiceId, out var dto)) continue;
            var copy = dto.Clone();
            copy.TechnicianId = e.TechnicianId;
            copy.TechnicianName = e.TechnicianName;
            copy.PlannedDate = day;
            copy.Status = e.EventType;
            copy.Outcome = e.EventType;
            copy.OutcomeNote = e.Note;
            copy.OutcomeAt = e.CreatedAt;
            if (current.TryGetValue(e.InvoiceId, out var now) && now.Status == InvoiceTrackingStatus.Planned && now.PlannedDate != day)
            {
                copy.MovedTo = now.PlannedDate;
            }
            result.Add(copy);
        }

        foreach (var t in planned)
        {
            if (result.Any(r => r.InvoiceId == t.InvoiceId)) continue;
            if (!items.TryGetValue(t.InvoiceId, out var dto)) continue;
            var copy = dto.Clone();
            copy.TechnicianId = t.TechnicianId;
            copy.TechnicianName = t.TechnicianName;
            copy.PlannedDate = day;
            copy.Status = "PLANLANDI";
            result.Add(copy);
        }

        return result
            .OrderBy(r => r.TechnicianName)
            .ThenBy(r => r.CustomerName)
            .ToList();
    }

    /// <summary>
    /// Fatura + iletişim bilgisi. Adres/telefon önceliği: faturadaki kurulum telefonu, teslimat
    /// carisinin kartı, carinin kartı.
    /// </summary>
    private async Task<Dictionary<int, FieldInvoiceDto>> BuildContactRowsAsync(IReadOnlyCollection<int> invoiceIds, CancellationToken ct)
    {
        var ids = invoiceIds.Distinct().ToList();
        if (ids.Count == 0) return new Dictionary<int, FieldInvoiceDto>();

        var invoices = await _db.Set<Invoice>().AsNoTracking()
            .Where(i => ids.Contains(i.Id))
            .Select(i => new
            {
                i.Id, i.InvoiceNo, i.Date, i.Type, i.SourcePurchaseInvoiceId, i.CustomerCode, i.DeliveryCustomerCode,
                i.CustomerNameOverride, i.GrandTotal, i.CurrencyTypeId, i.InstallationName, i.InstallationPhone
            })
            .ToListAsync(ct);

        var codes = invoices.SelectMany(i => new[] { i.CustomerCode, i.DeliveryCustomerCode })
            .Where(c => !string.IsNullOrWhiteSpace(c))
            .Distinct()
            .ToList();

        var customers = await _db.Customers.AsNoTracking()
            .Where(c => codes.Contains(c.CustomerCode))
            .Select(c => new { c.CustomerCode, c.Name, c.Phone, c.Address, c.District, c.City })
            .ToDictionaryAsync(c => c.CustomerCode, ct);

        var lastNotes = (await _db.InvoiceTrackingEvents.AsNoTracking()
                .Where(e => ids.Contains(e.InvoiceId) && e.Note != null && e.Note != "")
                .Select(e => new { e.InvoiceId, e.Note, e.Id })
                .ToListAsync(ct))
            .GroupBy(x => x.InvoiceId)
            .ToDictionary(g => g.Key, g => g.OrderByDescending(x => x.Id).First().Note);

        var result = new Dictionary<int, FieldInvoiceDto>();
        foreach (var i in invoices)
        {
            customers.TryGetValue(i.DeliveryCustomerCode ?? string.Empty, out var delivery);
            customers.TryGetValue(i.CustomerCode ?? string.Empty, out var customer);
            var contact = delivery ?? customer;

            var address = contact is null
                ? null
                : string.Join(" ", new[] { contact.Address, contact.District, contact.City }.Where(s => !string.IsNullOrWhiteSpace(s)));

            result[i.Id] = new FieldInvoiceDto
            {
                InvoiceId = i.Id,
                InvoiceNo = i.InvoiceNo,
                InvoiceDate = i.Date,
                TypeLabel = i.Type switch
                {
                    InvoiceType.SalesInvoice => "SATIŞ",
                    InvoiceType.ReturnInvoice => "İADE",
                    InvoiceType.ServiceInvoice => "TAMİR",
                    InvoiceType.OpenInvoice => "AÇIK",
                    _ => ((char)i.Type).ToString()
                },
                CustomerCode = i.CustomerCode ?? string.Empty,
                CustomerName = customer?.Name ?? i.CustomerNameOverride ?? i.CustomerCode ?? string.Empty,
                Phone = FirstNonEmpty(i.InstallationPhone, delivery?.Phone, customer?.Phone),
                Address = string.IsNullOrWhiteSpace(address) ? null : address,
                GrandTotal = i.GrandTotal,
                CurrencyTypeId = i.CurrencyTypeId,
                LastNote = lastNotes.TryGetValue(i.Id, out var n) ? n : null
            };
        }

        return result;
    }

    private static string? FirstNonEmpty(params string?[] values) => values.FirstOrDefault(v => !string.IsNullOrWhiteSpace(v))?.Trim();

    private static string Truncate(string value, int max) => value.Length <= max ? value : value[..max];
}

internal static class FieldInvoiceDtoExtensions
{
    public static InvoiceTrackingService.FieldInvoiceDto Clone(this InvoiceTrackingService.FieldInvoiceDto d) => new()
    {
        InvoiceId = d.InvoiceId,
        InvoiceNo = d.InvoiceNo,
        InvoiceDate = d.InvoiceDate,
        TypeLabel = d.TypeLabel,
        CustomerCode = d.CustomerCode,
        CustomerName = d.CustomerName,
        Phone = d.Phone,
        Address = d.Address,
        GrandTotal = d.GrandTotal,
        CurrencyTypeId = d.CurrencyTypeId,
        LastNote = d.LastNote
    };
}
