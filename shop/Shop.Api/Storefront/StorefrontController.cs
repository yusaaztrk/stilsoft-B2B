using System.Security.Claims;
using Microsoft.AspNetCore.Mvc;
using Shop.Api.Admin;
using Shop.Api.Catalog;

namespace Shop.Api.Storefront;

/// <summary>
/// Vitrin içeriği: vitrinin okuduğu uç herkese açık, bayinin yazdığı uçlar bayi oturumu ister.
/// </summary>
[ApiController]
[Route("api")]
public sealed class StorefrontController : ControllerBase
{
    private readonly StorefrontStore _store;
    private readonly StorefrontMediaStore _media;
    private readonly CatalogQueries _catalog;

    public StorefrontController(StorefrontStore store, StorefrontMediaStore media, CatalogQueries catalog)
    {
        _store = store;
        _media = media;
        _catalog = catalog;
    }

    private string CurrentUser =>
        (HttpContext.Items[B2BAdminAuthAttribute.PrincipalItemKey] as ClaimsPrincipal)?
            .FindFirst(ClaimTypes.Name)?.Value ?? "bayi";

    // ---------- vitrinin okuduğu ----------

    [HttpGet("storefront")]
    public async Task<IActionResult> Get(CancellationToken ct)
        => Ok(await _store.GetAsync(ct));

    [HttpGet("storefront/media/{fileName}")]
    public async Task<IActionResult> Media(string fileName, CancellationToken ct)
    {
        var file = await _media.GetAsync(fileName, ct);
        if (file is null) return NotFound();

        Response.Headers.CacheControl = "public, max-age=604800";
        return File(file.Value.Bytes, file.Value.ContentType);
    }

    // ---------- bayinin yönettiği ----------

    [HttpPut("admin/storefront")]
    [B2BAdminAuth]
    public async Task<IActionResult> Save([FromBody] StorefrontSettings settings, CancellationToken ct)
    {
        if (settings is null) return BadRequest(new { message = "İçerik boş olamaz." });

        await _store.SaveAsync(settings, CurrentUser, ct);
        return Ok(new { success = true });
    }

    [HttpPost("admin/storefront/media")]
    [B2BAdminAuth]
    [RequestSizeLimit(StorefrontMediaStore.MaxBytes + 1024)]
    public async Task<IActionResult> Upload(IFormFile file, CancellationToken ct)
    {
        if (file is null || file.Length == 0)
        {
            return BadRequest(new { message = "Dosya seçilmedi." });
        }

        if (file.Length > StorefrontMediaStore.MaxBytes)
        {
            return BadRequest(new { message = "Görsel en fazla 4 MB olabilir." });
        }

        // Tip kontrolü beyaz listeyle: gelen adı ya da uzantıyı temel almak, sunucuda
        // çalıştırılabilir bir dosya bırakmanın klasik yoludur.
        if (!StorefrontMediaStore.IsAllowed(file.ContentType))
        {
            return BadRequest(new { message = "Yalnızca webp, jpg veya png yükleyebilirsiniz." });
        }

        await using var stream = new MemoryStream();
        await file.CopyToAsync(stream, ct);

        var fileName = await _media.SaveAsync(stream.ToArray(), file.ContentType, CurrentUser, ct);

        return Ok(new { fileName, url = $"/api/storefront/media/{fileName}" });
    }

    [HttpGet("admin/storefront/media")]
    [B2BAdminAuth]
    public async Task<IActionResult> ListMedia(CancellationToken ct)
    {
        var files = await _media.ListAsync(ct);
        return Ok(files.Select(f => new { fileName = f, url = $"/api/storefront/media/{f}" }));
    }

    /// <summary>Yayın kuralına uyan ürünler + hangilerinin kapatıldığı ve öne çıkarıldığı.</summary>
    [HttpGet("admin/products")]
    [B2BAdminAuth]
    public async Task<IActionResult> Products([FromQuery] string? ara, CancellationToken ct)
    {
        /*
         * PANEL BÜTÜN KATALOĞU GÖRÜR — iki ayrı hata birden kapatıldı (2026-09-08).
         *
         * 1) Liste 96 üründe kesiliyordu. Canlıda 245 yayında ürün var; alfabetik olarak
         *    96'dan sonra gelen hiçbir ürün panelde görünmüyor, dolayısıyla vitrine
         *    kapatılamıyordu da. Arama kutusu vardı ama kullanıcının ürünü listede
         *    görememesi zaten "özellik yok" demek.
         *
         * 2) `includeHidden` verilmiyordu ve varsayılanı false. Yani bayi bir ürünü
         *    kapattığı anda o ürün listeden DE kayboluyordu — bir daha açmanın yolu yoktu.
         *    Aşağıdaki `isHidden` alanı da bu yüzden hiçbir zaman true olamıyordu.
         *
         * Sayfalama, süzme ve sıralama tarayıcıda (ortak tablo bileşeni) yapılıyor; uç
         * tamamını tek seferde veriyor.
         */
        var page = await _catalog.ListAsync(
            null, ara, "ad", 1, 5000, ct, includeHidden: true, maxPageSize: 5000);
        var hidden = await _store.HiddenStockCodesAsync(ct);
        var settings = await _store.GetAsync(ct);

        // Sıra numarası panelde gösteriliyor: bayi anasayfadaki diziliminin ne olacağını
        // işaretlerken görmeli, kaydedip vitrine bakarak öğrenmemeli.
        var featuredOrder = settings.FeaturedStockCodes
            .Select((code, index) => (code, index))
            .ToDictionary(x => x.code, x => x.index + 1, StringComparer.OrdinalIgnoreCase);

        var hiddenSet = new HashSet<string>(hidden, StringComparer.OrdinalIgnoreCase);
        var alwaysSet = new HashSet<string>(
            settings.AlwaysPublishStockCodes ?? new List<string>(), StringComparer.OrdinalIgnoreCase);

        /*
         * PANEL ARTIK "NEDEN YAYINDA DEĞİL" SORUSUNU CEVAPLIYOR.
         *
         * Önceki hâlde satırda yalnızca bir açık/kapalı anahtarı vardı. Ürün vitrinde
         * görünmüyorsa bayinin elinde hiçbir bilgi yoktu: stoğu mu bitti, kartında satışa
         * kapalı mı, yoksa biri panelden mi kapattı — üçü de aynı görünüyordu. Karar tek
         * yerde (CatalogQueries.ResolveBlock) veriliyor ve sebep buradan ekrana taşınıyor.
         *
         * Stok ve eşik de gönderiliyor: "kritik stok" demek yetmez, bayi kaç kaldığını ve
         * eşiğin kaç olduğunu görmeden ne yapacağına karar veremez.
         */
        var rows = page.Items.Select(x =>
        {
            var block = CatalogQueries.ResolveBlock(x, settings, hiddenSet, alwaysSet);

            return new
            {
                x.StockCode,
                x.Name,
                // Vitrindeki adres. Panelden "Vitrinde gör" bağlantısı bununla kuruluyor;
                // adresi tarayıcıda yeniden türetmek, ad kurallarını iki yerde tutmak olurdu.
                x.Slug,
                x.CategoryName,
                x.GrossPrice,
                x.Currency,
                x.ImageUrl,
                x.IsInstallable,
                x.InstallationFee,

                stock = x.ActualStock,
                criticalThreshold = x.AutoCloseThreshold,
                markedOpenToSale = x.MarkedOpenToSale,

                isHidden = hiddenSet.Contains(x.StockCode),
                alwaysPublish = alwaysSet.Contains(x.StockCode),
                isPublished = block == CatalogQueries.PublishBlock.None,
                blockReason = block.ToString(),
                blockLabel = CatalogQueries.BlockLabel(block),

                featuredOrder = featuredOrder.TryGetValue(x.StockCode, out var order) ? order : (int?)null
            };
        }).ToList();

        return Ok(new
        {
            totalCount = page.TotalCount,
            publishedCount = rows.Count(x => x.isPublished),
            criticalCount = rows.Count(x => x.blockReason == nameof(CatalogQueries.PublishBlock.CriticalStock)),
            outOfStockCount = rows.Count(x => x.blockReason == nameof(CatalogQueries.PublishBlock.OutOfStock)),
            closedCount = rows.Count(x => x.blockReason == nameof(CatalogQueries.PublishBlock.ClosedToSale)),
            hiddenCount = rows.Count(x => x.blockReason == nameof(CatalogQueries.PublishBlock.Hidden)),

            featuredCount = settings.FeaturedCount,
            // Seçili adet ayardan okunuyor, listeden sayılarak değil: liste aramayla süzülüyor
            // ve süzülmüş listede saymak "3 ürün seçili" gibi yanlış bir sayı verirdi.
            featuredSelected = settings.FeaturedStockCodes.Count,

            // Kuralların o anki hâli: panel "kritik stok kuralı kapalıyken" farklı bir metin
            // yazıyor, yoksa kapalı bir kuralın rozetleri kullanıcıyı yanıltır.
            rules = new
            {
                settings.HideOutOfStock,
                settings.StopPublishingBelowCriticalStock,
                settings.HideClosedToSale,
                settings.AllowOutOfStockOrders,
                defaultThreshold = CatalogQueries.DefaultAutoCloseThreshold
            },

            items = rows
        });
    }

    public sealed class VisibilityRequest
    {
        public bool Hidden { get; set; }
    }

    [HttpPut("admin/products/{stockCode}/visibility")]
    [B2BAdminAuth]
    public async Task<IActionResult> SetVisibility(string stockCode, [FromBody] VisibilityRequest request, CancellationToken ct)
    {
        await _store.SetProductHiddenAsync(stockCode, request.Hidden, CurrentUser, ct);
        return Ok(new { success = true });
    }

    public sealed class FeaturedRequest
    {
        public bool Featured { get; set; }
    }

    /// <summary>
    /// Ürünü anasayfadaki öne çıkanlara ekler/çıkarır.
    ///
    /// Ayarların tamamını kaydeden uçtan (PUT admin/storefront) ayrı duruyor: ürün listesi
    /// ayrı bir sekme ve orada tek bir işaret için bütün vitrin ayarlarını geri göndermek,
    /// aynı anda vitrin metnini düzenleyen ikinci bir kullanıcının değişikliğini ezerdi.
    /// </summary>
    [HttpPut("admin/products/{stockCode}/featured")]
    [B2BAdminAuth]
    public async Task<IActionResult> SetFeatured(string stockCode, [FromBody] FeaturedRequest request, CancellationToken ct)
    {
        try
        {
            await _store.SetProductFeaturedAsync(stockCode, request.Featured, CurrentUser, ct);
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { message = ex.Message });
        }

        return Ok(new { success = true });
    }

    /// <summary>
    /// Yönetim için kategori listesi: ERP'deki HAM adlar + bayinin verdiği vitrin ayarı.
    ///
    /// Vitrin ucundan (`/api/catalog/categories`) ayrı olmak zorunda — o uç gizlenenleri
    /// eliyor, dolayısıyla panel onu kullansaydı bir kategori gizlendiği anda panelden de
    /// kaybolur ve geri açılamazdı.
    /// </summary>
    [HttpGet("admin/categories")]
    [B2BAdminAuth]
    public async Task<IActionResult> AdminCategories(CancellationToken ct)
    {
        var all = await _catalog.AllCategoriesAsync(ct);
        var settings = await _store.GetAsync(ct);
        var overrides = settings.CategoryOverrides ?? new Dictionary<string, CategoryOverride>();

        return Ok(all.Select(c =>
        {
            overrides.TryGetValue(c.Slug, out var rule);
            return new
            {
                c.Slug,
                erpName = c.Name,
                c.ProductCount,
                c.ImageUrl,
                displayName = rule?.DisplayName ?? string.Empty,
                hidden = rule?.Hidden ?? false,
                sortOrder = rule?.SortOrder ?? 0
            };
        }));
    }

    public sealed class AlwaysPublishRequest
    {
        public bool AlwaysPublish { get; set; }
    }

    /// <summary>
    /// "Kritik stokta da yayında kalsın" işareti.
    ///
    /// Kritik stok kuralı bilinçli olarak SERT: stok satışa kapanma eşiğinin altına düşen ürün
    /// vitrinden kalkıyor. Ama bayinin elinde tek tek istisna tanıma imkânı olmalı — tedariki
    /// yolda olan ya da zaten tek satılan bir ürün için kuralın tamamını kapatmak, bütün
    /// katalog için kapatmak demekti.
    ///
    /// İşaret stoğu SIFIR olan ürünü yayına döndürmez; satılamayan malı vitrinde tutmak
    /// kuralın kendisini anlamsız kılardı.
    /// </summary>
    [HttpPut("admin/products/{stockCode}/always-publish")]
    [B2BAdminAuth]
    public async Task<IActionResult> SetAlwaysPublish(
        string stockCode, [FromBody] AlwaysPublishRequest request, CancellationToken ct)
    {
        await _store.SetProductAlwaysPublishAsync(stockCode, request.AlwaysPublish, CurrentUser, ct);
        return Ok(new { success = true });
    }

    public sealed class BulkProductRequest
    {
        public List<string> StockCodes { get; set; } = new();

        /// <summary>yayindanKaldir · yayinaAl · oneCikar · oneCikarmaKaldir · kritikMuaf · kritikMuafKaldir</summary>
        public string Action { get; set; } = string.Empty;
    }

    /// <summary>
    /// Seçili ürünlere toplu işlem.
    ///
    /// NEDEN GEREKLİ: panelde her işlem tek tek ve satır satır yapılıyordu. 245 ürünlük
    /// katalogda "şu kategoriyi tamamen kapat" demek 40 tıklama demekti; bayi bunu yapmak
    /// yerine hiç yapmıyordu. Süzme tarayıcıda olduğu için seçim de orada yapılıyor, buraya
    /// yalnızca stok kodları geliyor.
    ///
    /// KISMİ BAŞARI RAPORLANIR: öne çıkarma sınıra takılabiliyor (en fazla 24). Toplu istek
    /// ilk hatada durmuyor; kaç tanesinin uygulandığı ve neden durduğu geri veriliyor —
    /// "işlem tamamlandı" deyip yarısını yapmamak, sessiz yanlış davranışın ta kendisi.
    /// </summary>
    [HttpPost("admin/products/bulk")]
    [B2BAdminAuth]
    public async Task<IActionResult> BulkProducts([FromBody] BulkProductRequest request, CancellationToken ct)
    {
        var codes = (request.StockCodes ?? new List<string>())
            .Select(x => (x ?? string.Empty).Trim())
            .Where(x => x.Length > 0)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .Take(1000)
            .ToList();

        if (codes.Count == 0) return BadRequest(new { message = "Ürün seçilmedi." });

        var applied = 0;
        string? stoppedBecause = null;

        foreach (var code in codes)
        {
            try
            {
                switch (request.Action)
                {
                    case "yayindanKaldir":
                        await _store.SetProductHiddenAsync(code, true, CurrentUser, ct);
                        break;
                    case "yayinaAl":
                        await _store.SetProductHiddenAsync(code, false, CurrentUser, ct);
                        break;
                    case "oneCikar":
                        await _store.SetProductFeaturedAsync(code, true, CurrentUser, ct);
                        break;
                    case "oneCikarmaKaldir":
                        await _store.SetProductFeaturedAsync(code, false, CurrentUser, ct);
                        break;
                    case "kritikMuaf":
                        await _store.SetProductAlwaysPublishAsync(code, true, CurrentUser, ct);
                        break;
                    case "kritikMuafKaldir":
                        await _store.SetProductAlwaysPublishAsync(code, false, CurrentUser, ct);
                        break;
                    default:
                        return BadRequest(new { message = $"Bilinmeyen işlem: {request.Action}" });
                }

                applied++;
            }
            catch (InvalidOperationException ex)
            {
                stoppedBecause = ex.Message;
                break;
            }
        }

        return Ok(new
        {
            success = stoppedBecause is null,
            applied,
            total = codes.Count,
            message = stoppedBecause
        });
    }

    /// <summary>Bayi panelindeki özet kutuları.</summary>
    [HttpGet("admin/summary")]
    [B2BAdminAuth]
    public async Task<IActionResult> Summary(CancellationToken ct)
    {
        var page = await _catalog.ListAsync(null, null, "ad", 1, 1, ct);
        var hidden = await _store.HiddenStockCodesAsync(ct);
        var categories = await _catalog.CategoriesAsync(ct);

        return Ok(new
        {
            publishedProducts = page.TotalCount,
            hiddenProducts = hidden.Count,
            categories = categories.Count
        });
    }
}
