using ServiceOps.Domain.Entities;

namespace ServiceOps.Api.Reports;

/// <summary>
/// Bütün rapor uçlarının ortak filtresi. Tek sınıf olması bilinçli: her uç kendi filtresini
/// tanımlarsa "Girne + son 3 ay" bir ekranda başka, diğerinde başka sonuç verir.
/// </summary>
public sealed class ReportFilter
{
    public DateTime? From { get; set; }
    public DateTime? To { get; set; }

    /// <summary>bugun, dun, buHafta, gecenHafta, buAy, gecenAy, son3Ay, son6Ay, buYil, gecenYil</summary>
    public string? Preset { get; set; }

    public ServiceType? Type { get; set; }
    public ProductCategory? ProductCategory { get; set; }

    public string? Status { get; set; }
    public string? DealerCode { get; set; }
    public Guid? TechnicianId { get; set; }
    public Guid? RegionId { get; set; }
    public string? StockCode { get; set; }
    public string? Search { get; set; }

    /// <summary>Drill-down kartı hangi tanımdan geldi: cancelled, completed, pending, inProgress, repeat, sameDay.</summary>
    public string? Metric { get; set; }

    public int Page { get; set; } = 1;
    public int PageSize { get; set; } = 50;
    public string? Sort { get; set; }

    public int SafePage => Page < 1 ? 1 : Page;
    public int SafePageSize => PageSize < 1 ? 50 : (PageSize > 200 ? 200 : PageSize);

    /// <summary>
    /// Çözülmüş tarih aralığı; bitiş HARİÇ (yarı açık aralık).
    ///
    /// Ön ayarlar sunucuda tarihe çevrilir. İstemcinin saatine göre kayan bir "bu ay" tanımı,
    /// aynı raporu iki makinede farklı gösterir.
    /// </summary>
    public (DateTime Start, DateTime End) ResolveRange()
    {
        var today = DateTime.UtcNow.Date;

        if (!string.IsNullOrWhiteSpace(Preset))
        {
            switch (Preset.Trim())
            {
                case "bugun": return (today, today.AddDays(1));
                case "dun": return (today.AddDays(-1), today);
                case "buHafta":
                {
                    var start = StartOfWeek(today);
                    return (start, start.AddDays(7));
                }
                case "gecenHafta":
                {
                    var start = StartOfWeek(today).AddDays(-7);
                    return (start, start.AddDays(7));
                }
                case "buAy":
                {
                    var start = new DateTime(today.Year, today.Month, 1, 0, 0, 0, DateTimeKind.Utc);
                    return (start, start.AddMonths(1));
                }
                case "gecenAy":
                {
                    var start = new DateTime(today.Year, today.Month, 1, 0, 0, 0, DateTimeKind.Utc).AddMonths(-1);
                    return (start, start.AddMonths(1));
                }
                case "son3Ay": return (today.AddMonths(-3), today.AddDays(1));
                case "son6Ay": return (today.AddMonths(-6), today.AddDays(1));
                case "buYil":
                {
                    var start = new DateTime(today.Year, 1, 1, 0, 0, 0, DateTimeKind.Utc);
                    return (start, start.AddYears(1));
                }
                case "gecenYil":
                {
                    var start = new DateTime(today.Year - 1, 1, 1, 0, 0, 0, DateTimeKind.Utc);
                    return (start, start.AddYears(1));
                }
            }
        }

        var s = From.HasValue
            ? DateTime.SpecifyKind(From.Value.Date, DateTimeKind.Utc)
            : new DateTime(today.Year, today.Month, 1, 0, 0, 0, DateTimeKind.Utc);

        // Bitiş kullanıcı için DAHİL, sorgu için hariç: 1–31 Ağustos seçen biri 31'i de bekler.
        var e = To.HasValue
            ? DateTime.SpecifyKind(To.Value.Date, DateTimeKind.Utc).AddDays(1)
            : s.AddMonths(1);

        if (e <= s) e = s.AddDays(1);
        return (s, e);
    }

    /// <summary>
    /// Karşılaştırma için hemen önceki, aynı uzunluktaki dönem. "Geçen aya göre %" bunun üzerinden.
    /// </summary>
    public (DateTime Start, DateTime End) ResolvePreviousRange()
    {
        var (start, end) = ResolveRange();
        var length = end - start;
        return (start - length, start);
    }

    private static DateTime StartOfWeek(DateTime day)
    {
        // Hafta pazartesi başlar.
        var diff = ((int)day.DayOfWeek + 6) % 7;
        return DateTime.SpecifyKind(day.AddDays(-diff), DateTimeKind.Utc);
    }
}
