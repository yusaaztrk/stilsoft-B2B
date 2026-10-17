namespace B2B.Erp.Api.Entities;

public sealed class InvoiceLine : AuditableEntity
{
    public int Id { get; set; }

    public int InvoiceId { get; set; }
    public Invoice Invoice { get; set; } = null!;

    public int? SalesOrderLineId { get; set; }

    public int? SourcePurchaseInvoiceLineId { get; set; }

    public string StockCode { get; set; } = string.Empty;

    public string? Description { get; set; }

    public decimal Quantity { get; set; }

    public decimal UnitPrice { get; set; }

    public int CurrencyTypeId { get; set; }

    public decimal CurrencyRate { get; set; }

    public decimal CurrencyUnitPrice { get; set; }

    public decimal VatRate { get; set; }

    /// <summary>
    /// Satırın muhasebe niteliği — MAL mı HİZMET mi (denetim md. E3).
    ///
    /// <para>
    /// 600 / 600.20 kırılımı bunsuz yapılamıyordu: tek fatura hem parça hem işçilik satırı
    /// taşıyabildiği için fatura seviyesindeki nitelik yetmiyor. Değer fatura KESİLİRKEN
    /// damgalanır (<c>AppDbContext.StampInvoiceLineNaturesAsync</c>), sonradan hesaplanmaz —
    /// ürün kartı silinirse geçmiş fatura hesap değiştirmesin diye.
    /// </para>
    ///
    /// <para>
    /// Eski satırlarda <see cref="Core.Accounting.InvoiceLineNature.Unspecified"/> kalır;
    /// aktarım modülü bunları "çözülmedi" olarak ele almalı, mal varsayıp defterlememeli.
    /// </para>
    /// </summary>
    public Core.Accounting.InvoiceLineNature Nature { get; set; } = Core.Accounting.InvoiceLineNature.Unspecified;

    public int LineNo { get; set; }

    public Guid? LineageId { get; set; }

    /// <summary>
    /// Bu kalemin stoğunun DÜŞTÜĞÜ depo.
    ///
    /// Fatura başlığında tek bir depo vardı ve bütün kalemler oradan çıkıyordu. Servisten gelen
    /// kalemler ise işlemi yapan teknisyenin araç deposundan çıkmak zorunda; aynı faturada iki
    /// farklı depo olabiliyor. Kalemde tutulmasının ikinci sebebi FATURA SİLME: silinen fatura
    /// stoğu iade ederken hangi depoya döneceğini buradan okur, aksi halde hepsi başlıktaki
    /// tek depoya geri yazılıp araç stoğu kalıcı olarak bozulurdu.
    ///
    /// NULL = eski kayıt; iade/rapor tarafında faturanın başlık deposuna düşülür.
    /// </summary>
    public int? WarehouseCode { get; set; }

    public ICollection<Installation> Installations { get; set; } = new List<Installation>();
}
