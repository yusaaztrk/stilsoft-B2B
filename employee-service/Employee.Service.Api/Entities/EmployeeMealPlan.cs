namespace B2B.Erp.Api.Entities;

public enum EmployeeMealPlanStatus
{
    Planned = 1,
    Paid = 2,
    Cancelled = 3
}

public sealed class EmployeeMealPlan : AuditableEntity
{
    public int Id { get; set; }

    public int EmployeeId { get; set; }

    public DateTime PlannedDate { get; set; }

    public decimal Amount { get; set; }

    public string? Description { get; set; }

    public EmployeeMealPlanStatus Status { get; set; } = EmployeeMealPlanStatus.Planned;

    public int? PaidPaymentId { get; set; }

    public Employee? Employee { get; set; }

    public EmployeePayment? PaidPayment { get; set; }
}
