namespace Ecommerce.Api.Infrastructure.Data;

public sealed class ProductMetadata
{
    public string ProductTenantCode { get; set; } = string.Empty;
    public Guid ProductId { get; set; }
    public string? Description { get; set; }
    public List<string> Features { get; set; } = new();
    public string? VariantsJson { get; set; }
    
    // New E-commerce Fields
    public string? Slug { get; set; }
    public string? Brand { get; set; }
    public string? ShortDescription { get; set; }
    public string? TechnicalSpecsJson { get; set; }
    public string? ManualPdfUrl { get; set; }
    public string? CatalogPdfUrl { get; set; }
    public string? SeoTitle { get; set; }
    public string? SeoDescription { get; set; }
    public string? LabelsJson { get; set; }
    public bool ShowOnHome { get; set; }
    public bool IsCampaign { get; set; }
    public string Status { get; set; } = "Draft";
    public List<Guid> RelatedProductIds { get; set; } = new();
    public int WarrantyMonths { get; set; }
    public bool IsFreeShipping { get; set; } = false;

    // English language fields
    public string? DescriptionEn { get; set; }
    public List<string> FeaturesEn { get; set; } = new();
    public string? ShortDescriptionEn { get; set; }
    public string? TechnicalSpecsEnJson { get; set; }
    public string? SeoTitleEn { get; set; }
    public string? SeoDescriptionEn { get; set; }
    
    public DateTimeOffset UpdatedAtUtc { get; set; }
}
