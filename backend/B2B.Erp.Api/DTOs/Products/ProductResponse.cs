namespace B2B.Erp.Api.Dtos.Products;

public sealed class ProductResponse
{
    public Guid Id { get; init; }

    public DateTimeOffset CreatedAt { get; init; }

    public string StockCode { get; init; } = null!;

    public string Name { get; init; } = null!;

    public string? Description { get; init; }

    public string? Barcode { get; init; }

    public string BarcodeType { get; init; } = "CODE128";

    public string? Kod4 { get; init; }

    public string? Kod5 { get; init; }

    public string Unit { get; init; } = null!;

    public int TaxRate { get; init; }

    public decimal DiscountRate { get; init; }

    public int? SupplierId { get; init; }

    public int BoxQuantity { get; init; }

    public decimal PurchasePrice { get; init; }

    public string BsyVisibleFlag { get; init; } = "E";

    public int ContainerQuantity { get; init; }

    public decimal Freight { get; init; }

    public int CurrencyCode { get; init; }

    /// <summary>Satış para birimi. 1=TRY 2=EUR 3=USD 4=GBP.</summary>
    public int SalesCurrencyCode { get; init; }

    public bool IsOfficial { get; init; }

    public int Stock { get; init; }

    public int MinStock { get; init; }

    /// <summary>Satışa kapanma eşiği (stok bunun altına düşünce ürün bayide kapanır).</summary>
    public int BsyMinStock { get; init; }

    public bool IsActive { get; init; }

    public string? ImageUrl { get; init; }

    public List<string>? ImageUrls { get; init; }

    public string? VideoUrl { get; init; }

    public List<string>? VideoUrls { get; init; }

    public bool IsInstallable { get; init; }

    public decimal? InstallationFee { get; init; }

    public string? ProductType { get; init; }
}
