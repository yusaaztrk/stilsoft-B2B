namespace B2B.Erp.Api.Dtos.ProductPriceMetas;

public sealed class ProductPriceMetaResponse
{
    public Guid Id { get; init; }

    public Guid ProductId { get; init; }

    public int TaxRate { get; init; }

    public decimal DiscountRate { get; init; }
}
