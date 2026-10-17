using System.Security.Claims;
using Ecommerce.Api.Infrastructure.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Ecommerce.Api.Controllers;

[ApiController]
[Route("api/favorites")]
[Authorize]
public sealed class FavoritesController : ControllerBase
{
    private readonly FavoritesRepository _favorites;
    private readonly ProductsRepository _products;

    public FavoritesController(FavoritesRepository favorites, ProductsRepository products)
    {
        _favorites = favorites;
        _products = products;
    }

    public sealed class ToggleRequest
    {
        public string TenantCode { get; set; } = string.Empty;
        public Guid ProductId { get; set; }
    }

    [HttpGet]
    public async Task<IActionResult> List([FromQuery] int take = 200, CancellationToken cancellationToken = default)
    {
        var userIdRaw = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (!Guid.TryParse(userIdRaw, out var userId) || userId == Guid.Empty)
            return Unauthorized(new { success = false, message = "Oturum bulunamadı" });

        var keys = await _favorites.ListKeysAsync(userId, take, cancellationToken);

        var result = new List<object>();
        foreach (var (tenant, pid) in keys)
        {
            var p = await _products.GetAsync(tenant, pid, cancellationToken);
            if (p is null) continue;

            result.Add(new
            {
                id = p.ErpProductId,
                tenantCode = (p.TenantCode ?? tenant).Trim().ToUpperInvariant(),
                stockCode = p.StockCode,
                name = p.Name,
                unitPrice = p.UnitPrice,
                currency = p.Currency,
                stock = p.Stock,
                isActive = p.IsActive,
                imageUrl = p.ImageUrl,
                imageUrls = p.ImageUrls
            });
        }

        return Ok(new { success = true, data = result });
    }

    [HttpPost("toggle")]
    public async Task<IActionResult> Toggle([FromBody] ToggleRequest request, CancellationToken cancellationToken)
    {
        var userIdRaw = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (!Guid.TryParse(userIdRaw, out var userId) || userId == Guid.Empty)
            return Unauthorized(new { success = false, message = "Oturum bulunamadı" });

        var tenant = (request.TenantCode ?? string.Empty).Trim().ToUpperInvariant();
        if (string.IsNullOrWhiteSpace(tenant))
            return BadRequest(new { success = false, message = "TenantCode zorunlu" });
        if (request.ProductId == Guid.Empty)
            return BadRequest(new { success = false, message = "ProductId zorunlu" });

        var isFavorited = await _favorites.ToggleAsync(userId, tenant, request.ProductId, cancellationToken);
        return Ok(new { success = true, data = new { isFavorited } });
    }
}
