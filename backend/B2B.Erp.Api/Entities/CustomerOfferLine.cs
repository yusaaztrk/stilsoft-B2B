namespace B2B.Erp.Api.Entities;

public enum CustomerOfferLineDiscountType
{
    None = 0,
    Amount = 1,
    Percentage = 2
}

public sealed class CustomerOfferLine : AuditableEntity
{
    public int Id { get; set; }

    public int CustomerOfferId { get; set; }
    public CustomerOffer CustomerOffer { get; set; } = null!;

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

    /// <summary>
    /// Satır kampanyadan geldiyse kampanyanın adı; boş = normal satır (2026-09-20).
    /// Dolu satır ekranda KİLİTLİDİR: ürün, fiyat ve indirim değiştirilemez, teklif tekrar
    /// düzenlemeye açıldığında da kilit kalır (kullanıcı: "kampanya ise kilitli kalsın").
    /// </summary>
    public string? CampaignName { get; set; }

    public Guid? LineageId { get; set; }

    public ICollection<Installation> Installations { get; set; } = new List<Installation>();
}
