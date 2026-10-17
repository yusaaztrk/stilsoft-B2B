using System.ComponentModel.DataAnnotations;

namespace B2B.Erp.Api.DTOs.GlobalUsers;

public sealed class CreateGlobalUserRequest
{
    [Required]
    public string Username { get; set; } = string.Empty;

    [Required]
    public string Mail { get; set; } = string.Empty;

    [Required]
    public string Password { get; set; } = string.Empty;

    public bool IsSuperSuperAdmin { get; set; }

    public List<string> TenantCodes { get; set; } = new();
}
