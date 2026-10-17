using Microsoft.EntityFrameworkCore;
using ServiceOps.Api.Services;
using ServiceOps.Domain.Entities;
using ServiceOps.Infrastructure.Data;

namespace ServiceOps.Api.Reports;

public interface IReportQueryService
{
    Task<object> SummaryAsync(ReportFilter filter, ServiceOpsScope scope, CancellationToken ct);
    Task<object> TrendAsync(ReportFilter filter, ServiceOpsScope scope, string granularity, CancellationToken ct);
    Task<object> DealersAsync(ReportFilter filter, ServiceOpsScope scope, int take, CancellationToken ct);
    Task<object> DealerDetailAsync(string dealerCode, ReportFilter filter, ServiceOpsScope scope, CancellationToken ct);
    Task<object> TechniciansAsync(ReportFilter filter, ServiceOpsScope scope, int take, CancellationToken ct);
    Task<object> ProductsAsync(ReportFilter filter, ServiceOpsScope scope, int take, CancellationToken ct);
    Task<object> ProductDetailAsync(string stockCode, ReportFilter filter, ServiceOpsScope scope, CancellationToken ct);
    Task<object> InstallationsAsync(ReportFilter filter, ServiceOpsScope scope, CancellationToken ct);
    Task<object> DurationsAsync(ReportFilter filter, ServiceOpsScope scope, CancellationToken ct);
    Task<object> CancellationsAsync(ReportFilter filter, ServiceOpsScope scope, CancellationToken ct);
    Task<object> CargoAsync(ReportFilter filter, ServiceOpsScope scope, CancellationToken ct);
    Task<object> SparePartRequestsAsync(ReportFilter filter, int take, CancellationToken ct);
    Task<object> RecordsAsync(ReportFilter filter, ServiceOpsScope scope, CancellationToken ct);
}

public sealed class ReportQueryService : IReportQueryService
{
    private readonly ApplicationDbContext _context;
    private readonly IServiceOpsPermissionService _permissions;

    public ReportQueryService(ApplicationDbContext context, IServiceOpsPermissionService permissions)
    {
        _context = context;
        _permissions = permissions;
    }

    /// <summary>
    /// Rapor sorgularının tek giriş kapısı.
    ///
    /// Kapsam filtresi BURADA uygulanıyor, çağıranda değil: bir rapor ucunda unutulması,
    /// yalnızca kendi işlerini görmesi gereken bir teknisyene şirketin tamamını açardı.
    /// </summary>
    private IQueryable<ServiceRecord> Records(ReportFilter filter, ServiceOpsScope scope, bool applyDateRange = true)
    {
        var query = _permissions.ApplyServiceRecordScope(_context.ServiceRecords.AsNoTracking(), scope);

        if (applyDateRange)
        {
            var (start, end) = filter.ResolveRange();
            query = query.Where(s => s.CreatedAt >= start && s.CreatedAt < end);
        }

        if (filter.Type.HasValue)
            query = query.Where(s => s.Type == filter.Type.Value);

        if (filter.ProductCategory.HasValue)
            query = query.Where(s => s.ProductCategory == filter.ProductCategory.Value);

        if (!string.IsNullOrWhiteSpace(filter.DealerCode))
        {
            var code = filter.DealerCode.Trim();
            query = query.Where(s => s.DealerCode == code);
        }

        if (filter.TechnicianId.HasValue)
        {
            var techId = filter.TechnicianId.Value;
            query = query.Where(s =>
                s.AssignedTechnicianId == techId ||
                s.TechnicianId == techId ||
                s.CompletedByTechnicianId == techId ||
                s.DeliveryTechnicianId == techId);
        }

        if (filter.RegionId.HasValue)
            query = query.Where(s => s.RegionId == filter.RegionId.Value);

        if (!string.IsNullOrWhiteSpace(filter.StockCode))
        {
            var stockCode = filter.StockCode.Trim();
            query = query.Where(s => s.ProductStockCode == stockCode);
        }

        if (!string.IsNullOrWhiteSpace(filter.Status) && Enum.TryParse<ServiceStatus>(filter.Status, true, out var status))
            query = query.Where(s => s.Status == status);

        if (!string.IsNullOrWhiteSpace(filter.Search))
        {
            var term = filter.Search.Trim();
            query = query.Where(s =>
                s.ServiceNumber.Contains(term) ||
                (s.CustomerName != null && s.CustomerName.Contains(term)) ||
                (s.DealerName != null && s.DealerName.Contains(term)) ||
                s.ProductName.Contains(term) ||
                (s.SerialNumber != null && s.SerialNumber.Contains(term)));
        }

        return query;
    }

    /// <summary>Kartlardaki tanım ile listedeki tanımın aynı kalmasını sağlayan metrik süzgeci.</summary>
    private static IQueryable<ServiceRecord> ApplyMetric(IQueryable<ServiceRecord> query, string? metric)
    {
        return (metric ?? string.Empty).Trim() switch
        {
            "completed" => query.Where(ReportDefinitions.IsCompleted),
            "cancelled" => query.Where(ReportDefinitions.IsCancelled),
            "inProgress" => query.Where(s => ReportDefinitions.InProgressStatuses.Contains(s.Status)),
            "pending" => query.Where(s => ReportDefinitions.PendingStatuses.Contains(s.Status)),
            "sameDay" => query.Where(s => s.CompletedAt != null && s.CompletedAt.Value.Date == s.CreatedAt.Date),
            _ => query
        };
    }

    private sealed record Buckets(int Total, int Completed, int Cancelled, int InProgress, int Pending, double AvgHours);

    private async Task<Buckets> CountBucketsAsync(IQueryable<ServiceRecord> query, CancellationToken ct)
    {
        // Tek turda beş sayım: her biri ayrı sorgu olsaydı dashboard beş kez tam tablo tarardı.
        var grouped = await query
            .GroupBy(s => s.Status)
            .Select(g => new { Status = g.Key, Count = g.Count() })
            .ToListAsync(ct);

        var total = grouped.Sum(x => x.Count);
        var completed = grouped.Where(x => ReportDefinitions.CompletedStatuses.Contains(x.Status)).Sum(x => x.Count);
        var cancelled = grouped.Where(x => x.Status == ServiceStatus.Cancelled).Sum(x => x.Count);
        var inProgress = grouped.Where(x => ReportDefinitions.InProgressStatuses.Contains(x.Status)).Sum(x => x.Count);
        var pending = grouped.Where(x => ReportDefinitions.PendingStatuses.Contains(x.Status)).Sum(x => x.Count);

        // Süre ortalaması veritabanında: tamamlanmış kayıtların tamamını çekip C# tarafında
        // ortalamak, altı aylık bir aralıkta yüz binlerce satır taşımak demekti.
        var avgSeconds = await query
            .Where(s => s.CompletedAt != null)
            .Where(ReportDefinitions.IsCompleted)
            .Select(s => (double?)(s.CompletedAt!.Value - s.CreatedAt).TotalSeconds)
            .AverageAsync(ct);

        return new Buckets(total, completed, cancelled, inProgress, pending, Math.Round((avgSeconds ?? 0) / 3600.0, 2));
    }

    private static double Pct(int part, int whole) => whole <= 0 ? 0 : Math.Round(part * 100.0 / whole, 1);

    private static double Change(double current, double previous)
    {
        if (Math.Abs(previous) < 0.0001) return current > 0 ? 100 : 0;
        return Math.Round((current - previous) * 100.0 / previous, 1);
    }

    public async Task<object> SummaryAsync(ReportFilter filter, ServiceOpsScope scope, CancellationToken ct)
    {
        var current = await CountBucketsAsync(Records(filter, scope), ct);

        var previousFilter = CloneForPreviousPeriod(filter);
        var previous = await CountBucketsAsync(Records(previousFilter, scope), ct);

        var (start, end) = filter.ResolveRange();
        var dayCount = Math.Max(1, (end - start).TotalDays);

        var baseQuery = Records(filter, scope);

        var byType = await baseQuery
            .GroupBy(s => new { s.Type, s.ProductCategory })
            .Select(g => new { g.Key.Type, g.Key.ProductCategory, Count = g.Count() })
            .ToListAsync(ct);

        var installations = byType.Where(x => x.Type == ServiceType.Installation).Sum(x => x.Count);
        var largeRepairs = byType.Where(x => x.Type != ServiceType.Installation && x.ProductCategory == ProductCategory.Large).Sum(x => x.Count);
        var smallRepairs = byType.Where(x => x.Type != ServiceType.Installation && x.ProductCategory == ProductCategory.Small).Sum(x => x.Count);

        var cargoTotal = await CargoQuery(filter).CountAsync(ct);

        var activeTechnicians = await _context.Technicians.AsNoTracking()
            .CountAsync(t => t.IsActive && t.Status != TechnicianStatus.Inactive, ct);

        var activeDealers = await baseQuery
            .Where(s => s.DealerCode != null && s.DealerCode != "")
            .Select(s => s.DealerCode)
            .Distinct()
            .CountAsync(ct);

        var statusBreakdown = await baseQuery
            .GroupBy(s => s.Status)
            .Select(g => new { Status = g.Key, Count = g.Count() })
            .ToListAsync(ct);

        return new
        {
            range = new { start, end },
            kpi = new
            {
                total = new { value = current.Total, previous = previous.Total, change = Change(current.Total, previous.Total) },
                completed = new { value = current.Completed, previous = previous.Completed, change = Change(current.Completed, previous.Completed) },
                pending = new { value = current.Pending, previous = previous.Pending, change = Change(current.Pending, previous.Pending) },
                inProgress = new { value = current.InProgress, previous = previous.InProgress, change = Change(current.InProgress, previous.InProgress) },
                cancelled = new { value = current.Cancelled, previous = previous.Cancelled, change = Change(current.Cancelled, previous.Cancelled) },
                successRate = new { value = Pct(current.Completed, current.Total), previous = Pct(previous.Completed, previous.Total) },
                cancelRate = new { value = Pct(current.Cancelled, current.Total), previous = Pct(previous.Cancelled, previous.Total) },
                avgCompletionHours = new { value = current.AvgHours, previous = previous.AvgHours, change = Change(current.AvgHours, previous.AvgHours) },
                dailyAverage = Math.Round(current.Total / dayCount, 1),
                activeDealers,
                activeTechnicians
            },
            mix = new
            {
                installations,
                largeRepairs,
                smallRepairs,
                cargo = cargoTotal
            },
            statusBreakdown = statusBreakdown
                .OrderByDescending(x => x.Count)
                .Select(x => new { status = x.Status.ToString(), label = ReportDefinitions.StatusLabel(x.Status), count = x.Count })
                .ToList()
        };
    }

    public async Task<object> TrendAsync(ReportFilter filter, ServiceOpsScope scope, string granularity, CancellationToken ct)
    {
        var query = Records(filter, scope);

        var g = (granularity ?? "month").Trim().ToLowerInvariant();

        // Gruplama anahtarı veritabanında üretiliyor; tarihleri çekip C# tarafında kovalara
        // ayırmak, aralık büyüdükçe doğrusal olarak daha çok satır taşımak demek.
        var rows = g switch
        {
            "day" => await query
                .GroupBy(s => new { s.CreatedAt.Year, s.CreatedAt.Month, s.CreatedAt.Day })
                .Select(x => new TrendRow(
                    x.Key.Year, x.Key.Month, x.Key.Day,
                    x.Count(),
                    x.Count(s => s.Status == ServiceStatus.Delivered || s.Status == ServiceStatus.FieldCompleted),
                    x.Count(s => s.Status == ServiceStatus.Cancelled),
                    x.Count(s => s.Type == ServiceType.Installation)))
                .ToListAsync(ct),

            "week" => await query
                .GroupBy(s => new { s.CreatedAt.Year, Week = s.CreatedAt.DayOfYear / 7 })
                .Select(x => new TrendRow(
                    x.Key.Year, x.Key.Week, 0,
                    x.Count(),
                    x.Count(s => s.Status == ServiceStatus.Delivered || s.Status == ServiceStatus.FieldCompleted),
                    x.Count(s => s.Status == ServiceStatus.Cancelled),
                    x.Count(s => s.Type == ServiceType.Installation)))
                .ToListAsync(ct),

            _ => await query
                .GroupBy(s => new { s.CreatedAt.Year, s.CreatedAt.Month })
                .Select(x => new TrendRow(
                    x.Key.Year, x.Key.Month, 0,
                    x.Count(),
                    x.Count(s => s.Status == ServiceStatus.Delivered || s.Status == ServiceStatus.FieldCompleted),
                    x.Count(s => s.Status == ServiceStatus.Cancelled),
                    x.Count(s => s.Type == ServiceType.Installation)))
                .ToListAsync(ct)
        };

        return new
        {
            granularity = g,
            points = rows
                .OrderBy(r => r.A).ThenBy(r => r.B).ThenBy(r => r.C)
                .Select(r => new
                {
                    label = g == "day" ? $"{r.C:00}.{r.B:00}.{r.A}" : g == "week" ? $"{r.A}-H{r.B}" : $"{r.B:00}.{r.A}",
                    total = r.Total,
                    completed = r.Completed,
                    cancelled = r.Cancelled,
                    installations = r.Installations
                })
                .ToList()
        };
    }

    private sealed record TrendRow(int A, int B, int C, int Total, int Completed, int Cancelled, int Installations);

    public async Task<object> DealersAsync(ReportFilter filter, ServiceOpsScope scope, int take, CancellationToken ct)
    {
        var query = Records(filter, scope).Where(s => s.DealerCode != null && s.DealerCode != "");

        var rows = await query
            .GroupBy(s => new { s.DealerCode, s.DealerName })
            .Select(g => new
            {
                dealerCode = g.Key.DealerCode,
                dealerName = g.Key.DealerName,
                total = g.Count(),
                installations = g.Count(s => s.Type == ServiceType.Installation),
                largeRepairs = g.Count(s => s.Type != ServiceType.Installation && s.ProductCategory == ProductCategory.Large),
                smallRepairs = g.Count(s => s.Type != ServiceType.Installation && s.ProductCategory == ProductCategory.Small),
                completed = g.Count(s => s.Status == ServiceStatus.Delivered || s.Status == ServiceStatus.FieldCompleted),
                cancelled = g.Count(s => s.Status == ServiceStatus.Cancelled),
                avgCompletionSeconds = g
                    .Where(s => s.CompletedAt != null)
                    .Average(s => (double?)(s.CompletedAt!.Value - s.CreatedAt).TotalSeconds)
            })
            .OrderByDescending(x => x.total)
            .Take(take)
            .ToListAsync(ct);

        return rows.Select(x => new
        {
            x.dealerCode,
            x.dealerName,
            x.total,
            x.installations,
            x.largeRepairs,
            x.smallRepairs,
            x.completed,
            x.cancelled,
            pending = x.total - x.completed - x.cancelled,
            cancelRate = Pct(x.cancelled, x.total),
            successRate = Pct(x.completed, x.total),
            avgCompletionHours = Math.Round((x.avgCompletionSeconds ?? 0) / 3600.0, 2)
        }).ToList();
    }

    public async Task<object> DealerDetailAsync(string dealerCode, ReportFilter filter, ServiceOpsScope scope, CancellationToken ct)
    {
        var code = (dealerCode ?? string.Empty).Trim();
        var query = Records(filter, scope).Where(s => s.DealerCode == code);

        var buckets = await CountBucketsAsync(query, ct);

        var byProduct = await query
            .Where(s => s.ProductStockCode != null)
            .GroupBy(s => new { s.ProductStockCode, s.ProductName })
            .Select(g => new { stockCode = g.Key.ProductStockCode, productName = g.Key.ProductName, count = g.Count() })
            .OrderByDescending(x => x.count)
            .Take(25)
            .ToListAsync(ct);

        // Ad/soyad AYRI gruplanıyor: Technician.FullName hesaplanan bir property, SQL'e
        // çevrilemiyor ve bu uçları bir dönem 500 döndüren hata tam olarak buydu.
        var byTechnician = await query
            .Where(s => s.AssignedTechnicianId != null)
            .GroupBy(s => new { s.AssignedTechnicianId, s.AssignedTechnician!.FirstName, s.AssignedTechnician.LastName })
            .Select(g => new
            {
                technicianId = g.Key.AssignedTechnicianId,
                g.Key.FirstName,
                g.Key.LastName,
                count = g.Count()
            })
            .OrderByDescending(x => x.count)
            .Take(25)
            .ToListAsync(ct);

        var monthly = await query
            .GroupBy(s => new { s.CreatedAt.Year, s.CreatedAt.Month })
            .Select(g => new { g.Key.Year, g.Key.Month, count = g.Count() })
            .ToListAsync(ct);

        return new
        {
            dealerCode = code,
            summary = new
            {
                buckets.Total,
                buckets.Completed,
                buckets.Cancelled,
                buckets.Pending,
                buckets.InProgress,
                avgCompletionHours = buckets.AvgHours,
                cancelRate = Pct(buckets.Cancelled, buckets.Total),
                successRate = Pct(buckets.Completed, buckets.Total)
            },
            byProduct,
            byTechnician = byTechnician.Select(x => new
            {
                x.technicianId,
                technicianName = $"{x.FirstName} {x.LastName}".Trim(),
                x.count
            }).ToList(),
            monthly = monthly
                .OrderBy(x => x.Year).ThenBy(x => x.Month)
                .Select(x => new { label = $"{x.Month:00}.{x.Year}", x.count })
                .ToList()
        };
    }

    public async Task<object> TechniciansAsync(ReportFilter filter, ServiceOpsScope scope, int take, CancellationToken ct)
    {
        var query = Records(filter, scope).Where(s => s.AssignedTechnicianId != null);

        var rows = await query
            .GroupBy(s => new { s.AssignedTechnicianId, s.AssignedTechnician!.FirstName, s.AssignedTechnician.LastName })
            .Select(g => new
            {
                technicianId = g.Key.AssignedTechnicianId,
                g.Key.FirstName,
                g.Key.LastName,
                total = g.Count(),
                completed = g.Count(s => s.Status == ServiceStatus.Delivered || s.Status == ServiceStatus.FieldCompleted),
                cancelled = g.Count(s => s.Status == ServiceStatus.Cancelled),
                installations = g.Count(s => s.Type == ServiceType.Installation),
                sameDay = g.Count(s => s.CompletedAt != null && s.CompletedAt!.Value.Date == s.CreatedAt.Date),
                avgCompletionSeconds = g
                    .Where(s => s.CompletedAt != null)
                    .Average(s => (double?)(s.CompletedAt!.Value - s.CreatedAt).TotalSeconds)
            })
            .OrderByDescending(x => x.total)
            .Take(take)
            .ToListAsync(ct);

        return rows.Select(x => new
        {
            x.technicianId,
            technicianName = $"{x.FirstName} {x.LastName}".Trim(),
            x.total,
            x.completed,
            x.cancelled,
            x.installations,
            pending = x.total - x.completed - x.cancelled,
            successRate = Pct(x.completed, x.total),
            cancelRate = Pct(x.cancelled, x.total),
            sameDayRate = Pct(x.sameDay, x.completed),
            avgCompletionHours = Math.Round((x.avgCompletionSeconds ?? 0) / 3600.0, 2)
        }).ToList();
    }

    public async Task<object> ProductsAsync(ReportFilter filter, ServiceOpsScope scope, int take, CancellationToken ct)
    {
        var query = Records(filter, scope).Where(s => s.ProductStockCode != null && s.ProductStockCode != "");

        var rows = await query
            .GroupBy(s => new { s.ProductStockCode, s.ProductName })
            .Select(g => new
            {
                stockCode = g.Key.ProductStockCode,
                productName = g.Key.ProductName,
                total = g.Count(),
                installations = g.Count(s => s.Type == ServiceType.Installation),
                repairs = g.Count(s => s.Type != ServiceType.Installation),
                cancelled = g.Count(s => s.Status == ServiceStatus.Cancelled),
                completed = g.Count(s => s.Status == ServiceStatus.Delivered || s.Status == ServiceStatus.FieldCompleted),
                underWarranty = g.Count(s => s.IsUnderWarranty),
                avgCompletionSeconds = g
                    .Where(s => s.CompletedAt != null)
                    .Average(s => (double?)(s.CompletedAt!.Value - s.CreatedAt).TotalSeconds)
            })
            .OrderByDescending(x => x.total)
            .Take(take)
            .ToListAsync(ct);

        return rows.Select(x => new
        {
            x.stockCode,
            x.productName,
            x.total,
            x.installations,
            x.repairs,
            x.completed,
            x.cancelled,
            x.underWarranty,
            cancelRate = Pct(x.cancelled, x.total),
            avgCompletionHours = Math.Round((x.avgCompletionSeconds ?? 0) / 3600.0, 2)
        }).ToList();
    }

    public async Task<object> ProductDetailAsync(string stockCode, ReportFilter filter, ServiceOpsScope scope, CancellationToken ct)
    {
        var code = (stockCode ?? string.Empty).Trim();
        var query = Records(filter, scope).Where(s => s.ProductStockCode == code);

        var buckets = await CountBucketsAsync(query, ct);

        // "Bu üründen hangi bayi kaç adet verdi" — talebin açıkça istediği tablo.
        var byDealer = await query
            .Where(s => s.DealerCode != null && s.DealerCode != "")
            .GroupBy(s => new { s.DealerCode, s.DealerName })
            .Select(g => new
            {
                dealerCode = g.Key.DealerCode,
                dealerName = g.Key.DealerName,
                total = g.Count(),
                installations = g.Count(s => s.Type == ServiceType.Installation),
                repairs = g.Count(s => s.Type != ServiceType.Installation)
            })
            .OrderByDescending(x => x.total)
            .Take(50)
            .ToListAsync(ct);

        var monthly = await query
            .GroupBy(s => new { s.CreatedAt.Year, s.CreatedAt.Month })
            .Select(g => new { g.Key.Year, g.Key.Month, count = g.Count() })
            .ToListAsync(ct);

        var byRegion = await query
            .GroupBy(s => s.RegionId)
            .Select(g => new { regionId = g.Key, count = g.Count() })
            .OrderByDescending(x => x.count)
            .Take(20)
            .ToListAsync(ct);

        var regionNames = await _context.Regions.AsNoTracking()
            .Select(r => new { r.Id, r.Name })
            .ToDictionaryAsync(x => x.Id, x => x.Name, ct);

        return new
        {
            stockCode = code,
            summary = new
            {
                buckets.Total,
                buckets.Completed,
                buckets.Cancelled,
                buckets.Pending,
                avgCompletionHours = buckets.AvgHours
            },
            byDealer,
            byRegion = byRegion.Select(x => new
            {
                region = x.regionId == null ? "Bölge Yok" : (regionNames.TryGetValue(x.regionId.Value, out var n) ? n : "-"),
                x.count
            }).ToList(),
            monthly = monthly
                .OrderBy(x => x.Year).ThenBy(x => x.Month)
                .Select(x => new { label = $"{x.Month:00}.{x.Year}", x.count })
                .ToList()
        };
    }

    public async Task<object> InstallationsAsync(ReportFilter filter, ServiceOpsScope scope, CancellationToken ct)
    {
        var (start, end) = filter.ResolveRange();

        var serviceIds = Records(filter, scope).Where(s => s.Type == ServiceType.Installation).Select(s => s.Id);

        var tasks = _context.InstallationTasks.AsNoTracking().Where(t => serviceIds.Contains(t.ServiceId));

        var statusRows = await tasks
            .GroupBy(t => t.Status)
            .Select(g => new { status = g.Key, count = g.Count(), quantity = g.Sum(x => x.Quantity) })
            .ToListAsync(ct);

        // Montaj tarafındaki süreler sistemdeki en güvenilir veri: dört ayrı zaman damgası var.
        var durations = await tasks
            .Where(t => t.CompletedAt != null)
            .Select(t => new
            {
                PlanToTransfer = t.TransferredAt != null && t.PlannedAt != null
                    ? (double?)(t.TransferredAt!.Value - t.PlannedAt!.Value).TotalSeconds : null,
                TransferToStart = t.StartedAt != null && t.TransferredAt != null
                    ? (double?)(t.StartedAt!.Value - t.TransferredAt!.Value).TotalSeconds : null,
                StartToComplete = t.StartedAt != null
                    ? (double?)(t.CompletedAt!.Value - t.StartedAt!.Value).TotalSeconds : null
            })
            .GroupBy(_ => 1)
            .Select(g => new
            {
                planToTransfer = g.Average(x => x.PlanToTransfer),
                transferToStart = g.Average(x => x.TransferToStart),
                startToComplete = g.Average(x => x.StartToComplete)
            })
            .FirstOrDefaultAsync(ct);

        var byTechnician = await tasks
            .Where(t => t.AssignedTechnicianId != null && t.Status == InstallationTaskStatus.Completed)
            .GroupBy(t => new { t.AssignedTechnicianId, t.AssignedTechnician!.FirstName, t.AssignedTechnician.LastName })
            .Select(g => new
            {
                technicianId = g.Key.AssignedTechnicianId,
                g.Key.FirstName,
                g.Key.LastName,
                count = g.Count(),
                quantity = g.Sum(x => x.Quantity)
            })
            .OrderByDescending(x => x.quantity)
            .Take(20)
            .ToListAsync(ct);

        // Adet, kayıt sayısından farklı: bir kabul kaydında birden çok kalem olabiliyor.
        var byProduct = await _context.ServiceRecordItems.AsNoTracking()
            .Where(i => serviceIds.Contains(i.ServiceId))
            .GroupBy(i => new { i.ProductStockCode, i.ProductName })
            .Select(g => new
            {
                stockCode = g.Key.ProductStockCode,
                productName = g.Key.ProductName,
                quantity = g.Sum(x => x.Quantity),
                lines = g.Count()
            })
            .OrderByDescending(x => x.quantity)
            .Take(25)
            .ToListAsync(ct);

        var byDealer = await Records(filter, scope)
            .Where(s => s.Type == ServiceType.Installation && s.DealerCode != null && s.DealerCode != "")
            .GroupBy(s => new { s.DealerCode, s.DealerName })
            .Select(g => new { dealerCode = g.Key.DealerCode, dealerName = g.Key.DealerName, count = g.Count() })
            .OrderByDescending(x => x.count)
            .Take(20)
            .ToListAsync(ct);

        return new
        {
            range = new { start, end },
            taskStatus = statusRows.Select(x => new { status = x.status.ToString(), x.count, x.quantity }).ToList(),
            totalTasks = statusRows.Sum(x => x.count),
            totalQuantity = statusRows.Sum(x => x.quantity),
            completedTasks = statusRows.Where(x => x.status == InstallationTaskStatus.Completed).Sum(x => x.count),
            cancelledTasks = statusRows.Where(x => x.status == InstallationTaskStatus.Cancelled).Sum(x => x.count),
            avgHours = new
            {
                planToTransfer = Math.Round((durations?.planToTransfer ?? 0) / 3600.0, 2),
                transferToStart = Math.Round((durations?.transferToStart ?? 0) / 3600.0, 2),
                startToComplete = Math.Round((durations?.startToComplete ?? 0) / 3600.0, 2)
            },
            byTechnician = byTechnician.Select(x => new
            {
                x.technicianId,
                technicianName = $"{x.FirstName} {x.LastName}".Trim(),
                x.count,
                x.quantity
            }).ToList(),
            byProduct,
            byDealer
        };
    }

    public async Task<object> DurationsAsync(ReportFilter filter, ServiceOpsScope scope, CancellationToken ct)
    {
        var query = Records(filter, scope).Where(s => s.CompletedAt != null).Where(ReportDefinitions.IsCompleted);

        var stats = await query
            .Select(s => new
            {
                Total = (double)(s.CompletedAt!.Value - s.CreatedAt).TotalSeconds,
                ToPlan = s.PlannedAt != null ? (double?)(s.PlannedAt!.Value - s.CreatedAt).TotalSeconds : null
            })
            .GroupBy(_ => 1)
            .Select(g => new
            {
                count = g.Count(),
                avg = g.Average(x => x.Total),
                min = g.Min(x => x.Total),
                max = g.Max(x => x.Total),
                avgToPlan = g.Average(x => x.ToPlan)
            })
            .FirstOrDefaultAsync(ct);

        var longest = await query
            .OrderByDescending(s => (s.CompletedAt!.Value - s.CreatedAt).TotalSeconds)
            .Take(20)
            .Select(s => new
            {
                s.Id,
                s.ServiceNumber,
                s.ProductName,
                s.DealerName,
                s.CreatedAt,
                s.CompletedAt,
                hours = (s.CompletedAt!.Value - s.CreatedAt).TotalSeconds / 3600.0
            })
            .ToListAsync(ct);

        var fastest = await query
            .OrderBy(s => (s.CompletedAt!.Value - s.CreatedAt).TotalSeconds)
            .Take(20)
            .Select(s => new
            {
                s.Id,
                s.ServiceNumber,
                s.ProductName,
                s.DealerName,
                s.CreatedAt,
                s.CompletedAt,
                hours = (s.CompletedAt!.Value - s.CreatedAt).TotalSeconds / 3600.0
            })
            .ToListAsync(ct);

        return new
        {
            overall = new
            {
                count = stats?.count ?? 0,
                avgHours = Math.Round((stats?.avg ?? 0) / 3600.0, 2),
                minHours = Math.Round((stats?.min ?? 0) / 3600.0, 2),
                maxHours = Math.Round((stats?.max ?? 0) / 3600.0, 2),
                avgToPlanHours = Math.Round((stats?.avgToPlan ?? 0) / 3600.0, 2)
            },
            longest = longest.Select(x => new { x.Id, x.ServiceNumber, x.ProductName, x.DealerName, x.CreatedAt, x.CompletedAt, hours = Math.Round(x.hours, 2) }),
            fastest = fastest.Select(x => new { x.Id, x.ServiceNumber, x.ProductName, x.DealerName, x.CreatedAt, x.CompletedAt, hours = Math.Round(x.hours, 2) })
        };
    }

    public async Task<object> CancellationsAsync(ReportFilter filter, ServiceOpsScope scope, CancellationToken ct)
    {
        var all = Records(filter, scope);
        var cancelled = all.Where(ReportDefinitions.IsCancelled);

        var total = await all.CountAsync(ct);
        var cancelledCount = await cancelled.CountAsync(ct);

        var byDealer = await cancelled
            .Where(s => s.DealerCode != null && s.DealerCode != "")
            .GroupBy(s => new { s.DealerCode, s.DealerName })
            .Select(g => new { dealerCode = g.Key.DealerCode, dealerName = g.Key.DealerName, count = g.Count() })
            .OrderByDescending(x => x.count)
            .Take(20)
            .ToListAsync(ct);

        var byTechnician = await cancelled
            .Where(s => s.AssignedTechnicianId != null)
            .GroupBy(s => new { s.AssignedTechnicianId, s.AssignedTechnician!.FirstName, s.AssignedTechnician.LastName })
            .Select(g => new { technicianId = g.Key.AssignedTechnicianId, g.Key.FirstName, g.Key.LastName, count = g.Count() })
            .OrderByDescending(x => x.count)
            .Take(20)
            .ToListAsync(ct);

        var byProduct = await cancelled
            .Where(s => s.ProductStockCode != null)
            .GroupBy(s => new { s.ProductStockCode, s.ProductName })
            .Select(g => new { stockCode = g.Key.ProductStockCode, productName = g.Key.ProductName, count = g.Count() })
            .OrderByDescending(x => x.count)
            .Take(20)
            .ToListAsync(ct);

        var monthly = await cancelled
            .GroupBy(s => new { s.CreatedAt.Year, s.CreatedAt.Month })
            .Select(g => new { g.Key.Year, g.Key.Month, count = g.Count() })
            .ToListAsync(ct);

        return new
        {
            total,
            cancelled = cancelledCount,
            cancelRate = Pct(cancelledCount, total),
            byDealer,
            byTechnician = byTechnician.Select(x => new
            {
                x.technicianId,
                technicianName = $"{x.FirstName} {x.LastName}".Trim(),
                x.count
            }).ToList(),
            byProduct,
            monthly = monthly
                .OrderBy(x => x.Year).ThenBy(x => x.Month)
                .Select(x => new { label = $"{x.Month:00}.{x.Year}", x.count })
                .ToList(),
            // İptal SEBEBİ hiçbir tabloda tutulmuyor. Alan uydurmak yerine ekrana bu bayrak
            // gönderiliyor; sebep kırılımı bölümü o zaman hiç çizilmiyor.
            reasonBreakdownAvailable = false
        };
    }

    private IQueryable<CargoTrackingTask> CargoQuery(ReportFilter filter)
    {
        var (start, end) = filter.ResolveRange();
        var query = _context.CargoTrackingTasks.AsNoTracking()
            .Where(c => c.OrderDate >= start && c.OrderDate < end);

        if (filter.TechnicianId.HasValue)
            query = query.Where(c => c.AssignedTechnicianId == filter.TechnicianId.Value);

        return query;
    }

    public async Task<object> CargoAsync(ReportFilter filter, ServiceOpsScope scope, CancellationToken ct)
    {
        var query = _permissions.ApplyCargoScope(CargoQuery(filter), scope);

        var byStatus = await query
            .GroupBy(c => c.Status)
            .Select(g => new { status = g.Key, count = g.Count() })
            .ToListAsync(ct);

        var byTechnician = await query
            .Where(c => c.AssignedTechnicianId != null)
            .GroupBy(c => new { c.AssignedTechnicianId, c.AssignedTechnician!.FirstName, c.AssignedTechnician.LastName })
            .Select(g => new
            {
                technicianId = g.Key.AssignedTechnicianId,
                g.Key.FirstName,
                g.Key.LastName,
                total = g.Count(),
                delivered = g.Count(c => c.Status == CargoTrackingStatus.Delivered)
            })
            .OrderByDescending(x => x.total)
            .Take(20)
            .ToListAsync(ct);

        var avgDeliverySeconds = await query
            .Where(c => c.Status == CargoTrackingStatus.Delivered)
            .Select(c => (double?)(c.UpdatedAt - c.OrderDate).TotalSeconds)
            .AverageAsync(ct);

        var monthly = await query
            .GroupBy(c => new { c.OrderDate.Year, c.OrderDate.Month })
            .Select(g => new { g.Key.Year, g.Key.Month, count = g.Count() })
            .ToListAsync(ct);

        return new
        {
            total = byStatus.Sum(x => x.count),
            byStatus = byStatus
                .Select(x => new { status = x.status.ToString(), label = ReportDefinitions.CargoStatusLabel(x.status), x.count })
                .ToList(),
            delivered = byStatus.Where(x => x.status == CargoTrackingStatus.Delivered).Sum(x => x.count),
            avgDeliveryHours = Math.Round((avgDeliverySeconds ?? 0) / 3600.0, 2),
            byTechnician = byTechnician.Select(x => new
            {
                x.technicianId,
                technicianName = $"{x.FirstName} {x.LastName}".Trim(),
                x.total,
                x.delivered
            }).ToList(),
            monthly = monthly
                .OrderBy(x => x.Year).ThenBy(x => x.Month)
                .Select(x => new { label = $"{x.Month:00}.{x.Year}", x.count })
                .ToList(),
            // Kargo durum enum'unda "İptal" yok; bayi/cari alanı da yok. Ekran bu iki bölümü
            // bu bayraklara bakarak hiç çizmiyor — boş kart göstermek yerine.
            cancellationTracked = false,
            dealerBreakdownAvailable = false
        };
    }

    public async Task<object> SparePartRequestsAsync(ReportFilter filter, int take, CancellationToken ct)
    {
        var (start, end) = filter.ResolveRange();

        var query = _context.SparePartOrderRequests.AsNoTracking()
            .Where(r => r.CreatedAt >= start && r.CreatedAt < end);

        var byPart = await query
            .GroupBy(r => new { r.StockCode, r.PartName })
            .Select(g => new
            {
                stockCode = g.Key.StockCode,
                partName = g.Key.PartName,
                requests = g.Count(),
                quantity = g.Sum(x => x.QuantityRequested)
            })
            .OrderByDescending(x => x.quantity)
            .Take(take)
            .ToListAsync(ct);

        var byTechnician = await query
            .GroupBy(r => r.TechnicianName)
            .Select(g => new
            {
                technicianName = g.Key,
                requests = g.Count(),
                quantity = g.Sum(x => x.QuantityRequested)
            })
            .OrderByDescending(x => x.quantity)
            .Take(take)
            .ToListAsync(ct);

        var byStatus = await query
            .GroupBy(r => r.Status)
            .Select(g => new { status = g.Key, count = g.Count() })
            .ToListAsync(ct);

        var avgFulfilSeconds = await query
            .Where(r => r.CompletedAt != null)
            .Select(r => (double?)(r.CompletedAt!.Value - r.CreatedAt).TotalSeconds)
            .AverageAsync(ct);

        var monthly = await query
            .GroupBy(r => new { r.CreatedAt.Year, r.CreatedAt.Month })
            .Select(g => new { g.Key.Year, g.Key.Month, quantity = g.Sum(x => x.QuantityRequested) })
            .ToListAsync(ct);

        return new
        {
            totalRequests = byStatus.Sum(x => x.count),
            totalQuantity = byPart.Sum(x => x.quantity),
            avgFulfilHours = Math.Round((avgFulfilSeconds ?? 0) / 3600.0, 2),
            byStatus,
            byPart,
            byTechnician,
            monthly = monthly
                .OrderBy(x => x.Year).ThenBy(x => x.Month)
                .Select(x => new { label = $"{x.Month:00}.{x.Year}", x.quantity })
                .ToList(),
            // Servis ↔ kullanılan parça bağı (InventoryUsage) hiçbir akışta yazılmıyor; bu yüzden
            // rapor TALEP bazlı. "Hangi üründe kullanıldı" sorusu bugünkü veriyle cevaplanamıyor.
            usageTrackingAvailable = false
        };
    }

    public async Task<object> RecordsAsync(ReportFilter filter, ServiceOpsScope scope, CancellationToken ct)
    {
        var query = ApplyMetric(Records(filter, scope), filter.Metric);

        var total = await query.CountAsync(ct);

        var items = await query
            .OrderByDescending(s => s.CreatedAt)
            .Skip((filter.SafePage - 1) * filter.SafePageSize)
            .Take(filter.SafePageSize)
            .Select(s => new
            {
                s.Id,
                s.ServiceNumber,
                status = s.Status.ToString(),
                type = s.Type.ToString(),
                productCategory = s.ProductCategory.ToString(),
                s.ProductName,
                s.ProductStockCode,
                s.SerialNumber,
                s.CustomerName,
                s.DealerCode,
                s.DealerName,
                technicianName = s.AssignedTechnician != null
                    ? s.AssignedTechnician.FirstName + " " + s.AssignedTechnician.LastName
                    : null,
                s.CreatedAt,
                s.PlannedAt,
                s.CompletedAt,
                s.IsUnderWarranty
            })
            .ToListAsync(ct);

        return new
        {
            total,
            page = filter.SafePage,
            pageSize = filter.SafePageSize,
            items = items.Select(x => new
            {
                x.Id,
                x.ServiceNumber,
                x.status,
                statusLabel = Enum.TryParse<ServiceStatus>(x.status, out var st) ? ReportDefinitions.StatusLabel(st) : x.status,
                x.type,
                x.productCategory,
                x.ProductName,
                x.ProductStockCode,
                x.SerialNumber,
                x.CustomerName,
                x.DealerCode,
                x.DealerName,
                x.technicianName,
                x.CreatedAt,
                x.PlannedAt,
                x.CompletedAt,
                x.IsUnderWarranty
            })
        };
    }

    private static ReportFilter CloneForPreviousPeriod(ReportFilter filter)
    {
        var (prevStart, prevEnd) = filter.ResolvePreviousRange();
        return new ReportFilter
        {
            From = prevStart,
            To = prevEnd.AddDays(-1),
            Type = filter.Type,
            ProductCategory = filter.ProductCategory,
            Status = filter.Status,
            DealerCode = filter.DealerCode,
            TechnicianId = filter.TechnicianId,
            RegionId = filter.RegionId,
            StockCode = filter.StockCode
        };
    }
}

