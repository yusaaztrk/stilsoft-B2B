using Microsoft.AspNetCore.Mvc;
using Shop.Api.Admin;

namespace Shop.Api.Catalog;

/// <summary>
/// Panel: vitrinde ne arandığı raporu (2026-09-20).
/// Kimlik bayinin B2B token'ı — arama terimleri iş bilgisi, dışarı açılmaz.
/// </summary>
[ApiController]
[Route("api/admin/search-insights")]
[B2BAdminAuth]
public sealed class SearchInsightsController : ControllerBase
{
    private readonly SearchLogService _searchLog;
    private readonly StockAlertService _stockAlerts;
    private readonly CatalogQueries _catalog;
    private readonly CallbackService _callbacks;
    private readonly VisitAnalyticsService _visits;

    public SearchInsightsController(
        SearchLogService searchLog,
        StockAlertService stockAlerts,
        CatalogQueries catalog,
        CallbackService callbacks,
        VisitAnalyticsService visits)
    {
        _searchLog = searchLog;
        _stockAlerts = stockAlerts;
        _catalog = catalog;
        _callbacks = callbacks;
        _visits = visits;
    }

    /// <param name="gun">Kaç günlük pencere (1-180, varsayılan 30).</param>
    /// <param name="adet">Her listede kaç satır (5-200, varsayılan 50).</param>
    [HttpGet]
    public async Task<IActionResult> Get(
        [FromQuery] int gun = 30,
        [FromQuery] int adet = 50,
        CancellationToken ct = default)
    {
        var data = await _searchLog.GetInsightsAsync(gun, adet, ct);
        return Ok(new { success = true, data });
    }

    /// <summary>
    /// "Gelince haber ver" talebi: hangi ürünü kaç kişi bekliyor (2026-09-20).
    ///
    /// Arama raporundaki "sonuç çıkmayan aramalar" ile aynı işi görüyor ama daha keskin:
    /// burada müşteri ürünü BULMUŞ, beğenmiş ve telefonunu bırakmış. Sipariş edilecek ürünü
    /// bundan daha net söyleyen bir liste yok.
    /// </summary>
    [HttpGet("stock-demand")]
    public async Task<IActionResult> StockDemand([FromQuery] int adet = 50, CancellationToken ct = default)
    {
        var rows = await _stockAlerts.DemandAsync(adet, ct);
        if (rows.Count == 0) return Ok(new { success = true, data = Array.Empty<object>() });

        // Stok kodu tek başına panelde okunmuyor; ürün adı ve stoğu da veriliyor.
        var urunler = await _catalog.GetByStockCodesAsync(rows.Select(x => x.StockCode), ct);

        var data = rows.Select(r =>
        {
            urunler.TryGetValue(r.StockCode, out var urun);
            return new
            {
                stockCode = r.StockCode,
                name = urun?.Name,
                waiting = r.Waiting,
                inStock = urun?.InStock ?? false,
                stockQuantity = urun?.StockQuantity,
                firstRequestedUtc = r.FirstRequestedUtc,
                lastRequestedUtc = r.LastRequestedUtc
            };
        });

        return Ok(new { success = true, data });
    }

    /// <summary>
    /// FOTOĞRAF ÖNCELİK LİSTESİ (2026-09-20).
    ///
    /// Stoğu ve fiyatı olan ama GÖRSELİ olmadığı için vitrine hiç giremeyen ürünler.
    /// Ölçümde bu grup vitrindeki ürün sayısının kat kat üstünde çıktı: satışı artırmanın
    /// en ucuz yolu kod yazmak değil, bu listeyi yukarıdan aşağı fotoğraflamak.
    /// </summary>
    [HttpGet("missing-photos")]
    public async Task<IActionResult> MissingPhotos([FromQuery] int adet = 100, CancellationToken ct = default)
    {
        var rows = await _catalog.MissingPhotosAsync(adet, ct);
        var toplam = await _catalog.MissingPhotoCountAsync(ct);

        return Ok(new
        {
            success = true,
            data = new
            {
                total = toplam,
                items = rows.Select(r => new
                {
                    stockCode = r.StockCode,
                    name = r.Name,
                    category = r.Category,
                    price = r.Price,
                    stock = r.Stock
                })
            }
        });
    }

    /// <summary>
    /// "SİZİ ARAYALIM" TALEPLERİ (2026-09-21).
    ///
    /// Bu listenin diğerlerinden farkı: burada müşteri ADINI VE NUMARASINI bırakmış.
    /// Arama raporu "ne isteniyor"u, stok talebi "neyi getirmeli"yi söylüyor; bu liste
    /// doğrudan ARANACAK KİŞİLERİ veriyor. Mesai başında ilk bakılacak yer burası.
    /// </summary>
    [HttpGet("/api/admin/callbacks")]
    public async Task<IActionResult> Callbacks(
        [FromQuery] bool bekleyen = true,
        [FromQuery] int adet = 100,
        CancellationToken ct = default)
    {
        var rows = await _callbacks.ListAsync(bekleyen, adet, ct);
        return Ok(new
        {
            success = true,
            data = new
            {
                pending = await _callbacks.PendingCountAsync(ct),
                items = rows.Select(r => new
                {
                    id = r.Id,
                    name = r.Name,
                    phone = r.Phone,
                    stockCode = r.StockCode,
                    productName = r.ProductName,
                    note = r.Note,
                    source = r.Source,
                    createdAtUtc = r.CreatedAtUtc,
                    doneAtUtc = r.DoneAtUtc,
                    doneNote = r.DoneNote
                })
            }
        });
    }

    public sealed class CallbackDoneRequest
    {
        [System.ComponentModel.DataAnnotations.StringLength(500)]
        public string? Note { get; set; }
    }

    /// <summary>"Arandı" işareti. Kayıt silinmiyor; kim ne zaman aradı izi kalıyor.</summary>
    [HttpPost("/api/admin/callbacks/{id:long}/done")]
    public async Task<IActionResult> CallbackDone(long id, [FromBody] CallbackDoneRequest? request, CancellationToken ct)
    {
        var ok = await _callbacks.MarkDoneAsync(id, request?.Note, ct);
        return ok ? Ok(new { success = true }) : NotFound(new { message = "Talep bulunamadı ya da zaten kapatılmış." });
    }

    /// <summary>
    /// ZİYARET HUNİSİ (2026-09-21) — "kaç kişi girdi, kaç misafir, nerede takıldı".
    ///
    /// Panelin en üst düzey satış sorusu bu. Diğer raporlar "ne isteniyor"u söylüyor;
    /// bu rapor "kaç kişi kaybediliyor ve hangi adımda" diyor.
    /// </summary>
    [HttpGet("/api/admin/analytics/funnel")]
    public async Task<IActionResult> Funnel([FromQuery] int gun = 30, CancellationToken ct = default)
    {
        var rapor = await _visits.GetFunnelAsync(gun, ct);
        return Ok(new { success = true, data = rapor });
    }
}
