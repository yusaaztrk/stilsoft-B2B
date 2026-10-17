namespace B2B.Erp.Api.Entities;

public enum EmployeePaymentType
{
    Salary = 1,
    Bonus = 2,
    CashAdvance = 3,
    Meal = 4
}

public sealed class EmployeePayment : AuditableEntity
{
    public int Id { get; set; }

    public int EmployeeId { get; set; }

    public EmployeePaymentType Type { get; set; }

    public decimal Amount { get; set; }

    public DateTime PaymentDate { get; set; }

    public string? Description { get; set; }

    public bool DeductFromSalary { get; set; }

    public DateTime? SalaryDeductedAt { get; set; }

    public int? BankAccountDefinitionId { get; set; }

    public int? CashAccountId { get; set; }

    public Employee? Employee { get; set; }
}
