using Ecommerce.Api.Infrastructure.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.StaticFiles;

namespace Ecommerce.Api.Controllers;

[ApiController]
[Route("api/admin/categories")]
[Authorize(Roles = "Owner,Admin")]
public sealed class AdminCategoriesController : ControllerBase
{
    private readonly CategoriesRepository _repo;
    private readonly IWebHostEnvironment _env;

    public AdminCategoriesController(CategoriesRepository repo, IWebHostEnvironment env)
    {
        _repo = repo;
        _env = env;
    }

    public sealed class UpsertRequest
    {
        public Guid? Id { get; set; }
        public Guid? ParentId { get; set; }
        public string Name { get; set; } = string.Empty;
        public string? Slug { get; set; }
        public string? ImageUrl { get; set; }
        public bool ShowInHeader { get; set; } = true;
        public bool ShowInFooter { get; set; }
        public int SortOrder { get; set; }
        public bool IsActive { get; set; } = true;
    }

    [HttpGet]
    public async Task<IActionResult> List(CancellationToken cancellationToken)
    {
        var list = await _repo.ListAsync(CategoriesRepository.DefaultCatalogCode, cancellationToken);
        var counts = await _repo.GetCategoryProductCountsAsync(CategoriesRepository.DefaultCatalogCode, onlyPublished: false, cancellationToken);
        var data = list.Select(x => new
        {
            id = x.Id,
            parentId = x.ParentId,
            name = x.Name,
            slug = x.Slug,
            imageUrl = x.ImageUrl,
            showInHeader = x.ShowInHeader,
            showInFooter = x.ShowInFooter,
            sortOrder = x.SortOrder,
            isActive = x.IsActive,
            productCount = counts.GetValueOrDefault(x.Id, 0)
        }).ToList();

        return Ok(new { success = true, data });
    }

    [HttpPost]
    public async Task<IActionResult> Upsert([FromBody] UpsertRequest request, CancellationToken cancellationToken)
    {
        var name = (request.Name ?? string.Empty).Trim();
        if (string.IsNullOrWhiteSpace(name))
            return BadRequest(new { success = false, message = "name is required" });

        var category = new Category
        {
            TenantCode = CategoriesRepository.DefaultCatalogCode,
            Id = request.Id ?? Guid.Empty,
            ParentId = request.ParentId == Guid.Empty ? null : request.ParentId,
            Name = name,
            Slug = (request.Slug ?? string.Empty).Trim(),
            ImageUrl = (request.ImageUrl ?? string.Empty).Trim(),
            ShowInHeader = request.ShowInHeader,
            ShowInFooter = request.ShowInFooter,
            SortOrder = request.SortOrder,
            IsActive = request.IsActive,
            UpdatedAtUtc = DateTimeOffset.UtcNow
        };

        await _repo.UpsertAsync(category, cancellationToken);
        return Ok(new { success = true, data = new { id = category.Id } });
    }

    [HttpPost("{id:guid}/image")]
    [RequestSizeLimit(15_000_000)]
    public async Task<IActionResult> UploadImage([FromRoute] Guid id, [FromForm] IFormFile file, CancellationToken cancellationToken)
    {
        if (id == Guid.Empty)
            return BadRequest(new { success = false, message = "id is required" });

        if (file == null || file.Length == 0)
            return BadRequest(new { success = false, message = "file is required" });

        var uploadsRoot = Path.Combine(_env.ContentRootPath, "wwwroot", "uploads", "categories");
        Directory.CreateDirectory(uploadsRoot);

        var ext = Path.GetExtension(file.FileName);
        if (string.IsNullOrWhiteSpace(ext))
        {
            var provider = new FileExtensionContentTypeProvider();
            if (!provider.TryGetContentType(file.FileName, out _))
                ext = ".bin";
        }

        var fileName = $"{id:N}-{Guid.NewGuid():N}{ext}";
        var absPath = Path.Combine(uploadsRoot, fileName);

        await using (var fs = System.IO.File.Create(absPath))
        {
            await file.CopyToAsync(fs, cancellationToken);
        }

        var publicUrl = $"/uploads/categories/{fileName}";
        await _repo.UpdateImageUrlAsync(CategoriesRepository.DefaultCatalogCode, id, publicUrl, cancellationToken);

        return Ok(new { success = true, data = new { imageUrl = publicUrl } });
    }

    public sealed class SetProductPrimaryCategoryRequest
    {
        public string ProductTenantCode { get; set; } = string.Empty;
        public Guid CategoryId { get; set; }
    }

    public sealed class AddProductCategoryRequest
    {
        public string ProductTenantCode { get; set; } = string.Empty;
        public Guid CategoryId { get; set; }
        public bool IsPrimary { get; set; }
        public int SortOrder { get; set; }
    }

    [HttpPut("/api/admin/products/{productId:guid}/primary-category")]
    public async Task<IActionResult> SetProductPrimaryCategory([FromRoute] Guid productId, [FromBody] SetProductPrimaryCategoryRequest request, CancellationToken cancellationToken)
    {
        var productTenantCode = (request.ProductTenantCode ?? string.Empty).Trim().ToUpperInvariant();
        if (string.IsNullOrWhiteSpace(productTenantCode))
            return BadRequest(new { success = false, message = "productTenantCode is required" });

        if (request.CategoryId == Guid.Empty)
            return BadRequest(new { success = false, message = "categoryId is required" });

        await _repo.SetProductPrimaryCategoryAsync(productTenantCode, productId, CategoriesRepository.DefaultCatalogCode, request.CategoryId, cancellationToken);
        return Ok(new { success = true });
    }

    [HttpPost("/api/admin/products/{productId:guid}/categories")]
    public async Task<IActionResult> AddProductCategory([FromRoute] Guid productId, [FromBody] AddProductCategoryRequest request, CancellationToken cancellationToken)
    {
        var productTenantCode = (request.ProductTenantCode ?? string.Empty).Trim().ToUpperInvariant();
        if (string.IsNullOrWhiteSpace(productTenantCode))
            return BadRequest(new { success = false, message = "productTenantCode is required" });

        if (request.CategoryId == Guid.Empty)
            return BadRequest(new { success = false, message = "categoryId is required" });

        if (request.IsPrimary)
        {
            await _repo.SetProductPrimaryCategoryAsync(productTenantCode, productId, CategoriesRepository.DefaultCatalogCode, request.CategoryId, cancellationToken);
            return Ok(new { success = true });
        }

        await _repo.AddProductCategoryAsync(productTenantCode, productId, CategoriesRepository.DefaultCatalogCode, request.CategoryId, false, request.SortOrder, cancellationToken);
        return Ok(new { success = true });
    }

    [HttpDelete("/api/admin/products/{productId:guid}/categories/{categoryId:guid}")]
    public async Task<IActionResult> RemoveProductCategory([FromRoute] Guid productId, [FromRoute] Guid categoryId, [FromQuery] string productTenantCode, CancellationToken cancellationToken)
    {
        var pt = (productTenantCode ?? string.Empty).Trim().ToUpperInvariant();
        if (string.IsNullOrWhiteSpace(pt))
            return BadRequest(new { success = false, message = "productTenantCode is required" });

        if (categoryId == Guid.Empty)
            return BadRequest(new { success = false, message = "categoryId is required" });

        await _repo.RemoveProductCategoryAsync(pt, productId, CategoriesRepository.DefaultCatalogCode, categoryId, cancellationToken);
        return Ok(new { success = true });
    }

    [HttpGet("/api/admin/products/{productId:guid}/categories")]
    public async Task<IActionResult> ListProductCategories([FromRoute] Guid productId, [FromQuery] string productTenantCode, CancellationToken cancellationToken)
    {
        var pt = (productTenantCode ?? string.Empty).Trim().ToUpperInvariant();
        if (string.IsNullOrWhiteSpace(pt))
            return BadRequest(new { success = false, message = "productTenantCode is required" });

        var list = await _repo.ListProductCategoriesAsync(pt, productId, CategoriesRepository.DefaultCatalogCode, cancellationToken);
        var data = list.Select(x => new { categoryId = x.CategoryId, isPrimary = x.IsPrimary, sortOrder = x.SortOrder }).ToList();
        return Ok(new { success = true, data });
    }
}
