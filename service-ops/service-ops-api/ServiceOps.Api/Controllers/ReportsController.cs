using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using ServiceOps.Api.Reports;
using ServiceOps.Api.Services;

namespace ServiceOps.Api.Controllers;

/// <summary>
/// Raporlama uçları. Hepsi salt okuma; hiçbir operasyonel kayda dokunmaz.
///
/// İki kapıdan geçilir ve ikisi de zorunlu:
///   1. Sayfa anahtarı — bu rolün o raporu açma yetkisi var mı,
///   2. Kayıt kapsamı  — açtığında KAÇ kaydı görebiliyor.
/// İkincisi olmadan, yalnızca kendi işlerini görmesi gereken bir teknisyen rapor ekranından
/// şirketin tamamını okuyabilirdi. Frontend'de menüyü gizlemek yetki kontrolü değildir.
/// </summary>
[ApiController]
[Route("api/reports")]
[Authorize]
public sealed class ReportsController : ControllerBase
{
    private readonly IReportQueryService _reports;
    private readonly IReportExportService _export;
    private readonly IServiceOpsPermissionService _permissions;

    /// <summary>Kapsamın okunduğu kök sayfa. Alt raporlar kendi anahtarlarıyla ayrıca kontrol edilir.</summary>
    private const string RootPageKey = "raporlar";

    public ReportsController(
        IReportQueryService reports,
        IReportExportService export,
        IServiceOpsPermissionService permissions)
    {
        _reports = reports;
        _export = export;
        _permissions = permissions;
    }

    /// <summary>
    /// Sayfa açık mı + kayıt kapsamı ne. Kapsam <see cref="ServiceOpsScopeKind.None"/> ise
    /// kullanıcı raporu açabilir ama görebileceği kayıt yoktur; bu durumda boş sonuç döner,
    /// başkasının verisi sızmaz.
    /// </summary>
    private async Task<(bool Allowed, ServiceOpsScope Scope)> ResolveAccessAsync(string pageKey, CancellationToken ct)
    {
        var allowed = await _permissions.HasPageAsync(User, pageKey, ct);
        if (!allowed) return (false, new ServiceOpsScope(ServiceOpsScopeKind.None, null, null));

        var scope = await _permissions.GetScopeAsync(User, RootPageKey, ct);
        return (true, scope);
    }

    private async Task<IActionResult> RunAsync(
        string pageKey,
        Func<ServiceOpsScope, Task<object>> query,
        CancellationToken ct)
    {
        var (allowed, scope) = await ResolveAccessAsync(pageKey, ct);
        if (!allowed) return Forbid();

        var data = await query(scope);
        return Ok(new { success = true, data });
    }

    [HttpGet("summary")]
    public Task<IActionResult> Summary([FromQuery] ReportFilter filter, CancellationToken ct) =>
        RunAsync(RootPageKey, scope => _reports.SummaryAsync(filter, scope, ct), ct);

    [HttpGet("trend")]
    public Task<IActionResult> Trend([FromQuery] ReportFilter filter, [FromQuery] string granularity = "month", CancellationToken ct = default) =>
        RunAsync(RootPageKey, scope => _reports.TrendAsync(filter, scope, granularity, ct), ct);

    [HttpGet("installations")]
    public Task<IActionResult> Installations([FromQuery] ReportFilter filter, CancellationToken ct) =>
        RunAsync("raporlar.montaj", scope => _reports.InstallationsAsync(filter, scope, ct), ct);

    /// <summary>Büyük/küçük ürün arıza raporu. Ayrım <c>productCategory</c> ile yapılır.</summary>
    [HttpGet("repairs")]
    public Task<IActionResult> Repairs([FromQuery] ReportFilter filter, CancellationToken ct)
    {
        var pageKey = filter.ProductCategory == Domain.Entities.ProductCategory.Small
            ? "raporlar.kucukUrun"
            : "raporlar.buyukUrun";

        filter.Type ??= Domain.Entities.ServiceType.Repair;

        return RunAsync(pageKey, scope => _reports.SummaryAsync(filter, scope, ct), ct);
    }

    [HttpGet("cargo")]
    public Task<IActionResult> Cargo([FromQuery] ReportFilter filter, CancellationToken ct) =>
        RunAsync("raporlar.kargo", scope => _reports.CargoAsync(filter, scope, ct), ct);

    [HttpGet("dealers")]
    public Task<IActionResult> Dealers([FromQuery] ReportFilter filter, [FromQuery] int take = 20, CancellationToken ct = default) =>
        RunAsync("raporlar.bayi", scope => _reports.DealersAsync(filter, scope, Clamp(take), ct), ct);

    [HttpGet("dealers/{dealerCode}")]
    public Task<IActionResult> DealerDetail(string dealerCode, [FromQuery] ReportFilter filter, CancellationToken ct) =>
        RunAsync("raporlar.bayi", scope => _reports.DealerDetailAsync(dealerCode, filter, scope, ct), ct);

    [HttpGet("technicians")]
    public Task<IActionResult> Technicians([FromQuery] ReportFilter filter, [FromQuery] int take = 20, CancellationToken ct = default) =>
        RunAsync("raporlar.teknisyen", scope => _reports.TechniciansAsync(filter, scope, Clamp(take), ct), ct);

    [HttpGet("products")]
    public Task<IActionResult> Products([FromQuery] ReportFilter filter, [FromQuery] int take = 20, CancellationToken ct = default) =>
        RunAsync("raporlar.urun", scope => _reports.ProductsAsync(filter, scope, Clamp(take), ct), ct);

    [HttpGet("products/{stockCode}")]
    public Task<IActionResult> ProductDetail(string stockCode, [FromQuery] ReportFilter filter, CancellationToken ct) =>
        RunAsync("raporlar.urun", scope => _reports.ProductDetailAsync(stockCode, filter, scope, ct), ct);

    [HttpGet("durations")]
    public Task<IActionResult> Durations([FromQuery] ReportFilter filter, CancellationToken ct) =>
        RunAsync("raporlar.sureler", scope => _reports.DurationsAsync(filter, scope, ct), ct);

    [HttpGet("cancellations")]
    public Task<IActionResult> Cancellations([FromQuery] ReportFilter filter, CancellationToken ct) =>
        RunAsync("raporlar.iptal", scope => _reports.CancellationsAsync(filter, scope, ct), ct);

    [HttpGet("spare-part-requests")]
    public Task<IActionResult> SparePartRequests([FromQuery] ReportFilter filter, [FromQuery] int take = 20, CancellationToken ct = default) =>
        RunAsync("raporlar.yedekParca", _ => _reports.SparePartRequestsAsync(filter, Clamp(take), ct), ct);

    /// <summary>
    /// Drill-down listesi. Karttaki sayı ile buradaki satır sayısının aynı kalması için
    /// <c>metric</c> alanı kartın tanımını taşır — liste ikinci bir yerde yeniden tanımlanmaz.
    /// </summary>
    [HttpGet("records")]
    public Task<IActionResult> Records([FromQuery] ReportFilter filter, CancellationToken ct) =>
        RunAsync(RootPageKey, scope => _reports.RecordsAsync(filter, scope, ct), ct);

    /// <summary>
    /// Filtrelenmiş kayıtların Excel çıktısı. Dosya sunucuda üretilir; büyük aralıklarda
    /// on binlerce satırı tarayıcıya çekmek sekmeyi kilitliyordu.
    ///
    /// Dışa aktarma ayrı bir yetkidir: raporu görebilen herkes veriyi indirebilir olmak
    /// zorunda değil.
    /// </summary>
    [HttpGet("export/records")]
    public async Task<IActionResult> ExportRecords([FromQuery] ReportFilter filter, CancellationToken ct)
    {
        if (!await _permissions.HasPageAsync(User, "raporlar.disaAktar", ct))
        {
            return Forbid();
        }

        var scope = await _permissions.GetScopeAsync(User, RootPageKey, ct);
        var (content, fileName) = await _export.ExportRecordsAsync(filter, scope, ct);

        return File(content, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", fileName);
    }

    private static int Clamp(int take) => take < 1 ? 20 : (take > 100 ? 100 : take);
}
