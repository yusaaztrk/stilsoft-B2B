using System;
using System.Collections.Generic;

namespace EmailService.Application.DTOs;

public record SendEmailRequest(
    string TenantId,
    string Recipient,
    string Subject,
    string Body,
    List<EmailAttachmentDto>? Attachments = null,
    DateTime? ScheduledFor = null
);
