using System.ComponentModel.DataAnnotations;
using B2B.Erp.Api.Entities;

namespace B2B.Erp.Api.Dtos.CustomerOffers;

public sealed class UpdateCustomerOfferRequest
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

    [Required]
    [MinLength(1)]
    public List<UpdateCustomerOfferLineRequest> Lines { get; set; } = new();
}

public sealed class UpdateCustomerOfferLineRequest
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
