using Ecommerce.Api.Infrastructure.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Ecommerce.Api.Controllers;

[ApiController]
[Route("api/admin/products/{productId:guid}/metadata")]
[Authorize(Roles = "Owner,Admin")]
public sealed class AdminProductMetadataController : ControllerBase
{
    private readonly ProductMetadataRepository _repo;
    private readonly ProductsRepository _productsRepo;
    private readonly CategoriesRepository _categoriesRepo;
    private readonly AdminLogsRepository _logsRepo;

    public AdminProductMetadataController(
        ProductMetadataRepository repo,
        ProductsRepository productsRepo,
        CategoriesRepository categoriesRepo,
        AdminLogsRepository logsRepo)
    {
        _repo = repo;
        _productsRepo = productsRepo;
        _categoriesRepo = categoriesRepo;
        _logsRepo = logsRepo;
    }

    [HttpGet("/api/admin/products/metadata")]
    public async Task<IActionResult> ListAll(CancellationToken cancellationToken)
    {
        try
        {
            var items = await _repo.ListAllAsync(cancellationToken);
            var data = items.Select(meta => new
            {
                productTenantCode = meta.ProductTenantCode,
                productId = meta.ProductId,
                description = meta.Description,
                features = meta.Features ?? new List<string>(),
                variantsJson = meta.VariantsJson,
                slug = meta.Slug,
                brand = meta.Brand,
                shortDescription = meta.ShortDescription,
                technicalSpecsJson = meta.TechnicalSpecsJson,
                manualPdfUrl = meta.ManualPdfUrl,
                catalogPdfUrl = meta.CatalogPdfUrl,
                seoTitle = meta.SeoTitle,
                seoDescription = meta.SeoDescription,
                labelsJson = meta.LabelsJson,
                showOnHome = meta.ShowOnHome,
                isCampaign = meta.IsCampaign,
                status = meta.Status,
                descriptionEn = meta.DescriptionEn,
                featuresEn = meta.FeaturesEn ?? new List<string>(),
                shortDescriptionEn = meta.ShortDescriptionEn,
                technicalSpecsEnJson = meta.TechnicalSpecsEnJson,
                seoTitleEn = meta.SeoTitleEn,
                seoDescriptionEn = meta.SeoDescriptionEn,
                relatedProductIds = meta.RelatedProductIds ?? new List<Guid>(),
                warrantyMonths = meta.WarrantyMonths,
                isFreeShipping = meta.IsFreeShipping
            }).ToList();

            return Ok(new { success = true, data });
        }
        catch (Exception ex)
        {
            return StatusCode(500, new { success = false, message = ex.Message });
        }
    }

    [HttpGet]
    public async Task<IActionResult> Get([FromRoute] Guid productId, [FromQuery] string productTenantCode, CancellationToken cancellationToken)

    {
        var pt = (productTenantCode ?? string.Empty).Trim().ToUpperInvariant();
        if (string.IsNullOrWhiteSpace(pt))
            return BadRequest(new { success = false, message = "productTenantCode is required" });

        var meta = await _repo.GetAsync(pt, productId, cancellationToken);
        if (meta is null)
        {
            return Ok(new
            {
                success = true,
                data = new
                {
                    productTenantCode = pt,
                    productId = productId,
                    description = (string?)null,
                    features = new List<string>(),
                    variantsJson = (string?)null,
                    slug = (string?)null,
                    brand = (string?)null,
                    shortDescription = (string?)null,
                    technicalSpecsJson = (string?)null,
                    manualPdfUrl = (string?)null,
                    catalogPdfUrl = (string?)null,
                    seoTitle = (string?)null,
                    seoDescription = (string?)null,
                    labelsJson = (string?)null,
                    showOnHome = false,
                    isCampaign = false,
                    status = "Draft",
                    descriptionEn = (string?)null,
                    featuresEn = new List<string>(),
                    shortDescriptionEn = (string?)null,
                    technicalSpecsEnJson = (string?)null,
                    seoTitleEn = (string?)null,
                    seoDescriptionEn = (string?)null,
                    relatedProductIds = new List<Guid>(),
                    warrantyMonths = 0,
                    isFreeShipping = false
                }
            });
        }

        return Ok(new
        {
            success = true,
            data = new
            {
                productTenantCode = meta.ProductTenantCode,
                productId = meta.ProductId,
                description = meta.Description,
                features = meta.Features ?? new List<string>(),
                variantsJson = meta.VariantsJson,
                slug = meta.Slug,
                brand = meta.Brand,
                shortDescription = meta.ShortDescription,
                technicalSpecsJson = meta.TechnicalSpecsJson,
                manualPdfUrl = meta.ManualPdfUrl,
                catalogPdfUrl = meta.CatalogPdfUrl,
                seoTitle = meta.SeoTitle,
                seoDescription = meta.SeoDescription,
                labelsJson = meta.LabelsJson,
                showOnHome = meta.ShowOnHome,
                isCampaign = meta.IsCampaign,
                status = meta.Status,
                descriptionEn = meta.DescriptionEn,
                featuresEn = meta.FeaturesEn ?? new List<string>(),
                shortDescriptionEn = meta.ShortDescriptionEn,
                technicalSpecsEnJson = meta.TechnicalSpecsEnJson,
                seoTitleEn = meta.SeoTitleEn,
                seoDescriptionEn = meta.SeoDescriptionEn,
                relatedProductIds = meta.RelatedProductIds ?? new List<Guid>(),
                warrantyMonths = meta.WarrantyMonths,
                isFreeShipping = meta.IsFreeShipping
            }
        });
    }

    public sealed class UpsertRequest
    {
        public string ProductTenantCode { get; set; } = string.Empty;
        public string? Description { get; set; }
        public List<string>? Features { get; set; }
        public string? VariantsJson { get; set; }
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
        public string? DescriptionEn { get; set; }
        public List<string>? FeaturesEn { get; set; }
        public string? ShortDescriptionEn { get; set; }
        public string? TechnicalSpecsEnJson { get; set; }
        public string? SeoTitleEn { get; set; }
        public string? SeoDescriptionEn { get; set; }
        public List<Guid>? RelatedProductIds { get; set; }
        public int WarrantyMonths { get; set; }
        public bool IsFreeShipping { get; set; }
    }

    [HttpPut]
    public async Task<IActionResult> Upsert([FromRoute] Guid productId, [FromBody] UpsertRequest request, CancellationToken cancellationToken)
    {
        var pt = (request.ProductTenantCode ?? string.Empty).Trim().ToUpperInvariant();
        if (string.IsNullOrWhiteSpace(pt))
            return BadRequest(new { success = false, message = "productTenantCode is required" });

        // PUBLISHED STATUS VALIDATION CHECK
        if (request.Status == "Published")
        {
            if (string.IsNullOrWhiteSpace(request.Slug))
                return BadRequest(new { success = false, message = "Ürün yayına alınabilmesi için SEO slug alanının doldurulması zorunludur." });

            if (string.IsNullOrWhiteSpace(request.Description))
                return BadRequest(new { success = false, message = "Ürün yayına alınabilmesi için açıklama alanının doldurulması zorunludur." });

            var prod = await _productsRepo.GetAsync(pt, productId, cancellationToken);
            if (prod == null || (string.IsNullOrWhiteSpace(prod.ImageUrl) && (prod.ImageUrls == null || prod.ImageUrls.Count == 0)))
                return BadRequest(new { success = false, message = "Ürün yayına alınabilmesi için en az bir görselinin (kapak resmi veya galeri görseli) bulunması zorunludur." });

            var categories = await _categoriesRepo.ListProductCategoriesAsync(pt, productId, pt, cancellationToken);
            if (categories == null || categories.Count == 0)
                return BadRequest(new { success = false, message = "Ürün yayına alınabilmesi için en az bir kategoriye atanması zorunludur." });
        }

        var meta = new ProductMetadata
        {
            ProductTenantCode = pt,
            ProductId = productId,
            Description = request.Description,
            Features = request.Features ?? new List<string>(),
            VariantsJson = request.VariantsJson,
            Slug = request.Slug,
            Brand = request.Brand,
            ShortDescription = request.ShortDescription,
            TechnicalSpecsJson = request.TechnicalSpecsJson,
            ManualPdfUrl = request.ManualPdfUrl,
            CatalogPdfUrl = request.CatalogPdfUrl,
            SeoTitle = request.SeoTitle,
            SeoDescription = request.SeoDescription,
            LabelsJson = request.LabelsJson,
            ShowOnHome = request.ShowOnHome,
            IsCampaign = request.IsCampaign,
            Status = request.Status,
            DescriptionEn = request.DescriptionEn,
            FeaturesEn = request.FeaturesEn ?? new List<string>(),
            ShortDescriptionEn = request.ShortDescriptionEn,
            TechnicalSpecsEnJson = request.TechnicalSpecsEnJson,
            SeoTitleEn = request.SeoTitleEn,
            SeoDescriptionEn = request.SeoDescriptionEn,
            RelatedProductIds = request.RelatedProductIds ?? new List<Guid>(),
            WarrantyMonths = request.WarrantyMonths,
            IsFreeShipping = request.IsFreeShipping,
            UpdatedAtUtc = DateTimeOffset.UtcNow
        };

        await _repo.UpsertAsync(meta, cancellationToken);

        // Audit Logging
        var userEmail = User.Identity?.Name ?? "admin";
        await _logsRepo.LogAsync(
            userEmail,
            "ProductMetadataUpdate",
            $"Updated product metadata for ID {productId} (Status: {request.Status}, Slug: {request.Slug})",
            Request.HttpContext.Connection.RemoteIpAddress?.ToString() ?? "127.0.0.1",
            cancellationToken
        );

        return Ok(new { success = true });
    }
}
