using Ecommerce.Api.Infrastructure.Data;
using Ecommerce.Api.Infrastructure.Erp;
using Ecommerce.Api.Infrastructure;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Authorization;
using System.Security.Claims;
using System.Linq;
using System.Text.Json;
using Microsoft.Extensions.Options;

namespace Ecommerce.Api.Controllers;

[ApiController]
[Route("api/storefront")]
public sealed class StorefrontController : ControllerBase
{
    private readonly ProductSettingsRepository _repo;
    private readonly ProductsRepository _products;
    private readonly ProductMetadataRepository _meta;
    private readonly CategoriesRepository _categories;
    private readonly NewsletterRepository _newsletterRepo;
    private readonly IOptions<ErpOptions> _erpOptions;
    private readonly LiveActivityService _live;
    private readonly AdminModulesRepository _adminModules;
    private readonly EcommerceUsersRepository _users;
    private readonly PdfCatalogRepository _pdfCatalogs;
    private readonly CampaignsRepository _campaigns;
    private readonly CampaignService _campaignService;
    private readonly StoreDesignRepository _design;

    public StorefrontController(
        ProductSettingsRepository repo,
        ProductsRepository products,
        ProductMetadataRepository meta,
        CategoriesRepository categories,
        NewsletterRepository newsletterRepo,
        IOptions<ErpOptions> erpOptions,
        LiveActivityService live,
        AdminModulesRepository adminModules,
        EcommerceUsersRepository users,
        PdfCatalogRepository pdfCatalogs,
        CampaignsRepository campaigns,
        CampaignService campaignService,
        StoreDesignRepository design)
    {
        _repo = repo;
        _products = products;
        _meta = meta;
        _categories = categories;
        _newsletterRepo = newsletterRepo;
        _erpOptions = erpOptions;
        _live = live;
        _adminModules = adminModules;
        _users = users;
        _pdfCatalogs = pdfCatalogs;
        _campaigns = campaigns;
        _campaignService = campaignService;
        _design = design;
    }

    [HttpGet("products")]
    public async Task<IActionResult> Products([FromQuery] int take = 200, CancellationToken cancellationToken = default)
    {
        var erpBaseUrl = (_erpOptions.Value.BaseUrl ?? string.Empty).Trim();
        var tenantCode = Request.Headers.TryGetValue("X-Tenant-Code", out var t)
            ? t.ToString().Trim().ToUpperInvariant()
            : string.Empty;

        if (string.IsNullOrWhiteSpace(tenantCode))
        {
            tenantCode = (Request.Query["tenantCode"].ToString() ?? string.Empty).Trim().ToUpperInvariant();
        }

        var unpublishedIds = await _meta.GetUnpublishedProductIdsAsync(cancellationToken);

        // Load reviews aggregates
        var reviewSql = "SELECT product_id, COUNT(*) as cnt, COALESCE(AVG(rating), 0) as average FROM admin_reviews WHERE status = 'Approved' GROUP BY product_id";
        var reviewRows = await _adminModules.QuerySqlAsync(reviewSql, null, cancellationToken);
        var reviewsMap = new Dictionary<Guid, (int Count, double Avg)>();
        foreach (var row in reviewRows)
        {
            if (row.TryGetValue("product_id", out var pidVal))
            {
                Guid pid = Guid.Empty;
                if (pidVal is Guid g) pid = g;
                else if (pidVal is string sVal && Guid.TryParse(sVal, out var parsed)) pid = parsed;

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

        var parentLookup = allCats.ToDictionary(c => c.Id, c => c.ParentId);

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

        if (!string.IsNullOrWhiteSpace(tenantCode))
        {
            var settingsMap = await _repo.GetAllByProductIdAsync(tenantCode, cancellationToken);
            var products = await _products.ListAsync(tenantCode, take, cancellationToken);
            var metadataList = await _meta.ListAllAsync(cancellationToken);
            var metadataMap = metadataList.ToDictionary(x => x.ProductId);
            
            // Only return Published products (i.e. not draft/unpublished)
            var data = products
                .Where(p => !unpublishedIds.Contains(p.ErpProductId))
                .Select(p => {
                    var resolvedCat = resolveProductCategory(p.ErpProductId);
                    metadataMap.TryGetValue(p.ErpProductId, out var m);
                    var showOnHome = m?.ShowOnHome ?? false;
                    catMapsByProductId.TryGetValue(p.ErpProductId, out var maps);
                    var categoryIds = maps?.Select(x => x.CategoryId).ToList() ?? new List<Guid>();
                    var item = ApplyOverrideIfAny(p, settingsMap, erpBaseUrl, resolvedCat.MainCategory, resolvedCat.SubCategory, reviewsMap, m, categoryIds, activeCampaigns, parentLookup);
                    return new { Item = item, ShowOnHome = showOnHome, UpdatedAt = p.UpdatedAtUtc };
                })
                .OrderByDescending(x => x.ShowOnHome)
                .ThenByDescending(x => x.UpdatedAt)
                .Select(x => x.Item)
                .ToList();
            return Ok(new { success = true, data });
        }

        var allSettings = await _repo.ListAllAsync(5000, cancellationToken);
        var settingsByKey = allSettings
            .GroupBy(x => (Tenant: (x.TenantCode ?? string.Empty).Trim().ToUpperInvariant(), ProductId: x.ProductId))
            .ToDictionary(g => g.Key, g => g.OrderByDescending(x => x.UpdatedAtUtc).First());

        var allProducts = await _products.ListAllAsync(take, cancellationToken);
        var metadataListAll = await _meta.ListAllAsync(cancellationToken);
        var metadataMapAll = metadataListAll.ToDictionary(x => x.ProductId);
        
        // Only return Published products (i.e. not draft/unpublished)
        var dataAll = allProducts
            .Where(p => !unpublishedIds.Contains(p.ErpProductId))
            .Select(p => {
                var resolvedCat = resolveProductCategory(p.ErpProductId);
                metadataMapAll.TryGetValue(p.ErpProductId, out var m);
                var showOnHome = m?.ShowOnHome ?? false;
                catMapsByProductId.TryGetValue(p.ErpProductId, out var maps);
                var categoryIds = maps?.Select(x => x.CategoryId).ToList() ?? new List<Guid>();
                var item = ApplyOverrideIfAnyGlobal(p, settingsByKey, erpBaseUrl, resolvedCat.MainCategory, resolvedCat.SubCategory, reviewsMap, m, categoryIds, activeCampaigns, parentLookup);
                return new { Item = item, ShowOnHome = showOnHome, UpdatedAt = p.UpdatedAtUtc };
            })
            .OrderByDescending(x => x.ShowOnHome)
            .ThenByDescending(x => x.UpdatedAt)
            .Select(x => x.Item)
            .ToList();
        return Ok(new { success = true, data = dataAll });
    }

    [HttpGet("products/{id:guid}")]
    public async Task<IActionResult> ProductDetail([FromRoute] Guid id, [FromQuery] string? lang, CancellationToken cancellationToken)
    {
        var erpBaseUrl = (_erpOptions.Value.BaseUrl ?? string.Empty).Trim();
        var activeCampaigns = await _campaigns.GetActiveCampaignsAsync(cancellationToken);
        var allCats = await _categories.ListAsync(CategoriesRepository.DefaultCatalogCode, cancellationToken);
        var parentLookup = allCats.ToDictionary(c => c.Id, c => c.ParentId);
        var tenantCode = Request.Headers.TryGetValue("X-Tenant-Code", out var t)
            ? t.ToString().Trim().ToUpperInvariant()
            : string.Empty;

        if (string.IsNullOrWhiteSpace(tenantCode))
        {
            tenantCode = (Request.Query["tenantCode"].ToString() ?? string.Empty).Trim().ToUpperInvariant();
        }

        EcommerceProduct? product;
        if (string.IsNullOrWhiteSpace(tenantCode))
        {
            product = await _products.GetAnyAsync(id, cancellationToken);
            tenantCode = (product?.TenantCode ?? string.Empty).Trim().ToUpperInvariant();
        }
        else
        {
            product = await _products.GetAsync(tenantCode, id, cancellationToken);
        }

        if (product is null)
            return NotFound(new { success = false, message = "Ürün bulunamadı" });

        if (string.IsNullOrWhiteSpace(tenantCode))
            return NotFound(new { success = false, message = "Ürün bulunamadı" });

        var meta = await _meta.GetAsync(tenantCode, id, cancellationToken);
        
        // Only storefront visitors can see published products. If meta is null (new product), it is published by default.
        var isAdmin = User.IsInRole("Owner") || User.IsInRole("Admin");
        if (!isAdmin && meta != null && meta.Status != "Published")
        {
            return NotFound(new { success = false, message = "Ürün yayında değil veya bulunamadı" });
        }

        var s = await _repo.GetAsync(tenantCode, id, cancellationToken);

        var img = NormalizeImageUrl(product.ImageUrl, erpBaseUrl);
        var imgs = NormalizeImageUrls(product.ImageUrls, erpBaseUrl);

        var isEn = lang?.ToLowerInvariant() == "en";
        var description = meta != null ? (isEn ? (meta.DescriptionEn ?? meta.Description) : meta.Description) : null;
        var features = meta != null ? (isEn ? (meta.FeaturesEn ?? meta.Features) : meta.Features) : null;
        var shortDescription = meta != null ? (isEn ? (meta.ShortDescriptionEn ?? meta.ShortDescription) : meta.ShortDescription) : null;
        var technicalSpecsJson = meta != null ? (isEn ? (meta.TechnicalSpecsEnJson ?? meta.TechnicalSpecsJson) : meta.TechnicalSpecsJson) : null;
        var seoTitle = meta != null ? (isEn ? (meta.SeoTitleEn ?? meta.SeoTitle) : meta.SeoTitle) : null;
        var seoDescription = meta != null ? (isEn ? (meta.SeoDescriptionEn ?? meta.SeoDescription) : meta.SeoDescription) : null;

        object? variants = null;
        if (meta != null && !string.IsNullOrWhiteSpace(meta.VariantsJson))
        {
            try
            {
                variants = JsonSerializer.Deserialize<object>(meta.VariantsJson, new JsonSerializerOptions(JsonSerializerDefaults.Web));
            }
            catch { }
        }

        object? technicalSpecs = null;
        if (!string.IsNullOrWhiteSpace(technicalSpecsJson))
        {
            try
            {
                technicalSpecs = JsonSerializer.Deserialize<object>(technicalSpecsJson, new JsonSerializerOptions(JsonSerializerDefaults.Web));
            }
            catch { }
        }

        // Load category mapping for this product
        var productCats = await _categories.ListProductCategoriesAsync(tenantCode, id, CategoriesRepository.DefaultCatalogCode, cancellationToken);
        var primaryCatMapping = productCats.FirstOrDefault(x => x.IsPrimary);
        // Fallback to first mapping if no primary is explicitly set
        if (primaryCatMapping.CategoryId == Guid.Empty && productCats.Count > 0)
        {
            primaryCatMapping = productCats.First();
        }

        string? mainCategoryName = null;
        string? subCategoryName = null;

        if (primaryCatMapping.CategoryId != Guid.Empty)
        {
            var activeCats = allCats.Where(x => x.IsActive).ToList();
            var matchedCat = activeCats.FirstOrDefault(x => x.Id == primaryCatMapping.CategoryId);
            if (matchedCat != null)
            {
                if (matchedCat.ParentId != null)
                {
                    subCategoryName = matchedCat.Name;
                    var parentCat = activeCats.FirstOrDefault(x => x.Id == matchedCat.ParentId);
                    mainCategoryName = parentCat?.Name ?? matchedCat.Name;
                }
                else
                {
                    mainCategoryName = matchedCat.Name;
                }
            }
        }

        // Load reviews aggregates for this product
        var reviewStatsSql = "SELECT COUNT(*) as cnt, COALESCE(AVG(rating), 0) as average FROM admin_reviews WHERE product_id = @Id AND status = 'Approved'";
        var statsRows = await _adminModules.QuerySqlAsync(reviewStatsSql, new { Id = id }, cancellationToken);
        var reviewsCount = 0;
        var ratingAverage = 0.0;
        if (statsRows.Count > 0)
        {
            reviewsCount = Convert.ToInt32(statsRows[0]["cnt"]);
            ratingAverage = Convert.ToDouble(statsRows[0]["average"]);
        }

        // Load related products
        var formattedRelated = new List<object>();
        if (meta != null && meta.RelatedProductIds != null && meta.RelatedProductIds.Count > 0)
        {
            var relatedProds = await _products.GetManyByIdsAsync(tenantCode, meta.RelatedProductIds, cancellationToken);
            var relReviewRows = await _adminModules.QuerySqlAsync(
                "SELECT product_id, COUNT(*) as cnt, COALESCE(AVG(rating), 0) as average FROM admin_reviews WHERE status = 'Approved' AND product_id = ANY(@ids) GROUP BY product_id",
                new { ids = meta.RelatedProductIds },
                cancellationToken
            );
            var relReviewsMap = new Dictionary<Guid, (int Count, double Avg)>();
            foreach (var row in relReviewRows)
            {
                if (row.TryGetValue("product_id", out var pidVal))
                {
                    Guid pid = Guid.Empty;
                    if (pidVal is Guid g) pid = g;
                    else if (pidVal is string sVal && Guid.TryParse(sVal, out var parsed)) pid = parsed;

                    if (pid != Guid.Empty)
                    {
                        var count = row.TryGetValue("cnt", out var cntVal) ? Convert.ToInt32(cntVal) : 0;
                        var avg = row.TryGetValue("average", out var avgVal) ? Convert.ToDouble(avgVal) : 0.0;
                        relReviewsMap[pid] = (count, avg);
                    }
                }
            }

            var relSettingsMap = await _repo.GetAllByProductIdAsync(tenantCode, cancellationToken);
            var relMetadataList = await _meta.ListAllAsync(cancellationToken);
            var relMetadataMap = relMetadataList.ToDictionary(x => x.ProductId);
            
            var activeCats = allCats.Where(x => x.IsActive).ToList();
            var catsById = activeCats.ToDictionary(x => x.Id);
            var catMapsList = await _categories.ListAllProductCategoryMapsAsync(CategoriesRepository.DefaultCatalogCode, CategoriesRepository.DefaultCatalogCode, cancellationToken);
            var catMapsByProductId = catMapsList.GroupBy(x => x.ProductId).ToDictionary(g => g.Key, g => g.Select(x => (x.CategoryId, x.IsPrimary)).ToList());

            var resolveRelCat = (Guid pid) =>
            {
                string? main = null;
                string? sub = null;
                if (catMapsByProductId.TryGetValue(pid, out var maps) && maps.Count > 0)
                {
                    var primary = maps.FirstOrDefault(x => x.IsPrimary);
                    if (primary.CategoryId == Guid.Empty) primary = maps.First();
                    if (catsById.TryGetValue(primary.CategoryId, out var matched))
                    {
                        if (matched.ParentId != null && catsById.TryGetValue(matched.ParentId.Value, out var parent))
                        {
                            sub = matched.Name;
                            main = parent.Name;
                        }
                        else
                        {
                            main = matched.Name;
                        }
                    }
                }
                return (Main: main, Sub: sub);
            };

            var unpublishedIds = await _meta.GetUnpublishedProductIdsAsync(cancellationToken);

            foreach (var rp in relatedProds)
            {
                if (unpublishedIds.Contains(rp.ErpProductId)) continue;

                var relCat = resolveRelCat(rp.ErpProductId);
                
                var rpImg = NormalizeImageUrl(rp.ImageUrl, erpBaseUrl);
                var rpImgs = NormalizeImageUrls(rp.ImageUrls, erpBaseUrl);
                
                relSettingsMap.TryGetValue(rp.ErpProductId, out var rps);
                relReviewsMap.TryGetValue(rp.ErpProductId, out var rpr);
                relMetadataMap.TryGetValue(rp.ErpProductId, out var rpm);

                var relCategoryIds = catMapsByProductId.TryGetValue(rp.ErpProductId, out var rMaps)
                    ? rMaps.Select(x => x.CategoryId).ToList()
                    : new List<Guid>();

                var rpOriginalPrice = rps?.OverridePrice ?? rp.UnitPrice ?? 0;
                var rpAppliedCamp = _campaignService.ApplyCampaignsToProduct(
                    rp.ErpProductId,
                    rpOriginalPrice,
                    rpm?.Brand,
                    relCategoryIds,
                    activeCampaigns,
                    parentLookup);

                var rpDiscountedPrice = rpAppliedCamp != null ? rpAppliedCamp.DiscountedPrice : rpOriginalPrice;
                var rpFreeShipping = rpm?.IsFreeShipping ?? false;

                formattedRelated.Add(new
                {
                    id = rp.ErpProductId,
                    tenantCode = tenantCode,
                    stockCode = rp.StockCode,
                    name = rp.Name,
                    originalPrice = rpOriginalPrice,
                    unitPrice = rpDiscountedPrice,
                    discountedPrice = rpDiscountedPrice < rpOriginalPrice ? rpDiscountedPrice : (decimal?)null,
                    currency = !string.IsNullOrWhiteSpace(rps?.OverrideCurrency) ? rps!.OverrideCurrency : rp.Currency,
                    stock = rp.Stock,
                    isActive = rp.IsActive,
                    imageUrl = rpImg,
                    imageUrls = rpImgs,
                    mainCategory = relCat.Main,
                    subCategory = relCat.Sub,
                    reviewsCount = rpr.Count,
                    ratingAverage = rpr.Avg,
                    brand = rpm?.Brand,
                    slug = rpm?.Slug,
                    isCampaign = rpm?.IsCampaign ?? false,
                    showOnHome = rpm?.ShowOnHome ?? false,
                    campaignBadge = rpAppliedCamp?.CampaignBadge,
                    campaignName = rpAppliedCamp?.CampaignName,
                    isFreeShipping = rpFreeShipping
                });
            }
        }

        var mainProductCategoryIds = productCats.Select(x => x.CategoryId).ToList();
        var mainOriginalPrice = s?.OverridePrice ?? product.UnitPrice ?? 0;
        var mainAppliedCamp = _campaignService.ApplyCampaignsToProduct(
            product.ErpProductId,
            mainOriginalPrice,
            meta?.Brand,
            mainProductCategoryIds,
            activeCampaigns,
            parentLookup);

        var mainDiscountedPrice = mainAppliedCamp != null ? mainAppliedCamp.DiscountedPrice : mainOriginalPrice;
        var mainFreeShipping = meta?.IsFreeShipping ?? false;

        return Ok(new
        {
            success = true,
            data = new
            {
                id = product.ErpProductId,
                tenantCode = tenantCode,
                stockCode = product.StockCode,
                name = product.Name,
                originalPrice = mainOriginalPrice,
                unitPrice = mainDiscountedPrice,
                discountedPrice = mainDiscountedPrice < mainOriginalPrice ? mainDiscountedPrice : (decimal?)null,
                currency = !string.IsNullOrWhiteSpace(s?.OverrideCurrency) ? s!.OverrideCurrency : product.Currency,
                stock = product.Stock,
                isActive = product.IsActive,
                imageUrl = img,
                imageUrls = imgs,
                description = description,
                features = features ?? new List<string>(),
                variants = variants,
                shortDescription = shortDescription,
                technicalSpecs = technicalSpecs,
                seoTitle = seoTitle,
                seoDescription = seoDescription,
                brand = meta?.Brand,
                slug = meta?.Slug,
                manualPdfUrl = meta?.ManualPdfUrl,
                catalogPdfUrl = meta?.CatalogPdfUrl,
                mainCategory = mainCategoryName,
                subCategory = subCategoryName,
                reviewsCount = reviewsCount,
                ratingAverage = ratingAverage,
                warrantyMonths = meta?.WarrantyMonths ?? 0,
                campaignBadge = mainAppliedCamp?.CampaignBadge,
                campaignName = mainAppliedCamp?.CampaignName,
                isFreeShipping = mainFreeShipping,
                relatedProducts = formattedRelated
            }
        });
    }

    [HttpGet("featured-products")]
    public async Task<IActionResult> FeaturedProducts(CancellationToken cancellationToken)
    {
        var erpBaseUrl = (_erpOptions.Value.BaseUrl ?? string.Empty).Trim();
        var tenantCode = Request.Headers.TryGetValue("X-Tenant-Code", out var t)
            ? t.ToString().Trim().ToUpperInvariant()
            : string.Empty;

        var unpublishedIds = await _meta.GetUnpublishedProductIdsAsync(cancellationToken);

        // Load reviews aggregates
        var reviewSql = "SELECT product_id, COUNT(*) as cnt, COALESCE(AVG(rating), 0) as average FROM admin_reviews WHERE status = 'Approved' GROUP BY product_id";
        var reviewRows = await _adminModules.QuerySqlAsync(reviewSql, null, cancellationToken);
        var reviewsMap = new Dictionary<Guid, (int Count, double Avg)>();
        foreach (var row in reviewRows)
        {
            if (row.TryGetValue("product_id", out var pidVal))
            {
                Guid pid = Guid.Empty;
                if (pidVal is Guid g) pid = g;
                else if (pidVal is string sVal && Guid.TryParse(sVal, out var parsed)) pid = parsed;

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

        var parentLookup = allCats.ToDictionary(c => c.Id, c => c.ParentId);

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

        if (!string.IsNullOrWhiteSpace(tenantCode))
        {
            var featuredIds = await _repo.GetFeaturedIdsAsync(tenantCode, cancellationToken);
            if (featuredIds.Count == 0)
            {
                return Ok(new { success = true, data = Array.Empty<object>() });
            }

            var settingsMap = await _repo.GetAllByProductIdAsync(tenantCode, cancellationToken);
            var products = await _products.ListAsync(tenantCode, 500, cancellationToken);
            var metadataList = await _meta.ListAllAsync(cancellationToken);
            var metadataMap = metadataList.ToDictionary(x => x.ProductId);

            var data = products
                .Where(p => featuredIds.Contains(p.ErpProductId) && !unpublishedIds.Contains(p.ErpProductId))
                .Select(p => {
                    var resolvedCat = resolveProductCategory(p.ErpProductId);
                    metadataMap.TryGetValue(p.ErpProductId, out var m);
                    catMapsByProductId.TryGetValue(p.ErpProductId, out var maps);
                    var categoryIds = maps?.Select(x => x.CategoryId).ToList() ?? new List<Guid>();
                    return ApplyOverrideIfAny(p, settingsMap, erpBaseUrl, resolvedCat.MainCategory, resolvedCat.SubCategory, reviewsMap, m, categoryIds, activeCampaigns, parentLookup);
                })
                .ToList();

            return Ok(new { success = true, data });
        }

        var allSettings = await _repo.ListAllAsync(5000, cancellationToken);
        var featuredSettings = allSettings.Where(x => x.IsFeatured).ToList();
        if (featuredSettings.Count == 0)
        {
            return Ok(new { success = true, data = Array.Empty<object>() });
        }

        var settingsByKey = featuredSettings
            .GroupBy(x => (Tenant: (x.TenantCode ?? string.Empty).Trim().ToUpperInvariant(), ProductId: x.ProductId))
            .ToDictionary(g => g.Key, g => g.OrderByDescending(x => x.UpdatedAtUtc).First());

        var allProducts = await _products.ListAllAsync(500, cancellationToken);
        var metadataListAll = await _meta.ListAllAsync(cancellationToken);
        var metadataMapAll = metadataListAll.ToDictionary(x => x.ProductId);

        var dataAll = allProducts
            .Where(p => settingsByKey.ContainsKey(((p.TenantCode ?? string.Empty).Trim().ToUpperInvariant(), p.ErpProductId)) 
                        && !unpublishedIds.Contains(p.ErpProductId))
            .Select(p => {
                var resolvedCat = resolveProductCategory(p.ErpProductId);
                metadataMapAll.TryGetValue(p.ErpProductId, out var m);
                catMapsByProductId.TryGetValue(p.ErpProductId, out var maps);
                var categoryIds = maps?.Select(x => x.CategoryId).ToList() ?? new List<Guid>();
                return ApplyOverrideIfAnyGlobal(p, settingsByKey, erpBaseUrl, resolvedCat.MainCategory, resolvedCat.SubCategory, reviewsMap, m, categoryIds, activeCampaigns, parentLookup);
            })
            .ToList();

        return Ok(new { success = true, data = dataAll });
    }

    [HttpPost("newsletter/subscribe")]
    public async Task<IActionResult> SubscribeNewsletter([FromBody] SubscribeRequest request, CancellationToken cancellationToken)
    {
        if (request == null || string.IsNullOrWhiteSpace(request.Email))
            return BadRequest(new { success = false, message = "E-posta adresi zorunludur." });

        await _newsletterRepo.SubscribeAsync(request.Email, cancellationToken);
        return Ok(new { success = true, message = "Bültene başarıyla abone olundu." });
    }

    public sealed class SubscribeRequest
    {
        public string Email { get; set; } = string.Empty;
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

    private object ApplyOverrideIfAnyGlobal(
        EcommerceProduct product, 
        Dictionary<(string Tenant, Guid ProductId), ProductSetting> settingsByKey, 
        string? erpBaseUrl, 
        string? mainCategory, 
        string? subCategory,
        Dictionary<Guid, (int Count, double Avg)> reviewsMap,
        ProductMetadata? metadata,
        List<Guid> categoryIds,
        List<Campaign> activeCampaigns,
        Dictionary<Guid, Guid?> parentLookup)
    {
        var tc = (product.TenantCode ?? string.Empty).Trim().ToUpperInvariant();
        settingsByKey.TryGetValue((tc, product.ErpProductId), out var s);

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
            tenantCode = tc,
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

    [HttpGet("/robots.txt")]
    public IActionResult Robots()
    {
        var scheme = Request.Scheme;
        var host = Request.Host;
        var robots = $"User-agent: *\nAllow: /\nSitemap: {scheme}://{host}/sitemap.xml\n";
        return Content(robots, "text/plain", System.Text.Encoding.UTF8);
    }

    [HttpGet("/sitemap.xml")]
    public async Task<IActionResult> Sitemap(CancellationToken cancellationToken)
    {
        var scheme = Request.Scheme;
        var host = Request.Host;
        var baseUrl = $"{scheme}://{host}";

        var categories = await _categories.ListAsync(CategoriesRepository.DefaultCatalogCode, cancellationToken);
        var products = await _products.ListAllAsync(1000, cancellationToken);
        var unpublishedIds = await _meta.GetUnpublishedProductIdsAsync(cancellationToken);

        var sb = new System.Text.StringBuilder();
        sb.AppendLine("<?xml version=\"1.0\" encoding=\"UTF-8\"?>");
        sb.AppendLine("<urlset xmlns=\"http://www.sitemaps.org/schemas/sitemap/0.9\">");

        // Homepage
        sb.AppendLine("  <url>");
        sb.AppendLine($"    <loc>{baseUrl}/</loc>");
        sb.AppendLine("    <changefreq>daily</changefreq>");
        sb.AppendLine("    <priority>1.0</priority>");
        sb.AppendLine("  </url>");

        // Static Pages
        var staticPages = new[] { "/teknik-servis", "/kampanyalar", "/iletisim", "/garanti", "/kategoriler", "/blog" };
        foreach (var page in staticPages)
        {
            sb.AppendLine("  <url>");
            sb.AppendLine($"    <loc>{baseUrl}{page}</loc>");
            sb.AppendLine("    <changefreq>weekly</changefreq>");
            sb.AppendLine("    <priority>0.7</priority>");
            sb.AppendLine("  </url>");
        }

        // Categories
        foreach (var cat in categories.Where(x => x.IsActive))
        {
            var slug = string.IsNullOrWhiteSpace(cat.Slug) ? cat.Id.ToString() : cat.Slug;
            sb.AppendLine("  <url>");
            sb.AppendLine($"    <loc>{baseUrl}/kategori/{slug}</loc>");
            sb.AppendLine("    <changefreq>weekly</changefreq>");
            sb.AppendLine("    <priority>0.8</priority>");
            sb.AppendLine("  </url>");
        }

        // Products
        foreach (var prod in products.Where(x => x.IsActive == true && !unpublishedIds.Contains(x.ErpProductId)))
        {
            var slug = string.IsNullOrWhiteSpace(prod.Name) ? prod.ErpProductId.ToString() : GenerateSlug(prod.Name);
            sb.AppendLine("  <url>");
            sb.AppendLine($"    <loc>{baseUrl}/urun/{slug}/{prod.ErpProductId}</loc>");
            sb.AppendLine("    <changefreq>daily</changefreq>");
            sb.AppendLine("    <priority>0.9</priority>");
            sb.AppendLine("  </url>");
        }

        // Blog Posts
        try
        {
            var blogSql = "SELECT slug FROM blog_posts WHERE is_published = true";
            var blogPosts = await _adminModules.QuerySqlAsync(blogSql, null, cancellationToken);
            foreach (var post in blogPosts)
            {
                if (post.TryGetValue("slug", out var postSlugVal) && postSlugVal is string postSlug)
                {
                    sb.AppendLine("  <url>");
                    sb.AppendLine($"    <loc>{baseUrl}/blog/{postSlug}</loc>");
                    sb.AppendLine("    <changefreq>weekly</changefreq>");
                    sb.AppendLine("    <priority>0.8</priority>");
                    sb.AppendLine("  </url>");
                }
            }
        }
        catch { }

        sb.AppendLine("</urlset>");

        return Content(sb.ToString(), "application/xml", System.Text.Encoding.UTF8);
    }

    private static string GenerateSlug(string phrase) 
    { 
        string str = phrase.ToLowerInvariant(); 
        str = str.Replace("ı", "i").Replace("ğ", "g").Replace("ü", "u").Replace("ş", "s").Replace("ö", "o").Replace("ç", "c");
        str = System.Text.RegularExpressions.Regex.Replace(str, @"[^a-z0-9\s-]", ""); 
        return str; 
    }

    [HttpPost("live/event")]
    public IActionResult AddLiveEvent([FromBody] LiveActivityService.LiveEvent ev)
    {
        if (ev == null || string.IsNullOrWhiteSpace(ev.EventType))
            return BadRequest();

        var visitor = string.IsNullOrWhiteSpace(ev.Visitor) ? "Ziyaretçi" : ev.Visitor;
        var detail = string.IsNullOrWhiteSpace(ev.Detail) ? "Sitede geziniyor" : ev.Detail;
        var city = string.IsNullOrWhiteSpace(ev.City) ? "İstanbul" : ev.City;

        _live.AddEvent(ev.EventType, visitor, detail, city);

        if (ev.EventType == "visit" && !string.IsNullOrWhiteSpace(ev.Detail))
        {
            _live.TrackPageHit(ev.Detail);
        }

        return Ok(new { success = true });
    }

    public sealed class CreateReviewRequest
    {
        public int Rating { get; set; }
        public string Comment { get; set; } = string.Empty;
    }

    [HttpGet("products/{productId:guid}/reviews")]
    public async Task<IActionResult> GetReviews([FromRoute] Guid productId, CancellationToken cancellationToken)
    {
        var sql = "SELECT id, product_name AS \"productName\", customer_name AS \"customerName\", customer_email AS \"customerEmail\", rating, comment, admin_reply AS \"adminReply\", created_at_utc AS \"createdAtUtc\" FROM admin_reviews WHERE product_id = @ProductId AND status = 'Approved' ORDER BY created_at_utc DESC";
        var items = await _adminModules.QuerySqlAsync(sql, new { ProductId = productId }, cancellationToken);
        return Ok(new { success = true, data = items });
    }

    [Authorize]
    [HttpPost("products/{productId:guid}/reviews")]
    public async Task<IActionResult> CreateReview([FromRoute] Guid productId, [FromBody] CreateReviewRequest request, CancellationToken cancellationToken)
    {
        if (request == null || request.Rating < 1 || request.Rating > 5 || string.IsNullOrWhiteSpace(request.Comment))
            return BadRequest(new { success = false, message = "Geçersiz yorum verisi" });

        var email = User.FindFirstValue(ClaimTypes.Email) ?? User.Identity?.Name ?? "";
        if (string.IsNullOrWhiteSpace(email))
            return Unauthorized(new { success = false, message = "Oturum bulunamadı" });

        var user = await _users.GetByEmailAsync(email, cancellationToken);
        var customerName = user?.FullName ?? "Üye Müşteri";

        var product = await _products.GetAnyAsync(productId, cancellationToken);
        var productName = product?.Name ?? "Ürün";

        var reviewId = Guid.NewGuid();
        var sql = "INSERT INTO admin_reviews (id, product_id, product_name, customer_name, customer_email, rating, comment, status, created_at_utc) VALUES (@Id, @ProductId, @ProductName, @CustomerName, @CustomerEmail, @Rating, @Comment, 'Approved', (now() AT TIME ZONE 'utc'))";
        await _adminModules.ExecuteSqlAsync(sql, new {
            Id = reviewId,
            ProductId = productId,
            ProductName = productName,
            CustomerName = customerName,
            CustomerEmail = email,
            Rating = request.Rating,
            Comment = request.Comment.Trim()
        }, cancellationToken);

        // Add admin notification
        var notifSql = "INSERT INTO admin_notifications (id, type, title, message, is_read, link, created_at_utc) VALUES (@Id, 'review', @Title, @Message, false, @Link, (now() AT TIME ZONE 'utc'))";
        await _adminModules.ExecuteSqlAsync(notifSql, new {
            Id = Guid.NewGuid(),
            Title = $"{customerName} yeni yorum yaptı",
            Message = $"\"{productName}\" ürününe {request.Rating} yıldızlı yorum yazdı.",
            Link = "/admin/reviews"
        }, cancellationToken);

        return Ok(new { success = true, message = "Yorumunuz başarıyla yayınlandı." });
    }
    public sealed class UpdateReviewRequest
    {
        public int Rating { get; set; }
        public string Comment { get; set; } = string.Empty;
    }

    [Authorize]
    [HttpPut("products/{productId:guid}/reviews/{reviewId:guid}")]
    public async Task<IActionResult> UpdateReview([FromRoute] Guid productId, [FromRoute] Guid reviewId, [FromBody] UpdateReviewRequest request, CancellationToken cancellationToken)
    {
        if (request == null || request.Rating < 1 || request.Rating > 5 || string.IsNullOrWhiteSpace(request.Comment))
            return BadRequest(new { success = false, message = "Geçersiz yorum verisi" });

        var email = User.FindFirstValue(ClaimTypes.Email) ?? User.Identity?.Name ?? "";
        if (string.IsNullOrWhiteSpace(email))
            return Unauthorized(new { success = false, message = "Oturum bulunamadı" });

        // Verify ownership
        var checkSql = "SELECT customer_email FROM admin_reviews WHERE id = @ReviewId AND product_id = @ProductId";
        var rows = await _adminModules.QuerySqlAsync(checkSql, new { ReviewId = reviewId, ProductId = productId }, cancellationToken);
        if (rows.Count == 0)
            return NotFound(new { success = false, message = "Yorum bulunamadı" });

        var ownerEmail = rows[0].TryGetValue("customer_email", out var ownerVal) ? ownerVal?.ToString() ?? "" : "";
        if (!string.Equals(ownerEmail, email, StringComparison.OrdinalIgnoreCase))
            return Forbid();

        var sql = "UPDATE admin_reviews SET rating = @Rating, comment = @Comment, status = 'Approved' WHERE id = @ReviewId";
        await _adminModules.ExecuteSqlAsync(sql, new { Rating = request.Rating, Comment = request.Comment.Trim(), ReviewId = reviewId }, cancellationToken);

        return Ok(new { success = true, message = "Yorumunuz başarıyla güncellendi." });
    }

    [Authorize]
    [HttpDelete("products/{productId:guid}/reviews/{reviewId:guid}")]
    public async Task<IActionResult> DeleteReview([FromRoute] Guid productId, [FromRoute] Guid reviewId, CancellationToken cancellationToken)
    {
        var email = User.FindFirstValue(ClaimTypes.Email) ?? User.Identity?.Name ?? "";
        if (string.IsNullOrWhiteSpace(email))
            return Unauthorized(new { success = false, message = "Oturum bulunamadı" });

        // Verify ownership
        var checkSql = "SELECT customer_email FROM admin_reviews WHERE id = @ReviewId AND product_id = @ProductId";
        var rows = await _adminModules.QuerySqlAsync(checkSql, new { ReviewId = reviewId, ProductId = productId }, cancellationToken);
        if (rows.Count == 0)
            return NotFound(new { success = false, message = "Yorum bulunamadı" });

        var ownerEmail = rows[0].TryGetValue("customer_email", out var ownerVal) ? ownerVal?.ToString() ?? "" : "";
        if (!string.Equals(ownerEmail, email, StringComparison.OrdinalIgnoreCase))
            return Forbid();

        var sql = "DELETE FROM admin_reviews WHERE id = @ReviewId";
        await _adminModules.ExecuteSqlAsync(sql, new { ReviewId = reviewId }, cancellationToken);

        return Ok(new { success = true, message = "Yorumunuz silindi." });
    }

    [Authorize]
    [HttpGet("account/reviews")]
    public async Task<IActionResult> GetMyReviews(CancellationToken cancellationToken)
    {
        var email = User.FindFirstValue(ClaimTypes.Email) ?? User.Identity?.Name ?? "";
        if (string.IsNullOrWhiteSpace(email))
            return Unauthorized(new { success = false, message = "Oturum bulunamadı" });

        var sql = @"
            SELECT
              id,
              product_id AS ""productId"",
              product_name AS ""productName"",
              rating,
              comment,
              status,
              created_at_utc AS ""createdAtUtc""
            FROM admin_reviews
            WHERE lower(customer_email) = lower(@Email)
            ORDER BY created_at_utc DESC";

        var items = await _adminModules.QuerySqlAsync(sql, new { Email = email.Trim() }, cancellationToken);
        return Ok(new { success = true, data = items });
    }

    // --- 1. SAVED ADDRESSES ENDPOINTS ---

    public sealed class AddressDto
    {
        public Guid? Id { get; set; }
        public string Title { get; set; } = string.Empty;
        public string FullName { get; set; } = string.Empty;
        public string Phone { get; set; } = string.Empty;
        public string City { get; set; } = string.Empty;
        public string District { get; set; } = string.Empty;
        public string Details { get; set; } = string.Empty;
    }

    [Authorize]
    [HttpGet("addresses")]
    public async Task<IActionResult> GetAddresses(CancellationToken cancellationToken)
    {
        var email = User.FindFirstValue(ClaimTypes.Email) ?? User.Identity?.Name ?? "";
        var user = await _users.GetByEmailAsync(email, cancellationToken);
        if (user is null)
            return Unauthorized(new { success = false, message = "Kullanıcı bulunamadı" });

        var sql = "SELECT id, title, full_name AS \"fullName\", phone, city, district, details FROM member_addresses WHERE user_id = @UserId ORDER BY created_at_utc DESC";
        var rows = await _adminModules.QuerySqlAsync(sql, new { UserId = user.Id }, cancellationToken);

        var list = rows.Select(r => new AddressDto
        {
            Id = (Guid)r["id"],
            Title = r["title"]?.ToString() ?? "",
            FullName = r["fullName"]?.ToString() ?? "",
            Phone = r["phone"]?.ToString() ?? "",
            City = r["city"]?.ToString() ?? "",
            District = r["district"]?.ToString() ?? "",
            Details = r["details"]?.ToString() ?? ""
        }).ToList();

        return Ok(new { success = true, data = list });
    }

    [Authorize]
    [HttpPost("addresses")]
    public async Task<IActionResult> CreateAddress([FromBody] AddressDto request, CancellationToken cancellationToken)
    {
        var email = User.FindFirstValue(ClaimTypes.Email) ?? User.Identity?.Name ?? "";
        var user = await _users.GetByEmailAsync(email, cancellationToken);
        if (user is null)
            return Unauthorized(new { success = false, message = "Kullanıcı bulunamadı" });

        if (string.IsNullOrWhiteSpace(request.Title) || string.IsNullOrWhiteSpace(request.FullName) ||
            string.IsNullOrWhiteSpace(request.Phone) || string.IsNullOrWhiteSpace(request.City) ||
            string.IsNullOrWhiteSpace(request.District) || string.IsNullOrWhiteSpace(request.Details))
        {
            return BadRequest(new { success = false, message = "Tüm alanlar zorunludur" });
        }

        var phoneRaw = (request.Phone ?? string.Empty).Trim();
        var phone = new string(phoneRaw.Where(char.IsDigit).ToArray());
        if (string.IsNullOrWhiteSpace(phone) || phone.Length != 11)
            return BadRequest(new { success = false, message = "Telefon numarası 11 haneli olmalıdır (örn: 05488000000)" });

        var id = Guid.NewGuid();
        var sql = @"INSERT INTO member_addresses (id, user_id, title, full_name, phone, city, district, details)
                    VALUES (@Id, @UserId, @Title, @FullName, @Phone, @City, @District, @Details)";
        
        await _adminModules.ExecuteSqlAsync(sql, new {
            Id = id,
            UserId = user.Id,
            Title = request.Title.Trim(),
            FullName = request.FullName.Trim(),
            Phone = phone,
            City = request.City.Trim(),
            District = request.District.Trim(),
            Details = request.Details.Trim()
        }, cancellationToken);

        return Ok(new { success = true, message = "Adres başarıyla eklendi.", data = new { id } });
    }

    [Authorize]
    [HttpPut("addresses/{addressId:guid}")]
    public async Task<IActionResult> UpdateAddress([FromRoute] Guid addressId, [FromBody] AddressDto request, CancellationToken cancellationToken)
    {
        var email = User.FindFirstValue(ClaimTypes.Email) ?? User.Identity?.Name ?? "";
        var user = await _users.GetByEmailAsync(email, cancellationToken);
        if (user is null)
            return Unauthorized(new { success = false, message = "Kullanıcı bulunamadı" });

        if (string.IsNullOrWhiteSpace(request.Title) || string.IsNullOrWhiteSpace(request.FullName) ||
            string.IsNullOrWhiteSpace(request.Phone) || string.IsNullOrWhiteSpace(request.City) ||
            string.IsNullOrWhiteSpace(request.District) || string.IsNullOrWhiteSpace(request.Details))
        {
            return BadRequest(new { success = false, message = "Tüm alanlar zorunludur" });
        }

        var phoneRaw = (request.Phone ?? string.Empty).Trim();
        var phone = new string(phoneRaw.Where(char.IsDigit).ToArray());
        if (string.IsNullOrWhiteSpace(phone) || phone.Length != 11)
            return BadRequest(new { success = false, message = "Telefon numarası 11 haneli olmalıdır (örn: 05488000000)" });

        // Verify ownership
        var checkSql = "SELECT user_id FROM member_addresses WHERE id = @Id";
        var rows = await _adminModules.QuerySqlAsync(checkSql, new { Id = addressId }, cancellationToken);
        if (rows.Count == 0)
            return NotFound(new { success = false, message = "Adres bulunamadı" });

        var ownerId = (Guid)rows[0]["user_id"];
        if (ownerId != user.Id)
            return Forbid();

        var sql = @"UPDATE member_addresses SET title = @Title, full_name = @FullName, phone = @Phone, city = @City, district = @District, details = @Details
                    WHERE id = @Id";

        await _adminModules.ExecuteSqlAsync(sql, new {
            Id = addressId,
            Title = request.Title.Trim(),
            FullName = request.FullName.Trim(),
            Phone = phone,
            City = request.City.Trim(),
            District = request.District.Trim(),
            Details = request.Details.Trim()
        }, cancellationToken);

        return Ok(new { success = true, message = "Adres başarıyla güncellendi." });
    }

    [Authorize]
    [HttpDelete("addresses/{addressId:guid}")]
    public async Task<IActionResult> DeleteAddress([FromRoute] Guid addressId, CancellationToken cancellationToken)
    {
        var email = User.FindFirstValue(ClaimTypes.Email) ?? User.Identity?.Name ?? "";
        var user = await _users.GetByEmailAsync(email, cancellationToken);
        if (user is null)
            return Unauthorized(new { success = false, message = "Kullanıcı bulunamadı" });

        // Verify ownership
        var checkSql = "SELECT user_id FROM member_addresses WHERE id = @Id";
        var rows = await _adminModules.QuerySqlAsync(checkSql, new { Id = addressId }, cancellationToken);
        if (rows.Count == 0)
            return NotFound(new { success = false, message = "Adres bulunamadı" });

        var ownerId = (Guid)rows[0]["user_id"];
        if (ownerId != user.Id)
            return Forbid();

        var sql = "DELETE FROM member_addresses WHERE id = @Id";
        await _adminModules.ExecuteSqlAsync(sql, new { Id = addressId }, cancellationToken);

        return Ok(new { success = true, message = "Adres silindi." });
    }

    // --- 2. TECHNICAL SERVICE REQUESTS ENDPOINTS ---

    public sealed class CreateServiceRequestDto
    {
        public string ProductGroup { get; set; } = string.Empty;
        public string ModelNo { get; set; } = string.Empty;
        public string Description { get; set; } = string.Empty;
        public string? FullName { get; set; }
        public string? Phone { get; set; }
    }

    [Authorize]
    [HttpGet("service-requests")]
    public async Task<IActionResult> GetServiceRequests(CancellationToken cancellationToken)
    {
        var email = User.FindFirstValue(ClaimTypes.Email) ?? User.Identity?.Name ?? "";
        var user = await _users.GetByEmailAsync(email, cancellationToken);
        if (user is null)
            return Unauthorized(new { success = false, message = "Kullanıcı bulunamadı" });

        var sql = "SELECT id, full_name AS \"fullName\", phone, product_group AS \"productGroup\", model_no AS \"modelNo\", description, status, created_at_utc AS \"createdAt\" FROM technical_service_requests WHERE user_id = @UserId ORDER BY created_at_utc DESC";
        var rows = await _adminModules.QuerySqlAsync(sql, new { UserId = user.Id }, cancellationToken);

        var list = rows.Select(r => new
        {
            Id = (Guid)r["id"],
            FullName = r["fullName"]?.ToString() ?? "",
            Phone = r["phone"]?.ToString() ?? "",
            ProductGroup = r["productGroup"]?.ToString() ?? "",
            ModelNo = r["modelNo"]?.ToString() ?? "",
            Description = r["description"]?.ToString() ?? "",
            Status = r["status"]?.ToString() ?? "Bekliyor",
            CreatedAt = r.TryGetValue("createdAt", out var cd) && cd is DateTime dt ? dt.ToString("yyyy-MM-dd HH:mm") : ""
        }).ToList();

        return Ok(new { success = true, data = list });
    }

    [HttpPost("service-requests")]
    public async Task<IActionResult> CreateServiceRequest([FromBody] CreateServiceRequestDto request, CancellationToken cancellationToken)
    {
        Guid? userId = null;
        string fullName = request.FullName ?? "";
        string phone = request.Phone ?? "";

        var email = User.FindFirstValue(ClaimTypes.Email) ?? User.Identity?.Name ?? "";
        if (!string.IsNullOrEmpty(email))
        {
            var user = await _users.GetByEmailAsync(email, cancellationToken);
            if (user != null)
            {
                userId = user.Id;
                if (string.IsNullOrEmpty(fullName)) fullName = user.FullName;
                if (string.IsNullOrEmpty(phone)) phone = user.Phone;
            }
        }

        if (string.IsNullOrWhiteSpace(request.ProductGroup) || 
            string.IsNullOrWhiteSpace(request.Description) ||
            string.IsNullOrWhiteSpace(fullName) ||
            string.IsNullOrWhiteSpace(phone))
        {
            return BadRequest(new { success = false, message = "Ad Soyad, Telefon, Ürün Grubu ve Açıklama alanları zorunludur." });
        }

        var id = Guid.NewGuid();
        var sql = @"INSERT INTO technical_service_requests (id, user_id, full_name, phone, product_group, model_no, description, status, created_at_utc)
                    VALUES (@Id, @UserId, @FullName, @Phone, @ProductGroup, @ModelNo, @Description, 'Bekliyor', (now() AT TIME ZONE 'utc'))";

        await _adminModules.ExecuteSqlAsync(sql, new {
            Id = id,
            UserId = (object?)userId ?? DBNull.Value,
            FullName = fullName.Trim(),
            Phone = phone.Trim(),
            ProductGroup = request.ProductGroup.Trim(),
            ModelNo = (request.ModelNo ?? "").Trim(),
            Description = request.Description.Trim()
        }, cancellationToken);

        return Ok(new { success = true, message = "Servis talebiniz başarıyla oluşturuldu." });
    }

    // --- 3. WARRANTY TRACKING ENDPOINTS ---

    [Authorize]
    [HttpGet("warranties")]
    public async Task<IActionResult> GetWarranties(CancellationToken cancellationToken)
    {
        var email = User.FindFirstValue(ClaimTypes.Email) ?? User.Identity?.Name ?? "";
        var user = await _users.GetByEmailAsync(email, cancellationToken);
        if (user is null)
            return Unauthorized(new { success = false, message = "Kullanıcı bulunamadı" });

        var sql = "SELECT id, customer_name AS \"customerName\", customer_email AS \"customerEmail\", product_id AS \"productId\", product_name AS \"productName\", warranty_code AS \"warrantyCode\", warranty_months AS \"warrantyMonths\", sold_date AS \"soldDate\" FROM sold_product_warranties WHERE user_id = @UserId ORDER BY sold_date DESC";
        var rows = await _adminModules.QuerySqlAsync(sql, new { UserId = user.Id }, cancellationToken);

        var list = rows.Select(r => {
            var soldDate = r.TryGetValue("soldDate", out var d) && d is DateTime dt ? dt : DateTime.UtcNow;
            var months = r.TryGetValue("warrantyMonths", out var m) ? Convert.ToInt32(m) : 0;
            
            // Calculate remaining
            var now = DateTime.UtcNow;
            var endDate = soldDate.AddMonths(months);
            string remainingText;
            string status;
            if (now >= endDate)
            {
                remainingText = "Süresi Doldu";
                status = "expired";
            }
            else
            {
                int remMonths = 0;
                var tempDate = now;
                while (tempDate.AddMonths(1) <= endDate)
                {
                    tempDate = tempDate.AddMonths(1);
                    remMonths++;
                }
                int remDays = (endDate - tempDate).Days;
                
                if (remMonths > 0 && remDays > 0)
                    remainingText = $"{remMonths} Ay {remDays} Gün Kaldı";
                else if (remMonths > 0)
                    remainingText = $"{remMonths} Ay Kaldı";
                else
                    remainingText = $"{remDays} Gün Kaldı";
                
                status = "active";
            }

            return new {
                id = (Guid)r["id"],
                customerName = r["customerName"]?.ToString() ?? "",
                customerEmail = r["customerEmail"]?.ToString() ?? "",
                productId = (Guid)r["productId"],
                productName = r["productName"]?.ToString() ?? "",
                warrantyCode = r["warrantyCode"]?.ToString() ?? "",
                warrantyMonths = months,
                soldDate = soldDate.ToString("yyyy-MM-dd"),
                remainingText,
                status
            };
        }).ToList();

        return Ok(new { success = true, data = list });
    }

    [HttpGet("warranty/query")]
    public async Task<IActionResult> QueryWarranty([FromQuery] string code, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(code))
            return BadRequest(new { success = false, message = "Geçersiz seri numarası" });

        var sql = "SELECT id, customer_name AS \"customerName\", customer_email AS \"customerEmail\", product_id AS \"productId\", product_name AS \"productName\", warranty_code AS \"warrantyCode\", warranty_months AS \"warrantyMonths\", sold_date AS \"soldDate\" FROM sold_product_warranties WHERE LOWER(warranty_code) = LOWER(@Code) LIMIT 1";
        var rows = await _adminModules.QuerySqlAsync(sql, new { Code = code.Trim() }, cancellationToken);

        if (rows.Count == 0)
            return NotFound(new { success = false, message = "Bu seri numarasına ait garanti kaydı bulunamadı." });

        var r = rows[0];
        var soldDate = r.TryGetValue("soldDate", out var d) && d is DateTime dt ? dt : DateTime.UtcNow;
        var months = r.TryGetValue("warrantyMonths", out var m) ? Convert.ToInt32(m) : 0;
        
        // Calculate remaining
        var now = DateTime.UtcNow;
        var endDate = soldDate.AddMonths(months);
        string remainingText;
        string status;
        if (now >= endDate)
        {
            remainingText = "Süresi Doldu";
            status = "expired";
        }
        else
        {
            int remMonths = 0;
            var tempDate = now;
            while (tempDate.AddMonths(1) <= endDate)
            {
                tempDate = tempDate.AddMonths(1);
                remMonths++;
            }
            int remDays = (endDate - tempDate).Days;
            
            if (remMonths > 0 && remDays > 0)
                remainingText = $"{remMonths} Ay {remDays} Gün Kaldı";
            else if (remMonths > 0)
                remainingText = $"{remMonths} Ay Kaldı";
            else
                remainingText = $"{remDays} Gün Kaldı";
            
            status = "active";
        }

        // Mask name for privacy
        string customerName = r["customerName"]?.ToString() ?? "";
        string maskedName = "";
        if (!string.IsNullOrWhiteSpace(customerName))
        {
            var parts = customerName.Split(' ', StringSplitOptions.RemoveEmptyEntries);
            for (int i = 0; i < parts.Length; i++)
            {
                if (parts[i].Length <= 2)
                    parts[i] = parts[i][0] + new string('*', parts[i].Length - 1);
                else
                    parts[i] = parts[i][0] + new string('*', parts[i].Length - 2) + parts[i][^1];
            }
            maskedName = string.Join(" ", parts);
        }

        var result = new {
            id = (Guid)r["id"],
            customerName = maskedName,
            productName = r["productName"]?.ToString() ?? "",
            warrantyCode = r["warrantyCode"]?.ToString() ?? "",
            warrantyMonths = months,
            soldDate = soldDate.ToString("yyyy-MM-dd"),
            remainingText,
            status
        };

        return Ok(new { success = true, data = result });
    }

    // --- 4. COUPONS STOREFRONT ENDPOINTS ---
    [Authorize]
    [HttpGet("coupons")]
    public async Task<IActionResult> GetCoupons(CancellationToken cancellationToken)
    {
        var email = User.FindFirstValue(ClaimTypes.Email) ?? User.Identity?.Name ?? "";
        var user = await _users.GetByEmailAsync(email, cancellationToken);
        if (user is null)
            return Unauthorized(new { success = false, message = "Kullanıcı bulunamadı" });

        var sql = @"
        SELECT c.id, c.code, c.discount_type AS ""discountType"", c.discount_value AS ""discountValue"",
               c.min_order_amount AS ""minOrderAmount"", c.max_discount_amount AS ""maxDiscountAmount"",
               c.applicable_product_id AS ""applicableProductId"", p.name AS ""productName"",
               c.applicable_category_id AS ""applicableCategoryId"", cat.name AS ""categoryName"",
               c.valid_from AS ""validFrom"", c.valid_until AS ""validUntil"",
               c.usage_limit AS ""usageLimit"", c.used_count AS ""usedCount"",
               c.is_active AS ""isActive"", c.description, c.created_at_utc AS ""createdAt"",
               EXISTS(SELECT 1 FROM coupon_usages cu WHERE cu.coupon_id = c.id AND cu.user_id = @UserId) AS ""isUsed""
        FROM coupons c
        LEFT JOIN products p ON c.applicable_product_id = p.erp_product_id
        LEFT JOIN categories cat ON c.applicable_category_id = cat.id
        WHERE 
          -- Assigned directly to current user
          EXISTS(SELECT 1 FROM coupon_customers cc WHERE cc.coupon_id = c.id AND cc.user_id = @UserId)
          OR
          -- Or is global (not assigned to any customer)
          NOT EXISTS(SELECT 1 FROM coupon_customers cc2 WHERE cc2.coupon_id = c.id)
        ORDER BY c.created_at_utc DESC";

        var rows = await _adminModules.QuerySqlAsync(sql, new { UserId = user.Id }, cancellationToken);
        var list = rows.Select(r => new {
            id = (Guid)r["id"],
            code = r["code"]?.ToString() ?? "",
            discountType = r["discountType"]?.ToString() ?? "Percentage",
            discountValue = Convert.ToDecimal(r["discountValue"]),
            minOrderAmount = Convert.ToDecimal(r["minOrderAmount"]),
            maxDiscountAmount = r["maxDiscountAmount"] != null ? Convert.ToDecimal(r["maxDiscountAmount"]) : (decimal?)null,
            applicableProductId = r["applicableProductId"] != null ? (Guid)r["applicableProductId"] : (Guid?)null,
            productName = r["productName"]?.ToString(),
            applicableCategoryId = r["applicableCategoryId"] != null ? (Guid)r["applicableCategoryId"] : (Guid?)null,
            categoryName = r["categoryName"]?.ToString(),
            validFrom = Convert.ToDateTime(r["validFrom"]).ToString("yyyy-MM-dd"),
            validUntil = Convert.ToDateTime(r["validUntil"]).ToString("yyyy-MM-dd"),
            usageLimit = Convert.ToInt32(r["usageLimit"]),
            usedCount = Convert.ToInt32(r["usedCount"]),
            isActive = Convert.ToBoolean(r["isActive"]),
            description = r["description"]?.ToString(),
            isUsed = Convert.ToBoolean(r["isUsed"]),
            isExpired = DateTime.UtcNow > Convert.ToDateTime(r["validUntil"])
        }).ToList();

        return Ok(new { success = true, data = list });
    }

    public sealed class ValidateCouponRequest
    {
        public string Code { get; set; } = string.Empty;
        public List<CartLineDto> Items { get; set; } = new();
    }

    public sealed class CartLineDto
    {
        public Guid ProductId { get; set; }
        public decimal UnitPrice { get; set; }
        public int Qty { get; set; }
    }

    [Authorize]
    [HttpPost("coupons/validate")]
    public async Task<IActionResult> ValidateCoupon([FromBody] ValidateCouponRequest request, CancellationToken cancellationToken)
    {
        if (request == null || string.IsNullOrWhiteSpace(request.Code))
            return BadRequest(new { success = false, message = "Kupon kodu zorunludur." });

        var email = User.FindFirstValue(ClaimTypes.Email) ?? User.Identity?.Name ?? "";
        var user = await _users.GetByEmailAsync(email, cancellationToken);
        if (user is null)
            return Unauthorized(new { success = false, message = "Kullanıcı bulunamadı" });

        var code = request.Code.Trim().ToUpperInvariant();

        // Get coupon
        var couponSql = @"
        SELECT id, code, discount_type AS ""discountType"", discount_value AS ""discountValue"", 
               min_order_amount AS ""minOrderAmount"", max_discount_amount AS ""maxDiscountAmount"", 
               applicable_product_id AS ""applicableProductId"", applicable_category_id AS ""applicableCategoryId"", 
               valid_from AS ""validFrom"", valid_until AS ""validUntil"", usage_limit AS ""usageLimit"", 
               used_count AS ""usedCount"", is_active AS ""isActive""
        FROM coupons 
        WHERE UPPER(code) = @Code";

        var couponRows = await _adminModules.QuerySqlAsync(couponSql, new { Code = code }, cancellationToken);
        if (couponRows.Count == 0)
            return BadRequest(new { success = false, message = "Geçersiz kupon kodu." });

        var couponRow = couponRows[0];
        var couponId = (Guid)couponRow["id"];
        var discountType = couponRow["discountType"]?.ToString() ?? "Percentage";
        var discountValue = Convert.ToDecimal(couponRow["discountValue"]);
        var minOrderAmount = Convert.ToDecimal(couponRow["minOrderAmount"]);
        var maxDiscountAmount = couponRow["maxDiscountAmount"] != null ? Convert.ToDecimal(couponRow["maxDiscountAmount"]) : (decimal?)null;
        var applicableProductId = couponRow["applicableProductId"] != null ? (Guid)couponRow["applicableProductId"] : (Guid?)null;
        var applicableCategoryId = couponRow["applicableCategoryId"] != null ? (Guid)couponRow["applicableCategoryId"] : (Guid?)null;
        var validFrom = Convert.ToDateTime(couponRow["validFrom"]);
        var validUntil = Convert.ToDateTime(couponRow["validUntil"]);
        var usageLimit = Convert.ToInt32(couponRow["usageLimit"]);
        var usedCount = Convert.ToInt32(couponRow["usedCount"]);
        var isActive = Convert.ToBoolean(couponRow["isActive"]);

        if (!isActive)
            return BadRequest(new { success = false, message = "Bu kupon şu anda aktif değil." });

        var now = DateTime.UtcNow;
        if (now < validFrom || now > validUntil)
            return BadRequest(new { success = false, message = "Bu kuponun geçerlilik süresi dışında." });

        if (usedCount >= usageLimit)
            return BadRequest(new { success = false, message = "Bu kuponun genel kullanım limiti dolmuştur." });

        // Check customer mapping assignment
        var assignCheckSql = "SELECT COUNT(*) FROM coupon_customers WHERE coupon_id = @CouponId";
        var assignCheckRows = await _adminModules.QuerySqlAsync(assignCheckSql, new { CouponId = couponId }, cancellationToken);
        var isRestricted = Convert.ToInt64(assignCheckRows[0]["count"]) > 0;

        if (isRestricted)
        {
            var userAssignCheckSql = "SELECT COUNT(*) FROM coupon_customers WHERE coupon_id = @CouponId AND user_id = @UserId";
            var userAssignCheckRows = await _adminModules.QuerySqlAsync(userAssignCheckSql, new { CouponId = couponId, UserId = user.Id }, cancellationToken);
            if (Convert.ToInt64(userAssignCheckRows[0]["count"]) == 0)
            {
                return BadRequest(new { success = false, message = "Bu kupon sizin hesabınıza tanımlanmamış." });
            }
        }

        // Check if user already used it
        var usageCheckSql = "SELECT COUNT(*) FROM coupon_usages WHERE coupon_id = @CouponId AND user_id = @UserId";
        var usageCheckRows = await _adminModules.QuerySqlAsync(usageCheckSql, new { CouponId = couponId, UserId = user.Id }, cancellationToken);
        if (usageCheckRows.Count > 0 && Convert.ToInt64(usageCheckRows[0]["count"]) > 0)
            return BadRequest(new { success = false, message = "Bu kuponu daha önce kullandınız." });

        // Calculate total cart value
        var total = request.Items.Sum(x => x.UnitPrice * x.Qty);
        if (total < minOrderAmount)
            return BadRequest(new { success = false, message = $"Bu kuponu kullanabilmek için minimum sepet tutarı ₺{minOrderAmount:N2} olmalıdır." });

        decimal targetSubtotal = 0;
        if (applicableProductId != null)
        {
            var targetItem = request.Items.FirstOrDefault(x => x.ProductId == applicableProductId.Value);
            if (targetItem == null)
                return BadRequest(new { success = false, message = "Bu kupon sepetinizdeki belirli bir ürün için geçerlidir." });

            targetSubtotal = targetItem.UnitPrice * targetItem.Qty;
        }
        else if (applicableCategoryId != null)
        {
            var productIds = request.Items.Select(x => x.ProductId).ToList();
            var mapSql = "SELECT product_id FROM product_category_map WHERE category_id = @CatId AND product_id = ANY(@ProductIds)";
            var eligibleRows = await _adminModules.QuerySqlAsync(mapSql, new { CatId = applicableCategoryId.Value, ProductIds = productIds }, cancellationToken);
            var eligibleProductIds = eligibleRows.Select(r => (Guid)r["product_id"]).ToHashSet();

            if (eligibleProductIds.Count == 0)
                return BadRequest(new { success = false, message = "Bu kupon sepetinizdeki belirli bir kategorideki ürünler için geçerlidir." });

            targetSubtotal = request.Items.Where(x => eligibleProductIds.Contains(x.ProductId)).Sum(x => x.UnitPrice * x.Qty);
        }
        else
        {
            targetSubtotal = total;
        }

        decimal discount = 0;
        if (discountType == "Percentage")
        {
            discount = targetSubtotal * (discountValue / 100m);
            if (maxDiscountAmount != null && maxDiscountAmount.Value > 0)
            {
                discount = Math.Min(discount, maxDiscountAmount.Value);
            }
        }
        else
        {
            discount = Math.Min(discountValue, targetSubtotal);
        }

        discount = Math.Round(discount, 2);
        discount = Math.Min(discount, total); // Discount cannot exceed total cart value

        return Ok(new {
            success = true,
            code = code,
            discountType,
            discountValue,
            discountAmount = discount,
            newTotal = Math.Max(0, total - discount)
        });
    }

    public sealed class RegisterProductRequest
    {
        public Guid ProductId { get; set; }
        public string SerialNumber { get; set; } = string.Empty;
        public string Phone { get; set; } = string.Empty;
    }

    [Authorize]
    [HttpGet("registered-products")]
    public async Task<IActionResult> GetRegisteredProducts(CancellationToken cancellationToken)
    {
        var email = User.FindFirstValue(ClaimTypes.Email) ?? User.Identity?.Name ?? "";
        var user = await _users.GetByEmailAsync(email, cancellationToken);
        if (user is null)
            return Unauthorized(new { success = false, message = "Kullanıcı bulunamadı" });

        var sql = @"
            SELECT rp.id, rp.serial_number AS ""serialNumber"", rp.created_at_utc AS ""createdAtUtc"",
                   p.erp_product_id AS ""productId"", COALESCE(p.name, rp.product_name) AS ""productName"", p.image_url AS ""imageUrl""
            FROM registered_products rp
            LEFT JOIN products p ON rp.product_id = p.erp_product_id
            WHERE rp.user_id = @UserId
            ORDER BY rp.created_at_utc DESC";
        var items = await _adminModules.QuerySqlAsync(sql, new { UserId = user.Id }, cancellationToken);
        return Ok(new { success = true, data = items });
    }

    [Authorize]
    [HttpPost("registered-products")]
    public async Task<IActionResult> RegisterProduct([FromBody] RegisterProductRequest request, CancellationToken cancellationToken)
    {
        var email = User.FindFirstValue(ClaimTypes.Email) ?? User.Identity?.Name ?? "";
        var user = await _users.GetByEmailAsync(email, cancellationToken);
        if (user is null)
            return Unauthorized(new { success = false, message = "Kullanıcı bulunamadı" });

        var serialNumber = (request.SerialNumber ?? string.Empty).Trim();
        var phoneRaw = (request.Phone ?? string.Empty).Trim();
        var phone = new string(phoneRaw.Where(char.IsDigit).ToArray());

        if (request.ProductId == Guid.Empty)
            return BadRequest(new { success = false, message = "Lütfen bir ürün seçin" });
        if (string.IsNullOrWhiteSpace(serialNumber))
            return BadRequest(new { success = false, message = "Seri numarası zorunludur" });
        if (string.IsNullOrWhiteSpace(phone) || phone.Length != 11)
            return BadRequest(new { success = false, message = "Telefon numarası 11 haneli olmalıdır (örn: 05488000000)" });

        // Update user's phone in the database if it differs or is empty
        if (string.IsNullOrWhiteSpace(user.Phone) || user.Phone != phone)
        {
            var updatePhoneSql = "UPDATE ecommerce_users SET phone = @Phone WHERE id = @Id";
            await _adminModules.ExecuteSqlAsync(updatePhoneSql, new { Phone = phone, Id = user.Id }, cancellationToken);
        }

        // Resolve product name from catalog
        var product = await _products.GetAnyAsync(request.ProductId, cancellationToken);
        var productName = product?.Name ?? "Bilinmeyen Ürün";

        var id = Guid.NewGuid();
        var sql = @"
            INSERT INTO registered_products (id, user_id, product_id, product_name, serial_number, created_at_utc)
            VALUES (@Id, @UserId, @ProductId, @ProductName, @SerialNumber, (now() AT TIME ZONE 'utc'))";
        
        await _adminModules.ExecuteSqlAsync(sql, new {
            Id = id,
            UserId = user.Id,
            ProductId = request.ProductId,
            ProductName = productName,
            SerialNumber = serialNumber
        }, cancellationToken);

        return Ok(new { success = true });
    }

    [HttpGet("pdf-catalogs")]
    public async Task<IActionResult> GetPdfCatalogs(CancellationToken cancellationToken)
    {
        try
        {
            var list = await _pdfCatalogs.ListAllAsync(cancellationToken);
            var active = list.Where(x => x.IsActive).ToList();
            return Ok(new { success = true, data = active });
        }
        catch (Exception ex)
        {
            return StatusCode(500, new { success = false, message = ex.Message });
        }
    }

    public sealed class CartCalculateRequest
    {
        public List<CartCalculateItem> Items { get; set; } = new();
    }

    public sealed class CartCalculateItem
    {
        public Guid ProductId { get; set; }
        public string TenantCode { get; set; } = string.Empty;
        public int Quantity { get; set; }
    }

    [HttpPost("cart/calculate")]
    public async Task<IActionResult> CalculateCart([FromBody] CartCalculateRequest request, CancellationToken cancellationToken)
    {
        var design = await _design.GetAsync(cancellationToken);
        var baseCargoFee = design?.CargoFee ?? 150m;
        var freeShippingThreshold = design?.FreeShippingThreshold ?? 2000m;

        var cartItems = new List<(Guid ProductId, string TenantCode, int Quantity, decimal OriginalPrice)>();
        foreach (var item in request.Items)
        {
            if (item.Quantity < 1) continue;
            var tenant = (item.TenantCode ?? string.Empty).Trim().ToUpperInvariant();
            var product = string.IsNullOrWhiteSpace(tenant)
                ? await _products.GetAnyAsync(item.ProductId, cancellationToken)
                : await _products.GetAsync(tenant, item.ProductId, cancellationToken);
            
            if (product == null) continue;

            var productTenant = (product.TenantCode ?? tenant).Trim().ToUpperInvariant();
            var setting = await _repo.GetAsync(productTenant, product.ErpProductId, cancellationToken);
            var originalPrice = setting?.OverridePrice ?? product.UnitPrice ?? 0;

            cartItems.Add((product.ErpProductId, productTenant, item.Quantity, originalPrice));
        }

        var result = await _campaignService.EvaluateCartCampaignsAsync(cartItems, baseCargoFee, freeShippingThreshold, cancellationToken);
        return Ok(new { success = true, data = result });
    }

    [HttpGet("campaigns")]
    public async Task<IActionResult> ListCampaigns(CancellationToken cancellationToken)
    {
        var campaigns = await _campaigns.GetActiveCampaignsAsync(cancellationToken);
        return Ok(new { success = true, data = campaigns });
    }

    [HttpGet("campaigns/{id:guid}")]
    public async Task<IActionResult> GetCampaignDetail([FromRoute] Guid id, CancellationToken cancellationToken)
    {
        var campaign = await _campaigns.GetAsync(id, cancellationToken);
        if (campaign == null || !campaign.IsActive || campaign.StartDate > DateTime.UtcNow || campaign.EndDate < DateTime.UtcNow)
        {
            return NotFound(new { success = false, message = "Aktif kampanya bulunamadı." });
        }

        var allProducts = await _products.ListAllAsync(1000, cancellationToken);
        var activeCampaigns = new List<Campaign> { campaign };

        var reviewSql = "SELECT product_id, COUNT(*) as cnt, COALESCE(AVG(rating), 0) as average FROM admin_reviews WHERE status = 'Approved' GROUP BY product_id";
        var reviewRows = await _adminModules.QuerySqlAsync(reviewSql, null, cancellationToken);
        var reviewsMap = reviewRows
            .Select(r => {
                var pid = r.TryGetValue("product_id", out var pidVal) ? pidVal : null;
                Guid guid = Guid.Empty;
                if (pid is Guid g) guid = g;
                else if (pid is string sVal && Guid.TryParse(sVal, out var parsed)) guid = parsed;
                return new { Guid = guid, Row = r };
            })
            .Where(x => x.Guid != Guid.Empty)
            .GroupBy(x => x.Guid)
            .ToDictionary(
                g => g.Key,
                g => {
                    var r = g.First().Row;
                    return (Count: Convert.ToInt32(r["cnt"]), Avg: Convert.ToDouble(r["average"]));
                }
            );

        var allSettings = await _repo.ListAllAsync(5000, cancellationToken);
        var settingsByKey = allSettings
            .GroupBy(x => (Tenant: (x.TenantCode ?? string.Empty).Trim().ToUpperInvariant(), ProductId: x.ProductId))
            .ToDictionary(g => g.Key, g => g.OrderByDescending(x => x.UpdatedAtUtc).First());

        var catMapsList = await _categories.ListAllProductCategoryMapsAsync(CategoriesRepository.DefaultCatalogCode, CategoriesRepository.DefaultCatalogCode, cancellationToken);
        var catMapsByProductId = catMapsList
            .GroupBy(x => x.ProductId)
            .ToDictionary(g => g.Key, g => g.Select(x => x.CategoryId).ToList());

        var allCats = await _categories.ListAsync(CategoriesRepository.DefaultCatalogCode, cancellationToken);
        var activeCats = allCats.Where(x => x.IsActive).ToList();
        var catsById = activeCats.ToDictionary(x => x.Id);
        var parentLookup = allCats.ToDictionary(c => c.Id, c => c.ParentId);

        var metadataListAll = await _meta.ListAllAsync(cancellationToken);
        var metadataMapAll = metadataListAll.ToDictionary(x => x.ProductId);

        var unpublishedIds = await _meta.GetUnpublishedProductIdsAsync(cancellationToken);

        var erpBaseUrl = (_erpOptions.Value.BaseUrl ?? string.Empty).Trim();

        var resolveProductCategoryName = (Guid productId) =>
        {
            string? mainCat = null;
            string? subCat = null;
            var maps = catMapsList.Where(x => x.ProductId == productId).ToList();
            if (maps.Count > 0)
            {
                var primary = maps.Any(x => x.IsPrimary) ? maps.First(x => x.IsPrimary) : maps.First();
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

        var matchingProducts = new List<object>();

        foreach (var p in allProducts)
        {
            if (unpublishedIds.Contains(p.ErpProductId)) continue;

            catMapsByProductId.TryGetValue(p.ErpProductId, out var categoryIds);
            categoryIds ??= new List<Guid>();
            metadataMapAll.TryGetValue(p.ErpProductId, out var m);

            var expandedCats = CampaignService.ExpandCategoryIds(categoryIds, parentLookup);

            bool matches = false;

            if (campaign.Type == "Brand")
            {
                if (!string.IsNullOrWhiteSpace(m?.Brand) && campaign.BrandRules.Any(r => string.Equals(r.BrandName, m.Brand, StringComparison.OrdinalIgnoreCase)))
                {
                    matches = true;
                }
            }
            else
            {
                bool hasTargets = campaign.TargetProductIds.Count > 0 || campaign.TargetCategoryIds.Count > 0 || campaign.TargetBrandNames.Count > 0;
                if (!hasTargets)
                {
                    matches = true;
                }
                else
                {
                    bool matchesProduct = campaign.TargetProductIds.Contains(p.ErpProductId);
                    bool matchesCategory = expandedCats.Any(catId => campaign.TargetCategoryIds.Contains(catId));
                    bool matchesBrand = !string.IsNullOrWhiteSpace(m?.Brand) && campaign.TargetBrandNames.Any(b => string.Equals(b, m.Brand, StringComparison.OrdinalIgnoreCase));

                    if (matchesProduct || matchesCategory || matchesBrand)
                    {
                        matches = true;
                    }
                }
            }

            if (matches)
            {
                var tc = (p.TenantCode ?? string.Empty).Trim().ToUpperInvariant();
                settingsByKey.TryGetValue((tc, p.ErpProductId), out var s);
                reviewsMap.TryGetValue(p.ErpProductId, out var rev);
                var resolvedCatName = resolveProductCategoryName(p.ErpProductId);

                var originalPrice = s?.OverridePrice ?? p.UnitPrice ?? 0;
                
                var appliedCamp = _campaignService.ApplyCampaignsToProduct(
                    p.ErpProductId,
                    originalPrice,
                    m?.Brand,
                    categoryIds,
                    activeCampaigns,
                    parentLookup,
                    isCartEvaluation: true);

                var discountedPrice = appliedCamp != null ? appliedCamp.DiscountedPrice : originalPrice;
                var isFreeShipping = m?.IsFreeShipping ?? false;

                var img = NormalizeImageUrl(p.ImageUrl, erpBaseUrl);
                var imgs = NormalizeImageUrls(p.ImageUrls, erpBaseUrl);

                matchingProducts.Add(new
                {
                    id = p.ErpProductId,
                    tenantCode = tc,
                    stockCode = p.StockCode,
                    name = p.Name,
                    originalPrice = originalPrice,
                    unitPrice = discountedPrice,
                    discountedPrice = discountedPrice < originalPrice ? discountedPrice : (decimal?)null,
                    currency = !string.IsNullOrWhiteSpace(s?.OverrideCurrency) ? s!.OverrideCurrency : p.Currency,
                    stock = p.Stock,
                    isActive = p.IsActive,
                    imageUrl = img,
                    imageUrls = imgs,
                    mainCategory = resolvedCatName.MainCategory,
                    subCategory = resolvedCatName.SubCategory,
                    reviewsCount = rev.Count,
                    ratingAverage = rev.Avg,
                    brand = m?.Brand,
                    slug = m?.Slug,
                    isCampaign = m?.IsCampaign ?? false,
                    showOnHome = m?.ShowOnHome ?? false,
                    warrantyMonths = m?.WarrantyMonths ?? 0,
                    campaignBadge = appliedCamp?.CampaignBadge,
                    campaignName = appliedCamp?.CampaignName,
                    isFreeShipping = isFreeShipping
                });
            }
        }

        return Ok(new { 
            success = true, 
            data = new {
                campaign = campaign,
                products = matchingProducts
            }
        });
    }
}
