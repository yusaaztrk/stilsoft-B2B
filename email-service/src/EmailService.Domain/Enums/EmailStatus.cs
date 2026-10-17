namespace EmailService.Domain.Enums;

public enum EmailStatus
{
    Pending,
    Processing,
    Sent,
    Failed,
    Scheduled,
    Retrying
}
