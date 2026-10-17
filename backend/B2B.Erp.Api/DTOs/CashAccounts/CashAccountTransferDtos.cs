using System.ComponentModel.DataAnnotations;

namespace B2B.Erp.Api.Dtos.CashAccounts;

public sealed class CashAccountTransferListItemResponse
{
    public int Id { get; set; }
    public int SourceCashAccountId { get; set; }
    public int TargetCashAccountId { get; set; }
    public DateTime Date { get; set; }
    public decimal Amount { get; set; }
    public int? SelectedCashAccountId { get; set; }
    public int? SelectedDirection { get; set; }
    public decimal? SelectedTryAmount { get; set; }
    public int? SelectedCurrencyTypeId { get; set; }
    public decimal? SelectedCurrencyRate { get; set; }
    public decimal? SelectedCurrencyAmount { get; set; }
    public string? Description { get; set; }
    public string CreateUser { get; set; } = string.Empty;
}

public sealed class CreateCashAccountTransferRequest
{
    [Range(1, int.MaxValue)]
    public int SourceCashAccountId { get; set; }

    [Range(1, int.MaxValue)]
    public int TargetCashAccountId { get; set; }

    [Required]
    public DateTime Date { get; set; }

    [Range(0.01, double.MaxValue)]
    public decimal Amount { get; set; }

    [MaxLength(2000)]
    public string? Description { get; set; }
}
