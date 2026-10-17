namespace B2B.Erp.Api.Dtos.SalesOrders;

public sealed class SalesOrderInvoiceLineResponse
{
    public int SalesOrderLineId { get; set; }
    public int SalesOrderId { get; set; }

    public decimal OrderSubtotal { get; set; }
    public decimal OrderGrandTotal { get; set; }

    public DateTime OrderDate { get; set; }
    public string OrderNo { get; set; } = string.Empty;

    public string CustomerCode { get; set; } = string.Empty;
    public string DeliveryCustomerCode { get; set; } = string.Empty;

    public string StockCode { get; set; } = string.Empty;
    public string ProductName { get; set; } = string.Empty;

    public string? Description { get; set; }

    public decimal OrderQuantity { get; set; }
    public decimal DeliveredQuantity { get; set; }
    public decimal RemainingQuantity { get; set; }

    public string? SerialNo { get; set; }

    public decimal UnitPrice { get; set; }
    public int CurrencyTypeId { get; set; }
    public decimal CurrencyRate { get; set; }
    public decimal CurrencyUnitPrice { get; set; }
    public decimal VatRate { get; set; }

    public bool IsGift { get; set; }
    public decimal DiscountAmount { get; set; }

    public string ProcessedBy { get; set; } = string.Empty;

    public int? InstallationId { get; set; }
    public string? InstallationName { get; set; }

    public decimal CampaignDiscount { get; set; }
    public string? CampaignDetailsJson { get; set; }

    /// <summary>
    /// Servisten gelen kalemin damgalı çıkış deposu — satış faturası ekranındaki depo seçicinin
    /// öntanımlı değeri. Servis dışı kalemde null.
    /// </summary>
    public int? SourceWarehouseCode { get; set; }

    /// <summary>İşlemi yapan servis personeli; "SERVİS" rozetinin ipucunda gösterilir.</summary>
    public string? ServicePerformerName { get; set; }

    /// <summary>Kalemi oluşturan kullanıcı (`SalesOrderLine.CreateUser`, yoksa siparişin `ProcessedBy`'ı).</summary>
    public string? CreatedByUsername { get; set; }

    /// <summary>
    /// KALEMİN ÖNTANIMLI ÇIKIŞ DEPOSU (kullanıcı kuralı, 2026-08-14).
    ///
    /// Sıra: (1) servisin damgaladığı depo, (2) kalemi giren kullanıcının VARSAYILAN deposu
    /// (`Users.DefaultWarehouseCode`), (3) o kullanıcının tek bir depo yetkisi varsa o depo.
    /// Hiçbiri yoksa null kalır ve ekran depoyu kullanıcıya sorar.
    ///
    /// Neden sunucu hesaplıyor: kalemi giren kişi ile faturayı kesen kişi farklı olabiliyor;
    /// ekran yalnızca kendi oturumunun yetkilerini biliyor, "siparişi kim girdi" bilgisi burada.
    /// </summary>
    public int? DefaultWarehouseCode { get; set; }

    /// <summary>Öntanımlı deponun adı — ekranın seçicide etiket basabilmesi için.</summary>
    public string? DefaultWarehouseName { get; set; }

    /// <summary>Öntanımlı deponun nereden geldiği: <c>servis</c> | <c>kullanici</c> | null.</summary>
    public string? DefaultWarehouseSource { get; set; }
}
