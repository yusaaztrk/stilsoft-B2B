namespace B2B.Erp.Api.Dtos.Roles;

public sealed class RolePagePermissionResponse
{
    public int PageId { get; set; }
    public string ModuleKey { get; set; } = string.Empty;
    public string PageKey { get; set; } = string.Empty;
    public string DisplayName { get; set; } = string.Empty;
    public bool CanAccess { get; set; }
}
