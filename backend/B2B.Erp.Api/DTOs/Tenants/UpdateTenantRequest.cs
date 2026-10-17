using System.ComponentModel.DataAnnotations;

namespace B2B.Erp.Api.DTOs.Tenants;

public sealed class UpdateTenantRequest
{
    [Required]
    public string Name { get; set; } = string.Empty;

    public bool IsActive { get; set; } = true;

    public bool IsEcommerceEnabled { get; set; } = false;

    public bool ServiceOpsEnabled { get; set; }

    public string? ServiceOpsSuperAdminUsername { get; set; }

    public string? ServiceOpsSuperAdminMail { get; set; }

    public string? ServiceOpsSuperAdminPassword { get; set; }
}
