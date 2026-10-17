using System;

namespace ServiceOps.Application.Dtos;

public class CustomerServiceSummaryDto
{
    public Guid Id { get; set; }
    public string CustomerNumber { get; set; } = string.Empty;
    public string FullName { get; set; } = string.Empty;
    public string Phone { get; set; } = string.Empty;
    public string? Email { get; set; }
    public string? Address { get; set; }
    public string? City { get; set; }
    public string? District { get; set; }
    public string? RegionName { get; set; }
    public bool IsActive { get; set; }

    public int LargeProductRepairCount { get; set; }
    public int SmallProductRepairCount { get; set; }
    public int InstallationCount { get; set; }
    public int CargoCount { get; set; }

    public int TotalServiceCount => SmallProductRepairCount + InstallationCount + CargoCount;
}

public class CustomerServiceDetailDto
{
    public Guid Id { get; set; }
    public string ServiceNumber { get; set; } = string.Empty;
    public string Type { get; set; } = string.Empty;
    public string Status { get; set; } = string.Empty;
    public string StatusLabel { get; set; } = string.Empty;
    public string ProductName { get; set; } = string.Empty;
    public string? SerialNumber { get; set; }
    public DateTime CreatedAt { get; set; }
}

public class CustomerCargoDetailDto
{
    public Guid Id { get; set; }
    public string OrderNumber { get; set; } = string.Empty;
    public string ProductDetails { get; set; } = string.Empty;
    public string Status { get; set; } = string.Empty;
    public string StatusLabel { get; set; } = string.Empty;
    public DateTime? PlannedDate { get; set; }
    public DateTime CreatedAt { get; set; }
}

public class CustomerActivityDto
{
    public Guid Id { get; set; }
    public string ReferenceNumber { get; set; } = string.Empty;
    public string ActivityType { get; set; } = string.Empty;
    public string Status { get; set; } = string.Empty;
    public string StatusLabel { get; set; } = string.Empty;
    public string ProductName { get; set; } = string.Empty;
    public DateTime Date { get; set; }
}
