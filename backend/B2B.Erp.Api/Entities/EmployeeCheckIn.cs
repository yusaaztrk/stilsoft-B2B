namespace B2B.Erp.Api.Entities;

public sealed class EmployeeCheckIn : AuditableEntity
{
    public int Id { get; set; }

    public int EmployeeId { get; set; }

    public Employee? Employee { get; set; }

    public DateTime CheckInTime { get; set; }

    public DateTime? CheckOutTime { get; set; }

    public decimal Latitude { get; set; }

    public decimal Longitude { get; set; }

    public decimal CheckOutLatitude { get; set; }

    public decimal CheckOutLongitude { get; set; }

    public string? City { get; set; }

    public string? District { get; set; }
}
