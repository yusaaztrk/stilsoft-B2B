using System;
using System.Collections.Generic;
using EmailService.Application.DTOs;

namespace EmailService.Application.Events;

public record SendTemplatedEmailEvent(
    string TenantId,
    string Recipient,
    string TemplateName,
    Dictionary<string, object> TemplateData,
    List<EmailAttachmentDto>? Attachments = null,
    DateTime? ScheduledFor = null
);
