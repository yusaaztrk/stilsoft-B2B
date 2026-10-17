using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using EmailService.Domain.Entities;
using EmailService.Domain.Repositories;
using Microsoft.EntityFrameworkCore;

namespace EmailService.Infrastructure.Persistence.Repositories;

public class EmailTemplateRepository : IEmailTemplateRepository
{
    private readonly EmailDbContext _context;

    public EmailTemplateRepository(EmailDbContext context)
    {
        _context = context;
    }

    public async Task<EmailTemplate?> GetByIdAsync(Guid id)
    {
        return await _context.EmailTemplates.FindAsync(id);
    }

    public async Task<EmailTemplate?> GetByNameAsync(string tenantId, string name)
    {
        return await _context.EmailTemplates
            .FirstOrDefaultAsync(t => t.TenantId == tenantId && t.Name == name);
    }

    public async Task<IEnumerable<EmailTemplate>> GetByTenantAsync(string tenantId)
    {
        return await _context.EmailTemplates
            .Where(t => t.TenantId == tenantId)
            .ToListAsync();
    }

    public async Task AddAsync(EmailTemplate template)
    {
        await _context.EmailTemplates.AddAsync(template);
    }

    public void Update(EmailTemplate template)
    {
        _context.EmailTemplates.Update(template);
    }

    public void Delete(EmailTemplate template)
    {
        _context.EmailTemplates.Remove(template);
    }
}
