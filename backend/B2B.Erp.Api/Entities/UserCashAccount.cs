namespace B2B.Erp.Api.Entities;

public sealed class UserCashAccount
{
    public int UserId { get; set; }
    public User User { get; set; } = null!;

    public int CashAccountId { get; set; }
    public CashAccount CashAccount { get; set; } = null!;
}
