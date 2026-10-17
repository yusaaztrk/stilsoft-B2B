namespace B2B.Erp.Api.Entities;

public enum SupplierLedgerEntryDirection
{
    Debit = 1,
    Credit = 2
}

public enum SupplierLedgerEntryReferenceType
{
    Manual = 1,
    Invoice = 2,
    BankTransaction = 3,
    CashTransaction = 4
}

public sealed class SupplierLedgerEntry : AuditableEntity
{
    public int Id { get; set; }

    public string SupplierCode { get; set; } = string.Empty;
    public Supplier Supplier { get; set; } = null!;

    public DateTime Date { get; set; }

    public DateTime? DueDate { get; set; }

    public SupplierLedgerEntryDirection Direction { get; set; }

    public decimal Amount { get; set; }

    public int CurrencyTypeId { get; set; }

    public decimal CurrencyRate { get; set; }

    public decimal CurrencyAmount { get; set; }

    public string? DocumentNo { get; set; }

    public string? Description { get; set; }

    public string? TransactionType { get; set; }

    public SupplierLedgerEntryReferenceType ReferenceType { get; set; }

    public int? ReferenceId { get; set; }
}
