using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using ServiceOps.Domain.Entities;
using ServiceOps.Infrastructure.Data;
using ServiceOps.Application.Dtos;
using ServiceOps.Api.Services;

namespace ServiceOps.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
[Authorize]
public class WorkOrdersController : ControllerBase
{
    private readonly ApplicationDbContext _context;
    private readonly IServiceOpsPermissionService _permissions;

    public WorkOrdersController(ApplicationDbContext context, IServiceOpsPermissionService permissions)
    {
        _context = context;
        _permissions = permissions;
    }

    /// <summary>
    /// İş emri her zaman bir servis kaydına aittir; yetkisi de o kaydın yetkisidir.
    ///
    /// Bu controller'da HİÇBİR kapsam kontrolü yoktu: liste bütün firmanın iş emirlerini
    /// döndürüyor, oluşturma da istediğin ServiceId'yi kabul ediyordu — saha personeli
    /// BAŞKASININ servis kaydına iş emri açabiliyordu (yetki senaryosunda doğrulandı).
    /// </summary>
    /// <summary>
    /// Bir servis kaydını GÖSTEREN bütün sayfalar.
    ///
    /// Eskiden yalnızca üç yönetim kökü taranıyordu. Ama "tüm işleri görme" bayrağı çoğu rolde
    /// ALT SEKMELERE (montajYonetimi.planlama gibi) ve KABUL sayfalarına veriliyor; kök sayfa
    /// açık olsa bile kendi başına "sadece kendi işleri" anlamına geliyor. Teknisyen olmayan bir
    /// yönetici için "kendi işleri" hiçbir kayda denk gelmediğinden kapsam None'a düşüyor ve bu
    /// controller 403 veriyordu — iş emri okunamadığı için servis fişi hiç basılamıyordu.
    /// (Doğrulandı 2026-08-10: Müdür rolünde /api/workorders 403.)
    ///
    /// Liste yalnızca kullanıcının ZATEN sahip olduğu sayfalara bakar; yetki genişletmez.
    /// </summary>
    private static readonly string[] ServiceRecordPageKeys =
    {
        "buyukUrun",
        "buyukUrun.planlama",
        "buyukUrun.sahaPlanlama",
        "buyukUrun.atolye",
        "buyukUrun.hazirTeslimat",
        "buyukUrun.teslimattakiler",
        "atolyeAriza",
        "atolyeAriza.atolye",
        "atolyeAriza.hazirTeslimat",
        "atolyeAriza.teslimattakiler",
        "montajYonetimi",
        "montajYonetimi.planlama",
        "montajYonetimi.teslimat",
        "montajKabul",
        "buyukEvAletleriKabul",
        "kucukUrunKabul"
    };

    private async Task<bool> CanReachServiceAsync(Guid serviceId)
    {
        foreach (var pageKey in ServiceRecordPageKeys)
        {
            var scope = await _permissions.GetScopeAsync(User, pageKey);
            if (!scope.CanAccess) continue;

            var reachable = await _permissions
                .ApplyServiceRecordScope(_context.ServiceRecords.AsNoTracking().Where(s => s.Id == serviceId), scope)
                .AnyAsync();

            if (reachable) return true;
        }
        return false;
    }

    /// <summary>Erişilebilir servis kayıtlarının kimlikleri; liste sorgularını daraltmak için.</summary>
    private async Task<IQueryable<WorkOrder>> ScopedWorkOrdersAsync()
    {
        var query = _context.WorkOrders.AsQueryable();

        foreach (var pageKey in ServiceRecordPageKeys)
        {
            var scope = await _permissions.GetScopeAsync(User, pageKey);
            if (scope.Kind == ServiceOpsScopeKind.All) return query;
        }

        var techId = _permissions.GetTechnicianId(User);
        if (!techId.HasValue) return query.Where(_ => false);

        // Dar yetkili kullanıcı: kendi üzerine atanmış iş emirleri ve kendi servis kayıtları.
        return query.Where(w =>
            w.TechnicianId == techId.Value ||
            w.Service.AssignedTechnicianId == techId.Value ||
            w.Service.InstallationTasks.Any(t => t.AssignedTechnicianId == techId.Value));
    }

    [HttpGet]
    public async Task<ActionResult<List<object>>> GetAll(
        [FromQuery] string? status,
        [FromQuery] Guid? technicianId,
        [FromQuery] Guid? serviceId)
    {
        IQueryable<WorkOrder> query = (await ScopedWorkOrdersAsync())
            .Include(w => w.Technician)
            .Include(w => w.Service);

        if (!string.IsNullOrEmpty(status))
            query = query.Where(w => w.Status.ToString() == status);
        if (technicianId.HasValue)
            query = query.Where(w => w.TechnicianId == technicianId);
        if (serviceId.HasValue)
            query = query.Where(w => w.ServiceId == serviceId.Value);

        var orders = await query.OrderByDescending(w => w.CreatedAt).ToListAsync();

        return Ok(orders.Select(w => new
        {
            w.Id,
            w.WorkOrderNumber,
            w.Status,
            StatusLabel = w.Status.ToTurkishString(),
            w.TechnicianId,
            TechnicianName = w.Technician?.FullName,
            ServiceNumber = w.Service.ServiceNumber,
            w.ScheduledDate,
            w.CompletedAt,
            Description = w.Description
        }));
    }

    [HttpGet("{id:guid}")]
    public async Task<ActionResult<object>> GetById(Guid id)
    {
        var order = await _context.WorkOrders
            .Include(w => w.Technician)
            .Include(w => w.Service)
            .Include(w => w.WorkLogs)
            .FirstOrDefaultAsync(w => w.Id == id);

        if (order == null) return NotFound();

        // KAPSAM KAPISI OKUMADA DA GEÇERLİ. Yazma yolları (`Create` ve durum güncelleme)
        // `CanReachServiceAsync` ile korunuyordu, tekil okuma ise korumasızdı: id'yi bilen ya da
        // deneyen her oturumlu kullanıcı, kapsamı dışındaki bir iş emrinin müşterisini,
        // teknisyenini, maliyet kalemlerini ve çalışma kayıtlarını okuyabiliyordu.
        if (!await CanReachServiceAsync(order.ServiceId)) return Forbid();

        return Ok(new
        {
            order.Id,
            order.WorkOrderNumber,
            order.Description,
            order.Status,
            StatusLabel = order.Status.ToTurkishString(),
            TechnicianName = order.Technician?.FullName,
            ServiceNumber = order.Service.ServiceNumber,
            order.ScheduledDate,
            order.LaborCost,
            order.PartsCost,
            order.TotalCost,
            WorkLogs = order.WorkLogs.Select(l => new
            {
                l.Id,
                l.StartTime,
                l.EndTime,
                l.ActivityType,
                l.Description,
                l.Duration
            })
        });
    }

    [HttpPost]
    public async Task<ActionResult<object>> Create([FromBody] CreateWorkOrderRequest request)
    {
        if (!await CanReachServiceAsync(request.ServiceId)) return Forbid();

        var order = new WorkOrder
        {
            Id = Guid.NewGuid(),
            WorkOrderNumber = await GenerateWorkOrderNumber(),
            Description = request.Description,
            ServiceId = request.ServiceId,
            TechnicianId = request.TechnicianId,
            Status = WorkOrderStatus.Pending,
            ScheduledDate = request.ScheduledDate,
            CreatedAt = DateTime.UtcNow
        };

        _context.WorkOrders.Add(order);
        await _context.SaveChangesAsync();

        return CreatedAtAction(nameof(GetById), new { id = order.Id }, order);
    }

    [HttpPatch("{id:guid}/status")]
    public async Task<IActionResult> UpdateStatus(Guid id, [FromBody] UpdateStatusRequest request)
    {
        var order = await _context.WorkOrders.FindAsync(id);
        if (order == null) return NotFound();
        if (!await CanReachServiceAsync(order.ServiceId)) return Forbid();

        order.Status = Enum.Parse<WorkOrderStatus>(request.Status);
        if (order.Status == WorkOrderStatus.Completed)
            order.CompletedAt = DateTime.UtcNow;

        order.UpdatedAt = DateTime.UtcNow;
        await _context.SaveChangesAsync();

        return NoContent();
    }

    [HttpDelete("{id:guid}")]
    public async Task<IActionResult> Delete(Guid id)
    {
        var order = await _context.WorkOrders
            .Include(o => o.WorkLogs)
            .FirstOrDefaultAsync(o => o.Id == id);
            
        if (order == null) return NotFound();
        if (!await CanReachServiceAsync(order.ServiceId)) return Forbid();

        if (order.WorkLogs != null && order.WorkLogs.Any())
        {
            _context.WorkLogs.RemoveRange(order.WorkLogs);
        }

        _context.WorkOrders.Remove(order);
        await _context.SaveChangesAsync();

        return NoContent();
    }

    private async Task<string> GenerateWorkOrderNumber()
    {
        var todayStr = DateTime.UtcNow.ToString("yyyyMMdd");
        var prefix = $"WO-{todayStr}-";
        var maxOrder = await _context.WorkOrders
            .Where(w => w.WorkOrderNumber != null && w.WorkOrderNumber.StartsWith(prefix))
            .OrderByDescending(w => w.WorkOrderNumber)
            .FirstOrDefaultAsync();

        int nextSeq = 1;
        if (maxOrder != null && maxOrder.WorkOrderNumber != null)
        {
            var parts = maxOrder.WorkOrderNumber.Split('-');
            if (parts.Length == 3 && int.TryParse(parts[2], out int lastSeq))
            {
                nextSeq = lastSeq + 1;
            }
        }

        return $"{prefix}{nextSeq:D4}";
    }
}

public class CreateWorkOrderRequest
{
    public string? Description { get; set; }
    public Guid ServiceId { get; set; }
    public Guid? TechnicianId { get; set; }
    public DateTime? ScheduledDate { get; set; }
}

public class UpdateStatusRequest
{
    public string Status { get; set; } = string.Empty;
}
