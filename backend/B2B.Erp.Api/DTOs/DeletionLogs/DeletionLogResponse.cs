namespace B2B.Erp.Api.DTOs.DeletionLogs;

public sealed class DeletionLogResponse
{
    public int Id { get; set; }

    public string ModuleKey { get; set; } = string.Empty;
    public string PageKey { get; set; } = string.Empty;

    public string RecordType { get; set; } = string.Empty;
    public string RecordId { get; set; } = string.Empty;

    public string? ParentType { get; set; }
    public string? ParentId { get; set; }

    public string? Description { get; set; }

    public string DeletedBy { get; set; } = string.Empty;
    public DateTime DeletedAt { get; set; }
    public string? DetailsJson { get; set; }

    /// <summary>Silen kişinin yazdığı neden; eski kayıtlarda ve başlıksız silmelerde boş.</summary>
    public string? Reason { get; set; }
}
