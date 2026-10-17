using System;

namespace B2B.Erp.Api.Entities;

public sealed class WarrantyHistory
{
    public int Id { get; set; }
    public int WarrantyRecordId { get; set; }
    [System.Text.Json.Serialization.JsonIgnore]
    public WarrantyRecord? WarrantyRecord { get; set; }
    public string Status { get; set; } = string.Empty;
    public string Description { get; set; } = string.Empty;
    public DateTime CreatedTime { get; set; } = DateTime.UtcNow;
    public string CreatedByUser { get; set; } = string.Empty;
}
