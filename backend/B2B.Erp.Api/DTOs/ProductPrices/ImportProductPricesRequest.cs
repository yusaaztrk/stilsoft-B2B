using System.ComponentModel.DataAnnotations;

namespace B2B.Erp.Api.Dtos.ProductPrices;

public sealed class ImportProductPricesRequest
{
    [Required]
    [MinLength(1)]
    public List<ImportProductPriceRow> Rows { get; set; } = new();
}

public sealed class ImportProductPriceRow
{
    [Required]
    [StringLength(50)]
    public string StockCode { get; set; } = null!;

    [Range(1, int.MaxValue)]
    public int PriceGroupCode { get; set; }

    [Range(0.01d, double.MaxValue)]
    public decimal Price { get; set; }

    [StringLength(3, MinimumLength = 2)]
    public string? Currency { get; set; }
}
