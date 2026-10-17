using System;

namespace Ecommerce.Api.Infrastructure.Data;

public sealed class StoreInvoice
{
    public Guid Id { get; set; }
    public Guid OrderId { get; set; }
    public string InvoiceNo { get; set; } = string.Empty;
    public string OrderNo { get; set; } = string.Empty;
    public decimal GrandTotal { get; set; }
    public string PdfPath { get; set; } = string.Empty;
    public DateTimeOffset CreatedAtUtc { get; set; }
}
