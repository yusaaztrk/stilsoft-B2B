using System.Text.Json.Serialization;

namespace Shop.Api.Catalog;

/// <summary>Vitrin listesinde bir ürün.</summary>
public class CatalogItem
{
    public string StockCode { get; init; } = string.Empty;
    public string Slug { get; init; } = string.Empty;
    public string Name { get; init; } = string.Empty;
    public string? CategoryName { get; init; }
    public string? CategorySlug { get; init; }
    public string? ImageUrl { get; init; }

    /// <summary>KDV hariç birim fiyat — ERP'de tutulan hâli (kampanya varsa indirimli).</summary>
    public decimal NetPrice { get; set; }

    /// <summary>Vitrinde gösterilen KDV dahil fiyat (kampanya varsa indirimli).</summary>
    public decimal GrossPrice { get; set; }

    /*
      KAMPANYA (2026-09-19): B2B'de açılıp e-ticaret anahtarı açılmış ürün/kategori indirimi.
      Dolu ise kartta `OriginalGrossPrice` üstü çizili, `GrossPrice` yeni fiyat. Sepet ve sipariş
      `NetPrice`/`GrossPrice`'ı kullandığı için indirim onlara kendiliğinden geçer.
      Hesap: shop/Shop.Api/Catalog/CampaignPricing.cs.
    */
    /// <summary>Kampanyasız KDV dahil fiyat; kampanya yoksa null.</summary>
    public decimal? OriginalGrossPrice { get; set; }
    public string? CampaignName { get; set; }
    /// <summary>Oran kampanyasında yüzde; tutar kampanyasında null.</summary>
    public decimal? CampaignPercent { get; set; }
    /// <summary>KDV dahil birim indirim.</summary>
    public decimal? CampaignDiscountGross { get; set; }

    /*
      RENK SEÇENEKLERİ (2026-09-20). ERP'de her renk ayrı stok kodu; vitrinde aynı ürün iki
      ayrı kart olarak duruyordu. Gruplama listeden SONRA yapıldığı için bu alanlar init-only
      değil (kampanya alanlarındaki gibi). Hesap: VariantGrouping.
    */
    /// <summary>Aynı ürünün renkleri bu anahtarda toplanır; gruplanmayan üründe null.</summary>
    public string? VariantGroupKey { get; set; }

    /// <summary>Bu ürünün rengi ("Siyah", "Inox & Çelik"). Gruplanmayan üründe null.</summary>
    public string? VariantLabel { get; set; }

    /// <summary>Gruptaki toplam renk sayısı — kart "3 renk" yazabilsin diye. Tekil üründe 0.</summary>
    public int VariantCount { get; set; }

    public int TaxRate { get; init; }
    public string Currency { get; init; } = "TRY";
    public bool InStock { get; init; }

    /// <summary>
    /// Kalan adet — <c>StorefrontSettings.ShowStockQuantity</c> KAPALIYKEN null.
    ///
    /// `init` değil `set`: sayı sorgudan her zaman okunuyor (sipariş kapısı ona bakıyor),
    /// vitrine çıkıp çıkmayacağına ise okuma bittikten sonra tek yerde karar veriliyor
    /// (<c>CatalogQueries.ApplyStockVisibility</c>). Ayar kapalıysa alan API yanıtından da
    /// düşer; gizlemek ile hiç göndermemek arasındaki fark, tarayıcıya sızıp sızmamasıdır.
    /// </summary>
    public int? StockQuantity { get; set; }

    /// <summary>
    /// <see cref="StockQuantity"/> tavana takıldı mı. True ise vitrin sayıyı "12+" biçiminde
    /// yazar — gerçek adet daha yüksek olabilir ve bilerek verilmiyor.
    /// </summary>
    public bool StockCapped { get; set; }

    public bool IsInstallable { get; init; }
    public decimal? InstallationFee { get; init; }

    // ---- Yayın kuralının okuduğu ham ERP alanları -------------------------------------
    //
    // Üçü de [JsonIgnore]: yalnızca "bu ürün vitrine çıkar mı" kararını vermek ve BAYİ
    // PANELİNDE sebebini yazmak için var. Tarayıcıya gitmemeleri şart — gerçek stok adedi
    // ayrıca kırpılıyor (StorefrontSettings.StockDisplayCap), bu alanlardan sızarsa o
    // kırpma anlamsız kalır.

    /// <summary>
    /// ERP'deki gerçek stok adedi — kırpılmamış, gizlenmemiş hâli. Panel bunu gösteriyor;
    /// <see cref="StockQuantity"/> ise ziyaretçiye giden (tavana çekilmiş) sayıdır.
    /// </summary>
    [JsonIgnore]
    public int ActualStock { get; init; }

    /// <summary>
    /// Ürün kartındaki "Satışa Açık" işareti (<c>Products.BsyVisibleFlag &lt;&gt; 'H'</c>).
    /// AKTİF/PASİF ile karıştırılmamalı: pasif ürün zaten katalog sorgusuna hiç girmiyor.
    /// </summary>
    [JsonIgnore]
    public bool MarkedOpenToSale { get; init; } = true;

    /// <summary>
    /// Satışa kapanma eşiği (<c>Products.BsyMinStock</c>). Girilmemişse 12, 0 ise eşik yok.
    /// B2B tarafındaki <c>resolveAutoCloseThreshold</c> ile aynı kural.
    /// </summary>
    [JsonIgnore]
    public int AutoCloseThreshold { get; init; } = 12;
}

/// <summary>Ürün detay sayfası.</summary>
public sealed class CatalogDetail : CatalogItem
{
    public string? Description { get; init; }
    public IReadOnlyList<string> Features { get; init; } = Array.Empty<string>();
    public IReadOnlyList<string> Images { get; init; } = Array.Empty<string>();
    public string? Barcode { get; init; }
    public string? Unit { get; init; }

    /// <summary>
    /// Aynı ürünün diğer renkleri (2026-09-20). Bu ürün de listede — seçili olanı vitrin
    /// kendi stok koduyla işaretliyor. Renk seçeneği yoksa liste boş.
    /// </summary>
    public IReadOnlyList<VariantOption> Variants { get; set; } = Array.Empty<VariantOption>();
}

/// <summary>Ürün sayfasındaki renk seçeneği. Sepete giden yine kendi stok kodu.</summary>
public sealed class VariantOption
{
    public string StockCode { get; init; } = string.Empty;
    public string Slug { get; init; } = string.Empty;
    /// <summary>"Siyah", "Inox" gibi.</summary>
    public string Label { get; init; } = string.Empty;
    public string? ImageUrl { get; init; }
    public decimal GrossPrice { get; init; }
    public bool InStock { get; init; }
}

public sealed class CatalogCategory
{
    public string Slug { get; init; } = string.Empty;
    public string Name { get; init; } = string.Empty;
    public int ProductCount { get; init; }

    /// <summary>Kategori kutusunda gösterilen temsili ürün görseli.</summary>
    public string? ImageUrl { get; init; }
}

public sealed class CatalogPage
{
    public IReadOnlyList<CatalogItem> Items { get; init; } = Array.Empty<CatalogItem>();
    public int TotalCount { get; init; }
    public int Page { get; init; }
    public int PageSize { get; init; }

    /// <summary>
    /// Fiyat süzgeci UYGULANMADAN ÖNCEKİ en düşük/en yüksek KDV dahil fiyat.
    /// Süzgeç kutularına ne yazılacağı buradan gösteriliyor; boş bir aralık kutusu kullanıcıyı
    /// tahmine zorluyor. Süzgeçten SONRAKİ aralık verilseydi, kullanıcı bir kez süzdükten
    /// sonra sınırlar daralır ve geri genişletemezdi.
    /// </summary>
    public decimal MinPrice { get; init; }
    public decimal MaxPrice { get; init; }
}
