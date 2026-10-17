using Microsoft.Extensions.Options;

namespace Ecommerce.Api.Infrastructure.Erp;

public sealed class ErpTenantGuard
{
    // IMPORTANT: ERP expects Tenant.Code in X-Tenant-Code (NOT the tenant DB name).
    // Tenant DB name is derived by ERP as: b2b_erp_tenant_{TENANT_CODE}.
    public const string HardLockedTenantCode = "DEMO";

    private const string DbNamePrefix = "b2b_erp_tenant_";

    private readonly IOptions<ErpOptions> _options;

    public ErpTenantGuard(IOptions<ErpOptions> options)
    {
        _options = options;
    }

    public string GetTenantCode()
    {
        var configured = (_options.Value.TenantCode ?? string.Empty).Trim();

        // Tolerate legacy/misconfigured value that looks like tenant DB name.
        if (configured.StartsWith(DbNamePrefix, StringComparison.OrdinalIgnoreCase))
        {
            configured = configured[DbNamePrefix.Length..];
        }

        // Hard lock: never allow switching away from STILSOFT.
        return HardLockedTenantCode;
    }
}
