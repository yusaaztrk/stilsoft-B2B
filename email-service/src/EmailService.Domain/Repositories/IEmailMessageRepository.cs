using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using EmailService.Domain.Entities;

namespace EmailService.Domain.Repositories;

public interface IEmailMessageRepository
{
    Task<EmailMessage?> GetByIdAsync(Guid id);
    Task AddAsync(EmailMessage message);
    void Update(EmailMessage message);
    Task<IEnumerable<EmailMessage>> GetScheduledEmailsDueAsync();
}
