namespace B2B.Erp.Api.DTOs.Search;

public sealed class GlobalSearchResponse
{
    public bool Success { get; set; }

    public GlobalSearchData Data { get; set; } = new();
}

public sealed class GlobalSearchData
{
    public List<GlobalSearchItem> Items { get; set; } = new();
}

public sealed class GlobalSearchItem
{
    public string Type { get; set; } = string.Empty;

    public string Title { get; set; } = string.Empty;

    public string Subtitle { get; set; } = string.Empty;

    public string Href { get; set; } = string.Empty;

    public string Key { get; set; } = string.Empty;
}
