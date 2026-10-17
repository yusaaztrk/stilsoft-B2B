using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using ServiceOps.Domain.Entities;
using ServiceOps.Infrastructure.Data;

namespace ServiceOps.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
public sealed class SparePartOrderRequestsController : ControllerBase
{
    private readonly ApplicationDbContext _context;

    public SparePartOrderRequestsController(ApplicationDbContext context)
    {
        _context = context;
    }

    // B2B satın alma ekranı da çağırıyor (sunucu-sunucu). Kullanıcı oturumu da kabul edilir.
    [HttpGet]
    [ServiceOps.Api.Filters.InternalApiKeyOrUser]
    public async Task<ActionResult<object>> GetAll([FromQuery] string? status)
    {
        var tenantCode = GetTenantCode();
        if (string.IsNullOrWhiteSpace(tenantCode)) return BadRequest(new { success = false, message = "Firma kodu (X-Tenant-Code) eksik." });

        var st = string.IsNullOrWhiteSpace(status) ? null : status.Trim();

        var q = _context.SparePartOrderRequests
            .AsNoTracking()
            .Where(x => x.TenantCode == tenantCode);

        if (!string.IsNullOrWhiteSpace(st))
        {
            q = q.Where(x => x.Status == st);
        }

        var list = await q
            .OrderByDescending(x => x.CreatedAt)
            .Take(500)
            .Select(x => new
            {
                x.Id,
                x.TenantCode,
                x.TechnicianName,
                x.ErpProductId,
                x.StockCode,
                x.PartName,
                x.QuantityRequested,
                x.Status,
                x.CreatedAt,
                x.CompletedAt
            })
            .ToListAsync();

        return Ok(new { success = true, data = list });
    }

    public sealed class CreateOrderRequest
    {
        public Guid ErpProductId { get; set; }
        public string? StockCode { get; set; }
        public string? PartName { get; set; }
        public int QuantityRequested { get; set; }
    }

    [HttpPost]
    [ServiceOps.Api.Filters.InternalApiKeyOrUser]
    public async Task<ActionResult<object>> Create([FromBody] CreateOrderRequest req)
    {
        var tenantCode = GetTenantCode();
        if (string.IsNullOrWhiteSpace(tenantCode)) return BadRequest(new { success = false, message = "Firma kodu (X-Tenant-Code) eksik." });

        if (req.ErpProductId == Guid.Empty) return BadRequest(new { success = false, message = "ErpProductId zorunludur" });
        var stockCode = (req.StockCode ?? string.Empty).Trim();
        var partName = (req.PartName ?? string.Empty).Trim();
        if (string.IsNullOrWhiteSpace(stockCode)) return BadRequest(new { success = false, message = "StockCode zorunludur" });
        if (string.IsNullOrWhiteSpace(partName)) return BadRequest(new { success = false, message = "PartName zorunludur" });

        var qty = Math.Max(1, req.QuantityRequested);

        var techName = User?.FindFirstValue(ClaimTypes.Name) ?? User?.Identity?.Name ?? string.Empty;
        if (string.IsNullOrWhiteSpace(techName)) techName = "Teknisyen";

        var row = new SparePartOrderRequest
        {
            Id = Guid.NewGuid(),
            TenantCode = tenantCode,
            TechnicianName = techName,
            ErpProductId = req.ErpProductId,
            StockCode = stockCode,
            PartName = partName,
            QuantityRequested = qty,
            Status = "Pending",
            CreatedAt = DateTime.UtcNow,
            CompletedAt = null
        };

        _context.SparePartOrderRequests.Add(row);
        await _context.SaveChangesAsync();

        return Ok(new { success = true, data = new { row.Id } });
    }

    [HttpPost("{id:guid}/complete")]
    [ServiceOps.Api.Filters.InternalApiKeyOrUser]
    public async Task<ActionResult<object>> Complete(Guid id)
    {
        var tenantCode = GetTenantCode();
        if (string.IsNullOrWhiteSpace(tenantCode)) return BadRequest(new { success = false, message = "Firma kodu (X-Tenant-Code) eksik." });

        var row = await _context.SparePartOrderRequests
            .Where(x => x.Id == id && x.TenantCode == tenantCode)
            .FirstOrDefaultAsync();

        if (row == null) return NotFound(new { success = false, message = "Sipariş bulunamadı" });

        row.Status = "Completed";
        row.CompletedAt = DateTime.UtcNow;

        await _context.SaveChangesAsync();
        return Ok(new { success = true });
    }

    private string GetTenantCode()
    {
        return User?.FindFirst("tenantCode")?.Value
               ?? User?.FindFirst("tenant")?.Value
               ?? Request.Headers["X-Tenant-Code"].FirstOrDefault()
               ?? string.Empty;
    }
}
