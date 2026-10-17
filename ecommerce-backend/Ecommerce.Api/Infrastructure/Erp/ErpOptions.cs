namespace Ecommerce.Api.Infrastructure.Erp;

public sealed class ErpOptions
{
    public string BaseUrl { get; set; } = "http://localhost:5289";

    public string TenantCode { get; set; } = "b2b_erp_tenant_DEMO";

    public string ServiceUsername { get; set; } = string.Empty;

    public string ServicePassword { get; set; } = string.Empty;
}
