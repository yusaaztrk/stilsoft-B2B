using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using System.Security.Claims;
using ServiceOps.Domain.Entities;
using ServiceOps.Infrastructure.Data;
using System.Collections.Generic;

namespace ServiceOps.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
[Authorize]
public class PlanningController : ControllerBase
{
    private readonly ApplicationDbContext _context;

    private readonly ServiceOps.Api.Services.IJobAssignmentNotifier _assignmentNotifier;
    private readonly ServiceOps.Api.Services.IServiceOpsPermissionService _permissions;

    public PlanningController(
        ApplicationDbContext context,
        ServiceOps.Api.Services.IJobAssignmentNotifier assignmentNotifier,
        ServiceOps.Api.Services.IServiceOpsPermissionService permissions)
    {
        _context = context;
        _assignmentNotifier = assignmentNotifier;
        _permissions = permissions;
    }

    /// <summary>Planlama ekranının beslendiği sayfalar; herhangi birine yetki yeterli.</summary>
    private static readonly string[] PlanningPages =
    {
        "atolyeAriza", "atolyeAriza.atolye", "atolyeAriza.hazirTeslimat", "atolyeAriza.teslimattakiler",
        "buyukUrun", "buyukUrun.planlama", "buyukUrun.sahaPlanlama", "buyukUrun.atolye",
        "buyukUrun.hazirTeslimat", "buyukUrun.teslimattakiler",
        "montajYonetimi", "montajYonetimi.planlama", "montajYonetimi.teslimat"
    };

    private async Task<bool> CanUsePlanningAsync(CancellationToken cancellationToken)
    {
        foreach (var key in PlanningPages)
        {
            if (await _permissions.HasPageAsync(User, key, cancellationToken)) return true;
        }
        return false;
    }

    /// <summary>
    /// Planlamada atanan servis kayıtlarını sahiplerine duyurur.
    /// Kayıtlar zaten belleğe alınmış olduğu için ek sorgu yapılmaz.
    /// </summary>
    private Task NotifyPlanningAssignmentsAsync(
        IEnumerable<(ServiceRecord Service, Guid TechnicianId, DateTime? PlannedAt)> assigned,
        CancellationToken cancellationToken)
    {
        var jobs = assigned.Select(a =>
        {
            var parts = new[] { a.Service.ServiceNumber, a.Service.ProductName, a.Service.CustomerName }
                .Where(p => !string.IsNullOrWhiteSpace(p));
            return new ServiceOps.Api.Services.JobAssignment(
                a.TechnicianId,
                a.Service.Type == ServiceType.Installation
                    ? ServiceOps.Api.Services.JobKind.Installation
                    : ServiceOps.Api.Services.JobKind.Service,
                a.Service.Id,
                string.Join(" · ", parts),
                1,
                a.PlannedAt ?? a.Service.PlannedAt);
        }).ToList();

        return _assignmentNotifier.NotifyAsync(jobs, cancellationToken);
    }

    public sealed class DayPlanResponse
    {
        public DateTime Date { get; set; }
        public int PlannedServices { get; set; }
        public int PlannedRoutes { get; set; }
        public List<object> Services { get; set; } = new();
        public List<object> Routes { get; set; } = new();
    }

    public sealed class BulkPlanRequest
    {
        public List<Guid> ServiceIds { get; set; } = new();
        public DateTime PlannedDateUtc { get; set; }
    }

    public sealed class BulkAssignRequest
    {
        public List<Guid> ServiceIds { get; set; } = new();
        public Guid TechnicianId { get; set; }
    }

    public sealed class SmartAssignRequest
    {
        public DateTime? PlannedDateUtc { get; set; }
        public Guid? RegionId { get; set; }
        public ServiceType? Type { get; set; }
        public ServiceStatus? Status { get; set; }
        public int MaxToAssign { get; set; } = 50;
        public bool? PreviewOnly { get; set; }
    }

    /// <summary>
    /// BU METOT `return false;` İDİ — RoutesController'daki ikiziyle aynı hata.
    ///
    /// Sonuç: `bulk-plan`, `bulk-assign` ve `smart-assign` uçlarındaki
    /// `if (IsTechnicianUser()) return Forbid();` satırlarının hiçbiri çalışmıyordu; koşul
    /// hiçbir zaman doğru olmuyordu. Bir saha teknisyeni toplu planlama ve otomatik atama
    /// yapabiliyordu.
    /// </summary>
    private bool IsTechnicianUser() => _permissions.IsTechnicianUser(User);

    /// <summary>
    /// Verilen anın takvim gününü UTC gün başlangıcı olarak verir.
    ///
    /// Npgsql, `timestamp with time zone` kolonlarına yalnızca Kind=Utc DateTime kabul eder;
    /// sorgu dizesinden ya da JSON gövdeden gelen tarihler Kind=Unspecified olarak bağlanır ve
    /// doğrudan kullanıldıklarında sorgu çalışma anında patlar.
    /// </summary>
    private static DateTime AsUtcDay(DateTime value)
        => DateTime.SpecifyKind(value.Date, DateTimeKind.Utc);

    [HttpGet("day")]
    public async Task<ActionResult<DayPlanResponse>> GetDay([FromQuery] DateTime dateUtc, CancellationToken cancellationToken)
    {
        // Gün planı bütün müşteri/teknisyen dağılımını döküyor ve hiçbir yetki aramıyordu.
        if (!await CanUsePlanningAsync(cancellationToken)) return Forbid();

        // Gün sınırı UTC olarak işaretlenmeli. Sorgu dizesinden gelen tarih (`?dateUtc=2026-08-10`)
        // model binding sonrası Kind=Unspecified oluyor; Npgsql `timestamp with time zone`
        // kolonuna Unspecified bir DateTime yazmayı reddediyor ve uç HER ÇAĞRIDA 500 dönüyordu.
        // Parametre zaten "dateUtc" adını taşıyor: verilen takvim günü UTC günü olarak alınır.
        var day = AsUtcDay(dateUtc == default ? DateTime.UtcNow : dateUtc);
        var next = day.AddDays(1);

        var plannedServices = await _context.ServiceRecords
            .Include(s => s.AssignedTechnician)
            .Where(s => s.EstimatedDeliveryDate != null && s.EstimatedDeliveryDate >= day && s.EstimatedDeliveryDate < next)
            .OrderBy(s => s.EstimatedDeliveryDate)
            .ThenByDescending(s => s.Priority)
            .Take(500)
            .Select(s => new
            {
                id = s.Id,
                serviceNumber = s.ServiceNumber,
                type = s.Type.ToString(),
                status = s.Status.ToString(),
                plannedDateUtc = s.EstimatedDeliveryDate,
                customerName = s.CustomerName,
                customerPhone = s.CustomerPhone,
                customerAddress = s.CustomerAddress,
                productName = s.ProductName,
                productStockCode = s.ProductStockCode,
                regionId = s.RegionId,
                technicianId = s.AssignedTechnicianId,
                // FullName bir kolon değil, C#'ta hesaplanan bir özellik; SQL'e çevrilemez.
                // Mapped kolonlar birleştiriliyor (bunu EF çevirebiliyor).
                technicianName = s.AssignedTechnician != null
                    ? s.AssignedTechnician.FirstName + " " + s.AssignedTechnician.LastName
                    : null,
            })
            .ToListAsync(cancellationToken);

        var plannedRoutes = await _context.Routes
            .Include(r => r.Technician)
            .Include(r => r.Region)
            .Where(r => r.PlannedDate >= day && r.PlannedDate < next)
            .OrderBy(r => r.PlannedDate)
            .Take(200)
            .Select(r => new
            {
                id = r.Id,
                routeNumber = r.RouteNumber,
                name = r.Name,
                plannedDateUtc = r.PlannedDate,
                status = r.Status.ToString(),
                technicianId = r.TechnicianId,
                technicianName = r.Technician != null
                    ? r.Technician.FirstName + " " + r.Technician.LastName
                    : null,
                regionId = r.RegionId,
                regionName = r.Region != null ? r.Region.Name : null,
                stops = r.Stops.Count
            })
            .ToListAsync(cancellationToken);

        return Ok(new DayPlanResponse
        {
            Date = day,
            PlannedServices = plannedServices.Count,
            PlannedRoutes = plannedRoutes.Count,
            Services = plannedServices.Cast<object>().ToList(),
            Routes = plannedRoutes.Cast<object>().ToList(),
        });
    }

    [HttpPost("bulk-plan")]
    public async Task<ActionResult<object>> BulkPlan([FromBody] BulkPlanRequest request, CancellationToken cancellationToken)
    {
        if (IsTechnicianUser()) return Forbid();
        if (request.ServiceIds == null || request.ServiceIds.Count == 0)
            return BadRequest(new { success = false, message = "ServiceIds zorunlu" });

        var ids = request.ServiceIds.Distinct().ToList();

        var services = await _context.ServiceRecords
            .Where(s => ids.Contains(s.Id))
            .ToListAsync(cancellationToken);

        if (services.Count == 0)
            return NotFound(new { success = false, message = "Servis kaydı bulunamadı" });

        foreach (var s in services)
        {
            s.EstimatedDeliveryDate = request.PlannedDateUtc;
            s.PlannedAt = request.PlannedDateUtc;
            if (s.Status == ServiceStatus.New)
                s.Status = ServiceStatus.Planned;
            s.UpdatedAt = DateTime.UtcNow;

            if (s.Type == ServiceType.Installation)
            {
                await UpdateOrCreateInstallationTasksForService(s, s.AssignedTechnicianId, request.PlannedDateUtc, _context, cancellationToken);
            }
        }

        await _context.SaveChangesAsync(cancellationToken);

        return Ok(new { success = true, updated = services.Count });
    }

    [HttpPost("bulk-assign")]
    public async Task<ActionResult<object>> BulkAssign([FromBody] BulkAssignRequest request, CancellationToken cancellationToken)
    {
        if (IsTechnicianUser()) return Forbid();
        if (request.ServiceIds == null || request.ServiceIds.Count == 0)
            return BadRequest(new { success = false, message = "ServiceIds zorunlu" });

        var tech = await _context.Technicians.FirstOrDefaultAsync(t => t.Id == request.TechnicianId, cancellationToken);
        if (tech == null) return NotFound(new { success = false, message = "Teknisyen bulunamadı" });

        var ids = request.ServiceIds.Distinct().ToList();
        var services = await _context.ServiceRecords
            .Where(s => ids.Contains(s.Id))
            .ToListAsync(cancellationToken);

        if (services.Count == 0)
            return NotFound(new { success = false, message = "Servis kaydı bulunamadı" });

        // Zaten o kişide olan kayıt yeniden duyurulmaz.
        var newlyAssigned = services.Where(s => s.AssignedTechnicianId != tech.Id).ToList();

        foreach (var s in services)
        {
            s.AssignedTechnicianId = tech.Id;
            s.UpdatedAt = DateTime.UtcNow;

            if (s.Type == ServiceType.Installation)
            {
                await UpdateOrCreateInstallationTasksForService(s, tech.Id, s.PlannedAt, _context, cancellationToken);
            }
        }

        await _context.SaveChangesAsync(cancellationToken);

        await NotifyPlanningAssignmentsAsync(
            newlyAssigned.Select(s => (s, tech.Id, s.PlannedAt)), cancellationToken);

        return Ok(new { success = true, updated = services.Count });
    }

    [HttpPost("smart-assign")]
    public async Task<ActionResult<object>> SmartAssign([FromBody] SmartAssignRequest request, CancellationToken cancellationToken)
    {
        if (IsTechnicianUser()) return Forbid();
        const string SmartAssignVersion = "smart-assign/1.0.0";
        var max = request.MaxToAssign <= 0 ? 50 : Math.Min(request.MaxToAssign, 500);

        var day = AsUtcDay(request.PlannedDateUtc ?? DateTime.UtcNow);
        var next = day.AddDays(1);

        var allActiveTechs = await _context.Technicians
            .Where(t => t.Status == TechnicianStatus.Available && t.IsActive)
            .OrderByDescending(t => t.Rating)
            .ThenBy(t => t.CompletedTasks)
            .Take(100)
            .ToListAsync(cancellationToken);

        var techs = allActiveTechs.ToList();

        // Capacity filter (planned services + planned route stops)
        if (techs.Count > 0)
        {
            var techIds = techs.Select(t => t.Id).ToList();

            var serviceLoads = await _context.ServiceRecords
                .AsNoTracking()
                .Where(s => s.AssignedTechnicianId != null
                            && techIds.Contains(s.AssignedTechnicianId.Value)
                            && s.PlannedAt != null
                            && s.PlannedAt >= day && s.PlannedAt < next
                            && s.Status != ServiceStatus.Delivered
                            && s.Status != ServiceStatus.Cancelled)
                .GroupBy(s => s.AssignedTechnicianId!.Value)
                .Select(g => new { TechnicianId = g.Key, Count = g.Count() })
                .ToListAsync(cancellationToken);

            var routeLoads = await _context.Routes
                .AsNoTracking()
                .Where(r => r.TechnicianId != null
                            && techIds.Contains(r.TechnicianId.Value)
                            && r.PlannedDate >= day && r.PlannedDate < next)
                .GroupBy(r => r.TechnicianId!.Value)
                .Select(g => new { TechnicianId = g.Key, Stops = g.Sum(x => x.TotalStops) })
                .ToListAsync(cancellationToken);

            var serviceMap = serviceLoads.ToDictionary(x => x.TechnicianId, x => x.Count);
            var routeMap = routeLoads.ToDictionary(x => x.TechnicianId, x => x.Stops);

            // SÜZGEÇ HESAPLANIP UYGULANMIYORDU. `serviceMap` ve `routeMap` kuruluyor, sonra
            // blok bitiyordu: `techs` hiç daraltılmadığı için günü dolmuş teknisyene ikinci,
            // üçüncü iş atanabiliyordu — yani kapasite kontrolü fiilen YOKTU (yalnızca rota
            // duraklarının sayılmaması değil, tamamı). Aşağıdaki tanı bloğu ise aynı hesabı
            // doğru yapıyordu; iki taraf birbirini tutmuyordu.
            //
            // MESAİ SAATİ: tarih SAATSİZ geldiğinde (00:00) "o gün" demektir, belirli bir saat
            // değil. Eskiden saat karşılaştırması bu durumda da yapılıyor ve `08:30 <= 00:00`
            // hiçbir teknisyende sağlanmadığı için "müsait teknisyen yok" çıkıyordu. Artık
            // saat verilmişse mesai aralığı aranıyor, verilmemişse gün bazında bakılıyor.
            var requestedTimeOfDay = request.PlannedDateUtc?.TimeOfDay;
            var hasExplicitTime = requestedTimeOfDay.HasValue && requestedTimeOfDay.Value != TimeSpan.Zero;

            techs = techs.Where(t =>
            {
                var cap = t.MaxDailyTasks <= 0 ? 8 : t.MaxDailyTasks;
                var svc = serviceMap.TryGetValue(t.Id, out var c) ? c : 0;
                var stops = routeMap.TryGetValue(t.Id, out var s) ? s : 0;
                if (svc + stops >= cap) return false;

                if (hasExplicitTime)
                {
                    var tod = requestedTimeOfDay!.Value;
                    if (t.WorkStartTime > tod || tod > t.WorkEndTime) return false;
                }

                return true;
            }).ToList();
        }

        if (techs.Count == 0)
        {
            var reasons = new Dictionary<string, object?>();

            var activeCount = allActiveTechs.Count;
            reasons["activeCount"] = activeCount;

            int regionMatched = activeCount;
            if (request.RegionId != null)
                regionMatched = allActiveTechs.Count(t => t.PrimaryRegionId == request.RegionId);
            reasons["regionMatched"] = regionMatched;

            // Tanı satırı da aynı kuralı kullanmalı: saatsiz tarihte mesai saati aranmaz,
            // yoksa ekranda "mesai dışı" diye yanlış bir sebep gösterilirdi.
            int withinWorkingHours = regionMatched;
            if (request.PlannedDateUtc != null && request.PlannedDateUtc.Value.TimeOfDay != TimeSpan.Zero)
            {
                var tod = request.PlannedDateUtc.Value.TimeOfDay;
                withinWorkingHours = allActiveTechs.Count(t =>
                    (request.RegionId == null || t.PrimaryRegionId == request.RegionId)
                    && t.WorkStartTime <= tod && tod <= t.WorkEndTime);
            }
            reasons["withinWorkingHours"] = withinWorkingHours;

            var dayCap = AsUtcDay(request.PlannedDateUtc ?? DateTime.UtcNow);
            var nextCap = dayCap.AddDays(1);
            var capTechIds = allActiveTechs.Select(t => t.Id).ToList();

            var serviceLoadsCap = await _context.ServiceRecords
                .AsNoTracking()
                .Where(s => s.AssignedTechnicianId != null
                            && capTechIds.Contains(s.AssignedTechnicianId.Value)
                            && s.PlannedAt != null
                            && s.PlannedAt >= dayCap && s.PlannedAt < nextCap
                            && s.Status != ServiceStatus.Delivered
                            && s.Status != ServiceStatus.Cancelled)
                .GroupBy(s => s.AssignedTechnicianId!.Value)
                .Select(g => new { TechnicianId = g.Key, Count = g.Count() })
                .ToListAsync(cancellationToken);

            var routeLoadsCap = await _context.Routes
                .AsNoTracking()
                .Where(r => r.TechnicianId != null
                            && capTechIds.Contains(r.TechnicianId.Value)
                            && r.PlannedDate >= dayCap && r.PlannedDate < nextCap)
                .GroupBy(r => r.TechnicianId!.Value)
                .Select(g => new { TechnicianId = g.Key, Stops = g.Sum(x => x.TotalStops) })
                .ToListAsync(cancellationToken);

            var serviceMapCap = serviceLoadsCap.ToDictionary(x => x.TechnicianId, x => x.Count);
            var routeMapCap = routeLoadsCap.ToDictionary(x => x.TechnicianId, x => x.Stops);

            var capacityEligible = allActiveTechs.Count(t =>
            {
                var cap = t.MaxDailyTasks <= 0 ? 8 : t.MaxDailyTasks;
                var svc = serviceMapCap.TryGetValue(t.Id, out var c) ? c : 0;
                var stops = routeMapCap.TryGetValue(t.Id, out var s) ? s : 0;
                var todCap = request.PlannedDateUtc?.TimeOfDay;
                var checkHours = todCap.HasValue && todCap.Value != TimeSpan.Zero;

                return (svc + stops) < cap
                       && (request.RegionId == null || t.PrimaryRegionId == request.RegionId)
                       && (!checkHours || (t.WorkStartTime <= todCap!.Value && todCap.Value <= t.WorkEndTime));
            });
            reasons["capacityEligible"] = capacityEligible;

            return Ok(new { success = true, updated = 0, message = "Müsait teknisyen yok", reasons });
        }

        var q = _context.ServiceRecords.AsQueryable();

        q = q.Where(s => s.AssignedTechnicianId == null);

        if (request.PlannedDateUtc == null)
        {
            q = q.Where(s => s.EstimatedDeliveryDate != null);
        }

        if (request.RegionId != null)
            q = q.Where(s => s.RegionId == request.RegionId);

        if (request.Type != null)
            q = q.Where(s => s.Type == request.Type);

        if (request.Status != null)
            q = q.Where(s => s.Status == request.Status);
        else
            q = q.Where(s => s.Status != ServiceStatus.Delivered && s.Status != ServiceStatus.Cancelled);

        var services = await q
            .OrderByDescending(s => s.Priority)
            .ThenBy(s => s.EstimatedDeliveryDate)
            .ThenBy(s => s.CreatedAt)
            .Take(max)
            .ToListAsync(cancellationToken);

        if (services.Count == 0)
            return Ok(new { success = true, updated = 0, message = "Atanacak kayıt yok" });

        var distanceWeight = 0.7;
        var loadWeight = 0.3;

        var dayStart = AsUtcDay(request.PlannedDateUtc ?? DateTime.UtcNow);
        var dayEnd = dayStart.AddDays(1);

        var lastJobs = await _context.ServiceRecords.AsNoTracking()
            .Where(x => x.AssignedTechnicianId != null && techs.Select(t => t.Id).Contains(x.AssignedTechnicianId!.Value)
                        && x.PlannedAt != null && x.PlannedAt >= dayStart && x.PlannedAt < dayEnd
                        && x.Latitude != null && x.Longitude != null)
            .OrderByDescending(x => x.PlannedAt)
            .Select(x => new { x.AssignedTechnicianId, x.Latitude, x.Longitude })
            .ToListAsync(cancellationToken);
        var lastJobMap = lastJobs.GroupBy(x => x.AssignedTechnicianId!.Value)
            .ToDictionary(g => g.Key, g => (Lat: g.First().Latitude!.Value, Lon: g.First().Longitude!.Value));

        var assignedCounts = techs.ToDictionary(t => t.Id, t => 0);
        var targetPerTech = (int)Math.Ceiling((double)services.Count / Math.Max(1, techs.Count));

        var totalDistance = 0.0;
        var distanceCount = 0;
        var missingCoordinates = services.Any(s => s.Latitude == null || s.Longitude == null);
        var fallbackAssignments = 0;
        var unassignedCapacity = 0;
        var unassignedRegion = 0;
        var unassignedWorkingHours = 0;
        var assignments = new List<object>();
        // Bildirim için ayrı, TİPLİ liste: yukarıdaki `assignments` yanıt gövdesi için anonim.
        var notifiable = new List<(ServiceRecord Service, Guid TechnicianId, DateTime? PlannedAt)>();

        foreach (var s in services)
        {
            var hasCoord = s.Latitude != null && s.Longitude != null;
            Technician? chosen = null;

            var candidates = new List<(Technician tech, double score, double? distanceKm)>();
            foreach (var t in techs)
            {
                double? refLat = null, refLon = null;
                if (lastJobMap.TryGetValue(t.Id, out var p)) { refLat = p.Lat; refLon = p.Lon; }
                else if (t.CurrentLatitude.HasValue && t.CurrentLongitude.HasValue) { refLat = t.CurrentLatitude.Value; refLon = t.CurrentLongitude.Value; }

                double distanceKm = 0;
                double distanceScore = 0.0;
                if (hasCoord && refLat.HasValue && refLon.HasValue)
                {
                    distanceKm = Haversine(s.Latitude!.Value, s.Longitude!.Value, refLat.Value, refLon.Value);
                    distanceScore = Math.Max(0.0, 1.0 - Math.Min(distanceKm, 30.0) / 30.0);
                }
                else
                {
                    distanceScore = 0.5;
                }

                var load = assignedCounts[t.Id];
                var loadScore = 1.0 - Math.Min(1.0, (double)load / Math.Max(1, targetPerTech));

                var score = distanceWeight * distanceScore + loadWeight * loadScore;
                candidates.Add((t, score, hasCoord ? distanceKm : null));
            }

            if (candidates.Count == 0)
            {
                chosen = techs.OrderBy(t => assignedCounts[t.Id]).FirstOrDefault();
                if (chosen != null) fallbackAssignments++;
            }
            else
            {
                chosen = candidates.OrderByDescending(c => c.score).Select(c => c.tech).First();
                var best = candidates.OrderByDescending(c => c.score).First();
                if (best.distanceKm.HasValue) { totalDistance += best.distanceKm.Value; distanceCount++; }
            }

            if (chosen == null)
            {
                if (request.RegionId != null) unassignedRegion++; else if (request.PlannedDateUtc != null) unassignedWorkingHours++; else unassignedCapacity++;
                continue;
            }

            if (s.AssignedTechnicianId != chosen.Id)
            {
                notifiable.Add((s, chosen.Id, request.PlannedDateUtc ?? s.PlannedAt));
            }

            s.AssignedTechnicianId = chosen.Id;
            if (request.PlannedDateUtc != null)
            {
                s.EstimatedDeliveryDate = request.PlannedDateUtc;
                s.PlannedAt = request.PlannedDateUtc;
            }
            if (s.Status == ServiceStatus.New) s.Status = ServiceStatus.Planned;
            s.UpdatedAt = DateTime.UtcNow;
            assignedCounts[chosen.Id] = assignedCounts[chosen.Id] + 1;

            if (s.Type == ServiceType.Installation)
            {
                await UpdateOrCreateInstallationTasksForService(s, chosen.Id, request.PlannedDateUtc ?? s.PlannedAt, _context, cancellationToken);
            }

            assignments.Add(new
            {
                serviceId = s.Id,
                serviceNumber = s.ServiceNumber,
                customerName = s.CustomerName,
                productName = s.ProductName,
                technicianId = chosen.Id,
                technicianName = chosen.FullName,
                plannedDate = request.PlannedDateUtc ?? s.EstimatedDeliveryDate
            });
        }

        var updated = services.Count(s => s.AssignedTechnicianId != null);

        var summary = new
        {
            assignedCount = updated,
            unassignedCount = services.Count - updated,
            technicianLoads = assignedCounts.Select(kv => new { technicianId = kv.Key, count = kv.Value }),
            averageDistance = distanceCount == 0 ? (double?)null : totalDistance / distanceCount,
            fallbackAssignments
        };

        var reasonsObj = (object?)null;
        var reasonsDict = new Dictionary<string, object?>();
        if (techs.Count == 0)
        {
            reasonsDict["missingCoordinates"] = missingCoordinates;
            reasonsObj = reasonsDict;
        }

        var unassignedReasons = new { capacity = unassignedCapacity, region = unassignedRegion, workingHours = unassignedWorkingHours };

        if (request.PreviewOnly == true)
        {
            return Ok(new
            {
                success = true,
                updated,
                previewOnly = true,
                assignments,
                summary,
                reasons = reasonsObj,
                unassignedReasons,
                SmartAssignVersion
            });
        }

        await _context.SaveChangesAsync(cancellationToken);
        await NotifyPlanningAssignmentsAsync(notifiable, cancellationToken);
        return Ok(new { success = true, updated, summary, reasons = reasonsObj, unassignedReasons, SmartAssignVersion });
    }

    private async Task UpdateOrCreateInstallationTasksForService(ServiceRecord service, Guid? technicianId, DateTime? plannedDate, ApplicationDbContext context, CancellationToken cancellationToken)
    {
        var tasks = await context.InstallationTasks
            .Where(t => t.ServiceId == service.Id)
            .ToListAsync(cancellationToken);

        if (tasks.Count == 0)
        {
            var desc = service.ProblemDescription ?? "";
            var m = System.Text.RegularExpressions.Regex.Match(desc, @"Miktar\s*:\s*(\d+)", System.Text.RegularExpressions.RegexOptions.IgnoreCase);
            int totalQty = m.Success ? (int.TryParse(m.Groups[1].Value, out var q) ? q : 1) : 1;
            if (totalQty <= 0) totalQty = 1;

            for (int i = 0; i < totalQty; i++)
            {
                var task = new InstallationTask
                {
                    Id = Guid.NewGuid(),
                    ServiceId = service.Id,
                    AssignedTechnicianId = technicianId,
                    PlannedAt = plannedDate,
                    Status = technicianId.HasValue ? InstallationTaskStatus.Planned : InstallationTaskStatus.Deferred,
                    Quantity = 1,
                    CustomAddress = service.CustomerAddress,
                    CreatedAt = DateTime.UtcNow,
                    UpdatedAt = DateTime.UtcNow,
                    Notes = technicianId.HasValue ? "Akıllı/Toplu atama ile planlandı" : "Otomatik oluşturuldu"
                };
                context.InstallationTasks.Add(task);
            }
        }
        else
        {
            foreach (var task in tasks)
            {
                if (technicianId.HasValue)
                {
                    task.AssignedTechnicianId = technicianId.Value;
                    if (task.Status == InstallationTaskStatus.Deferred)
                    {
                        task.Status = InstallationTaskStatus.Planned;
                    }
                }
                if (plannedDate.HasValue)
                {
                    task.PlannedAt = plannedDate.Value;
                }
                task.UpdatedAt = DateTime.UtcNow;
            }
        }
    }

    private static double ToRad(double deg) => deg * Math.PI / 180.0;
    private static double Haversine(double lat1, double lon1, double lat2, double lon2)
    {
        var R = 6371.0; // km
        var dLat = ToRad(lat2 - lat1);
        var dLon = ToRad(lon2 - lon1);
        var a = Math.Sin(dLat / 2) * Math.Sin(dLat / 2) + Math.Cos(ToRad(lat1)) * Math.Cos(ToRad(lat2)) * Math.Sin(dLon / 2) * Math.Sin(dLon / 2);
        var c = 2 * Math.Atan2(Math.Sqrt(a), Math.Sqrt(1 - a));
        return R * c;
    }
}
