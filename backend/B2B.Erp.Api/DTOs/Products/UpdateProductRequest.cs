using System.ComponentModel.DataAnnotations;

namespace B2B.Erp.Api.Dtos.Products;

public sealed class UpdateProductRequest
{
    [Required]
    [StringLength(50)]
    public string StockCode { get; set; } = null!;

    [Required]
    [StringLength(200)]
    public string Name { get; set; } = null!;

    [StringLength(2000)]
    public string? Description { get; set; }

    /// <summary>Vitrin (e-ticaret) adı; boşsa ürün adı kullanılır.</summary>
    public string? DisplayName { get; set; }

    [StringLength(50)]
    public string? Barcode { get; set; }

    public Guid? MainCategoryId { get; set; }

    public Guid? CategoryId { get; set; }

    public string? GroupCode { get; set; }

    public string? SubGroupCode { get; set; }

    [Required]
    [StringLength(20)]
    public string Unit { get; set; } = null!;

    [Range(0, 100, ErrorMessage = "KDV oranı 0 ile 100 arasında olmalıdır.")]
    public int TaxRate { get; set; }

    [Range(0d, 100d, ErrorMessage = "İskonto oranı 0 ile 100 arasında olmalıdır.")]
    public decimal DiscountRate { get; set; }

    public int? SupplierId { get; set; }

    [Range(0, int.MaxValue, ErrorMessage = "Kutudaki adet negatif olamaz.")]
    public int BoxQuantity { get; set; }

    [Range(0d, double.MaxValue, ErrorMessage = "Alış fiyatı negatif olamaz.")]
    public decimal PurchasePrice { get; set; }

    [Required]
    [StringLength(1)]
    public string BsyVisibleFlag { get; set; } = "E";

    [Range(0, int.MaxValue, ErrorMessage = "Konteynır adet negatif olamaz.")]
    public int ContainerQuantity { get; set; }

    [Range(0d, double.MaxValue, ErrorMessage = "Navlun negatif olamaz.")]
    public decimal Freight { get; set; }

    public int CurrencyCode { get; set; }

    /// <summary>Satış para birimi. 1=TRY 2=EUR 3=USD 4=GBP.</summary>
    public int SalesCurrencyCode { get; set; }

    public bool IsOfficial { get; set; }

    [Range(0, int.MaxValue, ErrorMessage = "Stok adedi negatif olamaz.")]
    public int Stock { get; set; }

    [Range(0, int.MaxValue, ErrorMessage = "Minimum stok negatif olamaz.")]
    public int MinStock { get; set; }

    /// <summary>Satışa kapanma eşiği (stok bunun altına düşünce ürün bayide kapanır).</summary>
    [Range(0, int.MaxValue, ErrorMessage = "Satışa kapanma eşiği negatif olamaz.")]
    public int BsyMinStock { get; set; } = 12;

    public bool IsActive { get; set; } = true;

    [StringLength(500)]
    public string? ImageUrl { get; set; }

    public List<string>? ImageUrls { get; set; }

    [StringLength(500)]
    public string? VideoUrl { get; set; }

    public List<string>? VideoUrls { get; set; }

    public bool IsInstallable { get; set; } = false;

    [Range(0d, double.MaxValue, ErrorMessage = "Montaj ücreti negatif olamaz.")]
    public decimal? InstallationFee { get; set; }

    [StringLength(200)]
    public string? Kod4 { get; set; }

    [StringLength(200)]
    public string? Kod5 { get; set; }

    [StringLength(50)]
    public string? ProductType { get; set; }
}
