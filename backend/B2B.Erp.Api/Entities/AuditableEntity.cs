namespace B2B.Erp.Api.Entities;

public abstract class AuditableEntity
{
    public string CreateUser { get; set; } = string.Empty;
    public DateTime CreateTime { get; set; } = DateTime.UtcNow;
    public string? EditUser { get; set; }
    public DateTime? EditTime { get; set; }
}
