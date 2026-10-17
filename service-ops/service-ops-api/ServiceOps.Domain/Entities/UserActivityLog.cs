using System;

namespace ServiceOps.Domain.Entities;

public class UserActivityLog
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string Username { get; set; } = string.Empty;
    public string UserDisplayName { get; set; } = string.Empty;
    public string ModuleKey { get; set; } = string.Empty;
    public string PageKey { get; set; } = string.Empty;
    public string ActionType { get; set; } = string.Empty;
    public string Description { get; set; } = string.Empty;
    public string? RecordId { get; set; }
    public string? DetailsJson { get; set; }
    public DateTime CreateTime { get; set; } = DateTime.UtcNow;
}
