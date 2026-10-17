using B2B.Erp.Api.Entities;

namespace B2B.Erp.Api.Dtos.PurchaseInvoices;

public sealed class PurchaseInvoiceLineResponse
{
    public int Id { get; set; }
    public Guid? ProductId { get; set; }
    public string StockCode { get; set; } = string.Empty;
    public int? WarehouseCode { get; set; }
    public string StockName { get; set; } = string.Empty;
    public string? Description { get; set; }
    public decimal Quantity { get; set; }
    public decimal UnitPrice { get; set; }

    /// <summary>Birim fiyatın belgenin kendi para birimindeki karşılığı (2026-08-29).</summary>
    public decimal CurrencyUnitPrice { get; set; }
    public decimal VatRate { get; set; }
    public int DiscountType { get; set; }
    public decimal DiscountValue { get; set; }
    public PurchaseInvoiceLineDeliveryStatus? DeliveryStatus { get; set; }
    public string? DeliveryTeam { get; set; }
    public DateTime? DeliveryDispatchDate { get; set; }
    public DateTime? DeliveryCompletedDate { get; set; }
    public int LineNo { get; set; }
    public int CurrencyCode { get; set; }
}

public sealed class PurchaseInvoiceListItemResponse
{
    public int Id { get; set; }
    public bool Approved { get; set; }
    public DateTime Date { get; set; }
    public string DocumentNo { get; set; } = string.Empty;

    public PurchaseInvoiceKind Kind { get; set; }

    public string? SupplierCode { get; set; }

    public string? ServiceCode { get; set; }

    public string? CustomerCode { get; set; }
    public string? CustomerName { get; set; }
    public string? SalesmanCode { get; set; }
    public string? Description { get; set; }
    public bool VatExempt { get; set; }

    /// <summary>Belgenin para birimi (1 TL, 2 EUR, 3 USD, 4 GBP) — KAYITTAN, ürün kartından değil.</summary>
    public int CurrencyTypeId { get; set; }

    /// <summary>Belgenin kuru; TL çapasına çevrimde kullanılan değer.</summary>
    public decimal ExchangeRate { get; set; }

    /// <summary>Kurun kaynağı: "TCMB" ya da "Manuel".</summary>
    public string? RateSource { get; set; }

    public decimal Subtotal { get; set; }
    public decimal DiscountTotal { get; set; }
    public decimal NetTotal { get; set; }
    public decimal VatTotal { get; set; }
    public decimal GrandTotal { get; set; }
    public string? CreateUser { get; set; }
    public PurchaseInvoiceTerminStatus TerminStatus { get; set; }
    public DateTime? EstimatedArrivalDate { get; set; }
    public int? CashAccountId { get; set; }
    public List<PurchaseInvoiceLineResponse> Lines { get; set; } = new();
}
