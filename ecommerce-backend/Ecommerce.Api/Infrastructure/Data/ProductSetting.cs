namespace Ecommerce.Api.Infrastructure.Data;

public sealed class ProductSetting
{
    public string TenantCode { get; set; } = string.Empty;
    public Guid ProductId { get; set; }
    public bool IsFeatured { get; set; }
    public decimal? OverridePrice { get; set; }
    public string? OverrideCurrency { get; set; }
    public DateTimeOffset UpdatedAtUtc { get; set; }
}
