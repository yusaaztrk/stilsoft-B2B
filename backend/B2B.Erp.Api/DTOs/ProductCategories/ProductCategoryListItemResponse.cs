namespace B2B.Erp.Api.Dtos.ProductCategories;

public sealed class ProductCategoryListItemResponse
{
    public Guid Id { get; set; }

    public string Name { get; set; } = string.Empty;

    public Guid? ParentId { get; set; }

    public bool IsActive { get; set; }
}
