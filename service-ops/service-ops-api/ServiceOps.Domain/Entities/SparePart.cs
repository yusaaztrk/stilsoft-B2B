using System;

namespace ServiceOps.Domain.Entities;

public class SparePart
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string? TenantCode { get; set; }

    public Guid ProductId { get; set; }
    public ServiceProduct Product { get; set; } = null!;

    public string Name { get; set; } = string.Empty;
    public string? PartNumber { get; set; }

    public int StockQuantity { get; set; } = 0;
    public int MinStockLevel { get; set; } = 0;

    public string? ExplodedViewPartNumber { get; set; }

    public bool IsActive { get; set; } = true;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }
}
