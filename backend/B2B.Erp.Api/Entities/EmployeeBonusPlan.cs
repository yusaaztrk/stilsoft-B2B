namespace B2B.Erp.Api.Entities;

public enum EmployeeBonusPlanStatus
{
    Planned = 1,
    Paid = 2,
    Cancelled = 3
}

public sealed class EmployeeBonusPlan : AuditableEntity
{
    public int Id { get; set; }

    public int EmployeeId { get; set; }

    public DateTime PlannedDate { get; set; }

    public decimal Amount { get; set; }

    public string? Description { get; set; }

    public EmployeeBonusPlanStatus Status { get; set; } = EmployeeBonusPlanStatus.Planned;

    public int? PaidPaymentId { get; set; }

    public Employee? Employee { get; set; }

    public EmployeePayment? PaidPayment { get; set; }
}
