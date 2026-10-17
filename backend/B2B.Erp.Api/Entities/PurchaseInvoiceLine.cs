namespace B2B.Erp.Api.Entities;

public enum PurchaseInvoiceLineDiscountType
{
    None = 0,
    Amount = 1,
    Percentage = 2
}

public enum PurchaseInvoiceLineDeliveryStatus
{
    NotDelivered = 0,
    InDelivery = 1,
    Delivered = 2,
    PartiallyDelivered = 3
}

public sealed class PurchaseInvoiceLine : AuditableEntity
{
    public int Id { get; set; }

    public int PurchaseInvoiceId { get; set; }
    public PurchaseInvoice PurchaseInvoice { get; set; } = null!;

    public Guid? ProductId { get; set; }
    public Product? Product { get; set; }

    public string StockCode { get; set; } = string.Empty;

    public int? WarehouseCode { get; set; }
    public Warehouse? Warehouse { get; set; }

    public string? Description { get; set; }

    public decimal Quantity { get; set; }

    public decimal UnitPrice { get; set; }

    /// <summary>
    /// Birim fiyatın BELGENİN KENDİ para birimindeki karşılığı (2026-08-29).
    ///
    /// <see cref="UnitPrice"/> TL çapasıdır — raporlar ve stok maliyeti onu okur.
    /// Bu alan ise tedarikçinin faturasında gerçekte yazan tutardır. Satış faturasında bu
    /// ayrım (<c>InvoiceLine.CurrencyUnitPrice</c>) zaten vardı; alışta yoktu ve dövizli
    /// alışın orijinal tutarı kayıtta HİÇ durmuyordu.
    ///
    /// TL belgede ikisi aynı değeri taşır.
    /// </summary>
    public decimal CurrencyUnitPrice { get; set; }

    public decimal VatRate { get; set; }

    public PurchaseInvoiceLineDiscountType DiscountType { get; set; }

    public decimal DiscountValue { get; set; }

    public PurchaseInvoiceLineDeliveryStatus? DeliveryStatus { get; set; }

    public string? DeliveryTeam { get; set; }

    public DateTime? DeliveryDispatchDate { get; set; }

    public DateTime? DeliveryCompletedDate { get; set; }

    /// <summary>
    /// Satirin MAL mi HIZMET mi oldugu. Satis tarafindaki <see cref="InvoiceLine.Nature"/> ile
    /// ayni kural ve ayni gerekce: nitelik satira KESIM ANINDA damgalanir
    /// (<c>AppDbContext.StampPurchaseInvoiceLineNaturesAsync</c>), sonradan hesaplanmaz.
    ///
    /// <para>
    /// 2026-09-18'de eklendi: alis faturasina nakliye/hizmet bedeli satiri eklenebiliyor.
    /// O satir stok hareketi YAZMAMALI ve hizmet harcama raporunda gruplanabilmeli. Urun
    /// kartindan cikarmaya kalkmak, kart sonradan silinince gecmis satiri MAL'a cevirirdi.
    /// </para>
    /// </summary>
    public Core.Accounting.InvoiceLineNature Nature { get; set; } = Core.Accounting.InvoiceLineNature.Unspecified;

    public int LineNo { get; set; }
}
