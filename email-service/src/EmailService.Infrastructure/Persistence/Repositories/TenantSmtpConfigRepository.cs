using System.Threading.Tasks;
using EmailService.Domain.Entities;
using EmailService.Domain.Repositories;
using Microsoft.EntityFrameworkCore;

namespace EmailService.Infrastructure.Persistence.Repositories;

public class TenantSmtpConfigRepository : ITenantSmtpConfigRepository
{
    private readonly EmailDbContext _context;

    public TenantSmtpConfigRepository(EmailDbContext context)
    {
        _context = context;
    }

    public async Task<TenantSmtpConfig?> GetByTenantIdAsync(string tenantId)
    {
        return await _context.TenantSmtpConfigs
            .FirstOrDefaultAsync(c => c.TenantId == tenantId);
    }

    public async Task AddAsync(TenantSmtpConfig config)
    {
        await _context.TenantSmtpConfigs.AddAsync(config);
    }

    public void Update(TenantSmtpConfig config)
    {
        _context.TenantSmtpConfigs.Update(config);
    }

    public void Delete(TenantSmtpConfig config)
    {
        _context.TenantSmtpConfigs.Remove(config);
    }
}
