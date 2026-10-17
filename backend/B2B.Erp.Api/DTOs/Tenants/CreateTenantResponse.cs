namespace B2B.Erp.Api.DTOs.Tenants;

public sealed class CreateTenantResponse
{
    public int TenantId { get; set; }
    public string Code { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string DbName { get; set; } = string.Empty;
}
