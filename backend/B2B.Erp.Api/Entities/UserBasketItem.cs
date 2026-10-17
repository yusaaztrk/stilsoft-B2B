using System;

namespace B2B.Erp.Api.Entities;

public class UserBasketItem
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string CustomerCode { get; set; } = string.Empty;
    public string CustomerName { get; set; } = string.Empty;
    public string Username { get; set; } = string.Empty;
    public string ProductId { get; set; } = string.Empty;
    public string StockCode { get; set; } = string.Empty;
    public string ProductName { get; set; } = string.Empty;
    public decimal Quantity { get; set; }
    public decimal UnitPrice { get; set; }
    public decimal VatRate { get; set; }
    public string Currency { get; set; } = string.Empty;
    public string Montaj { get; set; } = string.Empty;
    public string Note { get; set; } = string.Empty;
    public string Key { get; set; } = string.Empty;
    public string CampaignTitle { get; set; } = string.Empty;
    public decimal DiscountAmount { get; set; }
    public decimal DiscountRate { get; set; }
    public bool IsGift { get; set; }
    public Guid? LineageId { get; set; }
    public string? MontajSnapshotJson { get; set; }
    public DateTime CreateTime { get; set; } = DateTime.UtcNow;
    public DateTime UpdateTime { get; set; } = DateTime.UtcNow;
}
