namespace B2B.Erp.Api.Entities;

public sealed class CariOfferLine : AuditableEntity
{
    public int Id { get; set; }

    public int CariOfferId { get; set; }
    public CariOffer CariOffer { get; set; } = null!;

    public Guid ProductId { get; set; }
    public Product Product { get; set; } = null!;

    public string StockCode { get; set; } = string.Empty;

    public string? Description { get; set; }

    public decimal Quantity { get; set; }

    public decimal UnitPrice { get; set; }

    /// <summary>
    /// Kalemin para birimi (1=TRY 2=EUR 3=USD 4=GBP): ürünün SATIŞ dövizi.
    /// `UnitPrice` bu para birimindedir — TL'ye çevrilmiş hâli değildir.
    /// </summary>
    public int CurrencyTypeId { get; set; } = 1;

    public decimal VatRate { get; set; }

    public CustomerOfferLineDiscountType DiscountType { get; set; }

    public decimal DiscountValue { get; set; }

    public int LineNo { get; set; }
}
