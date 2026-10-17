using System;
using System.Collections.Generic;
using EmailService.Domain.Common;
using EmailService.Domain.Enums;

namespace EmailService.Domain.Entities;

public class EmailMessage : Entity
{
    public string TenantId { get; private set; } = string.Empty;
    public Guid? TemplateId { get; private set; }
    public string Recipient { get; private set; } = string.Empty;
    public string Subject { get; private set; } = string.Empty;
    public string Body { get; private set; } = string.Empty;
    public EmailStatus Status { get; private set; }
    public int Attempts { get; private set; }
    public DateTime? LastAttemptAt { get; private set; }
    public DateTime? ScheduledFor { get; private set; }
    public DateTime CreatedAt { get; private set; } = DateTime.UtcNow;
    public string? ErrorMessage { get; private set; }

    private readonly List<EmailAttachment> _attachments = new();
    public virtual IReadOnlyCollection<EmailAttachment> Attachments => _attachments.AsReadOnly();

    // EF Core constructor
    private EmailMessage() { }

    public EmailMessage(
        string tenantId,
        string recipient,
        string subject,
        string body,
        Guid? templateId = null,
        DateTime? scheduledFor = null)
    {
        if (string.IsNullOrWhiteSpace(tenantId))
            throw new ArgumentException("TenantId cannot be empty.", nameof(tenantId));
        if (string.IsNullOrWhiteSpace(recipient))
            throw new ArgumentException("Recipient cannot be empty.", nameof(recipient));
        if (string.IsNullOrWhiteSpace(subject))
            throw new ArgumentException("Subject cannot be empty.", nameof(subject));
        if (string.IsNullOrWhiteSpace(body))
            throw new ArgumentException("Body cannot be empty.", nameof(body));

        TenantId = tenantId;
        Recipient = recipient;
        Subject = subject;
        Body = body;
        TemplateId = templateId;
        ScheduledFor = scheduledFor;
        Status = scheduledFor.HasValue && scheduledFor.Value > DateTime.UtcNow 
            ? EmailStatus.Scheduled 
            : EmailStatus.Pending;
        CreatedAt = DateTime.UtcNow;
        Attempts = 0;
    }

    public void AddAttachment(string fileName, string contentType, byte[] content)
    {
        _attachments.Add(new EmailAttachment(Id, fileName, contentType, content));
    }

    public void StartProcessing()
    {
        Status = EmailStatus.Processing;
        LastAttemptAt = DateTime.UtcNow;
        Attempts++;
    }

    public void MarkAsSent()
    {
        Status = EmailStatus.Sent;
        ErrorMessage = null;
    }

    public void MarkAsFailed(string error)
    {
        Status = EmailStatus.Failed;
        ErrorMessage = error;
    }

    public void ScheduleForRetry(string error, DateTime nextAttemptAt)
    {
        Status = EmailStatus.Retrying;
        ErrorMessage = error;
        ScheduledFor = nextAttemptAt;
    }
}
