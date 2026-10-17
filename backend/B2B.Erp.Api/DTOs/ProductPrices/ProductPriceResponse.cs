namespace B2B.Erp.Api.Dtos.ProductPrices;

public sealed class ProductPriceResponse
{
    public Guid Id { get; init; }

    public Guid ProductId { get; init; }

    public Guid PriceGroupId { get; init; }

    public decimal Price { get; init; }

    public string Currency { get; init; } = null!;
}
