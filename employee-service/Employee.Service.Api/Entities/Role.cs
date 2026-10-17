namespace B2B.Erp.Api.Entities;

public sealed class Role
{
    public int Id { get; set; }
    public string? Name { get; set; }

    public ICollection<RolePagePermission> PagePermissions { get; set; } = new List<RolePagePermission>();
}
