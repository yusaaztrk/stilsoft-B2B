namespace B2B.Erp.Api.Entities;

public class ProductPrice
{
    public Guid Id { get; set; } = Guid.NewGuid();

    public Guid ProductId { get; set; }

    public Guid PriceGroupId { get; set; }

    public decimal Price { get; set; }

    public string Currency { get; set; } = null!;

    public Product Product { get; set; } = null!;

    public PriceGroup PriceGroup { get; set; } = null!;
}
