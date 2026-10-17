using System;

namespace B2B.Erp.Api.DTOs.Montaj;

public sealed class InstallationDocumentDto
{
    public int Id { get; set; }
    public int InstallationId { get; set; }
    public string DocumentUrl { get; set; } = string.Empty;
    public DateTime UploadedDateUtc { get; set; }
}
