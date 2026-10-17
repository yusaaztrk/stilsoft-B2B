namespace B2B.Erp.Api.Dtos.CustomerProductPriceOverrides;

public sealed class CustomerProductPriceOverrideResponse
{
    public Guid Id { get; init; }

    public string CustomerCode { get; init; } = string.Empty;

    public Guid ProductId { get; init; }

    public Guid PriceGroupId { get; init; }

    public decimal Price { get; init; }

    public string Currency { get; init; } = null!;

    public bool IsActive { get; init; }
}
