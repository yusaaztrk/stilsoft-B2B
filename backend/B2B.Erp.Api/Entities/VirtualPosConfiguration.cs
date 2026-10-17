using System;

namespace B2B.Erp.Api.Entities;

public sealed class VirtualPosConfiguration
{
    public Guid Id { get; set; } = Guid.NewGuid();

    public Guid? TenantId { get; set; }

    public VirtualPosBankCode BankCode { get; set; }

    public VirtualPosProviderType ProviderType { get; set; }

    public string BankName { get; set; } = string.Empty;

    public string MerchantId { get; set; } = string.Empty;

    public string TerminalId { get; set; } = string.Empty;

    public string ClientId { get; set; } = string.Empty;

    public string GatewayUrl { get; set; } = string.Empty;

    /// <summary>NestPay `storetype`; bkz. <see cref="VirtualPosDefinition.StoreType"/>.</summary>
    public string StoreType { get; set; } = string.Empty;

    public string ApiUrl { get; set; } = string.Empty;

    public string StoreKeyEncrypted { get; set; } = string.Empty;

    public string ApiUsernameEncrypted { get; set; } = string.Empty;

    public string ApiPasswordEncrypted { get; set; } = string.Empty;

    /// <summary>
    /// The provision (PROVAUT) password. Separate from <see cref="ApiPasswordEncrypted"/>
    /// because Garanti signs the 3D request with this one and not with the login password —
    /// signing with the wrong secret produces a well-formed request the bank rejects.
    /// </summary>
    public string ProvisionPasswordEncrypted { get; set; } = string.Empty;

    public bool IsThreeDSecureEnabled { get; set; } = true;

    public bool IsTestEnvironment { get; set; } = false;

    public bool IsDefault { get; set; } = false;

    public bool IsActive { get; set; } = true;

    public string CustomConfigurationJson { get; set; } = string.Empty;

    public DateTime CreatedAtUtc { get; set; } = DateTime.UtcNow;

    public DateTime? UpdatedAtUtc { get; set; }
}
