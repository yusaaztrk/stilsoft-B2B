using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.AspNetCore.StaticFiles;
using ServiceOps.Domain.Entities;
using ServiceOps.Infrastructure.Data;

namespace ServiceOps.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
[Authorize]
public class ServiceProductsController : ControllerBase
{
    private readonly ApplicationDbContext _context;

    public ServiceProductsController(ApplicationDbContext context)
    {
        _context = context;
    }

    [HttpGet]
    public async Task<ActionResult<object>> GetAll([FromQuery] string? q)
    {
        var tenantCode = GetTenantCode();
        if (string.IsNullOrWhiteSpace(tenantCode)) return BadRequest(new { success = false, message = "Firma kodu (X-Tenant-Code) eksik." });

        var query = _context.ServiceProducts
            .Where(p => p.IsActive && p.TenantCode == tenantCode)
            .AsQueryable();

        if (!string.IsNullOrWhiteSpace(q))
        {
            var s = q.Trim();
            query = query.Where(p => p.Name.Contains(s) || (p.StockCode != null && p.StockCode.Contains(s)));
        }

        var items = await query
            .OrderBy(p => p.Name)
            .Select(p => new
            {
                p.Id,
                p.Name,
                p.StockCode
            })
            .ToListAsync();

        return Ok(new { success = true, data = items });
    }

    [HttpGet("{id:guid}")]
    public async Task<ActionResult<object>> GetById(Guid id)
    {
        var tenantCode = GetTenantCode();
        if (string.IsNullOrWhiteSpace(tenantCode)) return BadRequest(new { success = false, message = "Firma kodu (X-Tenant-Code) eksik." });

        var product = await _context.ServiceProducts
            .Where(p => p.Id == id && p.IsActive && p.TenantCode == tenantCode)
            .FirstOrDefaultAsync();

        if (product == null) return NotFound(new { success = false, message = "Ürün bulunamadı" });

        var diagrams = await _context.ExplodedDiagrams
            .Where(d => d.ProductId == id && d.IsActive && d.TenantCode == tenantCode)
            .OrderByDescending(d => d.UploadedAt)
            .Select(d => new
            {
                d.Id,
                d.FileName,
                d.ContentType,
                d.UploadedAt,
                url = $"/api/serviceproducts/diagram/{d.Id}"
            })
            .ToListAsync();

        var parts = await _context.SpareParts
            .Where(s => s.ProductId == id && s.IsActive && s.TenantCode == tenantCode)
            .OrderBy(s => s.Name)
            .Select(s => new
            {
                s.Id,
                s.Name,
                s.PartNumber,
                s.StockQuantity,
                s.MinStockLevel,
                s.ExplodedViewPartNumber
            })
            .ToListAsync();

        return Ok(new
        {
            success = true,
            data = new
            {
                product.Id,
                product.Name,
                product.StockCode,
                explodedDiagrams = diagrams,
                spareParts = parts
            }
        });
    }

    [HttpGet("by-name")]
    public async Task<ActionResult<object>> GetByName([FromQuery] string name)
    {
        var tenantCode = GetTenantCode();
        if (string.IsNullOrWhiteSpace(tenantCode)) return BadRequest(new { success = false, message = "Firma kodu (X-Tenant-Code) eksik." });

        if (string.IsNullOrWhiteSpace(name))
            return BadRequest(new { success = false, message = "name zorunludur" });

        var n = name.Trim();

        var productId = await _context.ServiceProducts
            .Where(p => p.IsActive && p.TenantCode == tenantCode && p.Name == n)
            .Select(p => (Guid?)p.Id)
            .FirstOrDefaultAsync();

        if (productId == null)
            return NotFound(new { success = false, message = "Ürün bulunamadı" });

        return await GetById(productId.Value);
    }

    [HttpPost]
    public async Task<ActionResult<object>> Create([FromBody] CreateServiceProductRequest request)
    {
        var tenantCode = GetTenantCode();
        if (string.IsNullOrWhiteSpace(tenantCode)) return BadRequest(new { success = false, message = "Firma kodu (X-Tenant-Code) eksik." });

        if (string.IsNullOrWhiteSpace(request.Name))
            return BadRequest(new { success = false, message = "Ürün adı zorunludur" });

        var product = new ServiceProduct
        {
            Id = Guid.NewGuid(),
            TenantCode = tenantCode,
            Name = request.Name.Trim(),
            StockCode = string.IsNullOrWhiteSpace(request.StockCode) ? null : request.StockCode.Trim(),
            IsActive = true,
            CreatedAt = DateTime.UtcNow
        };

        _context.ServiceProducts.Add(product);
        await _context.SaveChangesAsync();

        return Ok(new { success = true, data = new { product.Id } });
    }

    [HttpPost("{id:guid}/diagram")]
    [RequestSizeLimit(50_000_000)]
    public async Task<ActionResult<object>> UploadDiagram(Guid id, IFormFile file, CancellationToken cancellationToken)
    {
        var tenantCode = GetTenantCode();
        if (string.IsNullOrWhiteSpace(tenantCode)) return BadRequest(new { success = false, message = "Firma kodu (X-Tenant-Code) eksik." });

        var product = await _context.ServiceProducts
            .Where(p => p.Id == id && p.IsActive && p.TenantCode == tenantCode)
            .FirstOrDefaultAsync(cancellationToken);
        if (product == null) return NotFound(new { success = false, message = "Ürün bulunamadı" });

        if (file == null || file.Length <= 0)
            return BadRequest(new { success = false, message = "file zorunlu" });

        // UZANTI BEYAZ LİSTEDEN GEÇER. Uzantı istemciden olduğu gibi alınıyordu ve dosya
        // `GetDiagram` ucundan uzantısına göre belirlenen içerik tipiyle geri servis ediliyor:
        // `.html`/`.svg` yüklenip API'nin kendi kaynağında script çalıştırmak mümkündü — üstelik
        // o uç anonim. (Aynı sertleştirme B2B tarafında `UploadsController`da yapılmıştı.)
        var allowedDiagramExtensions = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        {
            ".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".pdf"
        };

        var ext = Path.GetExtension(file.FileName ?? string.Empty).ToLowerInvariant();
        if (string.IsNullOrWhiteSpace(ext) || !allowedDiagramExtensions.Contains(ext))
        {
            return BadRequest(new { success = false, message = "Yalnızca görsel (.png, .jpg, .webp) veya .pdf şema yüklenebilir" });
        }

        var uploadsRoot = Path.Combine(AppContext.BaseDirectory, "uploads", "exploded", tenantCode, id.ToString("N"));
        Directory.CreateDirectory(uploadsRoot);

        var diagramId = Guid.NewGuid();
        var safeName = $"{diagramId:N}{ext}";
        var absPath = Path.Combine(uploadsRoot, safeName);

        await using (var fs = System.IO.File.Create(absPath))
        {
            await file.CopyToAsync(fs, cancellationToken);
        }

        var diagram = new ExplodedDiagram
        {
            Id = diagramId,
            TenantCode = tenantCode,
            ProductId = id,
            FileName = Path.GetFileName(file.FileName),
            ContentType = string.IsNullOrWhiteSpace(file.ContentType) ? "application/octet-stream" : file.ContentType,
            StoragePath = absPath,
            IsActive = true,
            UploadedAt = DateTime.UtcNow
        };

        _context.ExplodedDiagrams.Add(diagram);
        await _context.SaveChangesAsync(cancellationToken);

        return Ok(new { success = true, data = new { diagram.Id } });
    }

    [HttpGet("diagram/{diagramId:guid}")]
    [AllowAnonymous]
    public async Task<IActionResult> GetDiagram(Guid diagramId, CancellationToken cancellationToken)
    {
        var diagram = await _context.ExplodedDiagrams
            .Where(d => d.Id == diagramId && d.IsActive)
            .FirstOrDefaultAsync(cancellationToken);

        if (diagram == null) return NotFound(new { success = false, message = "Şema bulunamadı" });
        if (string.IsNullOrWhiteSpace(diagram.StoragePath) || !System.IO.File.Exists(diagram.StoragePath))
            return NotFound(new { success = false, message = "Şema dosyası bulunamadı" });

        var provider = new FileExtensionContentTypeProvider();
        if (!provider.TryGetContentType(diagram.StoragePath, out var contentType))
            contentType = string.IsNullOrWhiteSpace(diagram.ContentType) ? "application/octet-stream" : diagram.ContentType;

        var stream = System.IO.File.OpenRead(diagram.StoragePath);
        return File(stream, contentType, diagram.FileName);
    }

    private string GetTenantCode()
    {
        return User?.FindFirst("tenantCode")?.Value
               ?? User?.FindFirst("tenant")?.Value
               ?? Request.Headers["X-Tenant-Code"].FirstOrDefault()
               ?? string.Empty;
    }
}

public sealed class CreateServiceProductRequest
{
    public string Name { get; set; } = string.Empty;
    public string? StockCode { get; set; }
}
