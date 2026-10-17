using System;

namespace B2B.Erp.Api.DTOs.Notifications;

public class NotificationResponse
{
    public int Id { get; set; }
    public int UserId { get; set; }
    public string UserDisplayName { get; set; } = string.Empty;
    public string UserUsername { get; set; } = string.Empty;
    public string Title { get; set; } = string.Empty;
    public string Content { get; set; } = string.Empty;
    public bool IsRead { get; set; }
    public DateTime? ReadTime { get; set; }
    public bool IsPopup { get; set; }
    public string SenderName { get; set; } = string.Empty;
    public DateTime CreateTime { get; set; }
    public string CreateUser { get; set; } = string.Empty;
}
