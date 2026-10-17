using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using ServiceOps.Application.Dtos;
using ServiceOps.Application.Interfaces;
using ServiceOps.Domain.Entities;
using ServiceOps.Infrastructure.Data;

namespace ServiceOps.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
[Authorize]
public class RoutesController : ControllerBase
{
    private readonly IRouteService _routeService;
    private readonly ApplicationDbContext _context;
    private readonly ServiceOps.Api.Services.IServiceOpsPermissionService _permissions;

    public RoutesController(
        IRouteService routeService,
        ApplicationDbContext context,
        ServiceOps.Api.Services.IServiceOpsPermissionService permissions)
    {
        _routeService = routeService;
        _context = context;
        _permissions = permissions;
    }

    /// <summary>
    /// BU METOT `return false;` İDİ.
    ///
    /// Yani bu controller'daki BÜTÜN yetki kontrolleri ölüydü: rota oluşturma, güncelleme,
    /// durum değiştirme, tamamlanan durak sayısı ve SİLME uçlarının hepsi
    /// `if (IsTechnicianUser()) return Forbid();` yazıyor ama koşul hiçbir zaman doğru olmuyordu.
    /// Aynı şekilde okuma uçlarındaki "teknisyen yalnızca kendi rotasını görür" daraltması da
    /// hiç uygulanmıyordu — teknisyen bütün rotaları görebiliyordu.
    ///
    /// Tek kaynak `IServiceOpsPermissionService`: süper admin burada teknisyen sayılmaz
    /// (bir zamanlar teknisyene bağlanmış bir hesap terfi edince kilitlenmesin diye).
    /// </summary>
    private bool IsTechnicianUser() => _permissions.IsTechnicianUser(User);

    private async Task<Guid?> GetCurrentTechnicianIdAsync()
    {
        var claimValue = User.FindFirstValue("technicianId");
        if (Guid.TryParse(claimValue, out var claimTechId)) return claimTechId;

        var sub = User.FindFirstValue(JwtRegisteredClaimNames.Sub) ?? User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (!Guid.TryParse(sub, out var userId)) return null;

        return await _context.ServiceUsers
            .AsNoTracking()
            .Where(u => u.Id == userId)
            .Select(u => u.TechnicianId)
            .FirstOrDefaultAsync();
    }

    [HttpGet]
    public async Task<ActionResult<List<RouteListItemDto>>> GetAll([FromQuery] RouteFilterDto? filter)
    {
        if (IsTechnicianUser())
        {
            var techId = await GetCurrentTechnicianIdAsync();
            if (!techId.HasValue) return Forbid();
            filter ??= new RouteFilterDto();
            filter.TechnicianId = techId.Value;
        }
        var routes = await _routeService.GetAllAsync(filter);
        return Ok(routes);
    }

    [HttpGet("today")]
    public async Task<ActionResult<List<RouteListItemDto>>> GetTodayRoutes()
    {
        if (IsTechnicianUser())
        {
            var techId = await GetCurrentTechnicianIdAsync();
            if (!techId.HasValue) return Forbid();
            var scoped = await _routeService.GetAllAsync(new RouteFilterDto
            {
                TechnicianId = techId.Value,
                DateFrom = DateTime.UtcNow.Date,
                DateTo = DateTime.UtcNow.Date.AddDays(1)
            });
            return Ok(scoped);
        }
        var routes = await _routeService.GetTodayRoutesAsync();
        return Ok(routes);
    }

    [HttpGet("{id:guid}")]
    public async Task<ActionResult<RouteDto>> GetById(Guid id)
    {
        if (IsTechnicianUser())
        {
            var techId = await GetCurrentTechnicianIdAsync();
            if (!techId.HasValue) return Forbid();
            var allowed = await _context.Routes.AsNoTracking().AnyAsync(r => r.Id == id && r.TechnicianId == techId.Value);
            if (!allowed) return Forbid();
        }
        var route = await _routeService.GetByIdAsync(id);
        if (route == null) return NotFound();
        return Ok(route);
    }

    [HttpPost]
    public async Task<ActionResult<RouteDto>> Create(CreateRouteDto dto)
    {
        if (IsTechnicianUser()) return Forbid();
        var route = await _routeService.CreateAsync(dto);
        return CreatedAtAction(nameof(GetById), new { id = route.Id }, route);
    }

    [HttpPut("{id:guid}")]
    public async Task<ActionResult<RouteDto>> Update(Guid id, CreateRouteDto dto)
    {
        if (IsTechnicianUser())
        {
            var techId = await GetCurrentTechnicianIdAsync();
            if (!techId.HasValue) return Forbid();
            var routeObj = await _context.Routes.AsNoTracking().FirstOrDefaultAsync(r => r.Id == id);
            if (routeObj == null) return NotFound();
            if (routeObj.TechnicianId != techId.Value) return Forbid();
        }
        var route = await _routeService.UpdateAsync(id, dto);
        if (route == null) return NotFound();
        return Ok(route);
    }

    [HttpPatch("stops/{stopId:guid}/status")]
    public async Task<ActionResult> UpdateStopStatus(Guid stopId, [FromBody] UpdateStopStatusDto dto)
    {
        var stop = await _context.RouteStops.FirstOrDefaultAsync(s => s.Id == stopId);
        if (stop == null) return NotFound();

        // BU UÇTA HİÇBİR KONTROL YOKTU. Kardeş uçların hepsi (`{id}/status`, `completed-stops`,
        // `DELETE`) en azından teknisyeni reddediyor; burası açık kalmıştı ve oturum açmış HERKES
        // BAŞKASININ rotasındaki herhangi bir durağı "tamamlandı" işaretleyebiliyordu — rota
        // tamamlanma sayacı ve rotanın kendi durumu da buna bağlı olduğu için başkasının günü
        // bitmiş gösterilebiliyordu.
        //
        // Kural: teknisyen YALNIZCA kendi rotasının durağına dokunur (bu uç zaten onun içindir);
        // teknisyen olmayan kullanıcı için Rota sayfası yetkisi aranır.
        if (IsTechnicianUser())
        {
            var techId = await GetCurrentTechnicianIdAsync();
            if (!techId.HasValue) return Forbid();

            var ownsRoute = await _context.Routes
                .AsNoTracking()
                .AnyAsync(r => r.Id == stop.RouteId && r.TechnicianId == techId.Value);
            if (!ownsRoute) return Forbid();
        }
        else if (!await _permissions.HasPageAsync(User, "rota", HttpContext.RequestAborted))
        {
            return Forbid();
        }

        stop.Status = dto.Status;
        if (dto.Status == StopStatus.Completed)
        {
            stop.ActualArrival = DateTime.UtcNow;
            stop.ActualDeparture = DateTime.UtcNow;
        }
        
        await _context.SaveChangesAsync();

        // Also update completed stops count on the parent route
        var route = await _context.Routes.Include(r => r.Stops).FirstOrDefaultAsync(r => r.Id == stop.RouteId);
        if (route != null)
        {
            route.CompletedStops = route.Stops.Count(s => s.Status == StopStatus.Completed);
            if (route.CompletedStops == route.TotalStops)
            {
                route.Status = RouteStatus.Completed;
            }
            await _context.SaveChangesAsync();
        }

        return Ok(new { success = true });
    }

    [HttpPatch("{id:guid}/status")]
    public async Task<ActionResult<RouteDto>> UpdateStatus(Guid id, UpdateRouteStatusDto dto)
    {
        if (IsTechnicianUser()) return Forbid();
        var route = await _routeService.UpdateStatusAsync(id, dto);
        if (route == null) return NotFound();
        return Ok(route);
    }

    [HttpPatch("{id:guid}/completed-stops")]
    public async Task<ActionResult<RouteDto>> UpdateCompletedStops(Guid id, [FromBody] int completedStops)
    {
        if (IsTechnicianUser()) return Forbid();
        var route = await _routeService.UpdateCompletedStopsAsync(id, completedStops);
        if (route == null) return NotFound();
        return Ok(route);
    }

    [HttpDelete("{id:guid}")]
    public async Task<IActionResult> Delete(Guid id)
    {
        if (IsTechnicianUser()) return Forbid();
        var result = await _routeService.DeleteAsync(id);
        if (!result) return NotFound();
        return NoContent();
    }

    /// <summary>
    /// Teknisyenlerin ANLIK KONUMU. Kişisel veri: hangi personelin nerede olduğunu, bunu görmesi
    /// gereken sayfaya (Rota / Teknisyen Takip) yetkisi olmayan kimse okuyamamalı. Uçta hiçbir
    /// kontrol yoktu; oturum açan herkes bütün ekibin konumunu çekebiliyordu.
    /// </summary>
    [HttpGet("technician-locations")]
    public async Task<ActionResult<List<TechnicianLocationDto>>> GetTechnicianLocations()
    {
        var ct = HttpContext.RequestAborted;
        if (!await _permissions.HasPageAsync(User, "rota", ct)
            && !await _permissions.HasPageAsync(User, "teknisyenTakip", ct))
        {
            return Forbid();
        }

        var locations = await _routeService.GetTechnicianLocationsAsync();
        return Ok(locations);
    }

    [HttpGet("region-stats")]
    public async Task<ActionResult<List<RegionStatsDto>>> GetRegionStats()
    {
        if (!await _permissions.HasPageAsync(User, "rota", HttpContext.RequestAborted)) return Forbid();

        var stats = await _routeService.GetRegionStatsAsync();
        return Ok(stats);
    }
}

public class UpdateStopStatusDto
{
    public StopStatus Status { get; set; }
}
