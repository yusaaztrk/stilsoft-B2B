using System;

namespace B2B.Erp.Api.DTOs.Montaj;

public sealed class MontajListItemDto
{
    public int Id { get; set; }
    public string? DealerCode { get; set; }
    public string Type { get; set; } = string.Empty;
    public string Status { get; set; } = string.Empty;
    public string DealerName { get; set; } = string.Empty;
    public string ProductName { get; set; } = string.Empty;
    public decimal Quantity { get; set; }
    public string? CustomerName { get; set; }
    public string? CustomerPhone { get; set; }
    public string Address { get; set; } = string.Empty;
    public string Region { get; set; } = string.Empty;
    public DateTime? PlannedDateUtc { get; set; }
    public string? Technician { get; set; }
    public string? DealerDescription { get; set; }
    public string CreateUser { get; set; } = string.Empty;
    public DateTime CreateTime { get; set; }
}
