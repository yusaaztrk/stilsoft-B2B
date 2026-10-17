namespace B2B.Erp.Api.Entities;

public enum CustomerLedgerEntryDirection
{
    Debit = 1,
    Credit = 2
}

public enum CustomerLedgerEntryReferenceType
{
    Manual = 1,
    Invoice = 2,
    Check = 3,
    Note = 4,
    Cash = 5,
    Virman = 6,
    Bank = 7,
    OpeningBalance = 8
}

public sealed class CustomerLedgerEntry : AuditableEntity
{
    public int Id { get; set; }

    public string CustomerCode { get; set; } = string.Empty;
    public Customer Customer { get; set; } = null!;

    public DateTime Date { get; set; }

    public DateTime? DueDate { get; set; }

    public CustomerLedgerEntryDirection Direction { get; set; }

    public decimal Amount { get; set; }

    public int CurrencyTypeId { get; set; }

    public decimal CurrencyRate { get; set; }

    public decimal CurrencyAmount { get; set; }

    /// <summary>Ödeme yapılan kasa/bankanın para birimi (1=TRY, 2=EUR, 3=USD, 4=GBP)</summary>
    public int PaymentCurrencyTypeId { get; set; }

    /// <summary>Ödeme anındaki döviz kuru (TL karşılığı)</summary>
    public decimal PaymentCurrencyRate { get; set; }

    /// <summary>Kasa/bankaya giren/çıkan birim miktar (döviz cinsinden)</summary>
    public decimal PaymentCurrencyAmount { get; set; }

    /// <summary>
    /// Paranın İŞLENDİĞİ cari döviz hesabı — 0 = belirtilmemiş, 1 = TRY, 2 = EUR, 3 = USD,
    /// 4 = GBP (2026-08-20 kullanıcı isteği).
    ///
    /// Kasa/bankada "hangi cari hesabına yazılacağı" ekrandan seçilir; varsayılan TL hesabı.
    /// Bu alan yalnızca HEDEF DAMGASIDIR: tutar ÇEVRİLMEZ. 1.500 £'lik bir tahsilat EUR
    /// hesabı seçilerek girildiyse satır 1.500 £ olarak durur, yalnızca hangi hesaba
    /// işlendiği burada yazar.
    ///
    /// Neden çevrim yok: seçici bir dönem çapraz kurla çevirim yapıyordu ve 1.500 £'lik işlem
    /// ekstreye 31,66 € düşmüştü (kur ayrıca ters yönde saklanıyordu). Çevrim o yüzden
    /// kaldırılmıştı; seçim geri geldi ama çevrim GERİ GELMEDİ.
    ///
    /// 0 varsayılanı eski satırları olduğu gibi bırakır (hedef bilinmiyor).
    /// </summary>
    public int TargetAccountCurrencyTypeId { get; set; }

    /// <summary>
    /// Döviz çevrimi kodu (<c>DVZ-2026-000001</c>), yalnız gelen para hesabın parasından
    /// FARKLIYSA dolar (2026-08-17). Kasa/banka hareketi ile bu ekstre satırı aynı kodu taşır:
    /// "1.000 $ getirdi, TL kasaya 38.200 ₺ olarak işlendi" tek kodla iki uçtan izlenir.
    /// Muhasebeci kur farkını bu kodla ayıklar; boşsa hareket tek para birimlidir.
    /// </summary>
    public string? ExchangeCode { get; set; }

    public string? DocumentNo { get; set; }

    public string? Description { get; set; }

    public string? TransactionType { get; set; }

    public string? DeliveryCustomerCode { get; set; }

    public CustomerLedgerEntryReferenceType ReferenceType { get; set; }

    public int? ReferenceId { get; set; }

    public int? AccountingPeriodId { get; set; }
    public AccountingPeriod? AccountingPeriod { get; set; }

    public bool IsOpeningBalance { get; set; } = false;

    public int? SourcePeriodId { get; set; }

    public bool IsCancelled { get; set; } = false;

    public int? ReversalTransactionId { get; set; }

    public decimal Balance { get; set; }
}
