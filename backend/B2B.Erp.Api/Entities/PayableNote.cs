namespace B2B.Erp.Api.Entities;

public enum PayableNoteStatus
{
    Issued = 1,
    EndorsedToBank = 2,
    Paid = 3,
    Returned = 4,
    Dishonored = 5,
    Cancelled = 6
}

public sealed class PayableNote : AuditableEntity
{
    public int Id { get; set; }

    public string ScNo { get; set; } = string.Empty;

    public string DocumentNo { get; set; } = string.Empty;

    public string? CustomerCode { get; set; }
    public Customer? Customer { get; set; }

    public int? SupplierId { get; set; }
    public Supplier? Supplier { get; set; }

    public DateTime IssueDate { get; set; }

    public DateTime DueDate { get; set; }

    public decimal Amount { get; set; }

    public int CurrencyTypeId { get; set; }

    public string? NoteNo { get; set; }

    public PayableNoteStatus Status { get; set; } = PayableNoteStatus.Issued;

    public int? BankAccountDefinitionId { get; set; }
    public BankAccountDefinition? BankAccountDefinition { get; set; }
}
