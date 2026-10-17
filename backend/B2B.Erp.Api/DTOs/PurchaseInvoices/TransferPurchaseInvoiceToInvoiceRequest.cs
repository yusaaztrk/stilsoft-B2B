using System.ComponentModel.DataAnnotations;

namespace B2B.Erp.Api.Dtos.PurchaseInvoices;

public sealed class TransferPurchaseInvoiceToInvoiceRequest
{
    [MaxLength(1)]
    public string? InvoiceSerie { get; set; }

    [Range(0, 99999999999999)]
    public long? InvoiceNumber { get; set; }
}
