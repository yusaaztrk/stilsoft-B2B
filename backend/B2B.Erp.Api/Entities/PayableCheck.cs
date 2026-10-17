namespace B2B.Erp.Api.Entities;

public enum PayableCheckStatus
{
    Issued = 1,
    EndorsedToBank = 2,
    Paid = 3,
    Returned = 4,
    Dishonored = 5,
    Cancelled = 6
}

public sealed class PayableCheck : AuditableEntity
{
    public int Id { get; set; }

    public string DocumentNo { get; set; } = string.Empty;

    public string? CustomerCode { get; set; }
    public Customer? Customer { get; set; }

    public int? SupplierId { get; set; }
    public Supplier? Supplier { get; set; }

    public DateTime IssueDate { get; set; }

    public DateTime DueDate { get; set; }

    /// <summary>
    /// Çekin tutarı — <b>çekin KENDİ para biriminde</b> (TL değil).
    ///
    /// <para>
    /// ⚠️ <b>DİKKAT — bu varlıkta isimlendirme sistemin GENELİNİN TERSİDİR.</b>
    /// Her yerde <c>Amount</c> TL çapası, <c>CurrencyAmount</c> döviz karşılığıdır
    /// (<c>CustomerLedgerEntry</c>, <c>BankAccountTransaction</c>, <c>CashAccountTransaction</c>).
    /// Burada tam tersi: <see cref="Amount"/> döviz, <see cref="CurrencyAmount"/> TL'dir.
    /// </para>
    ///
    /// <para>
    /// Kod bu hâliyle <b>DOĞRU</b> çalışıyor — ekstre satırı yazılırken bilerek
    /// <c>Amount = entity.CurrencyAmount</c> (TL) ve <c>CurrencyAmount = entity.Amount</c>
    /// (döviz) deniyor. Yani burayı "tutarsız" görüp düzeltmeye kalkmak, çalışan kodu bozar.
    /// Kolon adları veritabanında olduğu için değiştirilmedi; ayrım bu notla korunuyor.
    /// Kardeşleri <c>CustomerCheck</c> ve <c>PayableNote</c> genel kurala uyar.
    /// </para>
    /// </summary>
    public decimal Amount { get; set; }

    public int CurrencyTypeId { get; set; }

    public decimal CurrencyRate { get; set; }

    /// <summary>Çekin <b>TL karşılığı</b> (<c>Amount × CurrencyRate</c>). Bkz. <see cref="Amount"/> — isim yanıltıcıdır.</summary>
    public decimal CurrencyAmount { get; set; }

    public string? BankName { get; set; }

    public string? BranchName { get; set; }

    public string? CheckNo { get; set; }

    public PayableCheckStatus Status { get; set; } = PayableCheckStatus.Issued;

    public int? BankAccountDefinitionId { get; set; }
    public BankAccountDefinition? BankAccountDefinition { get; set; }
}
