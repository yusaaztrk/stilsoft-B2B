namespace B2B.Erp.Api.Entities;

public class PriceGroup
{
    public Guid Id { get; set; } = Guid.NewGuid();

    public int Code { get; set; }

    public string Name { get; set; } = null!;

    public string InvoiceType { get; set; } = string.Empty;

    public string? Formula { get; set; }

    public int SortOrder { get; set; }

    public bool IsActive { get; set; } = true;

    public ICollection<ProductPrice> ProductPrices { get; set; } = new List<ProductPrice>();
}
