using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using ServiceOps.Application.Interfaces;
using ServiceOps.Application.Dtos;
using ServiceOps.Domain.Entities;
using ServiceOps.Infrastructure.Data;
using ServiceOps.Api.Services;

namespace ServiceOps.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
[Authorize]
public class WorkLogsController : ControllerBase
{
    private readonly ITechnicianService _technicianService;
    private readonly ApplicationDbContext _context;
    private readonly IServiceOpsPermissionService _permissions;

    public WorkLogsController(
        ITechnicianService technicianService,
        ApplicationDbContext context,
        IServiceOpsPermissionService permissions)
    {
        _technicianService = technicianService;
        _context = context;
        _permissions = permissions;
    }

    [HttpPost]
    public async Task<ActionResult<WorkLog>> Create([FromBody] CreateWorkLogRequest request)
    {
        // TEKNİSYEN BAŞKASI ADINA ÇALIŞMA KAYDI AÇAMAZ. `TechnicianId` gövdeden geliyordu ve
        // hiç doğrulanmıyordu: bir teknisyen istediği teknisyenin üzerine mesai (ve hak edişe
        // giren süre) yazabiliyordu. Ofis/yönetici kullanıcılar için davranış değişmedi.
        if (_permissions.IsTechnicianUser(User))
        {
            var ownTechnicianId = _permissions.GetTechnicianId(User);
            if (!ownTechnicianId.HasValue || request.TechnicianId != ownTechnicianId.Value)
            {
                return Forbid();
            }
        }

        var log = new WorkLog
        {
            Id = Guid.NewGuid(),
            TechnicianId = request.TechnicianId,
            WorkOrderId = request.WorkOrderId,
            ServiceId = request.ServiceId,
            StartTime = request.StartTime,
            EndTime = request.EndTime,
            // Süre gönderilmediyse başlangıç/bitişten TÜRETİLİR. Öncesinde `Duration` boş
            // geldiğinde kayıt süresiz yazılıyor ve aşağıdaki `AddWorkDurationAsync` hiç
            // çağrılmıyordu: teknisyenin toplam çalışma süresine o iş HİÇ eklenmiyordu,
            // oysa başlangıç ve bitiş saati elimizdeydi.
            Duration = request.Duration
                       ?? (request.EndTime.HasValue && request.EndTime.Value > request.StartTime
                           ? request.EndTime.Value - request.StartTime
                           : null),
            ActivityType = request.ActivityType,
            Description = request.Description,
            Notes = request.Notes,
            StartLatitude = request.StartLatitude,
            StartLongitude = request.StartLongitude,
            EndLatitude = request.EndLatitude,
            EndLongitude = request.EndLongitude,
            IsBillable = request.IsBillable,
            HourlyRate = request.HourlyRate,
            TotalCost = request.TotalCost,
            CreatedAt = DateTime.UtcNow
        };

        _context.WorkLogs.Add(log);
        await _context.SaveChangesAsync();

        if (log.Duration.HasValue && log.Duration.Value > TimeSpan.Zero)
        {
            await _technicianService.AddWorkDurationAsync(request.TechnicianId, log.Duration.Value);
        }

        return CreatedAtAction(nameof(GetById), new { id = log.Id }, log);
    }

    [HttpGet("{id:guid}")]
    public async Task<ActionResult<WorkLog>> GetById(Guid id)
    {
        var log = await _context.WorkLogs
            .Include(l => l.Technician)
            .Include(l => l.WorkOrder)
            .Include(l => l.Service)
            .FirstOrDefaultAsync(l => l.Id == id);

        if (log == null) return NotFound();
        return Ok(log);
    }

    [HttpGet]
    public async Task<ActionResult<List<WorkLog>>> GetAll([FromQuery] Guid? technicianId)
    {
        var query = _context.WorkLogs
            .Include(l => l.Technician)
            .Include(l => l.WorkOrder)
            .Include(l => l.Service)
            .AsQueryable();

        // TEKNİSYEN YALNIZ KENDİ KAYITLARINI GÖRÜR. Liste hiç süzülmüyordu: `technicianId`
        // parametresi verilmediğinde herkesin çalışma kaydı, saatlik ücreti ve maliyeti
        // dönüyordu. Ofis/yönetici kullanıcı için davranış değişmedi.
        if (_permissions.IsTechnicianUser(User))
        {
            var ownTechnicianId = _permissions.GetTechnicianId(User);
            if (!ownTechnicianId.HasValue) return Ok(new List<WorkLog>());

            query = query.Where(l => l.TechnicianId == ownTechnicianId.Value);
        }
        else if (technicianId.HasValue)
        {
            query = query.Where(l => l.TechnicianId == technicianId);
        }

        return Ok(await query.OrderByDescending(l => l.StartTime).ToListAsync());
    }
}

public class CreateWorkLogRequest
{
    public Guid TechnicianId { get; set; }
    public Guid? WorkOrderId { get; set; }
    public Guid? ServiceId { get; set; }
    public DateTime StartTime { get; set; }
    public DateTime? EndTime { get; set; }
    public TimeSpan? Duration { get; set; }
    public WorkActivityType ActivityType { get; set; } = WorkActivityType.Work;
    public string? Description { get; set; }
    public string? Notes { get; set; }
    public double? StartLatitude { get; set; }
    public double? StartLongitude { get; set; }
    public double? EndLatitude { get; set; }
    public double? EndLongitude { get; set; }
    public bool IsBillable { get; set; } = true;
    public decimal? HourlyRate { get; set; }
    public decimal? TotalCost { get; set; }
}
