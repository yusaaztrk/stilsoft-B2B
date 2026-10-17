namespace B2B.Erp.Api.Entities;

public sealed class EmployeeLeave : AuditableEntity
{
    public int Id { get; set; }

    public int EmployeeId { get; set; }

    public DateTime LeaveStartTime { get; set; }

    public DateTime ReturnTime { get; set; }

    public string? Description { get; set; }

    public Employee? Employee { get; set; }
}
