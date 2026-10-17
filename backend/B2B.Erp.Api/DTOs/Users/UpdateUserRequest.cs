using System.ComponentModel.DataAnnotations;

namespace B2B.Erp.Api.Dtos.Users;

public sealed class UpdateUserRequest
{
    [Required]
    [StringLength(50)]
    public string Username { get; set; } = null!;

    [Required]
    [EmailAddress]
    [StringLength(255)]
    public string Mail { get; set; } = null!;

    [StringLength(500)]
    public string? Password { get; set; }

    [Required]
    [StringLength(200)]
    public string Unvan { get; set; } = null!;

    [StringLength(20)]
    [RegularExpression(B2B.Erp.Api.Core.Helpers.PhoneFormat.Pattern, ErrorMessage = B2B.Erp.Api.Core.Helpers.PhoneFormat.Message)]
    public string? Gsm { get; set; }

    /// <summary>
    /// Customer scope: a comma-separated list of customer codes, or '*' for all. Long enough for
    /// a full salesman book — one code fits in about 15 characters, and assigning a salesman's
    /// customers routinely selects several hundred. The old 50-character limit rejected any
    /// selection past the third customer with a 400 before the request was even looked at.
    /// </summary>
    [StringLength(8000)]
    public string? Carikodu { get; set; }

    [StringLength(50)]
    public string? SalesmanCode { get; set; }

    public List<int>? WarehouseCodes { get; set; }

    public List<int>? CashAccountIds { get; set; }

    public List<int>? BankAccountIds { get; set; }

    [Range(1, int.MaxValue)]
    public int? DefaultWarehouseCode { get; set; }

    public int? DefaultCashAccountId { get; set; }

    public int? DefaultBankAccountId { get; set; }

    public bool IsActive { get; set; } = true;

    public bool ServiceOpsAccess { get; set; } = false;

    public bool EmployeeAccess { get; set; } = false;

    public bool AsistanAccess { get; set; } = false;

    /// <summary>Cari ekstrede görebileceği tipler; null/boş ya da hepsi = kısıtlama yok.</summary>
    public List<string>? CariEkstreTipleri { get; set; }

    [Range(1, int.MaxValue)]
    public int RoleId { get; set; }

    public decimal? DiscountRate { get; set; }

    /// <summary>Only meaningful for a salesman account; ignored for every other role.</summary>
    public bool IsCariPlasiyeri { get; set; }
}
