namespace B2B.Erp.Api.Dtos.Users;

public sealed class UserResponse
{
    public int Id { get; set; }
    public string Username { get; set; } = string.Empty;
    public string Mail { get; set; } = string.Empty;
    public string? Password { get; set; }
    public string Unvan { get; set; } = string.Empty;
    public string? Gsm { get; set; }
    public string? Carikodu { get; set; }
    public string? CariAdi { get; set; }
    public string? SalesmanCode { get; set; }
    public int? DefaultWarehouseCode { get; set; }
    public int? DefaultCashAccountId { get; set; }
    public int? DefaultBankAccountId { get; set; }
    public List<int> WarehouseCodes { get; set; } = new();
    public List<int> CashAccountIds { get; set; } = new();
    public List<int> BankAccountIds { get; set; } = new();
    public bool IsActive { get; set; }
    public bool ServiceOpsAccess { get; set; }
    public bool EmployeeAccess { get; set; }
    public bool AsistanAccess { get; set; }
    /// <summary>null = kısıtlama yok.</summary>
    public List<string>? CariEkstreTipleri { get; set; }
    public int RoleId { get; set; }
    public string RoleName { get; set; } = string.Empty;
    public string RoleCode { get; set; } = string.Empty;
    public DateTime CreatedAt { get; set; }
    public DateTime? UpdatedAt { get; set; }
    public DateTime? LastLoginAt { get; set; }
    public decimal? DiscountRate { get; set; }

    /// <summary>Only meaningful for a salesman account; ignored for every other role.</summary>
    public bool IsCariPlasiyeri { get; set; }
}
