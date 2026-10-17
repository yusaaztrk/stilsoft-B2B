using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Shop.Api.Infrastructure;

namespace Shop.Api.Catalog;

/// <summary>
/// Vitrinin okuma uçları. Hepsi herkese açık — vitrin zaten herkese açık.
///
/// Fiyat burada HESAPLANIR, istemciden alınmaz: sepetten gelen bir tutara güvenmek, e-ticarette
/// en klasik açıktır (50.000₺'lik ürünü 1₺'ye satmak). Ödeme aşamasında da tutar yeniden ERP'ye
/// doğrulatılacak.
/// </summary>
[ApiController]
[Route("api/catalog")]
public sealed class CatalogController : ControllerBase
{
    private readonly CatalogQueries _catalog;
    private readonly SearchLogService _searchLog;
    private readonly StockAlertService _stockAlerts;
    private readonly CallbackService _callbacks;
    private readonly VisitAnalyticsService _visits;

    public CatalogController(
        CatalogQueries catalog,
        SearchLogService searchLog,
        StockAlertService stockAlerts,
        CallbackService callbacks,
        VisitAnalyticsService visits)
    {
        _catalog = catalog;
        _searchLog = searchLog;
        _stockAlerts = stockAlerts;
        _callbacks = callbacks;
        _visits = visits;
    }

    [HttpGet("products")]
    public async Task<IActionResult> List(
        [FromQuery] string? kategori,
        [FromQuery] string? ara,
        // Varsayılan sıralama FİYAT: AZALAN (2026-09-09 kullanıcı kararı).
        // Vitrindeki karşılığı `ProductListing.VARSAYILAN_SIRALAMA`; ikisi ayrışırsa
        // parametresiz istek sunucuda başka, ekranda başka sırayla görünür.
        [FromQuery] string sirala = "fiyat-azalan",
        [FromQuery] int sayfa = 1,
        [FromQuery] int adet = 24,
        [FromQuery] decimal? minFiyat = null,
        [FromQuery] decimal? maxFiyat = null,
        [FromQuery] bool stokta = false,
        [FromQuery] bool montaj = false,
        // Yalnız kampanyalı (B2B'de vitrin anahtarı açık) ürünler — "Haftanın Fırsatları" sayfası (2026-09-20).
        [FromQuery] bool kampanya = false,
        // Aramanın NEREDEN geldiği (2026-09-20). Yalnız "arama" değerini vitrindeki arama
        // kutusu gönderiyor ve yalnız o kaydediliyor: menüdeki "Ankastre Fırınlar" gibi
        // bağlantılar da `ara=firin` taşıyor, onları ziyaretçi araması saymak raporu
        // uydurma taleple doldururdu.
        [FromQuery] string? kaynak = null,
        CancellationToken cancellationToken = default)
    {
        var page = await _catalog.ListAsync(
            kategori, ara, sirala, sayfa, adet, cancellationToken,
            includeHidden: false, minPrice: minFiyat, maxPrice: maxFiyat, inStockOnly: stokta, installableOnly: montaj, campaignOnly: kampanya);

        if (string.Equals(kaynak, "arama", StringComparison.OrdinalIgnoreCase) && !string.IsNullOrWhiteSpace(ara))
        {
            // Bilerek await ediliyor (tek INSERT, ~1 ms): "unut gitsin" çağrısı, istek bitince
            // kapanan bağlantıyı kullanmaya kalkardı. Hata yutuluyor, arama sonucu etkilenmiyor.
            await _searchLog.TryRecordAsync(ara, page.TotalCount, cancellationToken);
        }

        return Ok(page);
    }

    [HttpGet("products/{slug}")]
    public async Task<IActionResult> Detail(string slug, CancellationToken cancellationToken)
    {
        var detail = await _catalog.GetBySlugAsync(slug, cancellationToken);
        if (detail is null) return NotFound(new { message = "Ürün bulunamadı." });
        return Ok(detail);
    }

    [HttpGet("categories")]
    public async Task<IActionResult> Categories(CancellationToken cancellationToken)
        => Ok(await _catalog.CategoriesAsync(cancellationToken));

    /// <summary>
    /// ERP'de tanımlı kategori adresleri — o an yayında ürünü olmasa da.
    ///
    /// Kategori sayfası bunu "böyle bir kategori var mı" sorusu için kullanıyor: yayındaki
    /// listede yoksa ama burada varsa 404 yerine "şu anda ürün yok" ekranı gösteriliyor.
    /// Menüdeki ve altbilgideki kategori bağlantıları sabit yazılı olduğu için, stok kuralı
    /// bir kategoriyi geçici olarak boşalttığında ziyaretçi kırık bağlantı görmemeli.
    /// </summary>
    /// <summary>
    /// Servis kaydı formundaki ürün seçici için arama.
    ///
    /// Vitrin aramasından AYRI: yayında olmayan (stoğu bitmiş, artık satılmayan) ürünler de
    /// dönüyor — servise gelen cihaz çoğunlukla yıllar önce alınmış oluyor. Fiyat ve stok
    /// dışarı verilmiyor.
    ///
    /// Kimlik istemiyor (form da istemiyor) ama en az iki harf şartı ve 20 satır sınırı var:
    /// tek harfle bütün katalogun dökülmesini engelliyor.
    /// </summary>
    [HttpGet("service-products")]
    public async Task<IActionResult> ServiceProducts(
        [FromQuery] string? ara, CancellationToken cancellationToken)
        => Ok(await _catalog.SearchServiceProductsAsync(ara, cancellationToken));

    [HttpGet("categories/known")]
    public async Task<IActionResult> KnownCategories(CancellationToken cancellationToken)
        => Ok(await _catalog.KnownCategorySlugsAsync(cancellationToken));

    /// <summary>
    /// Eski kategori adresi -> bayinin verdiği yeni adres (2026-09-20).
    /// Vitrin kategori sayfası bunu okuyup eski adresle geleni kalıcı olarak yenisine yolluyor.
    /// </summary>
    [HttpGet("categories/slug-redirects")]
    public async Task<IActionResult> CategorySlugRedirects(CancellationToken cancellationToken)
        => Ok(await _catalog.CategorySlugRedirectsAsync(cancellationToken));

    /// <summary>
    /// Öne çıkanlar: bayinin seçtikleri önce, eksik kalırsa en son eklenenlerle tamamlanır.
    /// Kural CatalogQueries.FeaturedAsync içinde.
    /// </summary>
    [HttpGet("featured")]
    public async Task<IActionResult> Featured([FromQuery] int adet = 8, CancellationToken cancellationToken = default)
        => Ok(await _catalog.FeaturedAsync(adet, cancellationToken));

    /// <summary>
    /// ARAMA ÖNERİSİ (2026-09-20) — üstteki arama kutusunun açılır listesi.
    ///
    /// NEDEN AYRI UÇ: liste ucu ürün başına ~20 alan döndürüyor (kampanya, stok, montaj,
    /// varyant...). Her tuş vuruşunda bunu çekmek hem ağı hem sunucuyu boşuna yorar. Burada
    /// yalnız kartta gösterilecek dört alan dönüyor.
    ///
    /// EN AZ İKİ HARF: tek harfle bütün katalogun dökülmesini engelliyor — servis ürün
    /// aramasındaki kuralın aynısı.
    /// </summary>
    [HttpGet("suggest")]
    public async Task<IActionResult> Suggest([FromQuery] string? ara, CancellationToken ct = default)
    {
        var terim = (ara ?? string.Empty).Trim();
        if (terim.Length < 2) return Ok(new { items = Array.Empty<object>(), categories = Array.Empty<object>() });

        /*
         * ADI EŞLEŞEN ÖNE ALINIR.
         *
         * Katalog araması adın yanı sıra AÇIKLAMA ve ÖZELLİKLER metnini de tarıyor (bilerek:
         * "wifi" yazan müşteri ürünü bulabilmeli). Ama açılır listede yalnız 6 satır var ve
         * "klima" yazana buzdolabı göstermek kutuyu işe yaramaz hâle getiriyordu — buzdolabının
         * açıklamasında "klima" geçtiği için geliyordu.
         *
         * Daha geniş çekip (30) adı eşleşenleri öne alıyoruz; geri kalanlar listeyi dolduruyor.
         */
        // "ilgi" sıralaması (2026-09-21): ad eşleşmesi, kelime başı, kategori, eş anlamlılar —
        // liste sayfasıyla aynı motor; öneri kutusu ile sonuç sayfası aynı sırayı gösterir.
        var genis = await _catalog.ListAsync(
            null, terim, "ilgi", 1, 30, ct,
            includeHidden: false, minPrice: null, maxPrice: null,
            inStockOnly: false, installableOnly: false, campaignOnly: false);

        var sirali = genis.Items.Take(6).ToList();

        var page = new { Items = sirali };

        // Kategori adı da eşleşebilir: "ankastre" yazan müşteri ürün değil kategori arıyordur.
        var kategoriler = (await _catalog.CategoriesAsync(ct))
            .Where(c => c.Name.Contains(terim, StringComparison.OrdinalIgnoreCase)
                     || c.Slug.Contains(Slugify.ToSlug(terim), StringComparison.OrdinalIgnoreCase))
            .Take(3)
            .Select(c => new { c.Name, c.Slug, c.ProductCount });

        return Ok(new
        {
            items = page.Items.Select(x => new
            {
                x.Name,
                x.Slug,
                x.ImageUrl,
                x.GrossPrice,
                x.Currency,
                x.InStock
            }),
            categories = kategoriler
        });
    }

    public sealed class StockAlertRequest
    {
        [System.ComponentModel.DataAnnotations.Required]
        [System.ComponentModel.DataAnnotations.StringLength(50)]
        public string StockCode { get; set; } = string.Empty;

        [System.ComponentModel.DataAnnotations.Required]
        [System.ComponentModel.DataAnnotations.StringLength(30)]
        public string Phone { get; set; } = string.Empty;
    }

    /// <summary>
    /// "Gelince haber ver" (2026-09-20). Tükenen üründe müşteri telefonunu bırakıyor.
    ///
    /// Kimlik İSTEMİYOR — bu özelliğin amacı zaten üye olmayan ziyaretçiyi kaybetmemek.
    /// Yazma kotasına bağlı: form insan hızında dolduruluyor, betik hızında değil.
    /// Ürünün GERÇEKTEN var olduğu doğrulanıyor; uydurma stok koduyla tablo şişirilemesin.
    /// </summary>
    [HttpPost("stock-alert")]
    [EnableRateLimiting(RateLimitPolicies.Write)]
    public async Task<IActionResult> StockAlert([FromBody] StockAlertRequest request, CancellationToken ct)
    {
        if (!ModelState.IsValid) return ValidationProblem(ModelState);

        var known = await _catalog.GetByStockCodesAsync(new[] { request.StockCode }, ct);
        if (known.Count == 0)
        {
            // Yayında olmayan ürün de tükenmiş olabilir; bu yüzden katalog listesi tek başına
            // yeterli değil. Ürün hiç yoksa (uydurma kod) sessizce başarılı dönüp tabloya
            // yazmıyoruz: saldırgana hangi kodun var olduğunu söylemenin bir faydası yok.
            var exists = await _catalog.StockCodeExistsAsync(request.StockCode, ct);
            if (!exists) return Ok(new { success = true, waiting = 0 });
        }

        var result = await _stockAlerts.SubscribeAsync(request.StockCode, request.Phone, null, ct);
        if (!result.Success) return BadRequest(new { message = result.Error });

        return Ok(new { success = true, waiting = result.WaitingCount });
    }

    /*
      DOĞRULAMA NİTELİĞİ BİLEREK YOK.

      `[ApiController]` model doğrulaması BAŞARISIZ olduğunda action hiç çalışmadan 400
      döndürüyor. Bu uçta bu yanlış: ölçüm hiçbir koşulda hata üretmemeli. Nitelikler
      dururken kısa bir oturum kimliği 400 alıyordu — yani "sessizce yut" sözü tutulmuyordu
      (QA betiği yakaladı).

      Uzunluk ve geçerlilik denetimi `VisitAnalyticsService.TryRecordAsync` içinde; orada
      geçersiz istek sessizce atılıyor ve tabloya çöp yazılmıyor.
    */
    public sealed class VisitRequest
    {
        public string SessionId { get; set; } = string.Empty;

        /// <summary>giris | urun | sepet | odeme | siparis</summary>
        public string Step { get; set; } = string.Empty;

        public string? Path { get; set; }
    }

    /// <summary>
    /// ZİYARET HUNİSİ ADIMI (2026-09-21).
    ///
    /// Kimlik istemiyor ve İSTEMEMELİ: ölçülmek istenen şey zaten üye OLMAYAN ziyaretçinin
    /// nerede takıldığı. Üye girişi varsa vitrin köprüsü `memberId` ekliyor.
    ///
    /// Hiçbir zaman hata döndürmüyor: ölçüm yüzünden bir sayfanın yavaşlaması ya da hata
    /// vermesi, ölçümün kendisinden çok daha pahalı olurdu.
    /// </summary>
    [HttpPost("visit")]
    [EnableRateLimiting(RateLimitPolicies.Write)]
    public async Task<IActionResult> Visit([FromBody] VisitRequest? request, CancellationToken ct)
    {
        if (request is not null)
        {
            await _visits.TryRecordAsync(request.SessionId, request.Step, null, request.Path, ct);
        }
        return Ok(new { success = true });
    }

    public sealed class CallbackRequest
    {
        [System.ComponentModel.DataAnnotations.Required]
        [System.ComponentModel.DataAnnotations.StringLength(120)]
        public string Name { get; set; } = string.Empty;

        [System.ComponentModel.DataAnnotations.Required]
        [System.ComponentModel.DataAnnotations.StringLength(30)]
        public string Phone { get; set; } = string.Empty;

        [System.ComponentModel.DataAnnotations.StringLength(50)]
        public string? StockCode { get; set; }

        [System.ComponentModel.DataAnnotations.StringLength(300)]
        public string? ProductName { get; set; }

        [System.ComponentModel.DataAnnotations.StringLength(500)]
        public string? Note { get; set; }

        /// <summary>urun | sepet | genel — panelde talebin nereden geldiğini göstermek için.</summary>
        [System.ComponentModel.DataAnnotations.StringLength(30)]
        public string? Source { get; set; }
    }

    /// <summary>
    /// "SİZİ ARAYALIM" (2026-09-21).
    ///
    /// Kimlik İSTEMİYOR ve SMS'e BAĞLI DEĞİL: amacı, mesai dışında bakan ve arayamayan
    /// ziyaretçiyi kaybetmemek. Talep yalnız panele düşüyor, dolayısıyla PostaGüvercini
    /// bilgisi girilmemiş olsa bile çalışıyor.
    ///
    /// Ürün adı İSTEMCİDEN geliyor ama yalnız panelde METİN olarak gösteriliyor; hiçbir
    /// fiyat/stok kararı buna dayanmıyor. Stok kodu varsa doğruluğu panelde ürüne bakılarak
    /// görülür — burada doğrulamak, olmayan kod yüzünden gerçek bir talebi reddetmek olurdu.
    /// </summary>
    [HttpPost("callback")]
    [EnableRateLimiting(RateLimitPolicies.Write)]
    public async Task<IActionResult> Callback([FromBody] CallbackRequest request, CancellationToken ct)
    {
        if (!ModelState.IsValid) return ValidationProblem(ModelState);

        var result = await _callbacks.CreateAsync(
            request.Name, request.Phone, request.StockCode, request.ProductName,
            request.Note, request.Source, null, ct);

        if (!result.Success) return BadRequest(new { message = result.Error });
        return Ok(new { success = true });
    }

    /// <summary>
    /// Çok satanlar — gerçek sipariş verisinden (2026-09-21).
    /// "Öne çıkanlar" bayinin seçtikleri; bu liste neyin gerçekten satıldığını gösteriyor.
    /// </summary>
    [HttpGet("best-sellers")]
    public async Task<IActionResult> BestSellers(
        [FromQuery] int adet = 8,
        [FromQuery] int gun = 90,
        CancellationToken ct = default)
        => Ok(await _catalog.BestSellersAsync(adet, gun, ct));

    /// <summary>Arama motorlarının tarayacağı adres listesi.</summary>
    [HttpGet("slugs")]
    public async Task<IActionResult> Slugs(CancellationToken cancellationToken)
        => Ok(await _catalog.AllProductSlugsAsync(cancellationToken));
}
