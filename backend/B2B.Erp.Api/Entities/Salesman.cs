namespace B2B.Erp.Api.Entities;

public sealed class Salesman : AuditableEntity
{
    public string SalesmanCode { get; set; } = string.Empty;
    public string Description { get; set; } = string.Empty;
    public string? CustomerCode { get; set; }
}
