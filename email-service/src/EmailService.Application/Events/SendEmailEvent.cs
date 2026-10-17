using System;
using System.Collections.Generic;
using EmailService.Application.DTOs;

namespace EmailService.Application.Events;

public record SendEmailEvent(
    string TenantId,
    string Recipient,
    string Subject,
    string Body,
    List<EmailAttachmentDto>? Attachments = null,
    DateTime? ScheduledFor = null,
    Guid? EmailMessageId = null
);
