using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using ServiceOps.Domain.Entities;
using ServiceOps.Infrastructure.Data;
using ServiceOps.Api.Services;

namespace ServiceOps.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
[Authorize]
public class RegionsController : ControllerBase
{
    private readonly ApplicationDbContext _context;
    private readonly IServiceOpsPermissionService _permissions;

    private static string NormalizeRegionName(string name)
    {
        if (string.IsNullOrWhiteSpace(name)) return name;
        return name
            .Replace("Gazima??usa", "Gazimağusa")
            .Replace("G??zelyurt", "Güzelyurt")
            .Replace("Lefko??a", "Lefkoşa")
            .Replace("??skele", "İskele");
    }

    public RegionsController(ApplicationDbContext context, IServiceOpsPermissionService permissions)
    {
        _context = context;
        _permissions = permissions;
    }

    [HttpGet]
    public async Task<ActionResult<List<object>>> GetAll()
    {
        var regions = await _context.Regions
            .Where(r => r.IsActive)
            .OrderBy(r => r.Name)
            .ToListAsync();

        return Ok(regions.Select(r => new
        {
            r.Id,
            Name = NormalizeRegionName(r.Name),
            r.Description,
            r.CenterLatitude,
            r.CenterLongitude,
            r.TechnicianCount,
            r.ActiveServiceCount,
            r.IsActive
        }));
    }

    [HttpGet("{id:guid}")]
    public async Task<ActionResult<object>> GetById(Guid id)
    {
        var region = await _context.Regions
            .Include(r => r.Technicians)
            .Include(r => r.Routes)
            .FirstOrDefaultAsync(r => r.Id == id);

        if (region == null) return NotFound();

        return Ok(new
        {
            region.Id,
            Name = NormalizeRegionName(region.Name),
            region.Description,
            region.CenterLatitude,
            region.CenterLongitude,
            region.TechnicianCount,
            region.ActiveServiceCount,
            region.IsActive,
            Technicians = region.Technicians.Select(t => new { t.Id, t.FullName }),
            ActiveRoutes = region.Routes.Count(r => r.Status == RouteStatus.InProgress)
        });
    }

    [HttpGet("stats")]
    public async Task<ActionResult<object>> GetStats()
    {
        var stats = await _context.Regions
            .Where(r => r.IsActive)
            .Select(r => new
            {
                Name = NormalizeRegionName(r.Name),
                r.TechnicianCount,
                r.ActiveServiceCount,
                ActiveRoutes = r.Routes.Count(x => x.Status == RouteStatus.InProgress)
            })
            .ToListAsync();

        return Ok(stats);
    }

    [HttpPost]
    public async Task<ActionResult<object>> Create([FromBody] CreateRegionRequest request)
    {
        // Eskiden [Authorize(Roles = "Admin,Manager")] — "Manager" hiçbir yerde kimseye
        // atanmıyordu (ölü kod) ve "Admin" artık (login akışındaki düzeltmeden sonra) teknisyen
        // olmayan herkesin varsayılan etiketi, tek başına yetki anlamına gelmiyor. Bölge
        // oluşturma ayarlar düzeyinde bir işlem; claim'e dayalı gerçek süper admin ister.
        if (!_permissions.IsSuperAdmin(User))
        {
            return Forbid();
        }

        var region = new Region
        {
            Id = Guid.NewGuid(),
            Name = request.Name,
            Description = request.Description,
            IsActive = true,
            CreatedAt = DateTime.UtcNow
        };

        _context.Regions.Add(region);
        await _context.SaveChangesAsync();

        return CreatedAtAction(nameof(GetById), new { id = region.Id }, region);
    }
}

public class CreateRegionRequest
{
    public string Name { get; set; } = string.Empty;
    public string? Description { get; set; }
}
