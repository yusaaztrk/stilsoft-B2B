namespace B2B.Erp.Api.Entities;

public enum InvoiceType
{
    Proforma = 'P',
    Quotation = 'T',
    OpenInvoice = '1',
    PurchaseInvoice = '2',
    ServiceInvoice = 'H',
    ReturnInvoice = 'I',
    WarehouseTransfer = 'D',
    SalesInvoice = '6'
}

public sealed class Invoice : InstallationInfoEntity
{
    public int Id { get; set; }

    public InvoiceType Type { get; set; }

    public int? SourceCustomerOfferId { get; set; }

    public int? SourcePurchaseInvoiceId { get; set; }

    public string InvoiceNo { get; set; } = string.Empty;

    public string CustomerCode { get; set; } = string.Empty;

    public string? CustomerNameOverride { get; set; }

    public string? CustomerInvoiceTypeOverride { get; set; }

    public string DeliveryCustomerCode { get; set; } = string.Empty;

    public DateTime Date { get; set; }

    public bool VatIncluded { get; set; }

    /// <summary>
    /// Faturanın para birimi. 0 veya 1 = TL. Öncesinde başlıkta para birimi YOKTU; her okumada
    /// kalemlerden yeniden çıkarılıyordu ve karışık kalemli faturada "yok" sayılıyordu.
    /// </summary>
    public int CurrencyTypeId { get; set; }

    /// <summary>
    /// Fatura ANINDAKİ kur (1 döviz = X TL). DONMUŞTUR — kur sonradan değişse de bu değer
    /// yeniden hesaplanmaz. Muhasebe fişi ve KDV beyanı bu kuru kullanır; güncel kurla
    /// yeniden değerlemek yevmiye numarası kesintisiz olduğu için ancak ters kayıtla düzeltilir.
    /// </summary>
    public decimal ExchangeRate { get; set; } = 1m;

    /// <summary>Kurun nereden geldiği: TCMB / Manuel / son bilinen kur. Denetim izi için.</summary>
    public string? RateSource { get; set; }

    public decimal Subtotal { get; set; }

    public decimal Discount { get; set; }
    
    public decimal CampaignDiscount { get; set; }
    public string? CampaignDetailsJson { get; set; }

    public decimal NetTotal { get; set; }

    public decimal VatTotal { get; set; }

    public decimal GrandTotal { get; set; }

    public string? SalesmanCode { get; set; }

    public string? Description { get; set; }

    public bool IsManuallyPaid { get; set; }

    public bool IsPriceOverridden { get; set; }
}
