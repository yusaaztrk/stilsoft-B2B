namespace B2B.Erp.Api.Entities;

public sealed class InstallmentRule
{
    public Guid Id { get; set; } = Guid.NewGuid();

    public string BankName { get; set; } = string.Empty;

    public string InstallmentText { get; set; } = string.Empty;

    public string MinAmountText { get; set; } = string.Empty;

    public string DescriptionText { get; set; } = string.Empty;

    public int SortOrder { get; set; }

    public bool IsActive { get; set; } = true;
}
