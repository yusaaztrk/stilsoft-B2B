namespace B2B.Erp.Api.Entities;

/// <summary>
/// Faiz oranının hangi döneme ait olduğu. KKTC'de bankalar ikisini de kullanıyor ve
/// aradaki fark 12 kat — hangisi olduğu kayıtta yazılı olmazsa taksit planı sessizce
/// yanlış üretilir.
/// </summary>
public enum LoanInterestRatePeriod
{
    Annual = 1,
    Monthly = 2
}

/// <summary>
/// Bankadan çekilen taksitli kredi (BİZİM borcumuz).
///
/// Sanal POS'taki <c>InstallmentRule</c> / <c>VirtualPosInstallmentRule</c> ile ilgisi YOKTUR —
/// onlar müşterinin kredi kartı taksitleridir, burası bizim bankaya olan borcumuz.
///
/// DURUM SAKLANMIYOR, HESAPLANIYOR: kredi "kapandı" bilgisi ödenmemiş taksit kalmamasından
/// türetilir (bkz. LoansController). Saklansaydı bir ödeme silindiğinde ya da taksit
/// düzeltildiğinde kayıt yalan söyler ve birinin elle geri açması gerekirdi.
/// <see cref="ClosedAt"/> yalnızca ERKEN kapatma içindir: kalan anaparayı tek seferde ödeyip
/// kapatmayı hiçbir otomatik kural bilemez.
/// </summary>
public sealed class Loan : AuditableEntity
{
    public int Id { get; set; }

    /// <summary>KRD-2026-0001 biçiminde, sistem üretir.</summary>
    public string LoanCode { get; set; } = string.Empty;

    /// <summary>Bankanın kendi sözleşme/kredi numarası — mutabakatta bunu arıyorlar.</summary>
    public string? ContractNo { get; set; }

    /// <summary>Kredinin bağlı olduğu banka hesabı: taksitler buradan ödenir.</summary>
    public int BankAccountDefinitionId { get; set; }
    public BankAccountDefinition? BankAccountDefinition { get; set; }

    /// <summary>Çekilen anapara.</summary>
    public decimal PrincipalAmount { get; set; }

    /// <summary>
    /// <see cref="Core.Helpers.CurrencyTypeHelper"/> kodları: 1=TRY, 2=EUR, 3=USD, 4=GBP.
    /// (Buradaki "ürün tarafı FARKLI, orada USD=43" uyarısı ARTIK GEÇERSİZ: ürün kodlaması
    /// tek bir UPDATE ile bu kodlamaya göç ettirildi, sistemde tek kodlama var.)
    /// </summary>
    public int CurrencyTypeId { get; set; }

    /// <summary>Yüzde olarak faiz oranı; dönemi <see cref="InterestRatePeriod"/> söyler.</summary>
    public decimal InterestRate { get; set; }

    public LoanInterestRatePeriod InterestRatePeriod { get; set; } = LoanInterestRatePeriod.Annual;

    public int InstallmentCount { get; set; }

    /// <summary>Kullandırım tarihi (paranın hesaba geçtiği gün).</summary>
    public DateTime StartDate { get; set; }

    public DateTime FirstInstallmentDate { get; set; }

    /// <summary>
    /// Vade sonu (son taksit tarihi).
    ///
    /// Plandan da türetilebilir ama bankanın kendi belgesinde AYRI bir alan olarak yazılı ve
    /// mutabakatta ona bakılıyor. Boş bırakılırsa plan üretilirken son taksitin tarihiyle
    /// doldurulur.
    /// </summary>
    public DateTime? EndDate { get; set; }

    /// <summary>
    /// BSİV oranı, FAİZ ÜZERİNDEN yüzde. Varsayılan 3.
    ///
    /// Banka planlarında ayrı bir kolon ve taksit tutarına DAHİL:
    /// taksit = anapara + faiz + BSİV. Altı örnek belgenin dördünde faizin tam %3'ü çıkıyor.
    /// Beşincisinde (GBP 150.000) hiç yok — bu yüzden oran krediye ait bir alan, sistem
    /// sabiti değil. 0 yazılırsa BSİV hiç hesaplanmaz.
    /// </summary>
    public decimal BsivRate { get; set; } = 3m;

    /// <summary>
    /// Bankanın belgesinde yazan taksit tutarı. 0 = sistem kendisi hesaplasın.
    ///
    /// NEDEN VAR: üretilen plan bankanın faiz ve BSİV rakamlarını satır satır tutturuyor ama
    /// EŞİT TAKSİT TUTARI birkaç lira sapabiliyor — bankaların gün/yuvarlama kuralları
    /// belgeden geri çıkarılamıyor (bir örnekte 31 günlük dönem 32 günlük faiz taşıyor).
    /// Tutar zaten belgenin üstünde yazılı olduğu için, tahmin etmek yerine yazdırmak hem
    /// kesin hem kolay. Verilirse plan bu tutar üzerinden kurulur, arama hiç yapılmaz.
    /// </summary>
    public decimal InstallmentAmount { get; set; }

    /// <summary>Bankadaki kredi hesap numarası (belgedeki "Hesap No").</summary>
    public string? AccountNo { get; set; }

    /// <summary>UBAN / IBAN — mutabakatta aranan ikinci numara.</summary>
    public string? Iban { get; set; }

    /// <summary>"TİCARİ KREDİ" gibi. Bilgi amaçlı, hesaba girmez.</summary>
    public string? ProductName { get; set; }

    /// <summary>Bankadaki müşteri numarası (belgedeki "Müşteri Crm No"). Bilgi amaçlı.</summary>
    public string? CustomerCrmNo { get; set; }

    /// <summary>
    /// "Standart (Eşit taksitli)" gibi. Şu an plan üretimi yalnızca eşit taksit yapıyor;
    /// alan, farklı plan türü olan kredilerin belgesini birebir taşıyabilmek için yazılı.
    /// </summary>
    public string? PlanType { get; set; }

    /// <summary>"Ayda bir" gibi. Faiz dönemlerinin sıklığı; bilgi amaçlı yazılır.</summary>
    public string? CapitalizePeriod { get; set; }

    /// <summary>Dosya masrafı, vergiler vb. — taksitlere dağıtılmayan tek seferlik bedeller.</summary>
    public decimal Fees { get; set; }

    public string? Description { get; set; }

    /// <summary>Yalnızca erken kapatmada dolar. Normal bitişte NULL kalır, durum hesaplanır.</summary>
    public DateTime? ClosedAt { get; set; }

    public DateTime? CancelledAt { get; set; }

    public ICollection<LoanInstallment> Installments { get; set; } = new List<LoanInstallment>();
}
