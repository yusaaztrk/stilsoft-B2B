using System.ComponentModel.DataAnnotations;

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
}

public sealed class EmployeeLeaveListItemResponse
{
    public int Id { get; set; }
    public int EmployeeId { get; set; }
    public DateTime LeaveStartTime { get; set; }
    public DateTime ReturnTime { get; set; }
    public string? Description { get; set; }
    public string? CreateUser { get; set; }
    public DateTime CreateTime { get; set; }
}
