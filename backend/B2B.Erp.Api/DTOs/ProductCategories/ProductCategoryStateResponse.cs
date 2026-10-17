namespace B2B.Erp.Api.Dtos.ProductCategories;

public sealed class ProductCategoryStateResponse
{
    public List<string> Mains { get; set; } = new();

    public Dictionary<string, List<string>> SubsByMain { get; set; } = new();

    public Dictionary<string, string> Labels { get; set; } = new();

    public Dictionary<string, ProductCategoryMetaResponse> Meta { get; set; } = new();

    public List<ProductCategoryItemDto> Items { get; set; } = new();
}

public sealed class ProductCategoryMetaResponse
{
    public string? Description { get; set; }

    public string Status { get; set; } = "active";
}

public sealed class ProductCategoryItemDto
{
    public Guid Id { get; set; }
    public Guid? ParentId { get; set; }
    public string Key { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string? Description { get; set; }
    public bool IsActive { get; set; }
    public int SortOrder { get; set; }
}
