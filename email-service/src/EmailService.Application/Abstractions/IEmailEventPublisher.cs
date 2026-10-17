using System.Threading.Tasks;
using EmailService.Application.Events;

namespace EmailService.Application.Abstractions;

public interface IEmailEventPublisher
{
    Task PublishSendEmailAsync(SendEmailEvent sendEvent);
}
