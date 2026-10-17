using System;

namespace ServiceOps.Domain.Entities;

public sealed class SparePartOrderRequest
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string TenantCode { get; set; } = string.Empty;

    public string TechnicianName { get; set; } = string.Empty;

    public Guid ErpProductId { get; set; }
    public string StockCode { get; set; } = string.Empty;
    public string PartName { get; set; } = string.Empty;

    public int QuantityRequested { get; set; }

    public string Status { get; set; } = "Pending";

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? CompletedAt { get; set; }
}
