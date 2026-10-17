namespace B2B.Erp.Api.Entities;

public enum CashAccountTransactionDirection
{
    In = 1,
    Out = 2
}

public enum CashAccountTransactionCounterpartyType
{
    Customer = 1,
    Bank = 2,
    Muhtelif = 3
}

public enum CashAccountTransactionReferenceType
{
    Manual = 1,
    Invoice = 2,
    Transfer = 3
}

public sealed class CashAccountTransaction : AuditableEntity
{
    public int Id { get; set; }

    public int CashAccountId { get; set; }
    public CashAccount CashAccount { get; set; } = null!;

    public DateTime Date { get; set; }

    public CashAccountTransactionDirection Direction { get; set; }

    public decimal Amount { get; set; }

    public int CurrencyTypeId { get; set; }

    public decimal CurrencyRate { get; set; }

    public decimal CurrencyAmount { get; set; }

    /// <summary>
    /// GELEN/GİDEN PARANIN KENDİ para birimi (2026-08-17): müşteri 1.000 DOLAR getirip TL
    /// kasaya yazdırdıysa burada USD durur, <see cref="CurrencyTypeId"/>'de kasanın parası (TL).
    /// 0 = çevrim yok, para hesabın para birimiyle aynı (eski kayıtların tamamı böyle).
    /// </summary>
    public int TenderCurrencyTypeId { get; set; }

    /// <summary>Gelen paranın işlem günündeki kuru (1 birim = X ₺). Çevrim yoksa hesabın kuru.</summary>
    public decimal TenderRate { get; set; }

    /// <summary>Fiziken gelen/giden tutar, gelen paranın kendi biriminde (1.000 $ gibi).</summary>
    public decimal TenderAmount { get; set; }

    /// <summary>
    /// Döviz çevrimi yapılan hareketlere verilen izlenebilir kod (<c>DVZ-2026-000001</c>).
    /// Yalnız gelen para hesabın parasından FARKLIYSA doldurulur; kasa hareketi ile onun cari
    /// ekstresindeki karşılığı aynı kodu taşır, muhasebe iki ucu bu kodla eşleştirir.
    /// </summary>
    public string? ExchangeCode { get; set; }

    public CashAccountTransactionCounterpartyType CounterpartyType { get; set; }

    public string CounterpartyCode { get; set; } = string.Empty;

    public string CounterpartyName { get; set; } = string.Empty;

    public CashAccountTransactionReferenceType ReferenceType { get; set; }

    public int? ReferenceId { get; set; }

    public int? LinkedBankAccountTransactionId { get; set; }

    /// <summary>
    /// Kasa fişinin belge numarası. Yevmiye defterinde her satırın belge numarası olmak
    /// zorunda; veritabanı <see cref="Id"/>'si bunun yerine geçmez — kullanıcıya gösterilmez,
    /// seri/dönem taşımaz. Banka hareketinde bu alan zaten vardı, kasada yoktu.
    /// </summary>
    public string? DocumentNo { get; set; }

    public string? Description { get; set; }
}
