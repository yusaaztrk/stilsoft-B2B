using Ecommerce.Api.Infrastructure.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Ecommerce.Api.Controllers;

[ApiController]
[Route("api/admin/product-settings")]
[Authorize(Roles = "Owner,Admin")]
public sealed class AdminProductSettingsController : ControllerBase
{
    private readonly ProductSettingsRepository _repo;

    public AdminProductSettingsController(ProductSettingsRepository repo)
    {
        _repo = repo;
    }

    [HttpGet]
    public async Task<IActionResult> List([FromQuery] int take = 2000, CancellationToken cancellationToken = default)
    {
        var tenantCode = Request.Headers.TryGetValue("X-Tenant-Code", out var t)
            ? t.ToString().Trim().ToUpperInvariant()
            : string.Empty;

        if (string.IsNullOrWhiteSpace(tenantCode))
        {
            var list = await _repo.ListAllAsync(take, cancellationToken);
            var dataAll = list
                .OrderByDescending(x => x.IsFeatured)
                .ThenByDescending(x => x.UpdatedAtUtc)
                .Select(x => new
                {
                    tenantCode = x.TenantCode,
                    productId = x.ProductId,
                    isFeatured = x.IsFeatured,
                    overridePrice = x.OverridePrice,
                    overrideCurrency = x.OverrideCurrency,
                    updatedAtUtc = x.UpdatedAtUtc
                })
                .ToList();

            return Ok(new { success = true, data = dataAll });
        }

        var map = await _repo.GetAllByProductIdAsync(tenantCode, cancellationToken);
        var data = map.Values
            .OrderByDescending(x => x.IsFeatured)
            .ThenByDescending(x => x.UpdatedAtUtc)
            .Select(x => new
            {
                tenantCode = x.TenantCode,
                productId = x.ProductId,
                isFeatured = x.IsFeatured,
                overridePrice = x.OverridePrice,
                overrideCurrency = x.OverrideCurrency,
                updatedAtUtc = x.UpdatedAtUtc
            })
            .ToList();

        return Ok(new { success = true, data });
    }

    public sealed class UpsertRequest
    {
        public bool IsFeatured { get; set; }
        public decimal? OverridePrice { get; set; }
        public string? OverrideCurrency { get; set; }
    }

    [HttpPut("{productId:guid}")]
    public async Task<IActionResult> Upsert([FromRoute] Guid productId, [FromBody] UpsertRequest request, CancellationToken cancellationToken)
    {
        var tenantCode = Request.Headers.TryGetValue("X-Tenant-Code", out var t)
            ? t.ToString().Trim().ToUpperInvariant()
            : string.Empty;

        if (string.IsNullOrWhiteSpace(tenantCode))
        {
            tenantCode = (Request.Query["tenantCode"].ToString() ?? string.Empty).Trim().ToUpperInvariant();
        }

        if (string.IsNullOrWhiteSpace(tenantCode))
            return BadRequest(new { success = false, message = "tenantCode is required" });

        var cur = (request.OverrideCurrency ?? string.Empty).Trim();
        var setting = new ProductSetting
        {
            TenantCode = tenantCode,
            ProductId = productId,
            IsFeatured = request.IsFeatured,
            OverridePrice = request.OverridePrice,
            OverrideCurrency = string.IsNullOrWhiteSpace(cur) ? null : cur,
            UpdatedAtUtc = DateTimeOffset.UtcNow
        };

        await _repo.UpsertAsync(setting, cancellationToken);
        return Ok(new { success = true });
    }
}
