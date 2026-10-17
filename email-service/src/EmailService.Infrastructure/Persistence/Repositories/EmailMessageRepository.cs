using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using EmailService.Domain.Entities;
using EmailService.Domain.Enums;
using EmailService.Domain.Repositories;
using Microsoft.EntityFrameworkCore;

namespace EmailService.Infrastructure.Persistence.Repositories;

public class EmailMessageRepository : IEmailMessageRepository
{
    private readonly EmailDbContext _context;

    public EmailMessageRepository(EmailDbContext context)
    {
        _context = context;
    }

    public async Task<EmailMessage?> GetByIdAsync(Guid id)
    {
        return await _context.EmailMessages
            .Include(e => e.Attachments)
            .FirstOrDefaultAsync(e => e.Id == id);
    }

    public async Task AddAsync(EmailMessage message)
    {
        await _context.EmailMessages.AddAsync(message);
    }

    public void Update(EmailMessage message)
    {
        _context.EmailMessages.Update(message);
    }

    public async Task<IEnumerable<EmailMessage>> GetScheduledEmailsDueAsync()
    {
        var now = DateTime.UtcNow;
        return await _context.EmailMessages
            .Include(e => e.Attachments)
            .Where(e => (e.Status == EmailStatus.Scheduled || e.Status == EmailStatus.Retrying) 
                     && e.ScheduledFor != null 
                     && e.ScheduledFor <= now)
            .ToListAsync();
    }
}
