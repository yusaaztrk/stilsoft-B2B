namespace B2B.Erp.Api.Entities;

public sealed class CashAccountTransfer : AuditableEntity
{
    public int Id { get; set; }

    public int SourceCashAccountId { get; set; }
    public CashAccount SourceCashAccount { get; set; } = null!;

    public int TargetCashAccountId { get; set; }
    public CashAccount TargetCashAccount { get; set; } = null!;

    public DateTime Date { get; set; }

    public decimal Amount { get; set; }

    public int CurrencyTypeId { get; set; }

    public string? Description { get; set; }
}
