namespace B2B.Erp.Api.Entities;

public sealed class Customer : AuditableEntity
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

    public string AccountRole { get; set; } = CustomerAccountRole.Normal;
    public string? MainCustomerCode { get; set; }
    public Customer? MainCustomer { get; set; }
    public Customer? InvoiceAccount { get; set; }

    public string? ProductCategory { get; set; }

    public CategoryAccessMode CategoryAccessMode { get; set; } = CategoryAccessMode.All;

    public ICollection<CustomerProductCategory> CustomerProductCategories { get; set; } = new List<CustomerProductCategory>();

    public bool IsActive { get; set; } = true;

    public Guid? PriceGroupId { get; set; }
    public PriceGroup? PriceGroupEntity { get; set; }

    public double DiscountRate { get; set; }

    public string? SalesmanCode { get; set; }

    /// <summary>
    /// TL kredi limiti. Para birimi başına AYRI limit tutulur (2026-08-19, kullanıcı kuralı):
    /// dövizli bir belge kendi para biriminin limitine yürür, TL'ye çevrilmez. Çevirmek aynı
    /// dolar borcunu kur değiştikçe farklı limit tüketir hâle getiriyordu.
    /// </summary>
    public decimal CreditLimit { get; set; }

    /// <summary>USD kredi limiti (dolarlı belgeler yalnızca buna yürür).</summary>
    public decimal CreditLimitUsd { get; set; }

    /// <summary>EUR kredi limiti.</summary>
    public decimal CreditLimitEur { get; set; }

    /// <summary>GBP kredi limiti.</summary>
    public decimal CreditLimitGbp { get; set; }

    public string? ParentCustomerCode { get; set; }
    public Customer? ParentCustomer { get; set; }
    public ICollection<Customer> ChildCustomers { get; set; } = new List<Customer>();

    public int CurrencyTypeId { get; set; }
}
