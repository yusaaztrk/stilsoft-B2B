using B2B.Erp.Api.Entities;

namespace B2B.Erp.Api.Dtos.Customers;

public sealed class CustomerResponse
{
    public string CustomerCode { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;

    public string? Address { get; set; }
    public string? City { get; set; }
    public string? District { get; set; }
    public string? Phone { get; set; }
    public string? Fax { get; set; }
    public string? Email { get; set; }

    public string? TaxOffice { get; set; }
    public string? TaxNumber { get; set; }
    public string? IdentityNumber { get; set; }

    public string CustomerType { get; set; } = string.Empty;
    public string InvoiceType { get; set; } = string.Empty;

    public string AccountRole { get; set; } = "NORMAL";
    public string? MainCustomerCode { get; set; }
    public string? InvoiceAccountCustomerCode { get; set; }
    public int? InvoiceAccountPriceGroupCode { get; set; }

    public string? ProductCategory { get; set; }

    public CategoryAccessMode CategoryAccessMode { get; set; } = CategoryAccessMode.All;

    public List<Guid> ProductCategoryIds { get; set; } = new();

    public bool IsActive { get; set; }

    public Guid? PriceGroupId { get; set; }

    public int? PriceGroupCode { get; set; }

    public double DiscountRate { get; set; }

    public string? SalesmanCode { get; set; }

    /// <summary>TL kredi limiti.</summary>
    public decimal CreditLimit { get; set; }

    /// <summary>Para birimi başına ayrı limitler (2026-08-19); çevrim yapılmaz.</summary>
    public decimal CreditLimitUsd { get; set; }

    public decimal CreditLimitEur { get; set; }

    public decimal CreditLimitGbp { get; set; }

    public string? ParentCustomerCode { get; set; }

    public int CurrencyTypeId { get; set; }
}
