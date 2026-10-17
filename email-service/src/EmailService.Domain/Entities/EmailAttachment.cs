using System;
using EmailService.Domain.Common;

namespace EmailService.Domain.Entities;

public class EmailAttachment : Entity
{
    public Guid EmailMessageId { get; private set; }
    public string FileName { get; private set; } = string.Empty;
    public string ContentType { get; private set; } = string.Empty;
    public byte[] Content { get; private set; } = Array.Empty<byte>();

    // EF Core constructor
    private EmailAttachment() { }

    public EmailAttachment(Guid emailMessageId, string fileName, string contentType, byte[] content)
    {
        if (emailMessageId == Guid.Empty)
            throw new ArgumentException("EmailMessageId cannot be empty.", nameof(emailMessageId));
        if (string.IsNullOrWhiteSpace(fileName))
            throw new ArgumentException("FileName cannot be empty.", nameof(fileName));
        if (string.IsNullOrWhiteSpace(contentType))
            throw new ArgumentException("ContentType cannot be empty.", nameof(contentType));
        if (content == null || content.Length == 0)
            throw new ArgumentException("Content cannot be empty.", nameof(content));

        EmailMessageId = emailMessageId;
        FileName = fileName;
        ContentType = contentType;
        Content = content;
    }
}
