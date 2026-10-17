using System;

namespace ServiceOps.Domain.Entities;

public class ServiceNote
{
    public Guid Id { get; set; } = Guid.NewGuid();
    
    // Relations
    public Guid ServiceId { get; set; }
    public ServiceRecord Service { get; set; } = null!;
    
    // Content
    public string Content { get; set; } = string.Empty;
    public NoteType Type { get; set; } = NoteType.General;
    
    // Author
    public string AuthorId { get; set; } = string.Empty;
    public string AuthorName { get; set; } = string.Empty;
    public string? AuthorRole { get; set; }
    
    // Visibility
    public bool IsInternal { get; set; } = false;
    public bool IsPinned { get; set; } = false;
    
    // Meta
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }
}

public enum NoteType
{
    General = 0,
    Technical = 1,
    Customer = 2,
    Internal = 3,
    FollowUp = 4
}
