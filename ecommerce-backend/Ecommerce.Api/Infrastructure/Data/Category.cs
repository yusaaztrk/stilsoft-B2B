namespace Ecommerce.Api.Infrastructure.Data;

public sealed class Category
{
    public string TenantCode { get; set; } = string.Empty;
    public Guid Id { get; set; }
    public Guid? ParentId { get; set; }
    public string Name { get; set; } = string.Empty;
    public string Slug { get; set; } = string.Empty;
    public string ImageUrl { get; set; } = string.Empty;
    public bool ShowInHeader { get; set; } = true;
    public bool ShowInFooter { get; set; }
    public int SortOrder { get; set; }
    public bool IsActive { get; set; } = true;
    public DateTimeOffset CreatedAtUtc { get; set; }
    public DateTimeOffset UpdatedAtUtc { get; set; }
}
