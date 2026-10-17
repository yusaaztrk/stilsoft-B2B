using System;
using System.Threading;
using System.Threading.Tasks;
using EmailService.Application.Features.Emails;
using EmailService.Domain.Repositories;
using MediatR;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace EmailService.Api.BackgroundWorkers;

public class ScheduledEmailProcessor : BackgroundService
{
    private readonly IServiceProvider _serviceProvider;
    private readonly ILogger<ScheduledEmailProcessor> _logger;

    public ScheduledEmailProcessor(
        IServiceProvider serviceProvider,
        ILogger<ScheduledEmailProcessor> logger)
    {
        _serviceProvider = serviceProvider;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _logger.LogInformation("Scheduled Email Processor Background Service starting...");

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                using var scope = _serviceProvider.CreateScope();
                var emailRepository = scope.ServiceProvider.GetRequiredService<IEmailMessageRepository>();
                var mediator = scope.ServiceProvider.GetRequiredService<IMediator>();

                // Fetch emails that are due (scheduled or retrying with ScheduledFor <= DateTime.UtcNow)
                var dueEmails = await emailRepository.GetScheduledEmailsDueAsync();

                foreach (var email in dueEmails)
                {
                    _logger.LogInformation("Processing due email {EmailMessageId} for recipient {Recipient}.", email.Id, email.Recipient);
                    
                    // Trigger process sending command
                    await mediator.Send(new ProcessEmailSendingCommand(email.Id), stoppingToken);
                }
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error occurred during scheduled email processing cycle.");
            }

            // Poll every 30 seconds
            await Task.Delay(TimeSpan.FromSeconds(30), stoppingToken);
        }
    }
}
