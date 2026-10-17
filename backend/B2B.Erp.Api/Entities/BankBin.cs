namespace B2B.Erp.Api.Entities;

public sealed class BankBin
{
    public int Id { get; set; }

    public string BankCode { get; set; } = string.Empty;

    public string Bin6 { get; set; } = string.Empty;

    public string? CardType1 { get; set; }

    public string? CardType2 { get; set; }

    public bool? HasInstallment { get; set; }

    public string? InstallmentBankCode { get; set; }
}
