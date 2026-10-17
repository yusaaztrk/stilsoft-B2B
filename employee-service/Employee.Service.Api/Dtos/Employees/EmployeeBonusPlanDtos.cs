using B2B.Erp.Api.Core.Services;
using System.ComponentModel.DataAnnotations;
using B2B.Erp.Api.Entities;

namespace B2B.Erp.Api.Dtos.Employees;

public sealed class EmployeeBonusPlanListItemResponse
{
    public int Id { get; set; }
    public int EmployeeId { get; set; }
    public DateTime PlannedDate { get; set; }
    public decimal Amount { get; set; }
    public string? Description { get; set; }
    public int? BankAccountDefinitionId { get; set; }
    public int? CashAccountId { get; set; }
    public EmployeeBonusPlanStatus Status { get; set; }
    public int? PaidPaymentId { get; set; }
    public string CreateUser { get; set; } = string.Empty;
    public DateTime CreateTime { get; set; }
}

public sealed class CreateEmployeeBonusPlanRequest
{
    [Required]
    public int EmployeeId { get; set; }

    [Required]
    public DateTime PlannedDate { get; set; }

    [Range(0.01, 999999999)]
    public decimal Amount { get; set; }

    [StringLength(2000)]
    public string? Description { get; set; }

    public int? BankAccountDefinitionId { get; set; }

    public int? CashAccountId { get; set; }
}

public sealed class UpdateEmployeeBonusPlanStatusRequest
{
    [Required]
    public EmployeeBonusPlanStatus Status { get; set; }
}

public sealed class BulkPlannedBonusPaymentRequest
{
    /// <summary>B2B kasa/banka kaynağı (2026-09-27). Doluysa seçilen hesaba tek "Personel Ödemesi" satırı yazılır.</summary>
    public ErpPaymentSource? ErpSource { get; set; }

    [Required]
    public List<int> EmployeeIds { get; set; } = new();

    [StringLength(2000)]
    public string? Description { get; set; }

    public int? BankAccountDefinitionId { get; set; }

    public int? CashAccountId { get; set; }
}
