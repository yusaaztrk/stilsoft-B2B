namespace B2B.Erp.Api.Entities;

/// <summary>
/// Kredi taksit planının tek satırı.
///
/// Plan sistemce üretilir ama satırlar ELLE DÜZELTİLEBİLİR: banka kendi tablosunu veriyor ve
/// yuvarlama farkı kuruş tutmuyor. Kullanıcı kararı (2026-08-12): "üret, sonra düzeltebil".
///
/// Anapara ve faiz AYRI kolonlarda duruyor. Tek "taksit tutarı" kolonuyla "bugüne kadar ne
/// kadar faiz ödedim" sorusu asla cevaplanamaz.
/// </summary>
public sealed class LoanInstallment : AuditableEntity
{
    public int Id { get; set; }

    public int LoanId { get; set; }
    public Loan? Loan { get; set; }

    /// <summary>1..N</summary>
    public int InstallmentNo { get; set; }

    public DateTime DueDate { get; set; }

    /// <summary>
    /// Taksit tutarı (kredinin para biriminde).
    /// = <see cref="PrincipalPart"/> + <see cref="InterestPart"/> + <see cref="BsivPart"/>
    /// </summary>
    public decimal Amount { get; set; }

    public decimal PrincipalPart { get; set; }

    public decimal InterestPart { get; set; }

    /// <summary>
    /// BSİV — faiz üzerinden alınan vergi, taksit tutarına DAHİL.
    ///
    /// Ayrı kolonda duruyor çünkü faize eklenip geçilirse "bugüne kadar ne kadar faiz, ne kadar
    /// vergi ödedim" ayrımı bir daha yapılamaz. Bankanın kendi tablosunda da ayrı bir kolon.
    /// </summary>
    public decimal BsivPart { get; set; }

    public ICollection<LoanPayment> Payments { get; set; } = new List<LoanPayment>();
}
