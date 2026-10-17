using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using ServiceOps.Domain.Entities;
using ServiceOps.Infrastructure.Data;
using System.Net.Http;
using System.Net.Http.Json;
using Microsoft.Extensions.Configuration;

namespace ServiceOps.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
[Authorize]
public class SparePartsController : ControllerBase
{
    private readonly ApplicationDbContext _context;
    private readonly IHttpClientFactory _httpClientFactory;
    private readonly IConfiguration _configuration;

    public SparePartsController(ApplicationDbContext context, IHttpClientFactory httpClientFactory, IConfiguration configuration)
    {
        _context = context;
        _httpClientFactory = httpClientFactory;
        _configuration = configuration;
    }

    [HttpGet]
    public async Task<ActionResult<object>> GetByProduct([FromQuery] Guid productId)
    {
        var tenantCode = GetTenantCode();
        if (string.IsNullOrWhiteSpace(tenantCode)) return BadRequest(new { success = false, message = "Firma kodu (X-Tenant-Code) eksik." });

        var exists = await _context.ServiceProducts
            .AnyAsync(p => p.Id == productId && p.IsActive && p.TenantCode == tenantCode);
        if (!exists) return NotFound(new { success = false, message = "Ürün bulunamadı" });

        var items = await _context.SpareParts
            .Where(s => s.IsActive && s.TenantCode == tenantCode && s.ProductId == productId)
            .OrderBy(s => s.Name)
            .Select(s => new
            {
                s.Id,
                s.ProductId,
                s.Name,
                s.PartNumber,
                s.StockQuantity,
                s.MinStockLevel,
                s.ExplodedViewPartNumber
            })
            .ToListAsync();

        return Ok(new { success = true, data = items });
    }

    [HttpPost]
    public async Task<ActionResult<object>> Create([FromBody] CreateSparePartRequest request)
    {
        var tenantCode = GetTenantCode();
        if (string.IsNullOrWhiteSpace(tenantCode)) return BadRequest(new { success = false, message = "Firma kodu (X-Tenant-Code) eksik." });

        if (request.ProductId == Guid.Empty)
            return BadRequest(new { success = false, message = "ProductId zorunludur" });

        if (string.IsNullOrWhiteSpace(request.Name))
            return BadRequest(new { success = false, message = "Yedek parça adı zorunludur" });

        var productExists = await _context.ServiceProducts
            .AnyAsync(p => p.Id == request.ProductId && p.IsActive && p.TenantCode == tenantCode);
        if (!productExists) return NotFound(new { success = false, message = "Ürün bulunamadı" });

        var part = new SparePart
        {
            Id = Guid.NewGuid(),
            TenantCode = tenantCode,
            ProductId = request.ProductId,
            Name = request.Name.Trim(),
            PartNumber = string.IsNullOrWhiteSpace(request.PartNumber) ? null : request.PartNumber.Trim(),
            StockQuantity = request.StockQuantity,
            MinStockLevel = request.MinStockLevel,
            ExplodedViewPartNumber = string.IsNullOrWhiteSpace(request.ExplodedViewPartNumber) ? null : request.ExplodedViewPartNumber.Trim(),
            IsActive = true,
            CreatedAt = DateTime.UtcNow
        };

        _context.SpareParts.Add(part);
        await _context.SaveChangesAsync();

        return Ok(new { success = true, data = new { part.Id } });
    }

    [HttpPatch("{id:guid}/stock")]
    public async Task<ActionResult<object>> UpdateStock(Guid id, [FromBody] UpdateSparePartStockRequest request)
    {
        var tenantCode = GetTenantCode();
        if (string.IsNullOrWhiteSpace(tenantCode)) return BadRequest(new { success = false, message = "Firma kodu (X-Tenant-Code) eksik." });

        var part = await _context.SpareParts
            .Where(s => s.Id == id && s.IsActive && s.TenantCode == tenantCode)
            .FirstOrDefaultAsync();
        
        if (part == null)
        {
            try
            {
                var client = _httpClientFactory.CreateClient("ErpApi");
                var reqMessage = new HttpRequestMessage(HttpMethod.Patch, $"api/products/{id}/stock")
                {
                    Content = JsonContent.Create(new { stockQuantity = request.StockQuantity })
                };
                reqMessage.Headers.Add("X-Tenant-Code", tenantCode);
                var response = await client.SendAsync(reqMessage);
                if (response.IsSuccessStatusCode)
                {
                    return Ok(new { success = true, fromErp = true });
                }
                else
                {
                    var errorMsg = await response.Content.ReadAsStringAsync();
                    return StatusCode((int)response.StatusCode, new { success = false, message = "B2B ERP stok güncelleme hatası: " + errorMsg });
                }
            }
            catch (Exception ex)
            {
                return StatusCode(500, new { success = false, message = "B2B ERP bağlantı hatası: " + ex.Message });
            }
        }

        part.StockQuantity = request.StockQuantity;
        if (request.MinStockLevel.HasValue) part.MinStockLevel = request.MinStockLevel.Value;
        part.UpdatedAt = DateTime.UtcNow;

        await _context.SaveChangesAsync();

        return Ok(new
        {
            success = true,
            data = new
            {
                part.Id,
                part.ProductId,
                part.Name,
                part.PartNumber,
                part.StockQuantity,
                part.MinStockLevel,
                part.ExplodedViewPartNumber
            }
        });
    }

    private string GetTenantCode()
    {
        // Jeton firma kodunu iki farklı yazımla taşıyabiliyor ("TenantCode" / "tenantCode");
        // projede her iki biçim de kullanılıyor (bkz. ServiceOpsSparePartOrdersController).
        // Yalnız küçük harfli biçim arandığında, başlık da gönderilmemişse metot boş dönüyor
        // ve bütün yedek parça sorguları 400 ile reddediliyordu.
        return User?.FindFirst("TenantCode")?.Value
               ?? User?.FindFirst("tenantCode")?.Value
               ?? User?.FindFirst("tenant")?.Value
               ?? Request.Headers["X-Tenant-Code"].FirstOrDefault()
               ?? string.Empty;
    }
}

public sealed class CreateSparePartRequest
{
    public Guid ProductId { get; set; }
    public string Name { get; set; } = string.Empty;
    public string? PartNumber { get; set; }
    public int StockQuantity { get; set; }
    public int MinStockLevel { get; set; }
    public string? ExplodedViewPartNumber { get; set; }
}

public sealed class UpdateSparePartStockRequest
{
    public int StockQuantity { get; set; }
    public int? MinStockLevel { get; set; }
}
