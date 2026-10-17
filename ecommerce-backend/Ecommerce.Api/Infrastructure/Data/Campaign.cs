using System;
using System.Collections.Generic;

namespace Ecommerce.Api.Infrastructure.Data;

public sealed class BrandDiscountRule
{
    public string BrandName { get; set; } = string.Empty;
    public string DiscountType { get; set; } = "Percentage"; // Percentage, FixedAmount
    public decimal DiscountValue { get; set; }
}

public sealed class Campaign
{
    public Guid Id { get; set; }
    public string Name { get; set; } = string.Empty;
    public string? Description { get; set; }
    public string Type { get; set; } = "Percentage"; // Percentage, FixedAmount, FreeShipping, GiftProduct, Brand
    public string Scope { get; set; } = "Product"; // Product, Cart
    public bool IsActive { get; set; } = true;
    public DateTime StartDate { get; set; }
    public DateTime EndDate { get; set; }
    public int Priority { get; set; } = 0;
    public string? ImageUrl { get; set; }
    public decimal MinOrderAmount { get; set; } = 0;
    public decimal? MaxDiscountAmount { get; set; }
    public decimal DiscountValue { get; set; } = 0;
    public Guid? GiftProductId { get; set; }
    public string? BuyXGetYType { get; set; } // "Single" or "Multi"
    public int? BuyQuantity { get; set; }      // X
    public int? GiftQuantity { get; set; }     // Y
    public bool? BuyXGetYScale { get; set; }   // Scale multiplier for Multi mode
    public DateTime CreatedAtUtc { get; set; }

    // Targets loaded in memory
    public List<Guid> TargetProductIds { get; set; } = new();
    public List<Guid> TargetCategoryIds { get; set; } = new();
    public List<string> TargetBrandNames { get; set; } = new();
    public List<BrandDiscountRule> BrandRules { get; set; } = new();
}
