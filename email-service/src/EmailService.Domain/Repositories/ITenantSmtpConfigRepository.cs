using System.Threading.Tasks;
using EmailService.Domain.Entities;

namespace EmailService.Domain.Repositories;

public interface ITenantSmtpConfigRepository
{
    Task<TenantSmtpConfig?> GetByTenantIdAsync(string tenantId);
    Task AddAsync(TenantSmtpConfig config);
    void Update(TenantSmtpConfig config);
    void Delete(TenantSmtpConfig config);
}
