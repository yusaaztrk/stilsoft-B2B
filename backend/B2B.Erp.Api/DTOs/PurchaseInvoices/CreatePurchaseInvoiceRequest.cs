using System.ComponentModel.DataAnnotations;
using B2B.Erp.Api.Entities;

namespace B2B.Erp.Api.Dtos.PurchaseInvoices;

public sealed class CreatePurchaseInvoiceRequest
{
    public DateTime? Date { get; set; }

    [Required(ErrorMessage = "Belge No zorunludur.")]
    [StringLength(15, ErrorMessage = "Belge No en fazla 15 karakter olabilir.")]
    public string? DocumentNo { get; set; }

    public PurchaseInvoiceKind Kind { get; set; }

    public bool VatExempt { get; set; }

    /// <summary>
    /// Belgenin para birimi (1 TL, 2 EUR, 3 USD, 4 GBP). Boş bırakılırsa sunucu eski
    /// davranışa düşer ve ürün kartından tahmin eder — bkz. ResolvePurchaseInvoiceCurrencyAsync.
    /// </summary>
    public int? CurrencyTypeId { get; set; }

    /// <summary>Belgenin kuru. Boş ise günün TCMB kuru alınır.</summary>
    public decimal? ExchangeRate { get; set; }

    /// <summary>Kur elle mi girildi: "TCMB" ya da "Manuel".</summary>
    public string? RateSource { get; set; }

    [StringLength(50)]
    public string? SupplierCode { get; set; }

    [StringLength(50)]
    public string? ServiceCode { get; set; }

    [StringLength(50)]
    public string? CustomerCode { get; set; }

    [StringLength(50)]
    public string? SalesmanCode { get; set; }

    [StringLength(2000)]
    public string? Description { get; set; }

    public int? CashAccountId { get; set; }

    [Required]
    [MinLength(1)]
    public List<CreatePurchaseInvoiceLineRequest> Lines { get; set; } = new();
}

public sealed class CreatePurchaseInvoiceLineRequest
{
    public Guid? ProductId { get; set; }

    /// <summary>
    /// HİZMET KATALOĞU KODU — yalnızca "Hizmet Ekle" ile eklenen satırlarda dolar
    /// (HIZ-NAKLIYE, HIZ-ELEKTRİK…). Bu kodların <c>Products</c> tablosunda karşılığı
    /// olmadığı için <see cref="ProductId"/> boş gelir.
    ///
    /// <para>
    /// Sunucu bu değeri OLDUĞU GİBİ kabul etmez: hizmet kataloğunda gerçekten var mı diye
    /// bakar. Aksi hâlde uydurma bir kod göndererek ürün kartı denetimi atlatılabilirdi.
    /// Ürünlü satırlarda gönderilse bile yok sayılır, stok kodu karttan okunur.
    /// </para>
    /// </summary>
    [StringLength(50)]
    public string? StockCode { get; set; }

    [StringLength(2000)]
    public string? Description { get; set; }

    public int? WarehouseCode { get; set; }

    [Range(0.001, double.MaxValue)]
    public decimal Quantity { get; set; }

    [Range(0, double.MaxValue)]
    public decimal UnitPrice { get; set; }

    /// <summary>
    /// Kullanıcının BELGE PARA BİRİMİNDE girdiği fiyat. <see cref="UnitPrice"/> bunun TL
    /// karşılığıdır; TL belgede ikisi aynıdır.
    /// </summary>
    public decimal? CurrencyUnitPrice { get; set; }

    [Range(0, double.MaxValue)]
    public decimal VatRate { get; set; }

    public PurchaseInvoiceLineDiscountType DiscountType { get; set; }

    [Range(0, double.MaxValue)]
    public decimal DiscountValue { get; set; }

    public PurchaseInvoiceLineDeliveryStatus? DeliveryStatus { get; set; }

    [StringLength(100)]
    public string? DeliveryTeam { get; set; }

    public DateTime? DeliveryDispatchDate { get; set; }

    public DateTime? DeliveryCompletedDate { get; set; }
}
