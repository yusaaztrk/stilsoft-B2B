namespace B2B.Erp.Api.Entities;

public enum BankAccountTransactionDirection
{
    In = 1,
    Out = 2
}

public enum BankAccountTransactionCounterpartyType
{
    Customer = 1,
    Bank = 2,
    Supplier = 3
}

/// <summary>
/// BANKA MASRAFININ TÜRÜ (2026-08-20 kullanıcı kararı).
///
/// <para>
/// Masraf tek bir <c>IsPosFee</c> bayrağıyla tutuluyordu: sistemde yalnızca "POS masrafı"
/// diye tek bir gider vardı ve kredi kullandırım masrafı gibi kalemler ya hiç girilmiyor ya
/// da düz bir çıkış hareketi olarak kaybediliyordu. Tür alanı, aynı satırın hangi masraf
/// hesabına ait olduğunu söyler; banka bazında "ne kadar POS, ne kadar kredi masrafı
/// ödedik" sorusunun cevabı budur.
/// </para>
///
/// <para>
/// <b>0 = masraf değil.</b> Tablodaki her satır bir masraf değil; eski satırlar ve normal
/// para hareketleri 0 ile durur. <see cref="BankAccountTransaction.IsPosFee"/> bayrağı
/// KALDIRILMADI — dış ekranlar ve silme yolu onu okuyor — yalnızca POS masrafında true
/// kalır, yani <c>IsPosFee == (ExpenseType == PosFee)</c>.
/// </para>
/// </summary>
public enum BankExpenseType
{
    None = 0,
    /// <summary>POS komisyonu / kesintisi.</summary>
    PosFee = 1,
    /// <summary>Kredi kullandırım (kullanım) masrafı.</summary>
    LoanUsageFee = 2,
    /// <summary>Havale/EFT işlem masrafı.</summary>
    TransferFee = 3,
    /// <summary>Hesap işletim ücreti.</summary>
    AccountFee = 4,
    /// <summary>Diğer banka masrafları.</summary>
    Other = 9
}

public sealed class BankAccountTransaction : AuditableEntity
{
    public int Id { get; set; }

    public int BankAccountDefinitionId { get; set; }
    public BankAccountDefinition BankAccountDefinition { get; set; } = null!;

    public DateTime Date { get; set; }

    public BankAccountTransactionDirection Direction { get; set; }

    public decimal Amount { get; set; }

    public int CurrencyTypeId { get; set; }

    public decimal CurrencyRate { get; set; }

    public decimal CurrencyAmount { get; set; }

    /// <summary>
    /// GELEN/GİDEN PARANIN KENDİ para birimi (2026-08-17): 1.000 DOLAR gelip TL hesaba
    /// yatırıldıysa burada USD, <see cref="CurrencyTypeId"/>'de hesabın parası (TL) durur.
    /// 0 = çevrim yok. Kardeşi <see cref="CashAccountTransaction"/> ile birebir aynı kural.
    /// </summary>
    public int TenderCurrencyTypeId { get; set; }

    /// <summary>Gelen paranın işlem günündeki kuru (1 birim = X ₺). Çevrim yoksa hesabın kuru.</summary>
    public decimal TenderRate { get; set; }

    /// <summary>Fiziken gelen/giden tutar, gelen paranın kendi biriminde.</summary>
    public decimal TenderAmount { get; set; }

    /// <summary>Döviz çevrimi kodu (<c>DVZ-2026-000001</c>); yalnız çevrim varsa dolar.</summary>
    public string? ExchangeCode { get; set; }

    public BankAccountTransactionCounterpartyType CounterpartyType { get; set; }

    public string CounterpartyCode { get; set; } = string.Empty;

    public string CounterpartyName { get; set; } = string.Empty;

    public string? DocumentNo { get; set; }

    public DateTime? MaturityDate { get; set; }

    public string? Description { get; set; }

    public bool IsPosFee { get; set; }

    /// <summary>
    /// Bu hareket bir ÇEKTEN doğduysa çekin kimliği; değilse <c>null</c>.
    /// </summary>
    /// <remarks>
    /// (2026-08-24, kullanıcı kararı: "çeki iptal edince, portföye alınca o hareketlerin
    /// silinmesi lazım".)
    ///
    /// Teminata verilen çek bankanın teminat hesabına giriş yazıyor; çek portföye döndüğünde,
    /// tahsil edildiğinde ya da iptal olduğunda o satır SİLİNİR — teminat hesabı "şu an
    /// teminatta olan çekler"i göstermeli.
    ///
    /// Silinecek satırı açıklama metnine bakarak bulmak kırılgandı: açıklama biçimi değişirse
    /// ya da kullanıcı elle düzenlerse eşleşme kaybolur ve hesapta hayalet satır kalırdı.
    /// Kimlik alanı bu bağı kesinleştirir.
    /// </remarks>
    public int? CheckId { get; set; }

    /*
      POS MASRAFINDA VERGİ AYRIŞTIRMASI (2026-08-20 kullanıcı kararı, denetim md. A4).

      POS komisyonu TEK kalem gider olarak yazılıyordu: bankanın kestiği tutarın içindeki
      BSMV ve KDV bileşenleri hiçbir yerde görünmüyordu, dolayısıyla KDV indirimi için
      ayrıştırma elle yapılmak zorundaydı.

      KURAL — para hareketi DEĞİŞMEZ. `Amount` bankanın hesaptan çektiği BRÜT tutardır ve
      bugüne kadar ne yazıyorsa aynısını yazmaya devam eder. Aşağıdaki alanlar o brüt
      tutarın İÇİNDEKİ bileşenleri açıklar; bakiyeye ayrıca eklenmez, ayrıca düşülmez.

      Oranların ikisi de ELLE ayarlanır (kullanıcı kararı: "elle ayarlanabilir olsun
      ikisi de"): banka ve ürüne göre değişir, sabit bir oran varsaymak yanlış olur.
      Varsayılan 0 — oran girilmediği sürece davranış birebir eskisi gibidir ve eski
      kayıtlar 0 ile okunur (ayrıştırma yok demek), yanlış bir ayrıştırma üretilmez.
    */

    /// <summary>POS masrafına uygulanan BSMV oranı, yüzde olarak (5 = %5). 0 = ayrıştırma yok.</summary>
    public decimal PosFeeBsmvRate { get; set; }

    /// <summary>POS masrafına uygulanan KDV oranı, yüzde olarak (20 = %20). 0 = ayrıştırma yok.</summary>
    public decimal PosFeeVatRate { get; set; }

    /// <summary>Brüt masrafın içindeki BSMV tutarı (hesabın para biriminde, `Amount` ile aynı çapa).</summary>
    public decimal PosFeeBsmvAmount { get; set; }

    /// <summary>Brüt masrafın içindeki KDV tutarı (hesabın para biriminde, `Amount` ile aynı çapa).</summary>
    public decimal PosFeeVatAmount { get; set; }

    /*
      MASRAF HESABI AYRIMI (2026-08-20 kullanıcı kararı).

      "Her bankanın ayrı POS masraf hesabı vardır" — masraf satırı hangi banka hesabına
      aitse orada, O HESABIN PARA BİRİMİNDE görünmeli. Tutar zaten `CurrencyAmount`ta
      hesabın parasında, `Amount`ta TL çapasında duruyor; eksik olan satırın NE MASRAFI
      olduğuydu. `IsPosFee` tek bir gider türü varsayıyordu.
    */

    /// <summary>
    /// Masraf türü. 0 = bu satır bir masraf değil (normal para hareketi).
    /// Bkz. <see cref="BankExpenseType"/>.
    /// </summary>
    public int ExpenseType { get; set; }

    /// <summary>
    /// Kredi kullanım masrafında ilgili kredi (<c>Loans.Id</c>). Diğer türlerde null.
    ///
    /// <para>
    /// FK VERİLMEDİ — bir masraf satırı, ilişkilendirildiği kredinin silinmesini
    /// engellememelidir; masraf gerçekten ödenmiş paradır ve kredi kaydından bağımsız
    /// durur. Kredi silinirse alan öksüz kalır, satır kaybolmaz.
    /// </para>
    /// </summary>
    public int? ExpenseLoanId { get; set; }
}
