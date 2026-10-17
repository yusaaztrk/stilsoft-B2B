namespace B2B.Erp.Api.Entities;

public enum PurchaseInvoiceKind
{
    Purchase = 0,
    Service = 1,
    Return = 2
}

public enum PurchaseInvoiceTerminStatus
{
    Waiting = 0,    // Bekliyor
    Delivered = 1   // Teslim Edildi
}

public sealed class PurchaseInvoice : AuditableEntity
{
    public int Id { get; set; }

    public string DocumentNo { get; set; } = string.Empty;

    public DateTime Date { get; set; }

    public PurchaseInvoiceKind Kind { get; set; }

    /// <summary>
    /// Alış faturasının para birimi. 1=TRY 2=EUR 3=USD 4=GBP (0 = TL, kolon varsayılanı).
    /// Öncesinde alış faturasında para birimi HİÇ yoktu: tedarikçi tarafında (cari yok,
    /// yalnızca <see cref="SupplierCode"/>) ekstre satırı zorunlu olarak TL yazılıyordu.
    /// </summary>
    public int CurrencyTypeId { get; set; }

    /// <summary>Fatura anındaki kur (1 döviz = X TL). DONMUŞTUR, sonradan yeniden hesaplanmaz.</summary>
    public decimal ExchangeRate { get; set; } = 1m;

    /// <summary>
    /// Kurun kaynağı: <c>"TCMB"</c> ya da <c>"Manuel"</c> (2026-08-29).
    ///
    /// Alış faturasında kur artık elle girilebiliyor — tedarikçinin faturasındaki kur günün
    /// TCMB kurundan farklı olabilir. Hangi kurun nereden geldiği damgalanmazsa ay sonunda
    /// "bu kur nereden çıktı" sorusunun cevabı kalmaz. Satış faturasında karşılığı vardı,
    /// alışta yoktu.
    /// </summary>
    public string? RateSource { get; set; }

    /// <summary>
    /// Bu fatura hangi SİPARİŞTEN bölündü (2026-08-29).
    ///
    /// Kısmi teslimat siparişi böler ve ayrı bir fatura doğurur. Bağ eskiden yalnızca
    /// açıklama metnindeydi ("Kısmi Teslimat - X"); metin elle değiştirilince kopuyordu ve
    /// "bu siparişin teslimat geçmişi" sorusu cevaplanamıyordu. Artık veri olarak duruyor.
    ///
    /// Normal (bölünmemiş) faturalarda NULL'dur.
    /// </summary>
    public int? SplitFromPurchaseInvoiceId { get; set; }

    public PurchaseInvoiceTerminStatus TerminStatus { get; set; } = PurchaseInvoiceTerminStatus.Waiting;

    public string? SupplierCode { get; set; }

    public string? ServiceCode { get; set; }

    public string? CustomerCode { get; set; }

    public int? MuhtelifCustomerId { get; set; }
    public MuhtelifCustomer? MuhtelifCustomer { get; set; }

    public bool VatExempt { get; set; }

    public bool Approved { get; set; }

    public decimal Subtotal { get; set; }

    public decimal DiscountTotal { get; set; }

    public decimal NetTotal { get; set; }

    public decimal VatTotal { get; set; }

    public decimal GrandTotal { get; set; }

    public string? SalesmanCode { get; set; }

    public string? Description { get; set; }

    public DateTime? EstimatedArrivalDate { get; set; }

    public int? CashAccountId { get; set; }

    public ICollection<PurchaseInvoiceLine> Lines { get; set; } = new List<PurchaseInvoiceLine>();
}
