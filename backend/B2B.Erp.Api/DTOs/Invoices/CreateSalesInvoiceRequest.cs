using System.ComponentModel.DataAnnotations;
using B2B.Erp.Api.Controllers;

namespace B2B.Erp.Api.Dtos.Invoices;


public enum DiscountType
{
    Amount = 0,
    Percentage = 1
}

public sealed class CreateSalesInvoiceRequest
{
    [Required]
    [MaxLength(50)]
    public string CustomerCode { get; set; } = string.Empty;

    [Required]
    [MaxLength(50)]
    public string DeliveryCustomerCode { get; set; } = string.Empty;

    [MaxLength(2)]
    public string? InvoiceSerie { get; set; }

    [Range(0, long.MaxValue)]
    public long? InvoiceNumber { get; set; }

    [Required(ErrorMessage = "Depo seçimi zorunludur")]
    public int? WarehouseCode { get; set; }

    public DateTime Date { get; set; }

    public bool VatIncluded { get; set; }

    public DiscountType DiscountType { get; set; }

    [Range(0, double.MaxValue)]
    public decimal DiscountValue { get; set; }

    [MaxLength(2000)]
    public string? Description { get; set; }

    [Required]
    [MinLength(1)]
    public List<CreateSalesInvoiceLineRequest> Lines { get; set; } = new();

    public decimal CampaignDiscount { get; set; }
    public string? CampaignDetailsJson { get; set; }

    public bool TakePaymentNow { get; set; }

    [Range(0, double.MaxValue)]
    public decimal CurrencyRate { get; set; }

    [Range(0, double.MaxValue)]
    public decimal? CashReceivedAmount { get; set; }

    [Range(0, double.MaxValue)]
    public decimal? InvoiceCurrencyRate { get; set; }

    [Range(1, int.MaxValue)]
    public int? CashAccountId { get; set; }

    [Range(1, int.MaxValue)]
    public int? BankAccountDefinitionId { get; set; }

    [Range(1, int.MaxValue)]
    public int? ChangeCashAccountId { get; set; }

    [Range(1, int.MaxValue)]
    public int? ChangeBankAccountDefinitionId { get; set; }

    [Range(0, double.MaxValue)]
    public decimal? ChangeCurrencyRate { get; set; }

    public bool? IsPriceOverridden { get; set; }
}

public sealed class CreateSalesInvoiceLineRequest
{
    [Range(1, int.MaxValue)]
    public int SalesOrderLineId { get; set; }

    [Range(0.001, double.MaxValue)]
    public decimal InvoiceQuantity { get; set; }

    /// <summary>
    /// Bu kalemin ÇIKIŞ DEPOSU (kullanıcı kuralı, 2026-08-13). Verilmezse faturanın başlık
    /// deposu kullanılır — eski davranış aynen sürüyor, tek fark artık her kalem kendi deposunu
    /// taşıyabiliyor.
    ///
    /// Servisten gelen kalemde ekran bunu <c>SalesOrderLine.SourceWarehouseCode</c> ile doldurur:
    /// parça teknisyenin arabasından çıktıysa stok oradan düşmeli, faturayı imzalayan müdürün
    /// deposundan değil.
    /// </summary>
    [Range(1, int.MaxValue)]
    public int? WarehouseCode { get; set; }

    public CreateInvoiceLineInstallationRequest? Installation { get; set; }
}
