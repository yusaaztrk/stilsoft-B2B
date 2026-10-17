using System;

namespace ServiceOps.Domain.Entities;

public class Notification
{
    public Guid Id { get; set; }
    public Guid TechnicianId { get; set; }
    public string Title { get; set; } = string.Empty;
    public string Message { get; set; } = string.Empty;
    public bool IsRead { get; set; }
    public DateTime CreatedAt { get; set; }
    public string? JobType { get; set; } // "ServiceRecord", "InstallationTask", "CargoTrackingTask"
    public Guid? JobId { get; set; }
}
