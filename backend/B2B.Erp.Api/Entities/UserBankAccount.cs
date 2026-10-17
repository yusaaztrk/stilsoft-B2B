namespace B2B.Erp.Api.Entities;

public sealed class UserBankAccount
{
    public int UserId { get; set; }
    public User User { get; set; } = null!;

    public int BankAccountId { get; set; }
    public BankAccountDefinition BankAccount { get; set; } = null!;
}
