using System.ComponentModel.DataAnnotations;
using B2B.Erp.Api.Entities;

namespace B2B.Erp.Api.Dtos.Employees;

public sealed class CreateEmployeeLeaveRequest
{
    [Required]
    public int EmployeeId { get; set; }

    [Required]
    public DateTime LeaveStartTime { get; set; }

    [Required]
    public DateTime ReturnTime { get; set; }

    [StringLength(2000)]
    public string? Description { get; set; }

    /// <summary>Boş bırakılırsa yıllık izin sayılır.</summary>
    public EmployeeLeaveType? LeaveType { get; set; }

    /// <summary>İK ekranından girilen izin doğrudan onaylı açılır; talep akışı için Pending gönderilir.</summary>
    public EmployeeLeaveStatus? Status { get; set; }

    /// <summary>Boş bırakılırsa ücretsiz izin dışındaki türler ücretli sayılır.</summary>
    public bool? IsPaid { get; set; }
}

public sealed class EmployeeLeaveListItemResponse
{
    public int Id { get; set; }
    public int EmployeeId { get; set; }
    public DateTime LeaveStartTime { get; set; }
    public DateTime ReturnTime { get; set; }
    public string? Description { get; set; }
    public EmployeeLeaveType LeaveType { get; set; }
    public EmployeeLeaveStatus Status { get; set; }
    public bool IsPaid { get; set; }
    public decimal DayCount { get; set; }
    public string? DecidedBy { get; set; }
    public DateTime? DecidedAt { get; set; }
    public string? RejectReason { get; set; }
    public string? CreateUser { get; set; }
    public DateTime CreateTime { get; set; }
}
