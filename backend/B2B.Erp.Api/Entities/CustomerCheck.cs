namespace B2B.Erp.Api.Entities;

public enum CustomerCheckEndorsementType
{
    Original = 1,
    Endorsed = 2
}

public enum CustomerCheckStatus
{
    Portfolio = 1,
    EndorsedToBankAsGuarantee = 2,
    EndorsedToBankForCollection = 3,
    EndorsedToCustomer = 4,
    Collected = 5,
    Returned = 6,
    Dishonored = 7
}

public enum CustomerCheckPaymentStatus
{
    Pending = 1,
    Paid = 2
}

public sealed class CustomerCheck : AuditableEntity
{
    public int Id { get; set; }

    public string? ABordroNo { get; set; }

    public string? VBordroNo { get; set; }

    public string DocumentNo { get; set; } = string.Empty;

    public string CustomerCode { get; set; } = string.Empty;
    public Customer Customer { get; set; } = null!;

    public DateTime IssueDate { get; set; }

    public DateTime DueDate { get; set; }

    public decimal Amount { get; set; }

    public int CurrencyTypeId { get; set; }

    public CustomerCheckEndorsementType EndorsementType { get; set; } = CustomerCheckEndorsementType.Original;

    public string? BankName { get; set; }

    public string? BranchName { get; set; }

    public string? DistrictName { get; set; }

    public string? CheckNo { get; set; }

    public string? OriginalDebtorName { get; set; }

    public string? OriginalIdentityNo { get; set; }

    public string? OriginalTaxNo { get; set; }

    public CustomerCheckPaymentStatus PaymentStatus { get; set; } = CustomerCheckPaymentStatus.Pending;

    public CustomerCheckStatus Status { get; set; } = CustomerCheckStatus.Portfolio;

    public int? CurrentBankAccountDefinitionId { get; set; }
    public BankAccountDefinition? CurrentBankAccountDefinition { get; set; }

    public string? CurrentCustomerCode { get; set; }
    public Customer? CurrentCustomer { get; set; }
}
