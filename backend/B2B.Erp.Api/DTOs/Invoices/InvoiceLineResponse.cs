namespace B2B.Erp.Api.Dtos.Invoices;

public sealed class InvoiceLineResponse
{
    public int Id { get; set; }
    public string StockCode { get; set; } = string.Empty;
    public string StockName { get; set; } = string.Empty;
    public string? Description { get; set; }
    public decimal VatRate { get; set; }
    public decimal Quantity { get; set; }
    public decimal UnitPrice { get; set; }
    public decimal Total { get; set; }
}
