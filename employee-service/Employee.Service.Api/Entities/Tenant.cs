namespace B2B.Erp.Api.Entities;

public sealed class Tenant
{
    public int Id { get; set; }
    public string Code { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string DbName { get; set; } = string.Empty;
    public bool IsActive { get; set; } = true;

    public string? LogoPath { get; set; }
    public string? HeaderGradientFrom { get; set; }
    public string? HeaderGradientTo { get; set; }
}
