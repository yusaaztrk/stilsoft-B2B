namespace B2B.Erp.Api.Entities;

public sealed class BankDetail
{
    public int Id { get; set; }

    public string Name { get; set; } = string.Empty;

    public string BankDetailCode { get; set; } = string.Empty;

    public bool IsActive { get; set; } = true;
}
