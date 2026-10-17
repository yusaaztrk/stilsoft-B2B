namespace B2B.Erp.Api.Entities;

public sealed class EmployeeAccrualSnapshot : AuditableEntity
{
    public int Id { get; set; }

    public int EmployeeId { get; set; }

    /// <summary>Dönem "yyyy-MM" (örn. "2026-08")</summary>
    public string Period { get; set; } = string.Empty;

    /// <summary>Snapshot'ın dahil ettiği son takvim günü (örn. "2026-08-17")</summary>
    public string LastCalculatedDate { get; set; } = string.Empty;

    /// <summary>Hesaplamanın fiilen yapıldığı zaman damgası (UTC)</summary>
    public DateTime LastCalculatedAt { get; set; }

    public decimal MonthlySalary { get; set; }

    public decimal DailyWage { get; set; }

    public decimal GrossAccrual { get; set; }

    public decimal MealAccrual { get; set; }

    public int AttendedDays { get; set; }

    public int WorkedMinutes { get; set; }

    public int MissingMinutes { get; set; }

    public int OvertimeMinutes { get; set; }

    public decimal AbsenceDeduction { get; set; }

    public decimal OvertimePay { get; set; }

    public decimal ShiftPremium { get; set; }

    public decimal DeductibleAdvances { get; set; }

    public decimal AlreadyPaid { get; set; }

    public decimal NetPayable { get; set; }

    /// <summary>Günün anlık mesaisini de içerip içermediği</summary>
    public bool IsLive { get; set; }

    public Employee? Employee { get; set; }
}
