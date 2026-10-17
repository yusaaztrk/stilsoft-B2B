using System;

namespace B2B.Erp.Api.Entities;

public sealed class VirtualPosInstallmentRule
{
    public Guid Id { get; set; } = Guid.NewGuid();

    public int BankCode { get; set; }

    public int MerchantInstallment { get; set; }

    public int BankInstallment { get; set; }

    public decimal MinAmount { get; set; } = 1m;

    public decimal MaxAmount { get; set; } = 999999999m;

    public string Description { get; set; } = string.Empty;

    public string InstallmentText { get; set; } = string.Empty;

    public bool IsActive { get; set; } = true;

    public DateTime CreateTime { get; set; } = DateTime.UtcNow;

    public string CreateUser { get; set; } = "SYSTEM";
}
