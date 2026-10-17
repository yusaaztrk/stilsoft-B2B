using System;
using System.Collections.Generic;

namespace ServiceOps.Domain.Entities;

public class Dealer
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string DealerCode { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string? ContactPerson { get; set; }
    
    // Contact
    public string Phone { get; set; } = string.Empty;
    public string? Email { get; set; }
    
    // Address
    public string? Address { get; set; }
    public string? City { get; set; }
    public string? District { get; set; }
    
    // Region
    public Guid? RegionId { get; set; }
    public Region? Region { get; set; }
    
    // Commission/Discount
    public decimal? CommissionRate { get; set; }
    public decimal? DiscountRate { get; set; }
    
    // Stats
    public int TotalServices { get; set; } = 0;
    public decimal TotalRevenue { get; set; } = 0;
    
    // Meta
    public bool IsActive { get; set; } = true;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    
    // Navigation
    public ICollection<ServiceRecord> Services { get; set; } = new List<ServiceRecord>();
}
