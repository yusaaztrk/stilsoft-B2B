using System;
using System.Collections.Generic;

namespace ServiceOps.Domain.Entities;

public class Inventory
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string? TenantCode { get; set; }
    public string PartNumber { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string? Description { get; set; }
    
    // Category
    public string? Category { get; set; }
    public string? SubCategory { get; set; }
    
    // Stock
    public int Quantity { get; set; } = 0;
    public int MinStockLevel { get; set; } = 10;
    public int MaxStockLevel { get; set; } = 100;
    public int ReorderPoint { get; set; } = 20;
    
    // Unit
    public string Unit { get; set; } = "Adet";
    
    // Location
    public string? StorageLocation { get; set; }
    public string? ShelfNumber { get; set; }
    
    // Pricing
    public decimal? UnitCost { get; set; }
    public decimal? UnitPrice { get; set; }
    public string? Currency { get; set; } = "TRY";
    
    // Supplier
    public string? Supplier { get; set; }
    public string? SupplierPartNumber { get; set; }
    
    // Compatibility
    public string[]? CompatibleProducts { get; set; }
    
    // Status
    public InventoryStatus Status { get; set; } = InventoryStatus.InStock;
    
    // Meta
    public bool IsActive { get; set; } = true;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }
    
    // Navigation
    public ICollection<InventoryUsage> Usages { get; set; } = new List<InventoryUsage>();
}

public enum InventoryStatus
{
    InStock = 0,
    LowStock = 1,
    OutOfStock = 2,
    Discontinued = 3,
    OnOrder = 4
}

public class InventoryUsage
{
    public Guid Id { get; set; } = Guid.NewGuid();
    
    // Relations
    public Guid InventoryId { get; set; }
    public Inventory Inventory { get; set; } = null!;
    
    public Guid ServiceId { get; set; }
    public ServiceRecord Service { get; set; } = null!;
    
    public Guid? WorkOrderId { get; set; }
    public WorkOrder? WorkOrder { get; set; }
    
    // Usage
    public int Quantity { get; set; }
    public decimal? UnitCost { get; set; }
    public decimal? TotalCost { get; set; }
    
    // Notes
    public string? Notes { get; set; }
    
    // Meta
    public DateTime UsedAt { get; set; } = DateTime.UtcNow;
    public string? UsedBy { get; set; }
}
