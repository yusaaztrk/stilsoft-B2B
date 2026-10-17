using System;
using System.Collections.Generic;

namespace EmailService.Application.DTOs;

public record SendTemplatedEmailRequest(
    string TenantId,
    string Recipient,
    string TemplateName,
    Dictionary<string, object> TemplateData,
    List<EmailAttachmentDto>? Attachments = null,
    DateTime? ScheduledFor = null
);
