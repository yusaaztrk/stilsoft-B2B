using B2B.Erp.Api.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace B2B.Erp.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
[Authorize]
public sealed class StocksController : ControllerBase
{
    private readonly AppDbContext _dbContext;

    public StocksController(AppDbContext dbContext)
    {
        _dbContext = dbContext;
    }

    [HttpGet]
    public async Task<IActionResult> Search(
        [FromQuery] string? q,
        [FromQuery] string? groupCode,
        [FromQuery] bool inStockOnly = true,
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 20,
        CancellationToken cancellationToken = default)
    {
        page = page < 1 ? 1 : page;
        pageSize = pageSize < 1 ? 20 : pageSize;
        pageSize = pageSize > 200 ? 200 : pageSize;

        var query = _dbContext.Products
            .AsNoTracking()
            .AsQueryable();

        if (!string.IsNullOrWhiteSpace(groupCode))
        {
            var g = groupCode.Trim();
            var catGuids = await _dbContext.ProductCategories
                .AsNoTracking()
                .Where(c => c.Key.ToLower() == g.ToLower() || c.Name.ToLower() == g.ToLower())
                .Select(c => c.Id)
                .ToListAsync(cancellationToken);

            query = query.Where(x => (x.MainCategoryId.HasValue && catGuids.Contains(x.MainCategoryId.Value)) || (x.CategoryId.HasValue && catGuids.Contains(x.CategoryId.Value)));
        }

        if (inStockOnly)
        {
            query = query.Where(x => x.Stock > 0);
        }

        if (!string.IsNullOrWhiteSpace(q))
        {
            var term = q.Trim().ToLowerInvariant();
            query = query.Where(x => x.StockCode.ToLower().Contains(term) || x.Name.ToLower().Contains(term));
        }

        var total = await query.CountAsync(cancellationToken);

        var items = await query
            .OrderBy(x => x.StockCode)
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .Select(x => new
            {
                id = x.Id,
                stockCode = x.StockCode,
                name = x.Name,
                stokKodu = x.StockCode,
                stokAdi = x.Name,
                bakiye = x.Stock,
                inStockQuantity = x.Stock
            })
            .ToListAsync(cancellationToken);

        return Ok(new { success = true, data = new { items, total, page, pageSize } });
    }
}
