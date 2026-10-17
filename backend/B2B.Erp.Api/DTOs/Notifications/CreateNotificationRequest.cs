namespace B2B.Erp.Api.DTOs.Notifications;

public class CreateNotificationRequest
{
    public string? Target { get; set; }
    public List<string>? Targets { get; set; }
    public int? TargetUserId { get; set; }
    public string Title { get; set; } = string.Empty;
    public string Content { get; set; } = string.Empty;
    public bool IsPopup { get; set; } = true;
}
