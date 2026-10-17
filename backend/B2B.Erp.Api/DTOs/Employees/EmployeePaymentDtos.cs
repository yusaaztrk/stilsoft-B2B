using System.ComponentModel.DataAnnotations;
using B2B.Erp.Api.Entities;

namespace B2B.Erp.Api.Dtos.Employees;

public sealed class EmployeePaymentListItemResponse
{
    public int Id { get; set; }
    public int EmployeeId { get; set; }
    public EmployeePaymentType Type { get; set; }
    public decimal Amount { get; set; }
    public DateTime PaymentDate { get; set; }
    public string? Description { get; set; }
    public bool DeductFromSalary { get; set; }
    public DateTime? SalaryDeductedAt { get; set; }
    public string CreateUser { get; set; } = string.Empty;
    public DateTime CreateTime { get; set; }
}

public sealed class CreateEmployeePaymentRequest
{
    [Required]
    public int EmployeeId { get; set; }

    [Required]
    public EmployeePaymentType Type { get; set; }

    [Range(0.01, 999999999)]
    public decimal Amount { get; set; }

    public DateTime? PaymentDate { get; set; }

    public bool DeductFromSalary { get; set; }

    [StringLength(2000)]
    public string? Description { get; set; }

    public int? BankAccountDefinitionId { get; set; }

    public int? CashAccountId { get; set; }
}

public sealed class CreateEmployeePaymentResponse
{
    public int Id { get; set; }
}

public sealed class BulkSalaryPaymentRequest
{
    [Required]
    public List<int> EmployeeIds { get; set; } = new();

    public DateTime? PaymentDate { get; set; }

    [StringLength(2000)]
    public string? Description { get; set; }

    public int? BankAccountDefinitionId { get; set; }

    public int? CashAccountId { get; set; }
}

public sealed class BulkMealPaymentRequest
{
    [Required]
    public List<int> EmployeeIds { get; set; } = new();

    public DateTime? PaymentDate { get; set; }

    [StringLength(2000)]
    public string? Description { get; set; }

    public int? BankAccountDefinitionId { get; set; }

    public int? CashAccountId { get; set; }
}
