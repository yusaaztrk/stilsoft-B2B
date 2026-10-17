using System.Threading;
using System.Threading.Tasks;
using EmailService.Domain.Entities;

namespace EmailService.Application.Abstractions;

public interface ISmtpEmailSender
{
    Task SendAsync(EmailMessage emailMessage, TenantSmtpConfig smtpConfig, CancellationToken cancellationToken = default);
}
