namespace B2B.Erp.Api.Entities;

public sealed class BankAccountDefinition : AuditableEntity
{
    public int Id { get; set; }

    public int BankDetailId { get; set; }

    public BankDetail? BankDetail { get; set; }

    public string AccountCode { get; set; } = string.Empty;

    public string AccountName { get; set; } = string.Empty;

    public string AccountNo { get; set; } = string.Empty;

    public int AccountType { get; set; }

    public int CurrencyTypeId { get; set; }

    /// <summary>
    /// Açılış bakiyesi. Kolon adı tarihsel olarak "Budget" ama hiçbir yerde bütçe/limit
    /// anlamında kullanılmıyor: bakiye hesabının BAŞLANGIÇ tutarı bu
    /// (bkz. BankAccountTransactionsController.Balance → Budget + (giren - çıkan)).
    /// Ekranlarda "Açılış Bakiyesi" diye görünür.
    /// </summary>
    public decimal Budget { get; set; }

    /// <summary>
    /// Hesap kesim tarihi (şirket kredi kartı hesapları için). Saat taşımaz — `date`
    /// olarak saklanır ki firma saat dilimine göre bir gün kayması olmasın.
    /// </summary>
    public DateOnly? StatementDate { get; set; }
}
