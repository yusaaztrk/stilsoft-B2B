using Ecommerce.Api.Infrastructure.Data;
using Ecommerce.Api.Infrastructure.Erp;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;

namespace Ecommerce.Api.Controllers;

[ApiController]
[Route("api/admin/products")]
[Authorize(Roles = "Owner,Admin")]
public sealed class AdminProductsController : ControllerBase
{
    private readonly ProductsRepository _repo;
    private readonly CategoriesRepository _categoriesRepo;
    private readonly ProductMetadataRepository _metadataRepo;
    private readonly ProductSettingsRepository _settingsRepo;
    private readonly IOptions<ErpOptions> _erpOptions;

    public AdminProductsController(
        ProductsRepository repo,
        CategoriesRepository categoriesRepo,
        ProductMetadataRepository metadataRepo,
        ProductSettingsRepository settingsRepo,
        IOptions<ErpOptions> erpOptions)
    {
        _repo = repo;
        _categoriesRepo = categoriesRepo;
        _metadataRepo = metadataRepo;
        _settingsRepo = settingsRepo;
        _erpOptions = erpOptions;
    }

    [HttpGet]
    public async Task<IActionResult> List([FromQuery] int? minStock, [FromQuery] int take = 200, CancellationToken cancellationToken = default)
    {
        var tenantCode = Request.Headers.TryGetValue("X-Tenant-Code", out var t)
            ? t.ToString().Trim().ToUpperInvariant()
            : string.Empty;

        var items = string.IsNullOrWhiteSpace(tenantCode)
            ? await _repo.ListAllAsync(take, cancellationToken)
            : await _repo.ListAsync(tenantCode, take, cancellationToken);

        if (minStock.HasValue)
        {
            items = items.Where(x => x.Stock <= minStock.Value).ToList();
        }

        var baseUrl = (_erpOptions.Value.BaseUrl ?? string.Empty).Trim();

        var data = items.Select(x => new
        {
            id = x.ErpProductId,
            tenantCode = x.TenantCode,
            stockCode = x.StockCode,
            name = x.Name,
            unitPrice = x.UnitPrice,
            currency = x.Currency,
            stock = x.Stock,
            isActive = x.IsActive,
            imageUrl = NormalizeImageUrl(x.ImageUrl, baseUrl),
            imageUrls = NormalizeImageUrls(x.ImageUrls, baseUrl)
        }).ToList();

        return Ok(new { success = true, data });
    }

    private static string? NormalizeImageUrl(string? url, string? erpBaseUrl)
    {
        var u = (url ?? string.Empty).Trim();
        if (string.IsNullOrWhiteSpace(u)) return null;

        if (u.StartsWith("uploads/", StringComparison.OrdinalIgnoreCase))
        {
            u = "/" + u;
        }

        if (u.StartsWith("/uploads/", StringComparison.OrdinalIgnoreCase)) return u;
        if (!u.StartsWith("/", StringComparison.Ordinal)) return u;

        var baseUrl = (erpBaseUrl ?? string.Empty).Trim();
        if (string.IsNullOrWhiteSpace(baseUrl)) return u;
        if (!baseUrl.EndsWith("/", StringComparison.Ordinal)) baseUrl += "/";
        return new Uri(new Uri(baseUrl), u.TrimStart('/')).ToString();
    }

    private static List<string>? NormalizeImageUrls(List<string>? urls, string? erpBaseUrl)
    {
        if (urls is null || urls.Count == 0) return null;
        var outList = urls
            .Select(x => NormalizeImageUrl(x, erpBaseUrl))
            .Where(x => !string.IsNullOrWhiteSpace(x))
            .Select(x => x!)
            .ToList();
        return outList.Count == 0 ? null : outList;
    }

    [HttpPost]
    public async Task<IActionResult> Create([FromBody] CreateProductRequest request, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(request.Name))
            return BadRequest(new { success = false, message = "Ürün adı boş olamaz." });
        if (string.IsNullOrWhiteSpace(request.StockCode))
            return BadRequest(new { success = false, message = "Stok kodu boş olamaz." });

        var productId = Guid.NewGuid();
        var newProduct = new EcommerceProduct
        {
            TenantCode = "DEMO",
            ErpProductId = productId,
            StockCode = request.StockCode.Trim(),
            Name = request.Name.Trim(),
            UnitPrice = request.UnitPrice,
            Currency = string.IsNullOrWhiteSpace(request.Currency) ? "TL" : request.Currency.Trim(),
            Stock = request.Stock,
            IsActive = request.Status != "Passive",
            ImageUrl = request.ImageUrl,
            ImageUrls = request.ImageUrls ?? new List<string>(),
            UpdatedAtUtc = DateTimeOffset.UtcNow
        };

        // 1. Insert product record
        await _repo.UpsertManyAsync("DEMO", new[] { newProduct }, cancellationToken);

        // 2. Insert main category mapping if present
        if (request.MainCategoryId.HasValue && request.MainCategoryId.Value != Guid.Empty)
        {
            bool isPrimary = !request.SubCategoryId.HasValue || request.SubCategoryId.Value == Guid.Empty;
            await _categoriesRepo.AddProductCategoryAsync("DEMO", productId, "DEMO", request.MainCategoryId.Value, isPrimary, 0, cancellationToken);
        }

        // 3. Insert sub category mapping if present
        if (request.SubCategoryId.HasValue && request.SubCategoryId.Value != Guid.Empty)
        {
            await _categoriesRepo.AddProductCategoryAsync("DEMO", productId, "DEMO", request.SubCategoryId.Value, true, 0, cancellationToken);
        }

        // 4. Create product setting (featured/homepage)
        var setting = new ProductSetting
        {
            TenantCode = "DEMO",
            ProductId = productId,
            IsFeatured = request.ShowOnHome,
            OverridePrice = null,
            OverrideCurrency = null,
            UpdatedAtUtc = DateTimeOffset.UtcNow
        };
        await _settingsRepo.UpsertAsync(setting, cancellationToken);

        // 5. Map status from active to published
        var statusToStore = request.Status;
        if (statusToStore == "Active") statusToStore = "Published";

        // 6. Create product metadata
        var meta = new ProductMetadata
        {
            ProductTenantCode = "DEMO",
            ProductId = productId,
            Description = request.Description ?? request.Name.Trim(),
            Features = new List<string>(),
            VariantsJson = request.VariantsJson,
            Slug = request.Slug,
            Brand = request.Brand,
            ShortDescription = request.ShortDescription,
            ShowOnHome = request.ShowOnHome,
            IsCampaign = request.IsCampaign,
            Status = statusToStore,
            RelatedProductIds = request.RelatedProductIds ?? new List<Guid>(),
            WarrantyMonths = request.WarrantyMonths,
            UpdatedAtUtc = DateTimeOffset.UtcNow
        };
        await _metadataRepo.UpsertAsync(meta, cancellationToken);

        return Ok(new { success = true, data = new
        {
            id = newProduct.ErpProductId,
            tenantCode = newProduct.TenantCode,
            stockCode = newProduct.StockCode,
            name = newProduct.Name,
            unitPrice = newProduct.UnitPrice,
            currency = newProduct.Currency,
            stock = newProduct.Stock,
            isActive = newProduct.IsActive,
            imageUrl = newProduct.ImageUrl,
            imageUrls = newProduct.ImageUrls
        }});
    }

    public sealed class CreateProductRequest
    {
        public string Name { get; set; } = "";
        public string StockCode { get; set; } = "";
        public decimal UnitPrice { get; set; }
        public string Currency { get; set; } = "TL";
        public int Stock { get; set; }
        public string? ImageUrl { get; set; }
        public List<string>? ImageUrls { get; set; }
        public Guid? MainCategoryId { get; set; }
        public Guid? SubCategoryId { get; set; }
        public string? VariantsJson { get; set; }
        public string? Slug { get; set; }
        public string? Brand { get; set; }
        public string? ShortDescription { get; set; }
        public string? Description { get; set; }
        public bool ShowOnHome { get; set; }
        public bool IsCampaign { get; set; }
        public string Status { get; set; } = "Active";
        public List<Guid>? RelatedProductIds { get; set; }
        public int WarrantyMonths { get; set; }
    }

    public sealed class UpdateStockRequest
    {
        public int Stock { get; set; }
    }

    [HttpPut("{id:guid}/stock")]
    public async Task<IActionResult> UpdateStock([FromRoute] Guid id, [FromBody] UpdateStockRequest request, CancellationToken cancellationToken)
    {
        var tenantCode = Request.Headers.TryGetValue("X-Tenant-Code", out var t)
            ? t.ToString().Trim().ToUpperInvariant()
            : "DEMO";

        await _repo.UpdateStockAsync(tenantCode, id, request.Stock, cancellationToken);
        return Ok(new { success = true, message = "Stok başarıyla güncellendi." });
    }

    [HttpPut("{id:guid}")]
    public async Task<IActionResult> Update([FromRoute] Guid id, [FromBody] CreateProductRequest request, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(request.Name))
            return BadRequest(new { success = false, message = "Ürün adı boş olamaz." });
        if (string.IsNullOrWhiteSpace(request.StockCode))
            return BadRequest(new { success = false, message = "Stok kodu boş olamaz." });

        var existing = await _repo.GetAsync("DEMO", id, cancellationToken);
        if (existing == null)
            return NotFound(new { success = false, message = "Ürün bulunamadı." });

        var updatedProduct = new EcommerceProduct
        {
            TenantCode = "DEMO",
            ErpProductId = id,
            StockCode = request.StockCode.Trim(),
            Name = request.Name.Trim(),
            UnitPrice = request.UnitPrice,
            Currency = string.IsNullOrWhiteSpace(request.Currency) ? "TL" : request.Currency.Trim(),
            Stock = request.Stock,
            IsActive = request.Status != "Passive",
            ImageUrl = request.ImageUrl,
            ImageUrls = request.ImageUrls ?? new List<string>(),
            UpdatedAtUtc = DateTimeOffset.UtcNow
        };

        // 1. Update product record
        await _repo.UpsertManyAsync("DEMO", new[] { updatedProduct }, cancellationToken);

        // 2. Clear old category mappings
        await _categoriesRepo.RemoveAllProductCategoriesAsync("DEMO", id, cancellationToken);

        // 3. Insert main category mapping if present
        if (request.MainCategoryId.HasValue && request.MainCategoryId.Value != Guid.Empty)
        {
            bool isPrimary = !request.SubCategoryId.HasValue || request.SubCategoryId.Value == Guid.Empty;
            await _categoriesRepo.AddProductCategoryAsync("DEMO", id, "DEMO", request.MainCategoryId.Value, isPrimary, 0, cancellationToken);
        }

        // 4. Insert sub category mapping if present
        if (request.SubCategoryId.HasValue && request.SubCategoryId.Value != Guid.Empty)
        {
            await _categoriesRepo.AddProductCategoryAsync("DEMO", id, "DEMO", request.SubCategoryId.Value, true, 0, cancellationToken);
        }

        // 5. Update settings
        var setting = new ProductSetting
        {
            TenantCode = "DEMO",
            ProductId = id,
            IsFeatured = request.ShowOnHome,
            OverridePrice = null,
            OverrideCurrency = null,
            UpdatedAtUtc = DateTimeOffset.UtcNow
        };
        await _settingsRepo.UpsertAsync(setting, cancellationToken);

        // 6. Update metadata
        var statusToStore = request.Status;
        if (statusToStore == "Active") statusToStore = "Published";

        var meta = await _metadataRepo.GetAsync("DEMO", id, cancellationToken);
        if (meta == null)
        {
            meta = new ProductMetadata
            {
                ProductTenantCode = "DEMO",
                ProductId = id,
                Features = new List<string>(),
                FeaturesEn = new List<string>()
            };
        }

        meta.Description = request.Description ?? meta.Description ?? request.Name.Trim();
        meta.VariantsJson = request.VariantsJson ?? meta.VariantsJson;
        meta.Slug = request.Slug ?? meta.Slug;
        meta.Brand = request.Brand ?? meta.Brand;
        meta.ShortDescription = request.ShortDescription ?? meta.ShortDescription;
        meta.ShowOnHome = request.ShowOnHome;
        meta.IsCampaign = request.IsCampaign;
        meta.Status = statusToStore;
        meta.RelatedProductIds = request.RelatedProductIds ?? meta.RelatedProductIds ?? new List<Guid>();
        meta.WarrantyMonths = request.WarrantyMonths;
        meta.UpdatedAtUtc = DateTimeOffset.UtcNow;

        await _metadataRepo.UpsertAsync(meta, cancellationToken);

        return Ok(new { success = true, message = "Ürün başarıyla güncellendi." });
    }
}
