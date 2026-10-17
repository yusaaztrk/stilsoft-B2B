namespace B2B.Erp.Api.DTOs.Pages;

public sealed class PageResponse
{
    public int Id { get; set; }
    public string ModuleKey { get; set; } = string.Empty;
    public string Key { get; set; } = string.Empty;
    public string DisplayName { get; set; } = string.Empty;
    public int SortOrder { get; set; }
    public bool IsActive { get; set; }
}
