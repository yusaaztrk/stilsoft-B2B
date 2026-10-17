namespace B2B.Erp.Api.Entities;

public sealed class MuhtelifCustomer : AuditableEntity
{
    public int Id { get; set; }

    public string? OwnerCustomerCode { get; set; }

    public string CustomerCode { get; set; } = string.Empty;

    public string Name { get; set; } = string.Empty;

    public string? City { get; set; }

    public string? District { get; set; }

    public string? Address { get; set; }

    public string? Phone { get; set; }

    public string? Email { get; set; }

    public string? TaxOffice { get; set; }

    public string? TaxNumber { get; set; }
}
