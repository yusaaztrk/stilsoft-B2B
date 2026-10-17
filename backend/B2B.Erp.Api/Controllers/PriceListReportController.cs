using B2B.Erp.Api.Core.Authorization;
using B2B.Erp.Api.Data;
using B2B.Erp.Api.Entities;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace B2B.Erp.Api.Controllers;

[ApiController]
[Route("api/reports/price-list")]
[Authorize]
public sealed class PriceListReportController : ControllerBase
{
    private readonly AppDbContext _dbContext;

    public PriceListReportController(AppDbContext dbContext)
    {
        _dbContext = dbContext;
    }

    [HttpGet]
    [AuthorizePage("reports", "fiyatListesi")]
    public async Task<IActionResult> GetReport(CancellationToken cancellationToken = default)
    {
        // 1. Fetch active Price Groups sorted by sort order and code
        var priceGroups = await _dbContext.PriceGroups
            .AsNoTracking()
            .Where(x => x.IsActive)
            .OrderBy(x => x.SortOrder)
            .ThenBy(x => x.Code)
            .Select(x => new
            {
                id = x.Id,
                code = x.Code,
                name = x.Name,
                invoiceType = x.InvoiceType,
                isActive = x.IsActive
            })
            .ToListAsync(cancellationToken);

        var categories = await _dbContext.ProductCategories.AsNoTracking().ToListAsync(cancellationToken);
        var catMap = categories.ToDictionary(c => c.Id, c => c.Key);
        var catNameMap = categories.ToDictionary(c => c.Id, c => c.Name);

        // 2. Fetch active products (including both MAMUL and Y.PARCA / spare parts)
        // Order by StockCode
        var products = await _dbContext.Products
            .AsNoTracking()
            .Where(x => x.IsActive)
            .OrderBy(x => x.StockCode)
            .Select(x => new
            {
                id = x.Id,
                productType = x.ProductType,
                barcode = x.Barcode,
                mainCategoryId = x.MainCategoryId,
                categoryId = x.CategoryId,
                stockCode = x.StockCode,
                name = x.Name
            })
            .ToListAsync(cancellationToken);

        // 3. Fetch product prices mapped by ProductId and PriceGroupId
        var prices = await _dbContext.ProductPrices
            .AsNoTracking()
            .Select(x => new
            {
                x.ProductId,
                x.PriceGroupId,
                x.Price,
                x.Currency
            })
            .ToListAsync(cancellationToken);

        // Create dictionary mapping ProductId -> (PriceGroupId -> PriceDetail)
        var pricesLookup = prices
            .GroupBy(x => x.ProductId)
            .ToDictionary(
                g => g.Key,
                g => g.ToDictionary(x => x.PriceGroupId, x => new { price = x.Price, currency = x.Currency })
            );

        // Map products and populate price columns dynamically
        var items = products.Select(p =>
        {
            var productPrices = pricesLookup.TryGetValue(p.id, out var dict) ? dict : null;
            var priceDict = new Dictionary<string, object?>();

            foreach (var pg in priceGroups)
            {
                var key = pg.id.ToString();
                if (productPrices != null && productPrices.TryGetValue(pg.id, out var pp))
                {
                    priceDict[key] = new
                    {
                        price = pp.price,
                        currency = pp.currency
                    };
                }
                else
                {
                    priceDict[key] = null;
                }
            }

            var isSpare = !string.IsNullOrWhiteSpace(p.productType) && p.productType.Equals("YEDEKPARCA", StringComparison.OrdinalIgnoreCase);
            var mappedType = isSpare ? "Y.PARCA" : "MAMUL";

            var gCode = p.mainCategoryId.HasValue && catMap.TryGetValue(p.mainCategoryId.Value, out var g) ? g : (p.mainCategoryId.HasValue && catNameMap.TryGetValue(p.mainCategoryId.Value, out var gn) ? gn : null);
            var sCode = p.categoryId.HasValue && catMap.TryGetValue(p.categoryId.Value, out var s) ? s : (p.categoryId.HasValue && catNameMap.TryGetValue(p.categoryId.Value, out var sn) ? sn : null);

            return new
            {
                id = p.id,
                kod4 = mappedType,
                barcode = p.barcode,
                groupCode = gCode,
                subGroupCode = sCode,
                stockCode = p.stockCode,
                stockName = p.name,
                prices = priceDict
            };
        }).ToList();

        return Ok(new
        {
            success = true,
            data = new
            {
                priceGroups,
                items
            }
        });
    }
}
