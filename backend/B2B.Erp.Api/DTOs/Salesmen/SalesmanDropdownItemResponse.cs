namespace B2B.Erp.Api.Dtos.Salesmen;

public sealed class SalesmanDropdownItemResponse
{
    public string SalesmanCode { get; set; } = string.Empty;

    public string Description { get; set; } = string.Empty;

    public double? DiscountRate { get; set; }
}
