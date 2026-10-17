using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using EmailService.Application.Abstractions;
using EmailService.Application.DTOs;
using EmailService.Application.Events;
using EmailService.Domain.Entities;
using EmailService.Domain.Repositories;
using MediatR;

namespace EmailService.Application.Features.Emails;

public record QueueEmailCommand(
    string TenantId,
    string Recipient,
    string Subject,
    string Body,
    string? TemplateName = null,
    Dictionary<string, object>? TemplateData = null,
    List<EmailAttachmentDto>? Attachments = null,
    DateTime? ScheduledFor = null,
    bool PublishEvent = true
) : IRequest<Guid>;

public class QueueEmailCommandHandler : IRequestHandler<QueueEmailCommand, Guid>
{
    private readonly IEmailMessageRepository _emailRepository;
    private readonly IEmailTemplateRepository _templateRepository;
    private readonly ITemplateEngine _templateEngine;
    private readonly IEmailEventPublisher _eventPublisher;
    private readonly IUnitOfWork _unitOfWork;

    public QueueEmailCommandHandler(
        IEmailMessageRepository emailRepository,
        IEmailTemplateRepository templateRepository,
        ITemplateEngine templateEngine,
        IEmailEventPublisher eventPublisher,
        IUnitOfWork unitOfWork)
    {
        _emailRepository = emailRepository;
        _templateRepository = templateRepository;
        _templateEngine = templateEngine;
        _eventPublisher = eventPublisher;
        _unitOfWork = unitOfWork;
    }

    public async Task<Guid> Handle(QueueEmailCommand request, CancellationToken cancellationToken)
    {
        string subject = request.Subject;
        string body = request.Body;
        Guid? templateId = null;

        // 1. Template compilation if TemplateName is provided
        if (!string.IsNullOrWhiteSpace(request.TemplateName))
        {
            var template = await _templateRepository.GetByNameAsync(request.TenantId, request.TemplateName);
            if (template == null)
            {
                throw new InvalidOperationException($"Template '{request.TemplateName}' not found for tenant '{request.TenantId}'.");
            }

            templateId = template.Id;
            var data = request.TemplateData ?? new Dictionary<string, object>();
            
            subject = _templateEngine.Render(template.SubjectTemplate, data);
            body = _templateEngine.Render(template.BodyTemplate, data);
        }

        // 2. Create Email Message entity
        var emailMessage = new EmailMessage(
            request.TenantId,
            request.Recipient,
            subject,
            body,
            templateId,
            request.ScheduledFor
        );

        // 3. Add attachments
        if (request.Attachments != null)
        {
            foreach (var attachment in request.Attachments)
            {
                emailMessage.AddAttachment(attachment.FileName, attachment.ContentType, attachment.Content);
            }
        }

        // 4. Save to Database
        await _emailRepository.AddAsync(emailMessage);
        await _unitOfWork.SaveChangesAsync(cancellationToken);

        // 5. Publish to RabbitMQ if email is for immediate processing (not scheduled in future)
        bool isScheduledForFuture = request.ScheduledFor.HasValue && request.ScheduledFor.Value > DateTime.UtcNow;
        if (!isScheduledForFuture && request.PublishEvent)
        {
            var attachmentDtos = new List<EmailAttachmentDto>();
            if (request.Attachments != null)
            {
                foreach (var attachment in request.Attachments)
                {
                    attachmentDtos.Add(new EmailAttachmentDto(attachment.FileName, attachment.ContentType, attachment.Content));
                }
            }

            var sendEvent = new SendEmailEvent(
                emailMessage.TenantId,
                emailMessage.Recipient,
                emailMessage.Subject,
                emailMessage.Body,
                attachmentDtos,
                null,
                emailMessage.Id
            );

            // Publish message asynchronously. We can tie it to the specific DB record by passing the EmailMessageId inside metadata if needed, 
            // but for simple event-based processing, passing the database record ID or the full details works. Here we pass the full event.
            await _eventPublisher.PublishSendEmailAsync(sendEvent);
        }

        return emailMessage.Id;
    }
}
