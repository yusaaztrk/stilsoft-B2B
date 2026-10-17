using System.ComponentModel.DataAnnotations;
using B2B.Erp.Api.Entities;

namespace B2B.Erp.Api.Dtos.CustomerOffers;

public sealed class CreateCustomerOfferRequest
{
    public DateTime? Date { get; set; }

    public bool VatExempt { get; set; }

    [StringLength(50)]
    public string? CustomerCode { get; set; }

    [StringLength(50)]
    public string? DeliveryCustomerCode { get; set; }

    public CreateMuhtelifCustomerRequest? Muhtelif { get; set; }

    [StringLength(50)]
    public string? SalesmanCode { get; set; }

    [StringLength(2000)]
    public string? Description { get; set; }

    /// <summary>
    /// ARTIK OKUNMUYOR (2026-08-19). Teklifin para birimi kalemlerden, kalemin para birimi de
    /// ürünün satış dövizinden gelir; ekrandaki seçici kaldırıldı. Alan yalnızca eski istemciler
    /// 400 almasın diye duruyor — gönderilen değer yok sayılır.
    /// </summary>
    public int? CurrencyTypeId { get; set; }

    /// <summary>
    /// Kopyalanan teklif. Muhtelifse kopya aynı muhtelif müşteriye bağlanır, yeni kayıt/cari açılmaz.
    /// </summary>
    public int? CopyFromOfferId { get; set; }

    [Required]
    [MinLength(1)]
    public List<CreateCustomerOfferLineRequest> Lines { get; set; } = new();
}

public sealed class CreateMuhtelifCustomerRequest
{
    [Required]
    [StringLength(50)]
    public string CustomerCode { get; set; } = string.Empty;

    [Required]
    [StringLength(255)]
    public string Name { get; set; } = string.Empty;

    [StringLength(100)]
    public string? City { get; set; }

    [StringLength(100)]
    public string? District { get; set; }

    [StringLength(500)]
    public string? Address { get; set; }

    [StringLength(50)]
    public string? Phone { get; set; }

    [EmailAddress]
    [StringLength(255)]
    public string? Email { get; set; }

    [StringLength(100)]
    public string? TaxOffice { get; set; }

    [StringLength(50)]
    public string? TaxNumber { get; set; }
}

public sealed class CreateCustomerOfferLineRequest
{
    [Required]
    public Guid ProductId { get; set; }

    [Range(0.001, double.MaxValue)]
    public decimal Quantity { get; set; }

    public CustomerOfferLineDiscountType DiscountType { get; set; }

    [Range(0, double.MaxValue)]
    public decimal DiscountValue { get; set; }

    /// <summary>
    /// Optional unit price override. If null, the product's default price is used.
    /// </summary>
    [Range(0, double.MaxValue)]
    public decimal? UnitPrice { get; set; }

    /// <summary>Kampanya satırıysa kampanya adı; kaydedilir, düzenlemede satır kilitli gelir.</summary>
    public string? CampaignName { get; set; }
}
