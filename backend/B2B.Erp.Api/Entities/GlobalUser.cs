namespace B2B.Erp.Api.Entities;

public sealed class GlobalUser
{
    public int Id { get; set; }

    public string Username { get; set; } = string.Empty;
    public string Mail { get; set; } = string.Empty;
    public string PasswordHash { get; set; } = string.Empty;

    public bool IsSuperSuperAdmin { get; set; }
    public bool IsActive { get; set; } = true;

    public ICollection<GlobalUserTenant> Tenants { get; set; } = new List<GlobalUserTenant>();
}
