using System;

namespace ServiceOps.Domain.Entities;

public class ExplodedDiagram
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string? TenantCode { get; set; }

    public Guid ProductId { get; set; }
    public ServiceProduct Product { get; set; } = null!;

    public string FileName { get; set; } = string.Empty;
    public string ContentType { get; set; } = string.Empty;
    public string StoragePath { get; set; } = string.Empty;

    public bool IsActive { get; set; } = true;
    public DateTime UploadedAt { get; set; } = DateTime.UtcNow;
}
