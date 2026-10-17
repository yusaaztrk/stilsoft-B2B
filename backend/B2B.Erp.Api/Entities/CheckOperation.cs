namespace B2B.Erp.Api.Entities;

public enum CheckDocumentType
{
    CustomerCheck = 1,
    PayableCheck = 2,
    PayableNote = 3
}

public enum CheckOperationType
{
    Create = 1,
    EndorseToBankAsGuarantee = 2,
    EndorseToBankForCollection = 3,
    EndorseToCustomer = 4,
    Collect = 5,
    Return = 6,
    Dishonor = 7
}

public sealed class CheckOperation : AuditableEntity
{
    public int Id { get; set; }

    public CheckDocumentType DocumentType { get; set; }

    public int DocumentId { get; set; }

    public DateTime Date { get; set; }

    public CheckOperationType Type { get; set; }

    public decimal Amount { get; set; }

    public int CurrencyTypeId { get; set; }

    public int? BankAccountDefinitionId { get; set; }
    public BankAccountDefinition? BankAccountDefinition { get; set; }

    public string? TargetCustomerCode { get; set; }
    public Customer? TargetCustomer { get; set; }

    public string? Description { get; set; }
}
