namespace EmailService.Application.DTOs;

public record EmailAttachmentDto(
    string FileName,
    string ContentType,
    byte[] Content
);
