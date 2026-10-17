using System;
using System.Threading;
using System.Threading.Tasks;
using EmailService.Application.Abstractions;
using EmailService.Domain.Entities;
using EmailService.Domain.Enums;
using EmailService.Domain.Repositories;
using MediatR;
using Microsoft.Extensions.Logging;

namespace EmailService.Application.Features.Emails;

public record ProcessEmailSendingCommand(Guid EmailMessageId) : IRequest<bool>;

public class ProcessEmailSendingCommandHandler : IRequestHandler<ProcessEmailSendingCommand, bool>
{
    private readonly IEmailMessageRepository _emailRepository;
    private readonly ITenantSmtpConfigRepository _smtpConfigRepository;
    private readonly ISmtpEmailSender _emailSender;
    private readonly IUnitOfWork _unitOfWork;
    private readonly ILogger<ProcessEmailSendingCommandHandler> _logger;

    public ProcessEmailSendingCommandHandler(
        IEmailMessageRepository emailRepository,
        ITenantSmtpConfigRepository smtpConfigRepository,
        ISmtpEmailSender emailSender,
        IUnitOfWork unitOfWork,
        ILogger<ProcessEmailSendingCommandHandler> logger)
    {
        _emailRepository = emailRepository;
        _smtpConfigRepository = smtpConfigRepository;
        _emailSender = emailSender;
        _unitOfWork = unitOfWork;
        _logger = logger;
    }

    public async Task<bool> Handle(ProcessEmailSendingCommand request, CancellationToken cancellationToken)
    {
        var email = await _emailRepository.GetByIdAsync(request.EmailMessageId);
        if (email == null)
        {
            _logger.LogError("Email message with ID {EmailMessageId} not found.", request.EmailMessageId);
            return false;
        }

        if (email.Status == EmailStatus.Sent)
        {
            _logger.LogWarning("Email message with ID {EmailMessageId} is already sent. Skipping.", request.EmailMessageId);
            return true;
        }

        // 1. Fetch Tenant SMTP Settings
        var smtpConfig = await _smtpConfigRepository.GetByTenantIdAsync(email.TenantId);
        if (smtpConfig == null)
        {
            string errMsg = $"SMTP configuration not found for tenant '{email.TenantId}'.";
            _logger.LogError(errMsg);
            email.MarkAsFailed(errMsg);
            await _unitOfWork.SaveChangesAsync(cancellationToken);
            return false;
        }

        try
        {
            email.StartProcessing();
            await _unitOfWork.SaveChangesAsync(cancellationToken);

            // Execute sending (underlying infrastructure handles the retry policy)
            await _emailSender.SendAsync(email, smtpConfig, cancellationToken);

            email.MarkAsSent();
            await _unitOfWork.SaveChangesAsync(cancellationToken);
            _logger.LogInformation("Email {EmailMessageId} successfully sent to {Recipient}.", email.Id, email.Recipient);
            return true;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to send email {EmailMessageId} to {Recipient} after all retry attempts.", email.Id, email.Recipient);
            email.MarkAsFailed(ex.Message);
            await _unitOfWork.SaveChangesAsync(cancellationToken);
            return false;
        }
    }
}
