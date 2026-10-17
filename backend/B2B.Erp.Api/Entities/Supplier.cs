namespace B2B.Erp.Api.Entities;

public sealed class Supplier : AuditableEntity
{
    public int Id { get; set; }

    public string SupplierCode { get; set; } = string.Empty;

    public string FullName { get; set; } = string.Empty;

    public string? PhoneNumber { get; set; }

    public string? Region { get; set; }

    public string? Address { get; set; }
}
