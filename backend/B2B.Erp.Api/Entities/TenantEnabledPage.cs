namespace B2B.Erp.Api.Entities;

public sealed class TenantEnabledPage
{
    public int Id { get; set; }

    public int TenantId { get; set; }
    public Tenant Tenant { get; set; } = null!;

    public int PageId { get; set; }
    public bool IsEnabled { get; set; } = true;
}
