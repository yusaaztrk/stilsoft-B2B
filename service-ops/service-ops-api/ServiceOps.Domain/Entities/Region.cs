using System;
using System.Collections.Generic;

namespace ServiceOps.Domain.Entities;

public class Region
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string Name { get; set; } = string.Empty;
    public string? Description { get; set; }
    
    // Geography
    public double? CenterLatitude { get; set; }
    public double? CenterLongitude { get; set; }
    public double? RadiusKm { get; set; }
    
    // Boundaries (GeoJSON polygon)
    public string? BoundaryGeoJson { get; set; }
    
    // Parent region (for hierarchy)
    public Guid? ParentRegionId { get; set; }
    public Region? ParentRegion { get; set; }
    public ICollection<Region> SubRegions { get; set; } = new List<Region>();
    
    // Stats
    public int TechnicianCount { get; set; } = 0;
    public int ActiveServiceCount { get; set; } = 0;
    public int TotalServiceCount { get; set; } = 0;
    
    // Meta
    public bool IsActive { get; set; } = true;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    
    // Navigation
    public ICollection<Technician> Technicians { get; set; } = new List<Technician>();
    public ICollection<ServiceRecord> Services { get; set; } = new List<ServiceRecord>();
    public ICollection<Route> Routes { get; set; } = new List<Route>();
}
