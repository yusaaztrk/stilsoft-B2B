using System.ComponentModel.DataAnnotations;
using B2B.Erp.Api.Entities;

namespace B2B.Erp.Api.Dtos.Employees;

public sealed class EmployeeMealPlanListItemResponse
{
    public int Id { get; set; }
    public int EmployeeId { get; set; }
    public DateTime PlannedDate { get; set; }
    public decimal Amount { get; set; }
    public string? Description { get; set; }
    public EmployeeMealPlanStatus Status { get; set; }
    public int? PaidPaymentId { get; set; }
    public string CreateUser { get; set; } = string.Empty;
    public DateTime CreateTime { get; set; }
}

public sealed class CreateEmployeeMealPlanRequest
{
    [Required]
    public int EmployeeId { get; set; }

    [Required]
    public DateTime PlannedDate { get; set; }

    [Range(0.01, 999999999)]
    public decimal Amount { get; set; }

    [StringLength(2000)]
    public string? Description { get; set; }
}

public sealed class UpdateEmployeeMealPlanStatusRequest
{
    [Required]
    public EmployeeMealPlanStatus Status { get; set; }
}

public sealed class BulkPlannedMealPaymentRequest
{
    [Required]
    public List<int> EmployeeIds { get; set; } = new();

    [StringLength(2000)]
    public string? Description { get; set; }

    public int? BankAccountDefinitionId { get; set; }
    public int? CashAccountId { get; set; }
}
