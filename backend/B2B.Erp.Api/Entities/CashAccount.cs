namespace B2B.Erp.Api.Entities;

public sealed class CashAccount : AuditableEntity
{
    public int Id { get; set; }
    public string Code { get; set; } = string.Empty;
    public string? Name { get; set; }

    public DateTime LastCarryDate { get; set; }
    public double LastCarryAmount { get; set; }
    public int CurrencyTypeId { get; set; }
}
