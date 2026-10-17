namespace B2B.Erp.Api.Entities;

public sealed class CustomerOffer : AuditableEntity
{
    public int Id { get; set; }

    public string DocumentNo { get; set; } = string.Empty;

    public string? ProformaDocumentNo { get; set; }

    public DateTime Date { get; set; }

    public string? CustomerCode { get; set; }

    public string? DeliveryCustomerCode { get; set; }

    public int? MuhtelifCustomerId { get; set; }
    public MuhtelifCustomer? MuhtelifCustomer { get; set; }

    public bool VatExempt { get; set; }

    public decimal Subtotal { get; set; }

    public decimal DiscountTotal { get; set; }

    public decimal NetTotal { get; set; }

    public decimal VatTotal { get; set; }

    public decimal GrandTotal { get; set; }

    public string? SalesmanCode { get; set; }

    public string? Description { get; set; }

    /// <summary>
    /// Teklifin para birimi (1=TRY 2=EUR 3=USD 4=GBP). Kalemlerin SATIŞ dövizinden gelir,
    /// carinin kartından DEĞİL (2026-08-17: cari kartındaki döviz alanı kaldırıldı).
    /// Basım ve ekran sembolü bunu okur.
    /// </summary>
    public int CurrencyTypeId { get; set; } = 1;

    /// <summary>Teklif anındaki 1 döviz = X ₺ kuru; TL teklifte 1.</summary>
    public decimal ExchangeRate { get; set; } = 1m;

    public ICollection<CustomerOfferLine> Lines { get; set; } = new List<CustomerOfferLine>();
}
