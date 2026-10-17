using System.ComponentModel.DataAnnotations;
using B2B.Erp.Api.Entities;

namespace B2B.Erp.Api.Dtos.CariOffers;

public sealed class CreateCariOfferRequest
{
    public DateTime? Date { get; set; }

    public bool VatExempt { get; set; }

    [StringLength(50)]
    public string? CustomerCode { get; set; }

    [StringLength(50)]
    public string? DeliveryCustomerCode { get; set; }

    public CreateBayiMuhtelifCustomerRequest? Muhtelif { get; set; }

    [StringLength(50)]
    public string? SalesmanCode { get; set; }

    [StringLength(2000)]
    public string? Description { get; set; }

    /// <summary>
    /// Teklifin para birimi (1=TRY, 2=EUR, 3=USD, 4=GBP).
    /// </summary>
    public int? CurrencyTypeId { get; set; }

    [Required]
    [MinLength(1)]
    public List<CreateCariOfferLineRequest> Lines { get; set; } = new();
}

public sealed class CreateBayiMuhtelifCustomerRequest
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

public sealed class CreateCariOfferLineRequest
{
    [Required]
    public Guid ProductId { get; set; }

    [Range(0.001, double.MaxValue)]
    public decimal Quantity { get; set; }

    public CustomerOfferLineDiscountType DiscountType { get; set; }

    [Range(0, double.MaxValue)]
    public decimal DiscountValue { get; set; }

    [Range(0, double.MaxValue)]
    public decimal? UnitPrice { get; set; }
}
