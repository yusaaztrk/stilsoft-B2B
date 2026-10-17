namespace B2B.Erp.Api.Entities;

/// <summary>İzin türü. Yıllık izin bakiyesinden yalnızca <see cref="Annual"/> düşülür.</summary>
public enum EmployeeLeaveType
{
    Annual = 1,
    Excuse = 2,
    Unpaid = 3,
    Sick = 4,
    Maternity = 5,
    Marriage = 6,
    Bereavement = 7,
    Other = 99
}

/// <summary>İzin onay durumu. Personelin kendi talebi <see cref="Pending"/> olarak açılır.</summary>
public enum EmployeeLeaveStatus
{
    Pending = 1,
    Approved = 2,
    Rejected = 3,
    Cancelled = 4
}

public sealed class EmployeeLeave : AuditableEntity
{
    public int Id { get; set; }

    public int EmployeeId { get; set; }

    public DateTime LeaveStartTime { get; set; }

    public DateTime ReturnTime { get; set; }

    public string? Description { get; set; }

    public EmployeeLeaveType LeaveType { get; set; } = EmployeeLeaveType.Annual;

    /// <summary>
    /// Varsayılan <see cref="EmployeeLeaveStatus.Approved"/>: İK ekranından girilen izin zaten
    /// onaylanmış sayılır. Mevcut kayıtlar da bu değerle uyumlu olsun diye şema varsayılanı 2.
    /// </summary>
    public EmployeeLeaveStatus Status { get; set; } = EmployeeLeaveStatus.Approved;

    /// <summary>Ücretli izin mi? Ücretsiz izin hakedişten düşülür.</summary>
    public bool IsPaid { get; set; } = true;

    /// <summary>
    /// İzne sayılan iş günü sayısı. Kaydedilirken iş günü tanımı ve resmî tatil takvimine
    /// göre hesaplanır; hafta tatili ve resmî tatiller izinden düşülmez.
    /// </summary>
    public decimal DayCount { get; set; }

    public string? DecidedBy { get; set; }

    public DateTime? DecidedAt { get; set; }

    public string? RejectReason { get; set; }

    public Employee? Employee { get; set; }
}
