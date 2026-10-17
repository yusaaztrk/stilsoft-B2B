using System.ComponentModel.DataAnnotations;

namespace B2B.Erp.Api.Dtos.Campaigns;

public sealed class EvaluateSalesOrderRequest
{
    [Required]
    [MaxLength(50)]
    public string CustomerCode { get; set; } = string.Empty;

    [MinLength(1)]
    public List<EvaluateSalesOrderLineRequest> Lines { get; set; } = new();

    public int? PriceGroupCode { get; set; }
}

public sealed class EvaluateSalesOrderLineRequest
{
    [Required]
    [MaxLength(50)]
    public string StockCode { get; set; } = string.Empty;

    [Range(0.001, double.MaxValue)]
    public decimal Quantity { get; set; }

    [Range(0, double.MaxValue)]
    public decimal UnitPrice { get; set; }

    [Range(0, double.MaxValue)]
    public decimal VatRate { get; set; }
}
