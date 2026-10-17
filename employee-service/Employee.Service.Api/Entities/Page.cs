using System.Collections.Generic;

namespace B2B.Erp.Api.Entities;

public sealed class Page
{
    public int Id { get; set; }
    public string ModuleKey { get; set; } = string.Empty;
    public string Key { get; set; } = string.Empty;
    public string DisplayName { get; set; } = string.Empty;
    public int SortOrder { get; set; }
    public bool IsActive { get; set; } = true;

    public ICollection<RolePagePermission> RolePermissions { get; set; } = new List<RolePagePermission>();
}
