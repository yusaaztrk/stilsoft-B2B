using Ecommerce.Api.Infrastructure.Data;
using Microsoft.AspNetCore.Mvc;

namespace Ecommerce.Api.Controllers;

[ApiController]
[Route("internal/import")]
public sealed class InternalImportController : ControllerBase
{
    private readonly ProductsRepository _products;
    private readonly IConfiguration _config;

    public InternalImportController(ProductsRepository products, IConfiguration config)
    {
        _products = products;
        _config = config;
    }

    public sealed class ImportProduct
    {
        public Guid ErpProductId { get; set; }
        public string? StockCode { get; set; }
        public string? Name { get; set; }
        public decimal? UnitPrice { get; set; }
        public string? Currency { get; set; }
        public int? Stock { get; set; }
        public bool? IsActive { get; set; }
        public string? ImageUrl { get; set; }
        public List<string>? ImageUrls { get; set; }
    }

    public sealed class ImportProductsRequest
    {
        public List<ImportProduct> Items { get; set; } = new();
    }

    [HttpPost("products")]
    public async Task<IActionResult> ImportProducts([FromBody] ImportProductsRequest request, CancellationToken cancellationToken)
    {
        var expected = (_config["Internal:ImportSecret"] ?? string.Empty).Trim();
        if (string.IsNullOrWhiteSpace(expected))
            return StatusCode(StatusCodes.Status500InternalServerError, new { success = false, message = "Internal secret not configured" });

        var provided = Request.Headers.TryGetValue("X-Internal-Secret", out var values)
            ? values.ToString().Trim()
            : string.Empty;

        if (!string.Equals(provided, expected, StringComparison.Ordinal))
            return Unauthorized(new { success = false, message = "Unauthorized" });

        var tenantCode = Request.Headers.TryGetValue("X-Tenant-Code", out var t)
            ? t.ToString().Trim().ToUpperInvariant()
            : string.Empty;

        if (string.IsNullOrWhiteSpace(tenantCode))
            return BadRequest(new { success = false, message = "X-Tenant-Code header is required" });

        var items = request?.Items ?? new List<ImportProduct>();
        if (items.Count == 0)
            return BadRequest(new { success = false, message = "items is required" });

        var mapped = items
            .Where(x => x.ErpProductId != Guid.Empty)
            .Select(x => new EcommerceProduct
            {
                TenantCode = tenantCode,
                ErpProductId = x.ErpProductId,
                StockCode = x.StockCode,
                Name = x.Name,
                UnitPrice = x.UnitPrice,
                Currency = x.Currency,
                Stock = x.Stock,
                IsActive = x.IsActive,
                ImageUrl = x.ImageUrl,
                ImageUrls = x.ImageUrls,
                UpdatedAtUtc = DateTimeOffset.UtcNow
            })
            .ToList();

        if (mapped.Count == 0)
            return BadRequest(new { success = false, message = "No valid items" });

        await _products.UpsertManyAsync(tenantCode, mapped, cancellationToken);
        return Ok(new { success = true, data = new { imported = mapped.Count } });
    }
}
