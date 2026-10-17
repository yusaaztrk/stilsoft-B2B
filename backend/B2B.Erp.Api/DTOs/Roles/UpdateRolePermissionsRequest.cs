using System.ComponentModel.DataAnnotations;

namespace B2B.Erp.Api.Dtos.Roles;

public sealed class UpdateRolePermissionsRequest
{
    [Required]
    public List<RolePermissionItem> Permissions { get; set; } = new();

    public sealed class RolePermissionItem
    {
        public int PageId { get; set; }
        public bool CanAccess { get; set; }
    }
}
