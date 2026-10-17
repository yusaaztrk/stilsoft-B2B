using System;
using System.Collections.Generic;

namespace ServiceOps.Domain.Entities;

public class WorkOrder
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string WorkOrderNumber { get; set; } = string.Empty;
    
    // Relations
    public Guid ServiceId { get; set; }
    public ServiceRecord Service { get; set; } = null!;
    
    public Guid? TechnicianId { get; set; }
    public Technician? Technician { get; set; }
    
    // Status
    public WorkOrderStatus Status { get; set; } = WorkOrderStatus.Pending;
    
    // Schedule
    public DateTime? ScheduledDate { get; set; }
    public TimeSpan? ScheduledStartTime { get; set; }
    public TimeSpan? EstimatedDuration { get; set; }
    
    // Actual
    public DateTime? StartedAt { get; set; }
    public DateTime? CompletedAt { get; set; }
    public TimeSpan? ActualDuration { get; set; }
    
    // Work Details
    public string? Description { get; set; }
    public string? Diagnosis { get; set; }
    public string? Solution { get; set; }
    public string? Notes { get; set; }
    
    // Costs
    public decimal? LaborCost { get; set; }
    public decimal? PartsCost { get; set; }
    public decimal? TotalCost { get; set; }
    
    // Meta
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }
    
    // Navigation
    public ICollection<WorkLog> WorkLogs { get; set; } = new List<WorkLog>();
    public ICollection<InventoryUsage> PartsUsed { get; set; } = new List<InventoryUsage>();
}

public enum WorkOrderStatus
{
    Pending = 0,
    InProgress = 1,
    Paused = 2,
    Completed = 3,
    Cancelled = 4,
    Delayed = 5
}
