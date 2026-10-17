using System.ComponentModel.DataAnnotations;
using B2B.Erp.Api.Entities;

namespace B2B.Erp.Api.Dtos.Loans;

/// <summary>
/// Kredinin ekranda görünen durumu. VERİTABANINDA TUTULMAZ — her okumada hesaplanır.
/// Saklansaydı bir ödeme silindiğinde ya da taksit düzeltildiğinde yalan söylerdi.
/// </summary>
public enum LoanStatusDto
{
    Active = 1,
    Closed = 2,
    Cancelled = 3
}

public enum LoanInstallmentStatusDto
{
    Pending = 1,
    Partial = 2,
    Paid = 3,
    Overdue = 4
}

// UpdateLoanRequest bundan türüyor — sealed olamaz.
public class CreateLoanRequest
{
    /// <summary>Boş bırakılırsa sistem üretir (KRD-yyyy-0001).</summary>
    public string? LoanCode { get; set; }

    [MaxLength(50)]
    public string? ContractNo { get; set; }

    [Range(1, int.MaxValue, ErrorMessage = "Banka hesabı seçilmelidir.")]
    public int BankAccountDefinitionId { get; set; }

    [Range(0.01, 999999999999, ErrorMessage = "Anapara sıfırdan büyük olmalıdır.")]
    public decimal PrincipalAmount { get; set; }

    public int CurrencyTypeId { get; set; }

    [Range(0, 1000, ErrorMessage = "Faiz oranı 0 ile 1000 arasında olmalıdır.")]
    public decimal InterestRate { get; set; }

    public LoanInterestRatePeriod InterestRatePeriod { get; set; } = LoanInterestRatePeriod.Annual;

    [Range(1, 600, ErrorMessage = "Taksit sayısı 1 ile 600 arasında olmalıdır.")]
    public int InstallmentCount { get; set; }

    public DateTime StartDate { get; set; }

    public DateTime FirstInstallmentDate { get; set; }

    /// <summary>Vade sonu. Boş bırakılırsa üretilen planın son taksit tarihi yazılır.</summary>
    public DateTime? EndDate { get; set; }

    /// <summary>
    /// BSİV oranı — FAİZ ÜZERİNDEN yüzde, taksit tutarına dahil.
    /// Varsayılan 3; BSİV almayan kredilerde 0 verilir.
    /// </summary>
    [Range(0, 100, ErrorMessage = "BSİV oranı 0 ile 100 arasında olmalıdır.")]
    public decimal BsivRate { get; set; } = 3m;

    /// <summary>
    /// Bankanın belgesinde yazan taksit tutarı. 0 / boş = sistem hesaplasın.
    /// Verilirse plan bu tutar üzerinden kurulur ve bankanın tablosuyla birebir oturur.
    /// </summary>
    public decimal InstallmentAmount { get; set; }

    [MaxLength(50)]
    public string? AccountNo { get; set; }

    [MaxLength(50)]
    public string? Iban { get; set; }

    [MaxLength(100)]
    public string? ProductName { get; set; }

    [MaxLength(50)]
    public string? CustomerCrmNo { get; set; }

    [MaxLength(60)]
    public string? PlanType { get; set; }

    [MaxLength(40)]
    public string? CapitalizePeriod { get; set; }

    public decimal Fees { get; set; }

    [MaxLength(2000)]
    public string? Description { get; set; }
}

public sealed class UpdateLoanRequest : CreateLoanRequest
{
    /// <summary>
    /// Ana bilgiler değişince taksit planı yeniden üretilsin mi. Varsayılan HAYIR:
    /// elle düzeltilmiş satırların sessizce silinmesi veri kaybıdır.
    /// Ödemesi olan kredide plan hiçbir koşulda yeniden üretilmez.
    /// </summary>
    public bool RegenerateSchedule { get; set; }
}

public sealed class UpdateLoanInstallmentRequest
{
    public DateTime DueDate { get; set; }
    public decimal Amount { get; set; }
    public decimal PrincipalPart { get; set; }
    public decimal InterestPart { get; set; }
    public decimal BsivPart { get; set; }
}

public sealed class CreateLoanPaymentRequest
{
    [Range(1, int.MaxValue)]
    public int LoanInstallmentId { get; set; }

    public DateTime Date { get; set; }

    /// <summary>Kredinin para biriminde. Boş/0 gönderilirse taksitin kalanı ödenir.</summary>
    public decimal Amount { get; set; }

    /// <summary>Paranın çıkacağı hesap. Boş bırakılırsa kredinin bağlı olduğu hesap.</summary>
    public int? BankAccountDefinitionId { get; set; }

    /// <summary>Döviz kredide TL kuru. 0 gönderilirse güncel kur çekilir.</summary>
    public decimal CurrencyRate { get; set; }

    [MaxLength(2000)]
    public string? Description { get; set; }
}

public sealed class LoanInstallmentDto
{
    public int Id { get; set; }
    public int InstallmentNo { get; set; }
    public DateTime DueDate { get; set; }
    public decimal Amount { get; set; }
    public decimal PrincipalPart { get; set; }
    public decimal InterestPart { get; set; }

    /// <summary>Faiz üzerinden alınan vergi; taksit tutarına dahil.</summary>
    public decimal BsivPart { get; set; }

    /// <summary>Faiz + BSİV — bankanın tablosunda tek kolon olarak gösterdiği yük.</summary>
    public decimal InterestWithBsiv => InterestPart + BsivPart;

    /// <summary>
    /// Bu satırın faiz + BSİV yükünün ödenmiş kısmı.
    ///
    /// Ödeme önce faize sayılır (bankaların yaptığı da bu), artan anaparaya gider. Kısmi
    /// ödemede "ne kadar faiz ödedim" sorusunun tek dürüst cevabı bu.
    /// </summary>
    public decimal PaidInterestWithBsiv { get; set; }

    public decimal PaidAmount { get; set; }
    public decimal RemainingAmount { get; set; }

    /// <summary>
    /// Taksit tamamen kapandığı gün. Kısmi ödemede NULL kalır — banka belgesindeki
    /// "Ödendiği Tarih" de yalnızca kapanan taksitte doludur.
    /// </summary>
    public DateTime? PaidDate { get; set; }

    public DateTime? LastPaymentDate { get; set; }

    /// <summary>
    /// Vadeye göre gecikme/erken ödeme, gün. Pozitif = geç, negatif = erken.
    /// Ödenmemiş taksitte bugüne göre hesaplanır (vadesi geçtiyse pozitif), aksi hâlde null.
    /// </summary>
    public int? LateDays { get; set; }

    /// <summary>
    /// Bu taksit ödendikten SONRA kalan anapara — bankanın tablosundaki "Bakiye" / "Kalan
    /// Anapara" kolonu. Satır satır yürütülerek hesaplanır, saklanmaz.
    /// </summary>
    public decimal RunningBalance { get; set; }

    public LoanInstallmentStatusDto Status { get; set; }
    public List<LoanPaymentDto> Payments { get; set; } = new();
}

public sealed class LoanPaymentDto
{
    public int Id { get; set; }
    public int LoanInstallmentId { get; set; }
    public int InstallmentNo { get; set; }
    public DateTime Date { get; set; }
    public decimal Amount { get; set; }
    public decimal CurrencyRate { get; set; }
    public decimal TryAmount { get; set; }
    public int BankAccountDefinitionId { get; set; }
    public string BankAccountName { get; set; } = string.Empty;
    public int? BankAccountTransactionId { get; set; }
    public string? Description { get; set; }
}

// LoanDetailDto bundan türüyor — sealed olamaz.
public class LoanListItemDto
{
    public int Id { get; set; }
    public string LoanCode { get; set; } = string.Empty;
    public string? ContractNo { get; set; }
    public int BankAccountDefinitionId { get; set; }
    public string BankAccountName { get; set; } = string.Empty;
    public string BankName { get; set; } = string.Empty;
    public decimal PrincipalAmount { get; set; }
    public int CurrencyTypeId { get; set; }
    public string CurrencyCode { get; set; } = "TRY";
    public decimal InterestRate { get; set; }
    public LoanInterestRatePeriod InterestRatePeriod { get; set; }
    public int InstallmentCount { get; set; }
    public DateTime StartDate { get; set; }
    public DateTime FirstInstallmentDate { get; set; }
    public DateTime? EndDate { get; set; }
    public decimal BsivRate { get; set; }

    /// <summary>Elle girilen taksit tutarı; 0 ise plan hesaplanarak üretilmiş demektir.</summary>
    public decimal InstallmentAmount { get; set; }

    public string? AccountNo { get; set; }
    public string? Iban { get; set; }
    public string? ProductName { get; set; }
    public string? CustomerCrmNo { get; set; }
    public string? PlanType { get; set; }
    public string? CapitalizePeriod { get; set; }
    public decimal Fees { get; set; }
    public string? Description { get; set; }

    /// <summary>Plandaki taksitlerin toplamı (anapara + faiz + BSİV).</summary>
    public decimal TotalPayable { get; set; }
    public decimal TotalInterest { get; set; }

    /// <summary>Plandaki BSİV toplamı — faizden ayrı, çünkü biri vergi biri finansman gideri.</summary>
    public decimal TotalBsiv { get; set; }

    /// <summary>Ödenmiş taksitlerin BSİV kısmı.</summary>
    public decimal PaidBsiv { get; set; }

    public decimal PaidAmount { get; set; }
    public decimal RemainingAmount { get; set; }

    /// <summary>Kalan taksitlerin anapara kısmı — "bankaya hâlâ ne kadar anapara borçluyum".</summary>
    public decimal RemainingPrincipal { get; set; }

    /// <summary>
    /// Ödemelerin TL karşılıklarının toplamı.
    ///
    /// Ödeme anındaki kurdan DONDURULMUŞ değerlerin toplamı; güncel kurla yeniden
    /// hesaplanmıyor. "Bugüne kadar kasadan kaç TL çıktı" sorusunun tek doğru cevabı bu.
    /// </summary>
    public decimal PaidTryAmount { get; set; }

    /// <summary>Ödenen taksit sayısı — ekranda "7/24" diye gösterilir.</summary>
    public int PaidInstallmentCount { get; set; }
    public int OverdueInstallmentCount { get; set; }
    public decimal OverdueAmount { get; set; }
    public DateTime? NextDueDate { get; set; }
    public decimal NextDueAmount { get; set; }

    /// <summary>Ödenmiş taksitlerin faiz kısmı — "bugüne kadar ne kadar faiz ödedim".</summary>
    public decimal PaidInterest { get; set; }

    public LoanStatusDto Status { get; set; }
    public DateTime? ClosedAt { get; set; }
    public DateTime? CancelledAt { get; set; }
}

public sealed class LoanDetailDto : LoanListItemDto
{
    public List<LoanInstallmentDto> Installments { get; set; } = new();
}

/// <summary>Ekranın üstündeki özet kartlar. Para birimi başına ayrı satır.</summary>
public sealed class LoanSummaryDto
{
    public int CurrencyTypeId { get; set; }
    public string CurrencyCode { get; set; } = "TRY";
    public decimal TotalRemaining { get; set; }
    public decimal DueThisMonth { get; set; }
    public decimal Overdue { get; set; }
    public decimal PaidInterest { get; set; }
    public int ActiveLoanCount { get; set; }
}

/// <summary>Kredi Vade Takvimi raporunun tek satırı: bir ay, bir para birimi.</summary>
public sealed class LoanScheduleMonthDto
{
    public int Year { get; set; }
    public int Month { get; set; }
    public int CurrencyTypeId { get; set; }
    public string CurrencyCode { get; set; } = "TRY";
    public decimal TotalDue { get; set; }
    public decimal PrincipalDue { get; set; }
    public decimal InterestDue { get; set; }

    /// <summary>Faiz üzerinden alınan vergi. Faizden ayrı: biri finansman gideri, biri vergi.</summary>
    public decimal BsivDue { get; set; }
    public decimal Paid { get; set; }
    public decimal Remaining { get; set; }
    public int InstallmentCount { get; set; }
}
