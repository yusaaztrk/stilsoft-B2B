using ClosedXML.Excel;
using Microsoft.EntityFrameworkCore;
using ServiceOps.Api.Services;
using ServiceOps.Domain.Entities;
using ServiceOps.Infrastructure.Data;

namespace ServiceOps.Api.Reports;

public interface IReportExportService
{
    Task<(byte[] Content, string FileName)> ExportRecordsAsync(ReportFilter filter, ServiceOpsScope scope, CancellationToken ct);
}

/// <summary>
/// Rapor dışa aktarımı. Dosya SUNUCUDA üretilir.
///
/// Tarayıcıya on binlerce satır gönderip orada xlsx kurmak, büyük aralıklarda sekmeyi
/// kilitliyor. Burada veri hiç istemciye gitmiyor; hazır dosya iniyor.
/// </summary>
public sealed class ReportExportService : IReportExportService
{
    private readonly ApplicationDbContext _context;
    private readonly IServiceOpsPermissionService _permissions;

    /// <summary>Üst sınır. Aşıldığında sessizce kesilmez — çağıran kullanıcıyı uyarır.</summary>
    public const int MaxRows = 100_000;

    public ReportExportService(ApplicationDbContext context, IServiceOpsPermissionService permissions)
    {
        _context = context;
        _permissions = permissions;
    }

    public async Task<(byte[] Content, string FileName)> ExportRecordsAsync(
        ReportFilter filter,
        ServiceOpsScope scope,
        CancellationToken ct)
    {
        var (start, end) = filter.ResolveRange();

        // Kapsam filtresi burada da uygulanıyor: dışa aktarım, ekranda görülemeyen kayıtları
        // indirebilmenin en kolay yolu olurdu.
        var query = _permissions.ApplyServiceRecordScope(_context.ServiceRecords.AsNoTracking(), scope)
            .Where(s => s.CreatedAt >= start && s.CreatedAt < end);

        if (filter.Type.HasValue) query = query.Where(s => s.Type == filter.Type.Value);
        if (filter.ProductCategory.HasValue) query = query.Where(s => s.ProductCategory == filter.ProductCategory.Value);

        if (!string.IsNullOrWhiteSpace(filter.DealerCode))
        {
            var code = filter.DealerCode.Trim();
            query = query.Where(s => s.DealerCode == code);
        }

        if (filter.TechnicianId.HasValue)
        {
            var techId = filter.TechnicianId.Value;
            query = query.Where(s => s.AssignedTechnicianId == techId || s.TechnicianId == techId);
        }

        if (filter.RegionId.HasValue) query = query.Where(s => s.RegionId == filter.RegionId.Value);

        if (!string.IsNullOrWhiteSpace(filter.StockCode))
        {
            var stockCode = filter.StockCode.Trim();
            query = query.Where(s => s.ProductStockCode == stockCode);
        }

        if (!string.IsNullOrWhiteSpace(filter.Status) && Enum.TryParse<ServiceStatus>(filter.Status, true, out var status))
            query = query.Where(s => s.Status == status);

        query = (filter.Metric ?? string.Empty).Trim() switch
        {
            "completed" => query.Where(ReportDefinitions.IsCompleted),
            "cancelled" => query.Where(ReportDefinitions.IsCancelled),
            "inProgress" => query.Where(s => ReportDefinitions.InProgressStatuses.Contains(s.Status)),
            "pending" => query.Where(s => ReportDefinitions.PendingStatuses.Contains(s.Status)),
            "sameDay" => query.Where(s => s.CompletedAt != null && s.CompletedAt.Value.Date == s.CreatedAt.Date),
            _ => query
        };

        var rows = await query
            .OrderByDescending(s => s.CreatedAt)
            .Take(MaxRows + 1)
            .Select(s => new
            {
                s.ServiceNumber,
                s.Status,
                s.Type,
                s.ProductCategory,
                s.ProductName,
                s.ProductStockCode,
                s.SerialNumber,
                s.CustomerName,
                s.CustomerPhone,
                s.DealerCode,
                s.DealerName,
                TechnicianFirstName = s.AssignedTechnician != null ? s.AssignedTechnician.FirstName : null,
                TechnicianLastName = s.AssignedTechnician != null ? s.AssignedTechnician.LastName : null,
                s.CreatedAt,
                s.PlannedAt,
                s.CompletedAt,
                s.IsUnderWarranty
            })
            .ToListAsync(ct);

        var truncated = rows.Count > MaxRows;
        if (truncated) rows = rows.Take(MaxRows).ToList();

        using var workbook = new XLWorkbook();

        var detail = workbook.Worksheets.Add("Detay");
        var headers = new[]
        {
            "Servis No", "Durum", "Tip", "Ürün Grubu", "Ürün", "Stok Kodu", "Seri No",
            "Müşteri", "Telefon", "Bayi Kodu", "Bayi", "Teknisyen", "Açılış", "Planlama",
            "Tamamlanma", "Garanti"
        };

        for (var c = 0; c < headers.Length; c++)
        {
            detail.Cell(1, c + 1).Value = headers[c];
        }
        detail.Row(1).Style.Font.Bold = true;

        for (var i = 0; i < rows.Count; i++)
        {
            var r = rows[i];
            var line = i + 2;

            detail.Cell(line, 1).Value = r.ServiceNumber;
            detail.Cell(line, 2).Value = ReportDefinitions.StatusLabel(r.Status);
            detail.Cell(line, 3).Value = r.Type == ServiceType.Installation ? "Montaj" : "Arıza";
            detail.Cell(line, 4).Value = r.ProductCategory == ProductCategory.Small ? "Küçük Ürün" : "Büyük Ürün";
            detail.Cell(line, 5).Value = r.ProductName;
            detail.Cell(line, 6).Value = r.ProductStockCode;
            detail.Cell(line, 7).Value = r.SerialNumber;
            detail.Cell(line, 8).Value = r.CustomerName;
            detail.Cell(line, 9).Value = r.CustomerPhone;
            detail.Cell(line, 10).Value = r.DealerCode;
            detail.Cell(line, 11).Value = r.DealerName;
            detail.Cell(line, 12).Value = $"{r.TechnicianFirstName} {r.TechnicianLastName}".Trim();

            // Tarihler hücre biçimiyle yazılıyor; metin olarak yazmak Excel'de sıralamayı bozar.
            SetDate(detail.Cell(line, 13), r.CreatedAt);
            SetDate(detail.Cell(line, 14), r.PlannedAt);
            SetDate(detail.Cell(line, 15), r.CompletedAt);

            detail.Cell(line, 16).Value = r.IsUnderWarranty ? "Evet" : "Hayır";
        }

        detail.Columns().AdjustToContents();
        detail.SheetView.FreezeRows(1);

        var summary = workbook.Worksheets.Add("Özet");
        summary.Cell(1, 1).Value = "Rapor Aralığı";
        summary.Cell(1, 2).Value = $"{start:dd.MM.yyyy} - {end.AddDays(-1):dd.MM.yyyy}";
        summary.Cell(2, 1).Value = "Kayıt Sayısı";
        summary.Cell(2, 2).Value = rows.Count;

        if (truncated)
        {
            summary.Cell(3, 1).Value = "UYARI";
            summary.Cell(3, 2).Value = $"Sonuç {MaxRows} satırda kesildi. Lütfen tarih aralığını daraltın.";
            summary.Cell(3, 1).Style.Font.FontColor = XLColor.Red;
            summary.Cell(3, 2).Style.Font.FontColor = XLColor.Red;
        }

        var byStatus = rows.GroupBy(r => r.Status).OrderByDescending(g => g.Count()).ToList();
        summary.Cell(5, 1).Value = "Durum";
        summary.Cell(5, 2).Value = "Kayıt";
        summary.Row(5).Style.Font.Bold = true;

        for (var i = 0; i < byStatus.Count; i++)
        {
            summary.Cell(6 + i, 1).Value = ReportDefinitions.StatusLabel(byStatus[i].Key);
            summary.Cell(6 + i, 2).Value = byStatus[i].Count();
        }

        summary.Columns().AdjustToContents();

        using var stream = new MemoryStream();
        workbook.SaveAs(stream);

        var fileName = $"servis-raporu-{start:yyyyMMdd}-{end.AddDays(-1):yyyyMMdd}.xlsx";
        return (stream.ToArray(), fileName);
    }

    private static void SetDate(IXLCell cell, DateTime? value)
    {
        if (value is null)
        {
            cell.Value = string.Empty;
            return;
        }

        cell.Value = value.Value;
        cell.Style.DateFormat.Format = "dd.MM.yyyy HH:mm";
    }
}
