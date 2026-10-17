namespace B2B.Erp.Api.Entities;

public sealed class InstallationDocument : AuditableEntity
{
    public int Id { get; set; }

    public int InstallationId { get; set; }

    public Installation? Installation { get; set; }

    public string DocumentUrl { get; set; } = string.Empty;

    public DateTime UploadedDateUtc { get; set; } = DateTime.UtcNow;
}
