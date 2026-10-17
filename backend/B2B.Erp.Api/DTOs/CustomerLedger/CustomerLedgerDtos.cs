using B2B.Erp.Api.Entities;

namespace B2B.Erp.Api.Dtos.CustomerLedger;

public sealed class CustomerLedgerListItemDto
{
    public int Id { get; set; }

    public string CustomerCode { get; set; } = string.Empty;

    public string DisplayCustomerCode { get; set; } = string.Empty;

    public string SourceCustomerCode { get; set; } = string.Empty;

    public string TransactionAccountType { get; set; } = "ACIK";

    public string CustomerName { get; set; } = string.Empty;

    public string? DeliveryCustomerCode { get; set; }

    public string? DeliveryCustomerName { get; set; }

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

    /// <summary>Ödeme yapılan kasa/bankanın para birimi ID'si</summary>
    public int PaymentCurrencyTypeId { get; set; }

    /// <summary>Ödeme anındaki döviz kuru</summary>
    public decimal PaymentCurrencyRate { get; set; }

    /// <summary>Kasa/bankaya giren birim miktar</summary>
    public decimal PaymentCurrencyAmount { get; set; }

    /// <summary>
    /// Paranın İŞLENDİĞİ cari döviz hesabı: 0 = belirtilmemiş (eski satırlar), 1 = TRY,
    /// 2 = EUR, 3 = USD, 4 = GBP.
    ///
    /// Kasa/banka ekranında seçilir (varsayılan TL). Tutar bu hesaba ÇEVRİLMEZ — satır
    /// ödemenin kendi para biriminde durur, bu alan yalnızca hedefi damgalar.
    /// </summary>
    public int TargetAccountCurrencyTypeId { get; set; }

    /// <summary>
    /// Döviz çevrimi kodu (<c>DVZ-2026-000001</c>) — yalnız gelen para, paranın işlendiği
    /// hesabın para biriminden FARKLIYSA dolu (2026-08-17). Ekstrede "1.000 $ getirdi,
    /// TL kasaya 38.200 ₺ işlendi" satırını kasa hareketine bu kod bağlar.
    /// </summary>
    public string? ExchangeCode { get; set; }

    /// <summary>
    /// TL üzerinden yürüyen bakiye. Karışık dövizli caride tek başına ANLAMLI DEĞİLDİR —
    /// geriye dönük uyumluluk için korunuyor (Excel, mail ve mevcut ekranlar bunu okuyor).
    /// Gerçek bakiye için <see cref="CurrencyBalance"/>.
    /// </summary>
    public decimal Balance { get; set; }

    /// <summary>
    /// Satırın KENDİ para biriminde yürüyen bakiye. TL satırı TL bakiyesini, USD satırı USD
    /// bakiyesini ilerletir; diller birbirine karışmaz. "Tümü" görünümünde bile her satır
    /// kendi dövizinin bakiyesini gösterir.
    /// </summary>
    public decimal CurrencyBalance { get; set; }

    public CustomerLedgerEntryReferenceType ReferenceType { get; set; }

    public int? ReferenceId { get; set; }

    public bool HasDetails { get; set; }
}

public sealed class CustomerLedgerSummaryDto
{
    public decimal TotalDebit { get; set; }

    public decimal TotalCredit { get; set; }

    public decimal Balance { get; set; }
}

/// <summary>
/// Para birimi başına bakiye. Cari birden çok dövizde çalışıyorsa bakiye TEK SAYIYA
/// indirilemez: TL alacağı ile USD alacağı ayrı hesaplardır (KKTC tekdüzen hesap planında
/// da 120.1 / 120.22 diye ayrılmıştır) ve birbirine mahsup edilmez.
/// </summary>
public sealed class CustomerLedgerCurrencyBalanceDto
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

public sealed class CustomerLedgerListResponseDto
{
    public string CustomerCode { get; set; } = string.Empty;

    public string CustomerName { get; set; } = string.Empty;

    public string? Mail { get; set; }

    public string? Phone { get; set; }

    public CustomerLedgerSummaryDto Summary { get; set; } = new();

    public CustomerLedgerSummaryDto OpenSummary { get; set; } = new();

    public CustomerLedgerSummaryDto InvoiceSummary { get; set; } = new();

    /// <summary>
    /// Para birimi başına bakiye — hareketi olan her döviz için bir satır. TL'den başka
    /// hareketi olmayan caride tek eleman döner ve ekran bugünküyle aynı görünür.
    /// </summary>
    public List<CustomerLedgerCurrencyBalanceDto> CurrencyBalances { get; set; } = new();

    public List<CustomerLedgerListItemDto> Items { get; set; } = new();
}

public sealed class CustomerLedgerDetailLineDto
{
    public int Id { get; set; }

    public string StockCode { get; set; } = string.Empty;

    public string StockName { get; set; } = string.Empty;

    public string Description { get; set; } = string.Empty;

    public string Montaj { get; set; } = string.Empty;

    public string Barcode { get; set; } = string.Empty;

    public decimal Quantity { get; set; }

    public decimal UnitPrice { get; set; }

    public decimal Total { get; set; }

    public int CurrencyTypeId { get; set; }

    public decimal CurrencyUnitPrice { get; set; }

    public decimal CurrencyTotal { get; set; }

    /// <summary>
    /// Kalemin KDV oranı (%). Ekstre satırının Borç/Alacak tutarı KDV DAHİLDİR; kalem
    /// dökümü KDV hariç toplarsa aradaki fark ekranda "indirim" gibi görünür
    /// (kullanıcı bildirimi 2026-08-19: 1.500 $ fatura, kalem toplamı 1.363,64 $).
    /// </summary>
    public decimal VatRate { get; set; }

    public bool IsGift { get; set; }
}
