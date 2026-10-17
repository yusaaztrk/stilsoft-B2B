using System.Collections.Generic;
using System.ComponentModel.DataAnnotations;

namespace B2B.Erp.Api.Dtos.CustomerOffers;

public sealed class TransferCustomerOfferToInvoiceRequest
{
    [MaxLength(2)]
    public string? InvoiceSerie { get; set; }

    [Range(0, 99999999999999)]
    public long? InvoiceNumber { get; set; }

    public int? WarehouseCode { get; set; }

    public string? TargetAccountType { get; set; } // "FATURA" (-1), "ACIK" (-2), "ASKERIYE" (-3)

    public string? TargetCustomerCode { get; set; } // Explicit sub-account code if specified

    public List<TransferOfferLineWarehouseDto>? LineWarehouses { get; set; }

    // Aktarım penceresindeki kur çubuğundan gelen ELLE girilmiş kurlar (1 birim = ? TL).
    // Dolu ve pozitifse o para birimi için TCMB kuru yerine bu kullanılır; boşsa davranış
    // eskisiyle aynı kalır (günün TCMB kuru). Satış faturasındaki `InvoiceCurrencyRate`
    // ile aynı mantık, sadece üç para birimi birden taşınıyor.
    [Range(0, 1000000)]
    public decimal? UsdRate { get; set; }

    [Range(0, 1000000)]
    public decimal? EurRate { get; set; }

    [Range(0, 1000000)]
    public decimal? GbpRate { get; set; }
}

public sealed class TransferOfferLineWarehouseDto
{
    public int LineId { get; set; } // CustomerOfferLine.Id

    public int WarehouseCode { get; set; }
}
