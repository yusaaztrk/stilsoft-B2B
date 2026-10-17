using System;

namespace B2B.Erp.Api.Entities;

public class Notification : AuditableEntity
{
    public int Id { get; set; }
    
    public int UserId { get; set; }
    public User User { get; set; } = null!;
    
    public string Title { get; set; } = string.Empty;
    public string Content { get; set; } = string.Empty;
    public bool IsRead { get; set; } = false;
    public DateTime? ReadTime { get; set; }
    public bool IsPopup { get; set; } = true;
    public string SenderName { get; set; } = string.Empty;
}
