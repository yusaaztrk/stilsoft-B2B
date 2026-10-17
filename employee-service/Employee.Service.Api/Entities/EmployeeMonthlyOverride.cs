namespace B2B.Erp.Api.Entities;

public enum MonthlyOverrideType
{
    Salary = 1,
    Meal = 2
}

public sealed class EmployeeMonthlyOverride : AuditableEntity
{
    public int Id { get; set; }

    public int EmployeeId { get; set; }

    /// <summary>Dönem "yyyy-MM" (örn. "2026-08")</summary>
    public string Period { get; set; } = string.Empty;

    public MonthlyOverrideType OverrideType { get; set; }

    public decimal OriginalAmount { get; set; }

    public decimal OverrideAmount { get; set; }

    public string? Description { get; set; }

    public Employee? Employee { get; set; }
}
