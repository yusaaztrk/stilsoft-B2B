namespace B2B.Erp.Api.Entities;

public enum EmployeePaymentType
{
    Salary = 1,
    Bonus = 2,
    CashAdvance = 3,
    Meal = 4
}

public sealed class EmployeePayment : AuditableEntity
{
    public int Id { get; set; }

    public int EmployeeId { get; set; }

    public EmployeePaymentType Type { get; set; }

    public decimal Amount { get; set; }

    public DateTime PaymentDate { get; set; }

    public string? Description { get; set; }

    public bool DeductFromSalary { get; set; }

    public DateTime? SalaryDeductedAt { get; set; }

    public int? BankAccountDefinitionId { get; set; }

    /// <summary>
    /// Kasa kimligi. YENI odeme yollarinda (tekil/toplu personel odemesi) bu alan
    /// <c>EmployeeCashAccounts.Id</c> tutar - ERP'nin <c>CashAccounts</c> tablosunun kimligi
    /// DEGIL. ERP hesap hareketi yazan eski yol (varsayilan olarak kapali, bkz.
    /// <c>AccountMovementSettings</c>) hala ERP kimligini yaziyor; iki yolu ayirt etmek icin
    /// <see cref="MovementCurrencyTypeId"/> kullanilir - o alan yalnizca gercekten ERP hareketi
    /// yazilmis odemelerde doludur.
    /// </summary>
    public int? CashAccountId { get; set; }

    /// <summary>
    /// Odemenin ait oldugu maas donemi, "yyyy-MM". Odeme tarihi ile donem ayni sey degildir:
    /// agustos maasi 5 eylulde odenebilir. Avans mahsubu ve mukerrer odeme kontrolu bu alana
    /// bakar; eskiden odeme TARIHININ ayina bakiliyor ve yanlis ayin avanslari dusuluyordu.
    /// </summary>
    public string? SalaryPeriod { get; set; }

    /// <summary>İşlem referans numarası (örn. SAL-2026-08-000124, ADV-2026-08-000042, PAY-2026-08-000088)</summary>
    public string? ReferenceNo { get; set; }

    /// <summary>Toplu ödemenin üst kayıt kimliği</summary>
    public int? ParentPaymentId { get; set; }

    /// <summary>Geri alındı / iptal edildi mi (audit trail)</summary>
    public bool IsCancelled { get; set; } = false;

    public DateTime? CancelledAt { get; set; }

    public string? CancelledBy { get; set; }

    public string? CancellationReason { get; set; }

    /// <summary>
    /// Bu odeme icin kasa/banka hareketi yazildiysa hareketin para birimi ve kuru.
    /// </summary>
    public int? MovementCurrencyTypeId { get; set; }

    public decimal? MovementCurrencyRate { get; set; }

    public decimal? MovementCurrencyAmount { get; set; }

    public Employee? Employee { get; set; }
}

