namespace B2B.Erp.Api.Core.Interfaces;

public interface ITenantProvisioningService
{
    Task<int> CreateTenantAsync(
        string tenantCode,
        string tenantName,
        bool isEcommerceEnabled,
        IEnumerable<int> enabledPageIds,
        string superAdminUsername,
        string superAdminMail,
        string superAdminPassword,
        bool serviceOpsEnabled,
        string? serviceOpsSuperAdminUsername,
        string? serviceOpsSuperAdminMail,
        string? serviceOpsSuperAdminPassword,
        CancellationToken cancellationToken = default);

    Task EnsureServiceOpsTenantAsync(
        string tenantCode,
        string serviceOpsSuperAdminUsername,
        string serviceOpsSuperAdminMail,
        string serviceOpsSuperAdminPassword,
        CancellationToken cancellationToken = default);
}
