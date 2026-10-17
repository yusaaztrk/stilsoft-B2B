namespace B2B.Erp.Api.Entities;

/// <summary>
/// Bir taksite yapılan ödeme. AYRI TABLO çünkü kısmi ödemeye izin veriliyor
/// (kullanıcı kararı, 2026-08-12): bir taksit birden fazla ödemeyle kapanabilir.
///
/// Taksitin durumu (Bekliyor / Kısmi / Ödendi) bu satırların toplamından HESAPLANIR,
/// taksite yazılmaz — bir ödeme silindiğinde yazılı durum yalan söylerdi.
/// </summary>
public sealed class LoanPayment : AuditableEntity
{
    public int Id { get; set; }

    /// <summary>Taksitten de bulunabilir; kredi bazlı toplamlar her seferinde join istemesin diye burada.</summary>
    public int LoanId { get; set; }
    public Loan? Loan { get; set; }

    public int LoanInstallmentId { get; set; }
    public LoanInstallment? Installment { get; set; }

    public DateTime Date { get; set; }

    /// <summary>Ödenen tutar, KREDİNİN para biriminde.</summary>
    public decimal Amount { get; set; }

    /// <summary>Ödeme anındaki TL kuru. TL kredide 1.</summary>
    public decimal CurrencyRate { get; set; } = 1m;

    /// <summary>TL karşılığı — döviz kredide kur farkını görebilmek için ödeme anında dondurulur.</summary>
    public decimal TryAmount { get; set; }

    /// <summary>Paranın çıktığı banka hesabı.</summary>
    public int BankAccountDefinitionId { get; set; }
    public BankAccountDefinition? BankAccountDefinition { get; set; }

    /// <summary>
    /// Oluşturulan banka hareketi. Ödeme banka bakiyesine işlemezse kredi ekranı "ödedim" der,
    /// banka raporu parayı hâlâ hesapta gösterir — iki ayrı gerçek oluşur.
    /// </summary>
    public int? BankAccountTransactionId { get; set; }

    public string? Description { get; set; }
}
