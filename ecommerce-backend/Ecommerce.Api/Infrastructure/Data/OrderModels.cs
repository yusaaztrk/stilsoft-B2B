namespace Ecommerce.Api.Infrastructure.Data;

public sealed class StoreOrder
{
    public Guid Id { get; set; }
    public string OrderNo { get; set; } = string.Empty;
    public Guid? CustomerId { get; set; }
    public string CustomerName { get; set; } = string.Empty;
    public string Email { get; set; } = string.Empty;
    public string Phone { get; set; } = string.Empty;
    public string Address { get; set; } = string.Empty;
    public string Status { get; set; } = "New";
    public string PaymentStatus { get; set; } = "PendingVirtualPos";
    public decimal Total { get; set; }
    public string? CouponCode { get; set; }
    public decimal DiscountAmount { get; set; }
    public decimal CampaignDiscountAmount { get; set; }
    public decimal CargoFee { get; set; }
    public DateTimeOffset CreatedAtUtc { get; set; }
    public List<StoreOrderLine> Lines { get; set; } = new();
}

public sealed class StoreOrderLine
{
    public Guid ProductId { get; set; }
    public string TenantCode { get; set; } = string.Empty;
    public string ProductName { get; set; } = string.Empty;
    public decimal UnitPrice { get; set; }
    public int Quantity { get; set; }
    public string ImageUrl { get; set; } = string.Empty;
    public decimal LineTotal => UnitPrice * Quantity;
}
