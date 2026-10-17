namespace B2B.Erp.Api.Entities;

public enum StockMovementDirection
{
    In = 'G',
    Out = 'C'
}

public sealed class StockMovement : AuditableEntity
{
    public int Id { get; set; }

    public string InvoiceNo { get; set; } = string.Empty;

    public string CustomerCode { get; set; } = string.Empty;

    public string DeliveryCustomerCode { get; set; } = string.Empty;

    public string StockCode { get; set; } = string.Empty;

    public StockMovementDirection Direction { get; set; }

    public decimal Quantity { get; set; }

    /// <summary>
    /// TL ÇAPASI. Stok hareketi daima TL tutulur (alış faturası bile kurla çevirerek yazar);
    /// belgenin kendi parasındaki değer <see cref="CurrencyUnitPrice"/> alanındadır.
    /// </summary>
    public decimal UnitPrice { get; set; }

    /// <summary>
    /// Hareketin para birimi (1=TRY 2=EUR 3=USD 4=GBP). 2026-08-19'da eklendi: tabloda para
    /// birimi hiç yoktu, dolayısıyla ürün satış ve stok raporları dolarlı satışı TL satıştan
    /// ayırt edemiyordu. 0/1 aynı şeydir (TL).
    /// </summary>
    public int CurrencyTypeId { get; set; }

    /// <summary>Hareket anındaki donmuş kur; TL harekette 1.</summary>
    public decimal CurrencyRate { get; set; }

    /// <summary>Birim fiyat, hareketin KENDİ para biriminde. TL harekette UnitPrice ile aynıdır.</summary>
    public decimal CurrencyUnitPrice { get; set; }

    public int? InstallationId { get; set; }
    public Installation? Installation { get; set; }

    public string BagNo { get; set; } = string.Empty;

    public string? SalesmanCode { get; set; }

    public int WarehouseCode { get; set; }
    public Warehouse? Warehouse { get; set; }

    public decimal NetUnitPrice { get; set; }

    public decimal VatRate { get; set; }

    public bool Delivered { get; set; }

    public DateTime Date { get; set; }

    public int LineNo { get; set; }

    public string? CustomerParentCode { get; set; }
}
