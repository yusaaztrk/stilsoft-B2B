using System.ComponentModel.DataAnnotations;
using B2B.Erp.Api.Entities;

namespace B2B.Erp.Api.Dtos.PurchaseInvoices;

public sealed class UpdatePurchaseInvoiceHeaderRequest
{
    [MaxLength(15)]
    public string? DocumentNo { get; set; }

    [Required]
    public PurchaseInvoiceKind Kind { get; set; }

    [MaxLength(50)]
    public string? SupplierCode { get; set; }

    [MaxLength(50)]
    public string? ServiceCode { get; set; }

    [MaxLength(50)]
    public string? CustomerCode { get; set; }
}
