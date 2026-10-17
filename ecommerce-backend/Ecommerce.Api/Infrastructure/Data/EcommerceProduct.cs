namespace Ecommerce.Api.Infrastructure.Data;

public sealed class EcommerceProduct
{
    public string TenantCode { get; set; } = string.Empty;
    public Guid ErpProductId { get; set; }
    public string? StockCode { get; set; }
    public string? Name { get; set; }
    public decimal? UnitPrice { get; set; }
    public string? Currency { get; set; }
    public int? Stock { get; set; }
    public bool? IsActive { get; set; }
    public string? ImageUrl { get; set; }
    public List<string>? ImageUrls { get; set; }
    public DateTimeOffset UpdatedAtUtc { get; set; }
}
