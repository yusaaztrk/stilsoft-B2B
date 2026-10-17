using System;

namespace ServiceOps.Domain.Entities;

public class WorkLog
{
    public Guid Id { get; set; } = Guid.NewGuid();
    
    // Relations
    public Guid TechnicianId { get; set; }
    public Technician Technician { get; set; } = null!;
    
    public Guid? WorkOrderId { get; set; }
    public WorkOrder? WorkOrder { get; set; }
    
    public Guid? ServiceId { get; set; }
    public ServiceRecord? Service { get; set; }
    
    // Time
    public DateTime StartTime { get; set; }
    public DateTime? EndTime { get; set; }
    public TimeSpan? Duration { get; set; }
    
    // Activity
    public WorkActivityType ActivityType { get; set; } = WorkActivityType.Work;
    public string? Description { get; set; }
    public string? Notes { get; set; }
    
    // Location (for field work)
    public double? StartLatitude { get; set; }
    public double? StartLongitude { get; set; }
    public double? EndLatitude { get; set; }
    public double? EndLongitude { get; set; }
    
    // Status
    public bool IsBillable { get; set; } = true;
    public decimal? HourlyRate { get; set; }
    public decimal? TotalCost { get; set; }
    
    // Meta
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

public enum WorkActivityType
{
    Work = 0,
    Travel = 1,
    Break = 2,
    Training = 3,
    Meeting = 4,
    Admin = 5
}
