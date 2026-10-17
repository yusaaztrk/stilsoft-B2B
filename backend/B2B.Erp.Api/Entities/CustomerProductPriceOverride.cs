namespace B2B.Erp.Api.Entities;

public sealed class CustomerProductPriceOverride
{
    public Guid Id { get; set; } = Guid.NewGuid();

    public string CustomerCode { get; set; } = string.Empty;

    public Guid ProductId { get; set; }

    public Guid PriceGroupId { get; set; }

    public decimal Price { get; set; }

    public string Currency { get; set; } = null!;

    public bool IsActive { get; set; } = true;

    public Customer Customer { get; set; } = null!;

    public Product Product { get; set; } = null!;

    public PriceGroup PriceGroup { get; set; } = null!;
}
