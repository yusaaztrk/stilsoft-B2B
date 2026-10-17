using System;
using EmailService.Domain.Common;

namespace EmailService.Domain.Entities;

public class EmailTemplate : Entity
{
    public string TenantId { get; private set; } = string.Empty;
    public string Name { get; private set; } = string.Empty;
    public string SubjectTemplate { get; private set; } = string.Empty;
    public string BodyTemplate { get; private set; } = string.Empty;
    public DateTime CreatedAt { get; private set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; private set; }

    // EF Core constructor
    private EmailTemplate() { }

    public EmailTemplate(
        string tenantId,
        string name,
        string subjectTemplate,
        string bodyTemplate)
    {
        if (string.IsNullOrWhiteSpace(tenantId))
            throw new ArgumentException("TenantId cannot be empty.", nameof(tenantId));
        if (string.IsNullOrWhiteSpace(name))
            throw new ArgumentException("Template Name cannot be empty.", nameof(name));
        if (string.IsNullOrWhiteSpace(subjectTemplate))
            throw new ArgumentException("SubjectTemplate cannot be empty.", nameof(subjectTemplate));
        if (string.IsNullOrWhiteSpace(bodyTemplate))
            throw new ArgumentException("BodyTemplate cannot be empty.", nameof(bodyTemplate));

        TenantId = tenantId;
        Name = name;
        SubjectTemplate = subjectTemplate;
        BodyTemplate = bodyTemplate;
        CreatedAt = DateTime.UtcNow;
    }

    public void Update(string subjectTemplate, string bodyTemplate)
    {
        if (string.IsNullOrWhiteSpace(subjectTemplate))
            throw new ArgumentException("SubjectTemplate cannot be empty.", nameof(subjectTemplate));
        if (string.IsNullOrWhiteSpace(bodyTemplate))
            throw new ArgumentException("BodyTemplate cannot be empty.", nameof(bodyTemplate));

        SubjectTemplate = subjectTemplate;
        BodyTemplate = bodyTemplate;
        UpdatedAt = DateTime.UtcNow;
    }
}
