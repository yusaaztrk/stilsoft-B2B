namespace B2B.Erp.Api.Entities;

public sealed class RolePagePermission
{
    public int Id { get; set; }

    public int RoleId { get; set; }
    public Role Role { get; set; } = null!;

    public int PageId { get; set; }
    public Page Page { get; set; } = null!;

    public bool CanAccess { get; set; } = true;
}
