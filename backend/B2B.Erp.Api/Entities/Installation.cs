namespace B2B.Erp.Api.Entities;

public sealed class Installation : InstallationInfoEntity
{
    public int Id { get; set; }

    public string? DealerCode { get; set; }

    public string Type { get; set; } = "Montaj";

    public string Status { get; set; } = "Yeni Kayıt";

    public DateTime? PlannedDateUtc { get; set; }

    public string? Technician { get; set; }

    public string DealerName { get; set; } = string.Empty;

    public string ProductName { get; set; } = string.Empty;

    public decimal Quantity { get; set; }

    public string Address { get; set; } = string.Empty;

    public string Region { get; set; } = string.Empty;

    public string? DealerDescription { get; set; }

    public Guid? LineageId { get; set; }
    public Guid? InstallationClientId { get; set; }

    public int? InvoiceLineId { get; set; }
    public InvoiceLine? InvoiceLine { get; set; }

    public int? SalesOrderLineId { get; set; }
    public SalesOrderLine? SalesOrderLine { get; set; }

    public int? CustomerOfferLineId { get; set; }
    public CustomerOfferLine? CustomerOfferLine { get; set; }
}
