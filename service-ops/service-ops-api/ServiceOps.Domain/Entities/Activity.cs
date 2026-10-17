using System;

namespace ServiceOps.Domain.Entities;

public class Activity
{
    public Guid Id { get; set; } = Guid.NewGuid();

    // Relations
    public Guid ServiceId { get; set; }
    public ServiceRecord Service { get; set; } = null!;

    public Guid? ActorUserId { get; set; }
    public string? ActorUserName { get; set; }
    public Guid? ActorTechnicianId { get; set; }
    public string? ActorTechnicianName { get; set; }

    // Type & Payload
    public ActivityType Type { get; set; } = ActivityType.System;
    public string Payload { get; set; } = "{}"; // JSON with standard shape: field, oldValue, newValue, reason, metadata

    public string? CorrelationId { get; set; }

    // Audit
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

public enum ActivityType
{
    System = 0,
    Assigned = 1,
    Planned = 2,
    StatusChanged = 3,
    NoteAdded = 4,
    WorkLogged = 5,
    PhotoUploaded = 6,
    Cancelled = 7
}
