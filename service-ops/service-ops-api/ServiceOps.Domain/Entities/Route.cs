using System;
using System.Collections.Generic;

namespace ServiceOps.Domain.Entities;

public class Route
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string RouteNumber { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string? Description { get; set; }
    
    // Status
    public RouteStatus Status { get; set; } = RouteStatus.Planned;
    
    // Assignment
    public Guid? TechnicianId { get; set; }
    public Technician? Technician { get; set; }
    
    // Region
    public Guid? RegionId { get; set; }
    public Region? Region { get; set; }
    
    // Schedule
    public DateTime PlannedDate { get; set; }
    public DateTime? StartTime { get; set; }
    public DateTime? EndTime { get; set; }
    public TimeSpan? EstimatedDuration { get; set; }
    
    // Stops
    public int TotalStops { get; set; } = 0;
    public int CompletedStops { get; set; } = 0;
    public ICollection<RouteStop> Stops { get; set; } = new List<RouteStop>();
    
    // Distance
    public double? TotalDistanceKm { get; set; }
    
    // Path (GeoJSON linestring for the route path)
    public string? PathGeoJson { get; set; }
    
    // Meta
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }
}

public class RouteStop
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid RouteId { get; set; }
    public Route? Route { get; set; }
    
    // Sequence
    public int Sequence { get; set; }
    
    // Service/Location
    public Guid? ServiceId { get; set; }
    public ServiceRecord? Service { get; set; }
    
    // Location
    public string? Address { get; set; }
    public double? Latitude { get; set; }
    public double? Longitude { get; set; }
    
    // Schedule
    public TimeSpan? EstimatedArrival { get; set; }
    public TimeSpan? EstimatedDuration { get; set; }
    public DateTime? ActualArrival { get; set; }
    public DateTime? ActualDeparture { get; set; }
    
    // Status
    public StopStatus Status { get; set; } = StopStatus.Pending;
    
    // Notes
    public string? Notes { get; set; }
}

public enum RouteStatus
{
    Planned = 0,
    InProgress = 1,
    Completed = 2,
    Cancelled = 3,
    Delayed = 4
}

public enum StopStatus
{
    Pending = 0,
    InProgress = 1,
    Completed = 2,
    Skipped = 3,
    Delayed = 4
}
