using System;
using System.Collections.Generic;

namespace ServiceOps.Domain.Entities;

public class Customer
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string CustomerNumber { get; set; } = string.Empty;
    public string FullName { get; set; } = string.Empty;
    public string? FirstName { get; set; }
    public string? LastName { get; set; }
    public string? CompanyName { get; set; }
    public CustomerType Type { get; set; } = CustomerType.Individual;
    
    // Contact
    public string Phone { get; set; } = string.Empty;
    public string? Phone2 { get; set; }
    public string? Email { get; set; }
    
    // Address
    public string? Address { get; set; }
    public string? City { get; set; }
    public string? District { get; set; }
    public string? PostalCode { get; set; }
    public double? Latitude { get; set; }
    public double? Longitude { get; set; }
    
    // Region
    public Guid? RegionId { get; set; }
    public Region? Region { get; set; }
    
    // Stats
    public int TotalServices { get; set; } = 0;
    public DateTime? LastServiceDate { get; set; }
    public double TotalRevenue { get; set; } = 0;
    
    // Meta
    public string? Notes { get; set; }
    public bool IsActive { get; set; } = true;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }
    
    // Navigation
    public ICollection<ServiceRecord> Services { get; set; } = new List<ServiceRecord>();
}

public enum CustomerType
{
    Individual = 0,
    Dealer = 1,
    Corporate = 2
}
