using System.ComponentModel.DataAnnotations;

namespace B2B.Erp.Api.Dtos.Invoices;

public sealed class MarkInvoicePaidRequest
{
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

    public bool? IsManualPayment { get; set; }

    [Range(0, double.MaxValue)]
    public decimal? PosFee { get; set; }

    /*
      POS MASRAFI VERGİ ORANLARI (2026-08-20 kullanıcı kararı, denetim md. A4).
      Yüzde olarak (5 = %5); elle ayarlanır, boş/0 = ayrıştırma yok. `PosFee` BRÜT kalır.
    */
    public decimal? PosFeeBsmvRate { get; set; }

    public decimal? PosFeeVatRate { get; set; }

    public bool? IsPriceOverridden { get; set; }
}
