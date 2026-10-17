using System.ComponentModel.DataAnnotations;
using B2B.Erp.Api.Entities;

namespace B2B.Erp.Api.Dtos.Checks;

public sealed class CustomerCheckListItemResponse
{
    public int Id { get; set; }

    public string ABordroNo { get; set; } = string.Empty;

    public string? VBordroNo { get; set; }

    public string DocumentNo { get; set; } = string.Empty;

    public string CustomerCode { get; set; } = string.Empty;

    public string CustomerName { get; set; } = string.Empty;

    public DateTime IssueDate { get; set; }

    public DateTime DueDate { get; set; }

    public decimal Amount { get; set; }

    public int CurrencyTypeId { get; set; }

    public string? BankName { get; set; }

    public string? BranchName { get; set; }

    public string? DistrictName { get; set; }

    public string? CheckNo { get; set; }

    public CustomerCheckEndorsementType EndorsementType { get; set; }

    public string? OriginalDebtorName { get; set; }

    public string? OriginalIdentityNo { get; set; }

    public string? OriginalTaxNo { get; set; }

    public CustomerCheckPaymentStatus PaymentStatus { get; set; }

    public CustomerCheckStatus Status { get; set; }

    public int? CurrentBankAccountDefinitionId { get; set; }

    public string? CurrentBankAccountName { get; set; }

    public string? CurrentCustomerCode { get; set; }

    public string? CurrentCustomerName { get; set; }

    public string CreateUser { get; set; } = string.Empty;
}

public sealed class CreateCustomerCheckRequest
{
    [MaxLength(30)]
    public string? DocumentNo { get; set; }

    [Required]
    [MaxLength(50)]
    public string CustomerCode { get; set; } = string.Empty;

    public DateTime IssueDate { get; set; }

    public DateTime DueDate { get; set; }

    [Range(0.01, double.MaxValue)]
    public decimal Amount { get; set; }

    public int CurrencyTypeId { get; set; }

    /// <summary>
    /// Çekin GİRİŞ KURU (2026-08-17, kullanıcı isteği: "kur seçiyorum ama anlık kuru sormuyor").
    ///
    /// Gönderilmezse eski davranış: sunucu güncel kuru kendisi çeker. Gönderildiğinde ekstre
    /// satırı bu kurla yazılır — çekin anlaşma kuru güncel kurdan farklı olabilir ve belge
    /// kuru sonradan değişmemelidir.
    /// </summary>
    public decimal? CurrencyRate { get; set; }

    public CustomerCheckEndorsementType EndorsementType { get; set; } = CustomerCheckEndorsementType.Original;

    [MaxLength(120)]
    public string? BankName { get; set; }

    [MaxLength(120)]
    public string? BranchName { get; set; }

    [MaxLength(120)]
    public string? DistrictName { get; set; }

    [MaxLength(50)]
    public string? CheckNo { get; set; }

    [MaxLength(255)]
    public string? OriginalDebtorName { get; set; }

    [MaxLength(30)]
    public string? OriginalIdentityNo { get; set; }

    [MaxLength(30)]
    public string? OriginalTaxNo { get; set; }
}

public sealed class CustomerCheckActionRequest
{
    public DateTime Date { get; set; }

    public int? BankAccountDefinitionId { get; set; }

    [MaxLength(50)]
    public string? TargetCustomerCode { get; set; }

    [MaxLength(2000)]
    public string? Description { get; set; }
}
