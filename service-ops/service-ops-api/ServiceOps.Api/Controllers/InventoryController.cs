using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using System.Security.Claims;
using ServiceOps.Domain.Entities;
using ServiceOps.Infrastructure.Data;
using ServiceOps.Application.Dtos;

namespace ServiceOps.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
[Authorize]
public class InventoryController : ControllerBase
{
    private readonly ApplicationDbContext _context;
    private readonly ServiceOps.Api.Services.IServiceOpsPermissionService _permissions;

    public InventoryController(
        ApplicationDbContext context,
        ServiceOps.Api.Services.IServiceOpsPermissionService permissions)
    {
        _context = context;
        _permissions = permissions;
    }

    /// <summary>
    /// Envanteri DEĞİŞTİRME yetkisi (kullanıcı kararı, 2026-08-17).
    ///
    /// Kalem açma ve stok miktarı yazma uçlarında hiçbir yetki kontrolü yoktu: ServiceOps'a
    /// girebilen herkes — teknisyen dahil — istediği parçanın stoğunu istediği değere
    /// çekebiliyordu. Yeni bir anahtar UYDURULMADI: modülde zaten "Stok" sayfa yetkisi var
    /// (`serviceOps/stok`, envanterin gösterildiği ekranın kendisi), o yüzden yazma da ona
    /// bağlandı — dağıtımdan sonra rollere elle yeni izin vermek gerekmiyor.
    /// Okuma uçlarına dokunulmadı; teknisyen parça arayabilmeli.
    /// </summary>
    private async Task<bool> CanWriteInventoryAsync(CancellationToken cancellationToken = default)
        => await _permissions.HasPageAsync(User, "stok", cancellationToken);

    [HttpGet]
    public async Task<ActionResult<List<object>>> GetAll(
        [FromQuery] string? category,
        [FromQuery] string? status,
        [FromQuery] bool? lowStock)
    {
        var tenantCode = GetTenantCode();
        if (string.IsNullOrWhiteSpace(tenantCode)) return BadRequest(new { success = false, message = "Firma kodu (X-Tenant-Code) eksik." });

        var query = _context.Inventories
            .Where(i => i.IsActive && i.TenantCode == tenantCode)
            .AsQueryable();

        if (!string.IsNullOrEmpty(category))
            query = query.Where(i => i.Category == category);
        if (!string.IsNullOrEmpty(status))
            query = query.Where(i => i.Status.ToString() == status);
        if (lowStock == true)
            query = query.Where(i => i.Quantity <= i.MinStockLevel);

        var items = await query.OrderBy(i => i.Name).ToListAsync();

        return Ok(items.Select(i => new
        {
            i.Id,
            i.PartNumber,
            i.Name,
            i.Description,
            i.Category,
            i.SubCategory,
            i.Quantity,
            i.MinStockLevel,
            i.MaxStockLevel,
            i.Unit,
            i.StorageLocation,
            i.ShelfNumber,
            i.UnitCost,
            i.UnitPrice,
            i.Currency,
            i.Supplier,
            i.Status,
            StatusLabel = i.Status.ToTurkishString(),
            i.IsActive
        }));
    }

    [HttpGet("{id:guid}")]
    public async Task<ActionResult<object>> GetById(Guid id)
    {
        var tenantCode = GetTenantCode();
        if (string.IsNullOrWhiteSpace(tenantCode)) return BadRequest(new { success = false, message = "Firma kodu (X-Tenant-Code) eksik." });

        var item = await _context.Inventories
            .Where(i => i.Id == id && i.IsActive && i.TenantCode == tenantCode)
            .FirstOrDefaultAsync();
        if (item == null) return NotFound();

        return Ok(new
        {
            item.Id,
            item.PartNumber,
            item.Name,
            item.Description,
            item.Category,
            item.Quantity,
            item.MinStockLevel,
            item.Unit,
            item.StorageLocation,
            item.Status,
            StatusLabel = item.Status.ToTurkishString()
        });
    }

    [HttpPost]
    public async Task<ActionResult<object>> Create([FromBody] CreateInventoryRequest request)
    {
        if (!await CanWriteInventoryAsync()) return Forbid();

        var tenantCode = GetTenantCode();
        if (string.IsNullOrWhiteSpace(tenantCode)) return BadRequest(new { success = false, message = "Firma kodu (X-Tenant-Code) eksik." });

        var item = new Inventory
        {
            Id = Guid.NewGuid(),
            TenantCode = tenantCode,
            PartNumber = request.PartNumber,
            Name = request.Name,
            Description = request.Description,
            Category = request.Category,
            Quantity = request.Quantity,
            MinStockLevel = request.MinStockLevel,
            Unit = request.Unit ?? "Adet",
            StorageLocation = request.StorageLocation,
            Status = request.Quantity == 0 ? InventoryStatus.OutOfStock :
                     request.Quantity <= request.MinStockLevel ? InventoryStatus.LowStock :
                     InventoryStatus.InStock,
            IsActive = true,
            CreatedAt = DateTime.UtcNow
        };

        _context.Inventories.Add(item);
        await _context.SaveChangesAsync();

        return CreatedAtAction(nameof(GetById), new { id = item.Id }, item);
    }

    [HttpPatch("{id:guid}/stock")]
    public async Task<IActionResult> UpdateStock(Guid id, [FromBody] UpdateStockRequest request)
    {
        if (!await CanWriteInventoryAsync()) return Forbid();

        var tenantCode = GetTenantCode();
        if (string.IsNullOrWhiteSpace(tenantCode)) return BadRequest(new { success = false, message = "Firma kodu (X-Tenant-Code) eksik." });

        var item = await _context.Inventories
            .Where(i => i.Id == id && i.IsActive && i.TenantCode == tenantCode)
            .FirstOrDefaultAsync();
        if (item == null) return NotFound();

        item.Quantity = request.Quantity;
        item.Status = request.Quantity == 0 ? InventoryStatus.OutOfStock :
                      request.Quantity <= item.MinStockLevel ? InventoryStatus.LowStock :
                      InventoryStatus.InStock;
        item.UpdatedAt = DateTime.UtcNow;

        await _context.SaveChangesAsync();

        return Ok(new
        {
            item.Id,
            item.PartNumber,
            item.Name,
            item.Description,
            item.Category,
            item.SubCategory,
            item.Quantity,
            item.MinStockLevel,
            item.MaxStockLevel,
            item.Unit,
            item.StorageLocation,
            item.ShelfNumber,
            item.UnitCost,
            item.UnitPrice,
            item.Currency,
            item.Supplier,
            item.Status,
            StatusLabel = item.Status.ToTurkishString(),
            item.IsActive
        });
    }

    [HttpGet("stats")]
    public async Task<ActionResult<object>> GetStats()
    {
        var tenantCode = GetTenantCode();
        if (string.IsNullOrWhiteSpace(tenantCode)) return BadRequest(new { success = false, message = "Firma kodu (X-Tenant-Code) eksik." });

        var total = await _context.Inventories.CountAsync(i => i.IsActive && i.TenantCode == tenantCode);
        var inStock = await _context.Inventories.CountAsync(i => i.IsActive && i.TenantCode == tenantCode && i.Status == InventoryStatus.InStock);
        var lowStock = await _context.Inventories.CountAsync(i => i.IsActive && i.TenantCode == tenantCode && i.Status == InventoryStatus.LowStock);
        var outOfStock = await _context.Inventories.CountAsync(i => i.IsActive && i.TenantCode == tenantCode && i.Status == InventoryStatus.OutOfStock);

        return Ok(new { totalItems = total, inStock, lowStock, outOfStock });
    }

    private string GetTenantCode()
    {
        // Jetondaki firma kodu iki yazımla gelebiliyor (bkz. SparePartsController/TechniciansController).
        return User?.FindFirst("TenantCode")?.Value
               ?? User?.FindFirst("tenantCode")?.Value
               ?? User?.FindFirst("tenant")?.Value
               ?? Request.Headers["X-Tenant-Code"].FirstOrDefault()
               ?? string.Empty;
    }
}

public class CreateInventoryRequest
{
    public string PartNumber { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string? Description { get; set; }
    public string? Category { get; set; }
    public int Quantity { get; set; }
    public int MinStockLevel { get; set; } = 10;
    public string? Unit { get; set; } = "Adet";
    public string? StorageLocation { get; set; }
}

public class UpdateStockRequest
{
    public int Quantity { get; set; }
}
