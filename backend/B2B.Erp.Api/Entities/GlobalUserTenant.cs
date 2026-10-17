namespace B2B.Erp.Api.Entities;

public sealed class GlobalUserTenant
{
    public int Id { get; set; }

    public int GlobalUserId { get; set; }
    public GlobalUser GlobalUser { get; set; } = null!;

    public int TenantId { get; set; }
    public Tenant Tenant { get; set; } = null!;

    public bool IsActive { get; set; } = true;
}
