using System.ComponentModel.DataAnnotations;

namespace B2B.Erp.Api.DTOs.Tenants;

public sealed class CreateTenantRequest
{
    [Required]
    public string Code { get; set; } = string.Empty;

    [Required]
    public string Name { get; set; } = string.Empty;

    public List<int> EnabledPageIds { get; set; } = new();

    [Required]
    public string SuperAdminUsername { get; set; } = string.Empty;

    [Required]
    public string SuperAdminMail { get; set; } = string.Empty;

    [Required]
    public string SuperAdminPassword { get; set; } = string.Empty;

    public bool IsEcommerceEnabled { get; set; } = false;

    public bool ServiceOpsEnabled { get; set; }

    public string? ServiceOpsSuperAdminUsername { get; set; }

    public string? ServiceOpsSuperAdminMail { get; set; }

    public string? ServiceOpsSuperAdminPassword { get; set; }
}
