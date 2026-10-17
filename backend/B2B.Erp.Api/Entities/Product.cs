namespace B2B.Erp.Api.Entities;

public class Product
{
    public Guid Id { get; set; } = Guid.NewGuid();

    public DateTimeOffset CreatedAt { get; set; }

    public string StockCode { get; set; } = null!;

    public string Name { get; set; } = null!;

    public string? Description { get; set; }

    /// <summary>
    /// VİTRİN ADI (2026-09-20). Ürün adı teknik ("ST-24UW4RKTCE00 - 24 BTU INVERTER KLİMA WIFI");
    /// müşteri aradığını bulamıyor, Google'da çıkmıyor. Doluysa vitrin bu adı gösterir (başlık,
    /// URL, arama), model kodu alt satıra iner. Boşsa vitrin ürün adını kullanır. B2B ekranları
    /// ürün adını kullanmaya devam eder; bu alan yalnız e-ticaret içindir.
    /// </summary>
    public string? DisplayName { get; set; }

    public string? Barcode { get; set; }

    /// <summary>
    /// Barkod formatı: "EAN13" veya "CODE128". Barkod kaydedilirken otomatik belirlenir.
    /// </summary>
    public string BarcodeType { get; set; } = "CODE128";

    public Guid? MainCategoryId { get; set; }

    public ProductCategory? MainCategory { get; set; }

    public Guid? CategoryId { get; set; }

    public ProductCategory? Category { get; set; }

    public string ProductType { get; set; } = "URUN";

    public string? Kod4 { get; set; }

    public string? Kod5 { get; set; }

    public string Unit { get; set; } = null!;

    public int TaxRate { get; set; }

    public decimal DiscountRate { get; set; }

    public int? SupplierId { get; set; }

    public Supplier? Supplier { get; set; }

    public int BoxQuantity { get; set; }

    public decimal PurchasePrice { get; set; }

    public string BsyVisibleFlag { get; set; } = "E";

    /// <summary>
    /// Stok bu sayının ALTINA düşünce ürün bayi tarafında otomatik satışa kapanır; stok yeniden
    /// eşiğe çıkınca kendiliğinden açılır (durum karta YAZILMAZ, okuma anında hesaplanır).
    /// Eşik eskiden kodda sabit 12'ydi, artık ürün başına ayarlanabiliyor; varsayılan yine 12.
    ///
    /// <see cref="MinStock"/> İLE KARIŞTIRILMAMALI: o, satın alma için stok alarmıdır
    /// ("bitmek üzere" uyarısı) ve satışı kapatmakla ilgisi yoktur.
    /// </summary>
    public int BsyMinStock { get; set; } = 12;

    public int ContainerQuantity { get; set; }

    public decimal Freight { get; set; }

    /// <summary>Ürünün ALIŞ para birimi. 1=TRY 2=EUR 3=USD 4=GBP (0 = TL, eski varsayılan).</summary>
    public int CurrencyCode { get; set; }

    /// <summary>
    /// Ürünün SATIŞ para birimi. Alış dövizinden BAĞIMSIZDIR — "dolarla al, TL sat" en yaygın hâl.
    /// Fiyat satırları (<c>ProductPrices.Currency</c>) bu değere göre yazılır; öncesinde toplu
    /// fiyat ekranı her yeni satıra sabit "TRY" yazıyordu ve ürünü dövizle satmanın arayüzden
    /// bir yolu yoktu.
    /// </summary>
    public int SalesCurrencyCode { get; set; } = 1;

    public bool IsOfficial { get; set; }

    public int Stock { get; set; }

    /// <summary>Stok alarmı: satın alma için "bitmek üzere" eşiği. Satışı KAPATMAZ.</summary>
    public int MinStock { get; set; }

    public bool IsActive { get; set; } = true;

    public string? ImageUrl { get; set; }

    public string? ImageUrlsJson { get; set; }

    public string? VideoUrl { get; set; }

    public string? VideoUrlsJson { get; set; }

    public bool IsInstallable { get; set; } = true;

    public decimal? InstallationFee { get; set; } = 0m;

    public ICollection<ProductPrice> ProductPrices { get; set; } = new List<ProductPrice>();
}
