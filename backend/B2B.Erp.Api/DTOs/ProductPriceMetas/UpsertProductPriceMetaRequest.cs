using System.ComponentModel.DataAnnotations;

namespace B2B.Erp.Api.Dtos.ProductPriceMetas;

public sealed class UpsertProductPriceMetaRequest
{
    [Required]
    public Guid ProductId { get; set; }

    [Range(0, 100)]
    public int TaxRate { get; set; }

    [Range(0d, 100d)]
    public decimal DiscountRate { get; set; }
}
