using B2B.Erp.Api.Entities;

namespace B2B.Erp.Api.Dtos.SupplierLedger;

public sealed class SupplierLedgerListItemDto
{
    public int Id { get; set; }

    public string SupplierCode { get; set; } = string.Empty;

    public string SupplierName { get; set; } = string.Empty;

    public DateTime Date { get; set; }

    public DateTime? DueDate { get; set; }

    public string? DocumentNo { get; set; }

    public string? Description { get; set; }

    public string? TransactionType { get; set; }

    public decimal Debit { get; set; }

    public decimal Credit { get; set; }

    public int CurrencyTypeId { get; set; }

    public decimal CurrencyRate { get; set; }

    public decimal CurrencyAmount { get; set; }

    /// <summary>
    /// TL ÇAPASINDA yürüyen bakiye. Para birimleri karışır — ekranda tek başına
    /// gösterilmez; gerçek bakiye <see cref="CurrencyBalance"/>.
    /// </summary>
    public decimal Balance { get; set; }

    /// <summary>
    /// SATIRIN KENDİ PARA BİRİMİNDE yürüyen bakiye (2026-09-01).
    ///
    /// Müşteri ekstresinde bu alan vardı, tedarikçi ekstresinde YOKTU: ekran her satırda
    /// TL çapasını gösterip satırın döviz simgesiyle etiketliyordu. Aynı tedarikçinin bir
    /// partisi USD diğeri TL yazıldığında bakiye kolonu anlamsız bir karışım oluyordu.
    /// Mahsup yok: her para birimi kendi kovasında ilerler.
    /// </summary>
    public decimal CurrencyBalance { get; set; }

    public SupplierLedgerEntryReferenceType ReferenceType { get; set; }

    public int? ReferenceId { get; set; }

    public bool HasDetails { get; set; }
}

public sealed class SupplierLedgerSummaryDto
{
    public decimal TotalDebit { get; set; }

    public decimal TotalCredit { get; set; }

    public decimal Balance { get; set; }
}

/// <summary>
/// Tedarikçi ekstresinde PARA BİRİMİ BAŞINA bakiye (2026-08-17, kullanıcı kararı).
///
/// Müşteri ekstresinde bu vektör vardı, tedarikçi tarafında yoktu: dolarla çalışılan bir
/// tedarikçide "kaç dolar borçluyuz" görünmüyor, yalnızca TL çapası toplanıyordu. Skaler
/// alanlar (`TotalDebit`/`TotalCredit`/`Balance`) TL olarak AYNEN duruyor — eski ekranlar,
/// Excel çıktısı ve mutabakat onları okuyor.
/// </summary>
public sealed class SupplierLedgerCurrencyBalanceDto
{
    public int CurrencyTypeId { get; set; }

    /// <summary>TRY / USD / EUR / GBP</summary>
    public string CurrencyCode { get; set; } = "TRY";

    public string CurrencySymbol { get; set; } = "₺";

    public decimal TotalDebit { get; set; }

    public decimal TotalCredit { get; set; }

    /// <summary>Dönem başı devri dahil kapanış bakiyesi.</summary>
    public decimal Balance { get; set; }

    /// <summary>Dönem başı devri (from verilmişse), o para biriminde.</summary>
    public decimal Opening { get; set; }
}

public sealed class SupplierLedgerListResponseDto
{
    public string SupplierCode { get; set; } = string.Empty;

    public string SupplierName { get; set; } = string.Empty;

    public SupplierLedgerSummaryDto Summary { get; set; } = new();

    /// <summary>Para birimi başına borç/alacak/devir/bakiye. Skaler özet TL olarak korunuyor.</summary>
    public List<SupplierLedgerCurrencyBalanceDto> CurrencyBalances { get; set; } = new();

    public List<SupplierLedgerListItemDto> Items { get; set; } = new();
}

public sealed class SupplierLedgerDetailLineDto
{
    public int Id { get; set; }

    public string StockCode { get; set; } = string.Empty;

    public string StockName { get; set; } = string.Empty;

    public string Barcode { get; set; } = string.Empty;

    public decimal Quantity { get; set; }

    public decimal UnitPrice { get; set; }

    public decimal Total { get; set; }

    public int CurrencyTypeId { get; set; }

    public decimal CurrencyUnitPrice { get; set; }

    public decimal CurrencyTotal { get; set; }

    public bool IsGift { get; set; }
}
