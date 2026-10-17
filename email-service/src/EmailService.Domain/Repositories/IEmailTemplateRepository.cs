using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using EmailService.Domain.Entities;

namespace EmailService.Domain.Repositories;

public interface IEmailTemplateRepository
{
    Task<EmailTemplate?> GetByIdAsync(Guid id);
    Task<EmailTemplate?> GetByNameAsync(string tenantId, string name);
    Task<IEnumerable<EmailTemplate>> GetByTenantAsync(string tenantId);
    Task AddAsync(EmailTemplate template);
    void Update(EmailTemplate template);
    void Delete(EmailTemplate template);
}
