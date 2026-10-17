using System.ComponentModel.DataAnnotations;

namespace B2B.Erp.Api.DTOs.GlobalUsers;

public sealed class AssignUserTenantsRequest
{
    [Required]
    public int GlobalUserId { get; set; }

    [Required]
    public List<string> TenantCodes { get; set; } = new();
}
