using System.ComponentModel.DataAnnotations;

namespace B2B.Erp.Api.Dtos.ProductPrices;

public sealed class CreateProductPriceRequest
{
    [Required]
    public Guid ProductId { get; set; }

    [Required]
    public Guid PriceGroupId { get; set; }

    public decimal Price { get; set; }

    [Required]
    [StringLength(3, MinimumLength = 2)]
    public string Currency { get; set; } = null!;
}
