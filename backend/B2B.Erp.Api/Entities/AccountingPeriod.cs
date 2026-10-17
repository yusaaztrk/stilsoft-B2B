namespace B2B.Erp.Api.Entities;

public enum AccountingPeriodStatus
{
    Draft = 1,
    Open = 2,
    Closing = 3,
    Closed = 4,
    Reopened = 5
}

public sealed class AccountingPeriod : AuditableEntity
{
    public int Id { get; set; }
    public string Code { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public int FiscalYear { get; set; }
    public DateTime StartDate { get; set; }
    public DateTime EndDate { get; set; }

    public AccountingPeriodStatus Status { get; set; } = AccountingPeriodStatus.Open;
    public bool IsActive { get; set; } = true;
    public bool IsClosed { get; set; } = false;

    public DateTime? ClosedAt { get; set; }
    public string? ClosedByUserId { get; set; }

    public DateTime? ReopenedAt { get; set; }
    public string? ReopenedByUserId { get; set; }

    public byte[]? RowVersion { get; set; }
}
