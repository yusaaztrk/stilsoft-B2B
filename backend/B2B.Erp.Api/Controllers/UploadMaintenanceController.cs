using B2B.Erp.Api.Features.Uploads;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace B2B.Erp.Api.Controllers;

/// <summary>
/// YETİM YÜKLEME DOSYALARI — RAPOR VE TEMİZLİK (denetim md. E5).
///
/// <para>
/// Uç SSA'ya kapalıdır çünkü sonucu geri alınamaz ve kapsamı tek firma değil, SUNUCUNUN
/// TAMAMIDIR: tarama bütün kiracıların referanslarını birlikte okur, silme bütün firmaların
/// ortak yükleme klasörüne dokunur. Tek bir firmanın yöneticisine verilecek bir yetki değil.
/// </para>
///
/// <para>
/// Kullanım sırası kasıtlı olarak iki adımdır: önce <c>orphan-report</c> ile ne silineceği
/// görülür, sonra <c>orphan-purge</c> ile silinir. Rapor hiçbir şeye dokunmaz.
/// </para>
/// </summary>
[ApiController]
[Route("api/upload-maintenance")]
[Authorize]
public sealed class UploadMaintenanceController : ControllerBase
{
    private readonly OrphanUploadScanner _scanner;

    public UploadMaintenanceController(OrphanUploadScanner scanner)
    {
        _scanner = scanner;
    }

    private bool RequesterIsSsa() => User.FindFirst("IsSuperSuperAdmin")?.Value == "1";

    /// <summary>Ne silineceğini gösterir; hiçbir dosyaya dokunmaz.</summary>
    [HttpGet("orphan-report")]
    public async Task<IActionResult> OrphanReport([FromQuery] int? graceDays, CancellationToken cancellationToken)
    {
        if (!RequesterIsSsa()) return StatusCode(403, new { success = false, message = "Yetkiniz yok" });

        var report = await _scanner.ScanAsync(
            deleteOrphans: false,
            graceDays ?? OrphanUploadScanner.DefaultGraceDays,
            cancellationToken);

        return Ok(Present(report));
    }

    /// <summary>
    /// Yetim dosyaları siler. Referans listesi eksikse (bir firma veritabanı okunamadıysa)
    /// tarayıcı silmeyi kendisi durdurur; burada ayrıca bir kapı yok, tek karar yeri orası.
    /// </summary>
    [HttpPost("orphan-purge")]
    public async Task<IActionResult> OrphanPurge([FromQuery] int? graceDays, CancellationToken cancellationToken)
    {
        if (!RequesterIsSsa()) return StatusCode(403, new { success = false, message = "Yetkiniz yok" });

        var report = await _scanner.ScanAsync(
            deleteOrphans: true,
            graceDays ?? OrphanUploadScanner.DefaultGraceDays,
            cancellationToken);

        return Ok(Present(report));
    }

    /// <summary>
    /// Liste kırpılır: 814 dosyalık bir klasörde bütün adları göndermek ekranı da yanıtı da
    /// boğar. Toplam sayı ve toplam boyut tam verilir, örnek olarak ilk 200 ad listelenir.
    /// </summary>
    private static object Present(OrphanUploadReport report) => new
    {
        success = true,
        referenceSetComplete = report.ReferenceSetComplete,
        warnings = report.Warnings,
        scannedFileCount = report.ScannedFileCount,
        referencedNameCount = report.ReferencedNameCount,
        graceDays = report.GraceDays,
        skippedByGraceCount = report.SkippedByGraceCount,
        orphanCount = report.Orphans.Count,
        orphanBytes = report.OrphanBytes,
        orphanSample = report.Orphans
            .OrderByDescending(x => x.SizeBytes)
            .Take(200)
            .Select(x => new { folder = x.Folder, fileName = x.FileName, sizeBytes = x.SizeBytes, lastWriteUtc = x.LastWriteUtc })
            .ToList(),
        deleteRequested = report.DeleteRequested,
        deletePerformed = report.DeletePerformed,
        deletedCount = report.DeletedCount,
        deletedBytes = report.DeletedBytes,
        deleteFailures = report.DeleteFailures
    };
}
