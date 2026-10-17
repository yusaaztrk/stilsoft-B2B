namespace B2B.Erp.Api.Entities;

public sealed class CustomerAuthorizedContact : AuditableEntity
{
    public string CustomerCode { get; set; } = string.Empty;

    public Customer? Customer { get; set; }

    public string FullName { get; set; } = string.Empty;

    public string? Phone { get; set; }
}
