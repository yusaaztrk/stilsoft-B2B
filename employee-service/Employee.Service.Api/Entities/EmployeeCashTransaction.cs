namespace B2B.Erp.Api.Entities;

public enum EmployeeCashDirection
{
    In = 1,
    Out = 2
}

/// <summary>
/// Personel kasasının hareketi. ERP'nin <c>CashAccountTransactions</c> tablosuna DEĞİL,
/// bu tabloya yazılır — bkz. <see cref="EmployeeCashAccount"/>.
///
/// <para>Toplu ödemede kasaya 20 ayrı satır yerine TEK üst satır yazılır
/// (<c>IsBulk = true</c>, personel bağı yok); personel kırılımı aynı üst satıra
/// <see cref="ParentTransactionId"/> ile bağlı alt satırlarda durur. Kasa bakiyesi yalnızca
/// üst satırlardan ve tekil hareketlerden hesaplanır — alt satırlar bakiyeye SAYILMAZ,
/// yoksa toplu ödeme kasadan iki kez düşer.</para>
/// </summary>
public sealed class EmployeeCashTransaction : AuditableEntity
{
    public int Id { get; set; }

    public int EmployeeCashAccountId { get; set; }

    public DateTime Date { get; set; }

    public EmployeeCashDirection Direction { get; set; } = EmployeeCashDirection.Out;

    public decimal Amount { get; set; }

    /// <summary>Tekil hareketlerde personel; toplu üst kayıtta null.</summary>
    public int? EmployeeId { get; set; }

    /// <summary>Hareketi doğuran <c>EmployeePayments.Id</c>.</summary>
    public int? PaymentId { get; set; }

    /// <summary>İşlem türü (maaş/prim/avans/yemek) — <see cref="EmployeePaymentType"/> değeri.</summary>
    public int? PaymentType { get; set; }

    public string? SalaryPeriod { get; set; }

    public string? ReferenceNo { get; set; }

    /// <summary>Toplu ödemenin üst hareket kimliği.</summary>
    public int? ParentTransactionId { get; set; }

    /// <summary>Toplu ödemenin ÜST kaydı mı? Bakiye yalnızca üst + tekil satırlardan hesaplanır.</summary>
    public bool IsBulk { get; set; }

    public string? CounterpartyName { get; set; }

    public string? Description { get; set; }

    // --- B2B KASA/BANKA BAĞLANTISI (2026-09-27 kullanıcı kararı) ---
    // Ödeme B2B'deki bir kasa ya da bankadan çıktıysa, o hesaba yazılan TEK "Personel Ödemesi"
    // satırı burada tutulur. Yalnız ÜST kayıtta (tekil ödeme ya da toplu üst satır) dolar;
    // kırılım satırlarında boştur. Geri almada B2B satırı bu bağla bulunup düşürülür/silinir.

    /// <summary>1 = B2B kasası (<c>CashAccounts</c>), 2 = B2B bankası (<c>BankAccountDefinitions</c>).</summary>
    public int? ErpAccountKind { get; set; }

    public int? ErpAccountId { get; set; }

    /// <summary>Hesabın o anki adı — liste ekranı B2B'ye gitmeden gösterebilsin.</summary>
    public string? ErpAccountName { get; set; }

    /// <summary><c>CashAccountTransactions.Id</c> ya da <c>BankAccountTransactions.Id</c>.</summary>
    public int? ErpTransactionId { get; set; }

    /// <summary>Hesabın para birimi: 1 TRY, 2 EUR, 3 USD, 4 GBP.</summary>
    public int? ErpCurrencyTypeId { get; set; }

    /// <summary>1 döviz = kaç TL. TL hesapta 1.</summary>
    public decimal? ErpRate { get; set; }

    /// <summary>Hesaptan çıkan tutar, hesabın KENDİ para biriminde.</summary>
    public decimal? ErpCurrencyAmount { get; set; }

    public EmployeeCashAccount? CashAccount { get; set; }

    public Employee? Employee { get; set; }
}
