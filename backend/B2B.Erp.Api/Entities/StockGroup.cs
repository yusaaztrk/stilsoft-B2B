namespace B2B.Erp.Api.Entities;

public sealed class StockGroup : AuditableEntity
{
    public int Id { get; set; }

    public string GroupCode { get; set; } = string.Empty;
    public string GroupType { get; set; } = string.Empty;
    public string? Description { get; set; }

    public bool B2BOrder { get; set; }
}
