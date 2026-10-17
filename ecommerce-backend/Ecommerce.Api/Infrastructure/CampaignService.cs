using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Ecommerce.Api.Infrastructure.Data;

namespace Ecommerce.Api.Infrastructure;

public sealed class AppliedCampaignInfo
{
    public Guid CampaignId { get; set; }
    public string CampaignName { get; set; } = string.Empty;
    public string CampaignType { get; set; } = string.Empty;
    public decimal OriginalPrice { get; set; }
    public decimal DiscountedPrice { get; set; }
    public decimal DiscountAmount { get; set; }
    public string? CampaignBadge { get; set; }
    public string? CampaignImage { get; set; }
}

public sealed class CartCalculationResult
{
    public decimal Subtotal { get; set; } // original price sum
    public decimal ItemDiscountsTotal { get; set; } // sum of item-level discounts
    public decimal CartDiscountTotal { get; set; } // sum of cart-wide discounts (percentage/fixed)
    public decimal TotalCampaignDiscount => ItemDiscountsTotal + CartDiscountTotal;
    public decimal CargoFee { get; set; }
    public decimal FinalTotal { get; set; }
    public bool FreeShippingApplied { get; set; }
    
    // Injected gift items
    public List<CartGiftItem> GiftItems { get; set; } = new();
    
    // Detailed item breakdown
    public List<CartCalculationLine> Lines { get; set; } = new();
    
    // Active applied campaigns
    public List<Guid> AppliedCampaignIds { get; set; } = new();
    public List<AppliedCampaignDetail> AppliedCampaigns { get; set; } = new();
}

public sealed class AppliedCampaignDetail
{
    public Guid CampaignId { get; set; }
    public decimal DiscountAmount { get; set; }
}

public sealed class CartGiftItem
{
    public Guid ProductId { get; set; }
    public string ProductName { get; set; } = string.Empty;
    public string ImageUrl { get; set; } = string.Empty;
    public string TenantCode { get; set; } = string.Empty;
    public int Quantity { get; set; } = 1;
    public decimal UnitPrice => 0;
}

public sealed class CartCalculationLine
{
    public Guid ProductId { get; set; }
    public string TenantCode { get; set; } = string.Empty;
    public int Quantity { get; set; }
    public decimal OriginalPrice { get; set; }
    public decimal DiscountedPrice { get; set; }
    public decimal LineDiscountAmount => (OriginalPrice - DiscountedPrice) * Quantity;
    public decimal LineTotal => DiscountedPrice * Quantity;
    public Guid? AppliedCampaignId { get; set; }
    public string? CampaignBadge { get; set; }
}

public sealed class CampaignService
{
    private readonly CampaignsRepository _campaignsRepo;
    private readonly ProductsRepository _productsRepo;
    private readonly CategoriesRepository _categoriesRepo;
    private readonly ProductMetadataRepository _metadataRepo;

    public CampaignService(
        CampaignsRepository campaignsRepo,
        ProductsRepository productsRepo,
        CategoriesRepository categoriesRepo,
        ProductMetadataRepository metadataRepo)
    {
        _campaignsRepo = campaignsRepo;
        _productsRepo = productsRepo;
        _categoriesRepo = categoriesRepo;
        _metadataRepo = metadataRepo;
    }

    public static List<Guid> ExpandCategoryIds(List<Guid> categoryIds, Dictionary<Guid, Guid?> parentLookup)
    {
        if (categoryIds == null || categoryIds.Count == 0) return new List<Guid>();
        if (parentLookup == null || parentLookup.Count == 0) return categoryIds;

        var result = new HashSet<Guid>();
        foreach (var catId in categoryIds)
        {
            var current = catId;
            while (current != Guid.Empty)
            {
                result.Add(current);
                if (parentLookup.TryGetValue(current, out var parentId) && parentId.HasValue && parentId.Value != Guid.Empty)
                {
                    if (result.Contains(parentId.Value)) break; // Prevent cyclic hierarchy
                    current = parentId.Value;
                }
                else
                {
                    break;
                }
            }
        }
        return result.ToList();
    }

    public AppliedCampaignInfo? ApplyCampaignsToProduct(
        Guid productId,
        decimal originalPrice,
        string? brand,
        List<Guid> categoryIds,
        List<Campaign> activeCampaigns,
        Dictionary<Guid, Guid?>? parentLookup = null,
        bool isCartEvaluation = false)
    {
        if (activeCampaigns == null || activeCampaigns.Count == 0) return null;

        var expandedCategoryIds = categoryIds;
        if (categoryIds != null && parentLookup != null)
        {
            expandedCategoryIds = ExpandCategoryIds(categoryIds, parentLookup);
        }

        AppliedCampaignInfo? bestCampaign = null;
        decimal maxDiscount = 0;

        foreach (var c in activeCampaigns)
        {
            if (string.Equals(c.Scope, "Cart", StringComparison.OrdinalIgnoreCase)) continue;
            if (c.Type != "Percentage" && c.Type != "FixedAmount" && c.Type != "Brand") continue;
            
            // Product price must be greater than or equal to the minimum product price limit
            if (originalPrice < c.MinOrderAmount) continue;

            decimal discount = 0;
            string discountType = c.Type;
            decimal val = c.DiscountValue;

            if (c.Type == "Brand")
            {
                if (string.IsNullOrWhiteSpace(brand)) continue;

                var rule = c.BrandRules?.FirstOrDefault(r => string.Equals(r.BrandName, brand, StringComparison.OrdinalIgnoreCase));
                if (rule == null) continue;

                discountType = rule.DiscountType;
                val = rule.DiscountValue;
            }
            else
            {
                // Check targets. If any target is specified, it must match.
                bool hasTargets = c.TargetProductIds.Count > 0 || c.TargetCategoryIds.Count > 0 || c.TargetBrandNames.Count > 0;
                if (hasTargets)
                {
                    bool matchesProduct = c.TargetProductIds.Contains(productId);
                    bool matchesCategory = expandedCategoryIds.Any(catId => c.TargetCategoryIds.Contains(catId));
                    bool matchesBrand = !string.IsNullOrWhiteSpace(brand) && c.TargetBrandNames.Any(b => string.Equals(b, brand, StringComparison.OrdinalIgnoreCase));

                    if (!matchesProduct && !matchesCategory && !matchesBrand) continue;
                }
            }

            // Calculate discount for this single product
            if (discountType == "Percentage")
            {
                discount = originalPrice * (val / 100m);
                if (c.MaxDiscountAmount.HasValue && c.MaxDiscountAmount.Value > 0)
                {
                    discount = Math.Min(discount, c.MaxDiscountAmount.Value);
                }
            }
            else if (discountType == "FixedAmount")
            {
                discount = Math.Min(val, originalPrice);
            }

            discount = Math.Round(discount, 2);

            if (discount > maxDiscount)
            {
                maxDiscount = discount;
                
                string badge = discountType == "Percentage" 
                    ? $"%{val:0} İndirim" 
                    : $"₺{val:0} İndirim";

                bestCampaign = new AppliedCampaignInfo
                {
                    CampaignId = c.Id,
                    CampaignName = c.Name,
                    CampaignType = c.Type,
                    OriginalPrice = originalPrice,
                    DiscountedPrice = Math.Max(0, originalPrice - discount),
                    DiscountAmount = discount,
                    CampaignBadge = badge,
                    CampaignImage = c.ImageUrl
                };
            }
        }

        return bestCampaign;
    }

    public async Task<CartCalculationResult> EvaluateCartCampaignsAsync(
        List<(Guid ProductId, string TenantCode, int Quantity, decimal OriginalPrice)> cartItems,
        decimal baseCargoFee,
        decimal freeShippingThreshold,
        CancellationToken cancellationToken)
    {
        var result = new CartCalculationResult();
        if (cartItems == null || cartItems.Count == 0)
        {
            result.CargoFee = baseCargoFee;
            result.FinalTotal = baseCargoFee;
            return result;
        }

        // 1. Fetch active campaigns
        var activeCampaigns = await _campaignsRepo.GetActiveCampaignsAsync(cancellationToken);

        // 2. Fetch category and brand metadata in bulk for cart products to prevent N+1 queries
        var productIds = cartItems.Select(x => x.ProductId).Distinct().ToList();
        
        // Load category maps for cart items
        var catMapsList = await _categoriesRepo.ListAllProductCategoryMapsAsync(CategoriesRepository.DefaultCatalogCode, CategoriesRepository.DefaultCatalogCode, cancellationToken);
        var categoriesLookup = catMapsList
            .Where(x => productIds.Contains(x.ProductId))
            .GroupBy(x => x.ProductId)
            .ToDictionary(g => g.Key, g => g.Select(x => x.CategoryId).ToList());

        // Load all active categories to build parent lookup (limit to 5000)
        var allCats = await _categoriesRepo.ListAllAsync(5000, cancellationToken);
        var parentLookup = allCats.ToDictionary(c => c.Id, c => c.ParentId);

        // Load metadata (brand) for cart items
        var metadataList = await _metadataRepo.ListAllAsync(cancellationToken);
        var brandLookup = metadataList
            .Where(x => productIds.Contains(x.ProductId))
            .GroupBy(x => (Tenant: (x.ProductTenantCode ?? string.Empty).Trim().ToUpperInvariant(), ProductId: x.ProductId))
            .ToDictionary(g => g.Key, g => g.First().Brand);

        // 3. Evaluate item-level campaigns first
        decimal itemsSubtotalOriginal = 0;
        decimal itemsSubtotalDiscounted = 0;

        decimal initialCartSubtotal = cartItems.Sum(x => x.OriginalPrice * x.Quantity);
        // Cart-scoped campaigns must meet the cart subtotal threshold
        var eligibleCartCampaigns = activeCampaigns
            .Where(c => string.Equals(c.Scope, "Cart", StringComparison.OrdinalIgnoreCase) && 
                        initialCartSubtotal >= c.MinOrderAmount)
            .ToList();

        // Product-scoped campaigns do not require cart subtotal threshold (their MinOrderAmount applies to individual product prices)
        var eligibleProductCampaigns = activeCampaigns
            .Where(c => !string.Equals(c.Scope, "Cart", StringComparison.OrdinalIgnoreCase))
            .ToList();

        foreach (var item in cartItems)
        {
            categoriesLookup.TryGetValue(item.ProductId, out var catIds);
            catIds ??= new List<Guid>();
            
            var brandKey = ((item.TenantCode ?? string.Empty).Trim().ToUpperInvariant(), item.ProductId);
            brandLookup.TryGetValue(brandKey, out var brand);

            var bestCamp = ApplyCampaignsToProduct(item.ProductId, item.OriginalPrice, brand, catIds, eligibleProductCampaigns, parentLookup, isCartEvaluation: true);

            var line = new CartCalculationLine
            {
                ProductId = item.ProductId,
                TenantCode = item.TenantCode,
                Quantity = item.Quantity,
                OriginalPrice = item.OriginalPrice,
                DiscountedPrice = bestCamp != null ? bestCamp.DiscountedPrice : item.OriginalPrice,
                AppliedCampaignId = bestCamp?.CampaignId,
                CampaignBadge = bestCamp?.CampaignBadge
            };

            result.Lines.Add(line);
            
            itemsSubtotalOriginal += line.OriginalPrice * line.Quantity;
            itemsSubtotalDiscounted += line.DiscountedPrice * line.Quantity;
            result.ItemDiscountsTotal += line.LineDiscountAmount;

            if (bestCamp != null && !result.AppliedCampaignIds.Contains(bestCamp.CampaignId))
            {
                result.AppliedCampaignIds.Add(bestCamp.CampaignId);
            }
        }

        result.Subtotal = itemsSubtotalOriginal;

        // 4. Evaluate cart-wide campaigns using itemsSubtotalDiscounted as basis
        // Look for FreeShipping, GiftProduct or general discount campaigns where MinOrderAmount is met
        var cartWideCampaigns = activeCampaigns
            .Where(c => string.Equals(c.Scope, "Cart", StringComparison.OrdinalIgnoreCase) &&
                        itemsSubtotalDiscounted >= c.MinOrderAmount)
            .ToList();

        // 4a. Check if all products in the cart are marked as free shipping
        var freeShippingLookup = metadataList
            .Where(x => productIds.Contains(x.ProductId))
            .GroupBy(x => (Tenant: (x.ProductTenantCode ?? string.Empty).Trim().ToUpperInvariant(), ProductId: x.ProductId))
            .ToDictionary(g => g.Key, g => g.First().IsFreeShipping);

        bool allItemsFreeShipping = true;
        foreach (var line in result.Lines)
        {
            var metaKey = ((line.TenantCode ?? string.Empty).Trim().ToUpperInvariant(), line.ProductId);
            freeShippingLookup.TryGetValue(metaKey, out var isItemFree);
            if (!isItemFree)
            {
                allItemsFreeShipping = false;
                break;
            }
        }
        result.FreeShippingApplied = allItemsFreeShipping;

        if (!result.FreeShippingApplied && itemsSubtotalDiscounted >= freeShippingThreshold)
        {
            result.FreeShippingApplied = true;
        }

        Campaign? appliedFreeShippingCamp = null;

        // 4b. Check GiftProduct campaign (can be cart-wide or triggered by specific products)
        var giftCampaigns = activeCampaigns
            .Where(c => c.Type == "GiftProduct" && c.GiftProductId.HasValue)
            .ToList();

        foreach (var giftCamp in giftCampaigns)
        {
            var giftProductId = giftCamp.GiftProductId!.Value;
            bool hasTrigger = false;
            bool hasTargets = giftCamp.TargetProductIds.Count > 0 || giftCamp.TargetCategoryIds.Count > 0 || giftCamp.TargetBrandNames.Count > 0;
            
            if (!hasTargets)
            {
                // Cart-wide gift (if no targets, it triggers when cart meets MinOrderAmount)
                hasTrigger = itemsSubtotalDiscounted >= giftCamp.MinOrderAmount;
            }
            else
            {
                // Has targets: check if any cart line item matches
                foreach (var line in result.Lines)
                {
                    categoriesLookup.TryGetValue(line.ProductId, out var catIds);
                    catIds ??= new List<Guid>();
                    var expandedCats = ExpandCategoryIds(catIds, parentLookup);

                    var brandKey = ((line.TenantCode ?? string.Empty).Trim().ToUpperInvariant(), line.ProductId);
                    brandLookup.TryGetValue(brandKey, out var brand);

                    bool matchesProduct = giftCamp.TargetProductIds.Contains(line.ProductId);
                    bool matchesCategory = expandedCats.Any(catId => giftCamp.TargetCategoryIds.Contains(catId));
                    bool matchesBrand = !string.IsNullOrWhiteSpace(brand) && giftCamp.TargetBrandNames.Any(b => string.Equals(b, brand, StringComparison.OrdinalIgnoreCase));

                    if (matchesProduct || matchesCategory || matchesBrand)
                    {
                        hasTrigger = true;
                        break;
                    }
                }

                if (hasTrigger && giftCamp.MinOrderAmount > 0)
                {
                    hasTrigger = itemsSubtotalDiscounted >= giftCamp.MinOrderAmount;
                }
            }

            if (hasTrigger)
            {
                var giftProduct = await _productsRepo.GetAnyAsync(giftProductId, cancellationToken);
                if (giftProduct != null)
                {
                    result.GiftItems.Add(new CartGiftItem
                    {
                        ProductId = giftProductId,
                        ProductName = giftProduct.Name ?? giftProduct.StockCode ?? "Hediye Ürün",
                        ImageUrl = giftProduct.ImageUrl ?? string.Empty,
                        TenantCode = giftProduct.TenantCode ?? string.Empty,
                        Quantity = 1
                    });
                    result.AppliedCampaignIds.Add(giftCamp.Id);
                }
            }
        }

        // 4d. Check BuyXGetY campaigns
        var buyXGetYCampaigns = activeCampaigns
            .Where(c => string.Equals(c.Type, "BuyXGetY", StringComparison.OrdinalIgnoreCase) && 
                        c.GiftProductId.HasValue && 
                        (string.Equals(c.BuyXGetYType, "Multi", StringComparison.OrdinalIgnoreCase) ||
                         (c.BuyQuantity.HasValue && c.BuyQuantity.Value > 0 && c.GiftQuantity.HasValue && c.GiftQuantity.Value > 0)))
            .ToList();

        foreach (var camp in buyXGetYCampaigns)
        {
            var giftProductId = camp.GiftProductId!.Value;
            var buyQty = camp.BuyQuantity ?? 1;
            var giftQty = camp.GiftQuantity ?? 1;
            
            bool isSingleProduct = string.Equals(camp.BuyXGetYType, "Single", StringComparison.OrdinalIgnoreCase);
            decimal totalMultiplier = 0;

            if (isSingleProduct)
            {
                // Single Product: trigger condition must be met by a single matching product individually
                foreach (var line in result.Lines)
                {
                    categoriesLookup.TryGetValue(line.ProductId, out var catIds);
                    catIds ??= new List<Guid>();
                    var expandedCats = ExpandCategoryIds(catIds, parentLookup);

                    var brandKey = ((line.TenantCode ?? string.Empty).Trim().ToUpperInvariant(), line.ProductId);
                    brandLookup.TryGetValue(brandKey, out var brand);

                    bool hasTargets = camp.TargetProductIds.Count > 0 || camp.TargetCategoryIds.Count > 0 || camp.TargetBrandNames.Count > 0;
                    bool matches = !hasTargets;
                    if (hasTargets)
                    {
                        bool matchesProduct = camp.TargetProductIds.Contains(line.ProductId);
                        bool matchesCategory = expandedCats.Any(catId => camp.TargetCategoryIds.Contains(catId));
                        bool matchesBrand = !string.IsNullOrWhiteSpace(brand) && camp.TargetBrandNames.Any(b => string.Equals(b, brand, StringComparison.OrdinalIgnoreCase));
                        matches = matchesProduct || matchesCategory || matchesBrand;
                    }

                    if (matches && line.Quantity >= buyQty)
                    {
                        decimal mult = Math.Floor((decimal)line.Quantity / buyQty);
                        totalMultiplier += mult;
                    }
                }
            }
            else
            {
                // Multi Product: requires at least 1 of each target product to be present in the cart.
                if (camp.TargetProductIds != null && camp.TargetProductIds.Count > 0)
                {
                    var targetQuantities = new List<int>();
                    foreach (var targetId in camp.TargetProductIds)
                    {
                        var line = result.Lines.FirstOrDefault(l => l.ProductId == targetId);
                        int qty = line?.Quantity ?? 0;
                        targetQuantities.Add(qty);
                    }

                    if (targetQuantities.All(q => q >= 1))
                    {
                        bool scaleEnabled = camp.BuyXGetYScale == true;
                        int minQty = targetQuantities.Min();
                        totalMultiplier = scaleEnabled ? minQty : 1;
                    }
                }
            }

            if (totalMultiplier > 0)
            {
                var giftProduct = await _productsRepo.GetAnyAsync(giftProductId, cancellationToken);
                if (giftProduct != null)
                {
                    int totalGiftQty = (int)(giftQty * totalMultiplier);
                    
                    var existingGift = result.GiftItems.FirstOrDefault(g => g.ProductId == giftProductId);
                    if (existingGift != null)
                    {
                        existingGift.Quantity += totalGiftQty;
                    }
                    else
                    {
                        result.GiftItems.Add(new CartGiftItem
                        {
                            ProductId = giftProductId,
                            ProductName = giftProduct.Name ?? giftProduct.StockCode ?? "Hediye Ürün",
                            ImageUrl = giftProduct.ImageUrl ?? string.Empty,
                            TenantCode = giftProduct.TenantCode ?? string.Empty,
                            Quantity = totalGiftQty
                        });
                    }

                    if (!result.AppliedCampaignIds.Contains(camp.Id))
                    {
                        result.AppliedCampaignIds.Add(camp.Id);
                    }
                }
            }
        }

        // 4c. Check Cart-Wide discount campaigns (Percentage or FixedAmount with Scope == "Cart")
        // Pick the highest advantage cart-wide discount
        decimal bestCartDiscount = 0;
        Guid? bestCartCampId = null;

        var discountCampaigns = cartWideCampaigns
            .Where(c => (c.Type == "Percentage" || c.Type == "FixedAmount") &&
                        string.Equals(c.Scope, "Cart", StringComparison.OrdinalIgnoreCase))
            .ToList();

        foreach (var c in discountCampaigns)
        {
            decimal discount = 0;
            if (c.Type == "Percentage")
            {
                discount = itemsSubtotalDiscounted * (c.DiscountValue / 100m);
                if (c.MaxDiscountAmount.HasValue && c.MaxDiscountAmount.Value > 0)
                {
                    discount = Math.Min(discount, c.MaxDiscountAmount.Value);
                }
            }
            else if (c.Type == "FixedAmount")
            {
                discount = Math.Min(c.DiscountValue, itemsSubtotalDiscounted);
            }

            discount = Math.Round(discount, 2);
            if (discount > bestCartDiscount)
            {
                bestCartDiscount = discount;
                bestCartCampId = c.Id;
            }
        }

        if (bestCartCampId.HasValue)
        {
            result.CartDiscountTotal = bestCartDiscount;
            result.AppliedCampaignIds.Add(bestCartCampId.Value);
        }

        result.CargoFee = result.FreeShippingApplied ? 0 : baseCargoFee;
        result.FinalTotal = Math.Max(0, itemsSubtotalDiscounted - result.CartDiscountTotal + result.CargoFee);

        // Calculate individual campaign contributions for tracking
        var contributions = new Dictionary<Guid, decimal>();
        foreach (var line in result.Lines)
        {
            if (line.AppliedCampaignId.HasValue && line.LineDiscountAmount > 0)
            {
                var cid = line.AppliedCampaignId.Value;
                contributions[cid] = contributions.GetValueOrDefault(cid) + line.LineDiscountAmount;
            }
        }

        if (bestCartCampId.HasValue && bestCartDiscount > 0)
        {
            contributions[bestCartCampId.Value] = contributions.GetValueOrDefault(bestCartCampId.Value) + bestCartDiscount;
        }

        if (appliedFreeShippingCamp != null)
        {
            // Free shipping savings is the base cargo fee
            contributions[appliedFreeShippingCamp.Id] = contributions.GetValueOrDefault(appliedFreeShippingCamp.Id) + baseCargoFee;
        }

        foreach (var gc in giftCampaigns)
        {
            if (result.AppliedCampaignIds.Contains(gc.Id))
            {
                contributions[gc.Id] = contributions.GetValueOrDefault(gc.Id) + 0;
            }
        }

        foreach (var c in buyXGetYCampaigns)
        {
            if (result.AppliedCampaignIds.Contains(c.Id))
            {
                contributions[c.Id] = contributions.GetValueOrDefault(c.Id) + 0;
            }
        }

        result.AppliedCampaigns = contributions
            .Select(kv => new AppliedCampaignDetail { CampaignId = kv.Key, DiscountAmount = kv.Value })
            .ToList();

        return result;
    }

}
