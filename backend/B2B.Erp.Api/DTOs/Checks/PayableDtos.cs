using System.ComponentModel.DataAnnotations;
using B2B.Erp.Api.Entities;

namespace B2B.Erp.Api.Dtos.Checks;

public sealed class PayableCheckListItemResponse
{
    public int Id { get; set; }

    public string DocumentNo { get; set; } = string.Empty;

    public string CustomerCode { get; set; } = string.Empty;

    public string CustomerName { get; set; } = string.Empty;

    public DateTime IssueDate { get; set; }

    public DateTime DueDate { get; set; }

    public decimal Amount { get; set; }

    public int CurrencyTypeId { get; set; }

    public decimal CurrencyRate { get; set; }

    public decimal CurrencyAmount { get; set; }

    public string? BankName { get; set; }

    public string? BranchName { get; set; }

    public string? CheckNo { get; set; }

    public PayableCheckStatus Status { get; set; }

    public int? BankAccountDefinitionId { get; set; }

    public string? BankAccountName { get; set; }

    public string CreateUser { get; set; } = string.Empty;
}

public sealed class CreatePayableCheckRequest
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

    [Range(0, double.MaxValue)]
    public decimal CurrencyRate { get; set; }

    public int BankAccountDefinitionId { get; set; }

    [MaxLength(120)]
    public string? BankName { get; set; }

    [MaxLength(120)]
    public string? BranchName { get; set; }

    [MaxLength(50)]
    public string? CheckNo { get; set; }
}

public sealed class PayableNoteListItemResponse
{
    public int Id { get; set; }

    public string ScNo { get; set; } = string.Empty;

    public string DocumentNo { get; set; } = string.Empty;

    public string CustomerCode { get; set; } = string.Empty;

    public string CustomerName { get; set; } = string.Empty;

    public DateTime IssueDate { get; set; }

    public DateTime DueDate { get; set; }

    public decimal Amount { get; set; }

    public int CurrencyTypeId { get; set; }

    public string? NoteNo { get; set; }

    public PayableNoteStatus Status { get; set; }

    public int? BankAccountDefinitionId { get; set; }

    public string? BankAccountName { get; set; }

    public string CreateUser { get; set; } = string.Empty;
}

public sealed class CreatePayableNoteRequest
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

    [MaxLength(50)]
    public string? NoteNo { get; set; }

    public int? BankAccountDefinitionId { get; set; }
}

public sealed class PayableActionRequest
{
    public DateTime Date { get; set; }

    public int? BankAccountDefinitionId { get; set; }

    [MaxLength(2000)]
    public string? Description { get; set; }
}
