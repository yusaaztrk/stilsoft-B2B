using System.ComponentModel.DataAnnotations;
using B2B.Erp.Api.Entities;

namespace B2B.Erp.Api.Dtos.Customers;

public sealed class CreateCustomerRequest
{
    [StringLength(50)]
    public string? CustomerCode { get; set; }

    [Required]
    [StringLength(255)]
    public string Name { get; set; } = null!;

    [StringLength(500)]
    public string? Address { get; set; }

    [StringLength(100)]
    public string? City { get; set; }

    [StringLength(100)]
    public string? District { get; set; }

    [StringLength(50)]
    [RegularExpression(B2B.Erp.Api.Core.Helpers.PhoneFormat.Pattern, ErrorMessage = B2B.Erp.Api.Core.Helpers.PhoneFormat.Message)]
    public string? Phone { get; set; }

    [StringLength(50)]
    public string? Fax { get; set; }

    [EmailAddress]
    [StringLength(255)]
    public string? Email { get; set; }

    [StringLength(100)]
    public string? TaxOffice { get; set; }

    [StringLength(50)]
    public string? TaxNumber { get; set; }

    [StringLength(50)]
    [RegularExpression(@"^\d{11}$", ErrorMessage = "TC Kimlik No 11 haneli olmalıdır.")]
    public string? IdentityNumber { get; set; }

    [Required]
    [StringLength(50)]
    public string CustomerType { get; set; } = null!;

    [Required]
    [StringLength(50)]
    public string InvoiceType { get; set; } = null!;

    [StringLength(200)]
    public string? ProductCategory { get; set; }

    public CategoryAccessMode CategoryAccessMode { get; set; } = CategoryAccessMode.All;

    public List<Guid>? ProductCategoryIds { get; set; }

    public bool IsActive { get; set; } = true;

    public Guid? PriceGroupId { get; set; }

    public double DiscountRate { get; set; }

    [StringLength(50)]
    public string? SalesmanCode { get; set; }

    [Range(0, double.MaxValue)]
    public decimal CreditLimit { get; set; }

    /// <summary>
    /// Para birimi başına AYRI limit (2026-08-19). Dolarlı belge yalnızca USD limitine yürür;
    /// kurla TL'ye çevrilmez. Yukarıdaki <see cref="CreditLimit"/> TL limitidir.
    /// </summary>
    [Range(0, double.MaxValue)]
    public decimal CreditLimitUsd { get; set; }

    [Range(0, double.MaxValue)]
    public decimal CreditLimitEur { get; set; }

    [Range(0, double.MaxValue)]
    public decimal CreditLimitGbp { get; set; }

    [StringLength(50)]
    public string? ParentCustomerCode { get; set; }

    [Range(1, 4)]
    public int CurrencyTypeId { get; set; }

    public decimal? InitialBalance { get; set; }
}
