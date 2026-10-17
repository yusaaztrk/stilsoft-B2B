using Ecommerce.Api.Infrastructure;
using Ecommerce.Api.Infrastructure.Data;
using Ecommerce.Api.Infrastructure.Erp;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;

namespace Ecommerce.Api.Controllers;

[ApiController]
[Route("api/storefront/categories")]
public sealed class StorefrontCategoriesController : ControllerBase
{
    private readonly CategoriesRepository _categories;
    private readonly ProductsRepository _products;
    private readonly ProductSettingsRepository _settings;
    private readonly ProductMetadataRepository _meta;
    private readonly AdminModulesRepository _adminModules;
    private readonly IOptions<ErpOptions> _erpOptions;
    private readonly CampaignsRepository _campaigns;
    private readonly CampaignService _campaignService;

    public StorefrontCategoriesController(
        CategoriesRepository categories, 
        ProductsRepository products, 
        ProductSettingsRepository settings,
        ProductMetadataRepository meta,
        AdminModulesRepository adminModules,
        IOptions<ErpOptions> erpOptions,
        CampaignsRepository campaigns,
        CampaignService campaignService)
    {
        _categories = categories;
        _products = products;
        _settings = settings;
        _meta = meta;
        _adminModules = adminModules;
        _erpOptions = erpOptions;
        _campaigns = campaigns;
        _campaignService = campaignService;
    }

    [HttpGet]
    public async Task<IActionResult> List(CancellationToken cancellationToken)
    {
        var list = await _categories.ListAsync(CategoriesRepository.DefaultCatalogCode, cancellationToken);
        var counts = await _categories.GetCategoryProductCountsAsync(CategoriesRepository.DefaultCatalogCode, onlyPublished: true, cancellationToken);

        var data = list
            .Where(x => x.IsActive)
            .Select(x => new
            {
                id = x.Id,
                parentId = x.ParentId,
                name = x.Name,
                slug = x.Slug,
                imageUrl = x.ImageUrl,
                showInHeader = x.ShowInHeader,
                showInFooter = x.ShowInFooter,
                sortOrder = x.SortOrder,
                productCount = counts.GetValueOrDefault(x.Id, 0)
            })
            .ToList();

        return Ok(new { success = true, data });
    }

    [HttpGet("{slug}/products")]
    public async Task<IActionResult> ProductsByCategory([FromRoute] string slug, [FromQuery] int take = 200, CancellationToken cancellationToken = default)
    {
        var erpBaseUrl = (_erpOptions.Value.BaseUrl ?? string.Empty).Trim();
        var cat = await _categories.GetBySlugAsync(CategoriesRepository.DefaultCatalogCode, slug, cancellationToken);
        if (cat is null)
            return NotFound(new { success = false, message = "Kategori bulunamadı" });

        var catIds = await _categories.GetCategoryAndChildIdsAsync(CategoriesRepository.DefaultCatalogCode, cat.Id, cancellationToken);
        var productKeys = await _categories.ListProductKeysByCategoryIdsAsync(CategoriesRepository.DefaultCatalogCode, catIds, cancellationToken);

        take = take < 1 ? 20 : take;
        take = take > 500 ? 500 : take;

        // Fetch unpublished product IDs
        var unpublishedIds = await _meta.GetUnpublishedProductIdsAsync(cancellationToken);

        var products = new List<EcommerceProduct>();
        foreach (var (productTenantCode, productId) in productKeys)
        {
            if (unpublishedIds.Contains(productId)) continue; // Filter out drafts, missing info, passive etc.

            var p = await _products.GetAsync(productTenantCode, productId, cancellationToken);
            if (p is not null) products.Add(p);

            if (products.Count >= take) break;
        }

        // Fetch reviews aggregates in bulk
        var reviewSql = "SELECT product_id, COUNT(*) as cnt, COALESCE(AVG(rating), 0) as average FROM admin_reviews WHERE status = 'Approved' GROUP BY product_id";
        var reviewRows = await _adminModules.QuerySqlAsync(reviewSql, null, cancellationToken);
        var reviewsMap = new Dictionary<Guid, (int Count, double Avg)>();
        foreach (var row in reviewRows)
        {
            if (row.TryGetValue("product_id", out var pidVal))
            {
                Guid pid = Guid.Empty;
                if (pidVal is Guid g) pid = g;
                else if (pidVal is string s && Guid.TryParse(s, out var parsed)) pid = parsed;

                if (pid != Guid.Empty)
                {
                    var count = row.TryGetValue("cnt", out var cntVal) ? Convert.ToInt32(cntVal) : 0;
                    var avg = row.TryGetValue("average", out var avgVal) ? Convert.ToDouble(avgVal) : 0.0;
                    reviewsMap[pid] = (count, avg);
                }
            }
        }

        // Fetch categories and product maps in bulk
        var allCats = await _categories.ListAsync(CategoriesRepository.DefaultCatalogCode, cancellationToken);
        var activeCats = allCats.Where(x => x.IsActive).ToList();
        var catsById = activeCats.ToDictionary(x => x.Id);

        var catMapsList = await _categories.ListAllProductCategoryMapsAsync(CategoriesRepository.DefaultCatalogCode, CategoriesRepository.DefaultCatalogCode, cancellationToken);
        var catMapsByProductId = catMapsList
            .GroupBy(x => x.ProductId)
            .ToDictionary(
                g => g.Key,
                g => g.Select(x => (x.CategoryId, x.IsPrimary, x.SortOrder)).ToList()
            );

        var resolveProductCategory = (Guid productId) =>
        {
            string? mainCat = null;
            string? subCat = null;
            if (catMapsByProductId.TryGetValue(productId, out var maps) && maps.Count > 0)
            {
                var primary = maps.FirstOrDefault(x => x.IsPrimary);
                if (primary.CategoryId == Guid.Empty)
                {
                    primary = maps.First();
                }

                if (catsById.TryGetValue(primary.CategoryId, out var matchedCat))
                {
                    if (matchedCat.ParentId != null && catsById.TryGetValue(matchedCat.ParentId.Value, out var parentCat))
                    {
                        subCat = matchedCat.Name;
                        mainCat = parentCat.Name;
                    }
                    else
                    {
                        mainCat = matchedCat.Name;
                    }
                }
            }
            return (MainCategory: mainCat, SubCategory: subCat);
        };

        var activeCampaigns = await _campaigns.GetActiveCampaignsAsync(cancellationToken);
        var parentLookup = allCats.ToDictionary(c => c.Id, c => c.ParentId);

        var metadataList = await _meta.ListAllAsync(cancellationToken);
        var metadataMap = metadataList.ToDictionary(x => x.ProductId);

        var data = new List<object>();
        foreach (var group in products.GroupBy(x => (x.TenantCode ?? string.Empty).Trim().ToUpperInvariant()))
        {
            var tc = group.Key;
            if (string.IsNullOrWhiteSpace(tc)) continue;
            var settingsMap = await _settings.GetAllByProductIdAsync(tc, cancellationToken);

            data.AddRange(group
                .OrderBy(x => x.Name)
                .Select(p => {
                    var resolvedCat = resolveProductCategory(p.ErpProductId);
                    metadataMap.TryGetValue(p.ErpProductId, out var m);
                    catMapsByProductId.TryGetValue(p.ErpProductId, out var maps);
                    var categoryIds = maps?.Select(x => x.CategoryId).ToList() ?? new List<Guid>();
                    return ApplyOverrideIfAny(p, settingsMap, erpBaseUrl, resolvedCat.MainCategory, resolvedCat.SubCategory, reviewsMap, m, categoryIds, activeCampaigns, parentLookup);
                }));
        }

        return Ok(new { success = true, data });
    }

    private object ApplyOverrideIfAny(
        EcommerceProduct product, 
        Dictionary<Guid, ProductSetting> settingsMap, 
        string? erpBaseUrl, 
        string? mainCategory, 
        string? subCategory,
        Dictionary<Guid, (int Count, double Avg)> reviewsMap,
        ProductMetadata? metadata,
        List<Guid> categoryIds,
        List<Campaign> activeCampaigns,
        Dictionary<Guid, Guid?> parentLookup)
    {
        settingsMap.TryGetValue(product.ErpProductId, out var s);

        var img = NormalizeImageUrl(product.ImageUrl, erpBaseUrl);
        var imgs = NormalizeImageUrls(product.ImageUrls, erpBaseUrl);

        reviewsMap.TryGetValue(product.ErpProductId, out var rev);

        var originalPrice = s?.OverridePrice ?? product.UnitPrice ?? 0;
        var appliedCamp = _campaignService.ApplyCampaignsToProduct(
            product.ErpProductId,
            originalPrice,
            metadata?.Brand,
            categoryIds,
            activeCampaigns,
            parentLookup);

        var discountedPrice = appliedCamp != null ? appliedCamp.DiscountedPrice : originalPrice;
        var isFreeShipping = metadata?.IsFreeShipping ?? false;

        return new
        {
            id = product.ErpProductId,
            tenantCode = (product.TenantCode ?? string.Empty).Trim().ToUpperInvariant(),
            stockCode = product.StockCode,
            name = product.Name,
            originalPrice = originalPrice,
            unitPrice = discountedPrice,
            discountedPrice = discountedPrice < originalPrice ? discountedPrice : (decimal?)null,
            currency = !string.IsNullOrWhiteSpace(s?.OverrideCurrency) ? s!.OverrideCurrency : product.Currency,
            stock = product.Stock,
            isActive = product.IsActive,
            imageUrl = img,
            imageUrls = imgs,
            mainCategory = mainCategory,
            subCategory = subCategory,
            reviewsCount = rev.Count,
            ratingAverage = rev.Avg,
            brand = metadata?.Brand,
            slug = metadata?.Slug,
            isCampaign = metadata?.IsCampaign ?? false,
            showOnHome = metadata?.ShowOnHome ?? false,
            warrantyMonths = metadata?.WarrantyMonths ?? 0,
            campaignBadge = appliedCamp?.CampaignBadge,
            campaignName = appliedCamp?.CampaignName,
            isFreeShipping = isFreeShipping
        };
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
}
