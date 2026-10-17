using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using ServiceOps.Domain.Entities;
using ServiceOps.Infrastructure.Data;

namespace ServiceOps.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
[Authorize]
public class AnalyticsController : ControllerBase
{
    private readonly ApplicationDbContext _context;

    public AnalyticsController(ApplicationDbContext context)
    {
        _context = context;
    }

    [HttpGet("overview")]
    public async Task<ActionResult<object>> GetOverview([FromQuery] DateTime? from, [FromQuery] DateTime? to, CancellationToken cancellationToken)
    {
        var now = DateTime.UtcNow;
        var start = from ?? new DateTime(now.Year, now.Month, 1, 0, 0, 0, DateTimeKind.Utc);
        var end = to ?? start.AddMonths(1);

        var servicesInRange = _context.ServiceRecords.Where(s => s.CreatedAt >= start && s.CreatedAt < end);

        var completedInRange = servicesInRange.Where(s => s.Status == ServiceStatus.Delivered);
        var completedCount = await completedInRange.CountAsync(cancellationToken);

        var totalCount = await servicesInRange.CountAsync(cancellationToken);

        var today = DateTime.UtcNow.Date;
        var completedToday = await _context.ServiceRecords.CountAsync(s => s.CompletedAt != null && s.CompletedAt.Value.Date == today, cancellationToken);

        var completedTimes = await completedInRange
            .Where(s => s.CompletedAt != null)
            .Select(s => new { s.CreatedAt, CompletedAt = s.CompletedAt!.Value })
            .ToListAsync(cancellationToken);

        var avgRepairDays = completedTimes.Count == 0
            ? 0
            : completedTimes.Average(x => (x.CompletedAt - x.CreatedAt).TotalDays);

        var activeTechs = await _context.Technicians.CountAsync(t => t.IsActive && t.Status != TechnicianStatus.Inactive, cancellationToken);

        var statusCounts = await servicesInRange
            .GroupBy(s => s.Status)
            .Select(g => new { status = g.Key.ToString(), count = g.Count() })
            .ToListAsync(cancellationToken);

        var regionNameById = await _context.Regions
            .Select(r => new { r.Id, r.Name })
            .ToDictionaryAsync(x => x.Id, x => x.Name, cancellationToken);

        var regionDistributionRaw = await servicesInRange
            .GroupBy(s => s.RegionId)
            .Select(g => new { regionId = g.Key, count = g.Count() })
            .OrderByDescending(x => x.count)
            .Take(10)
            .ToListAsync(cancellationToken);

        var regionDistribution = regionDistributionRaw
            .Select(x => new
            {
                region = x.regionId == null ? "Bölge Yok" : (regionNameById.TryGetValue(x.regionId.Value, out var name) ? name : "-"),
                x.count
            })
            .ToList();

        // Gruplama, VERİTABANINDA KARŞILIĞI OLAN kolonlara göre yapılır.
        //
        // Burada `AssignedTechnician!.FullName` ile gruplanıyordu. `Technician.FullName` bir
        // kolon değil, C# tarafında hesaplanan bir özellik (`$"{FirstName} {LastName}"`), yani
        // SQL'e çevrilemez. EF sorguyu çeviremeyip InvalidOperationException fırlatıyordu ve uç
        // HER ÇAĞRIDA 500 dönüyordu — Analiz ekranı bu yüzden hiç açılmıyordu.
        // Ad/soyad ayrı ayrı gruplanıp tam ad listeye çevrildikten SONRA birleştiriliyor.
        var technicianPerformanceRaw = await _context.ServiceRecords
            .Where(s => s.AssignedTechnicianId != null && s.CreatedAt >= start && s.CreatedAt < end)
            .GroupBy(s => new
            {
                s.AssignedTechnicianId,
                s.AssignedTechnician!.FirstName,
                s.AssignedTechnician!.LastName
            })
            .Select(g => new
            {
                technicianId = g.Key.AssignedTechnicianId,
                g.Key.FirstName,
                g.Key.LastName,
                completed = g.Count(x => x.Status == ServiceStatus.Delivered),
                pending = g.Count(x => x.Status != ServiceStatus.Delivered && x.Status != ServiceStatus.Cancelled)
            })
            .OrderByDescending(x => x.completed)
            .Take(10)
            .ToListAsync(cancellationToken);

        var technicianPerformance = technicianPerformanceRaw
            .Select(x => new
            {
                x.technicianId,
                fullName = $"{x.FirstName} {x.LastName}".Trim(),
                x.completed,
                x.pending
            })
            .ToList();

        return Ok(new
        {
            range = new { from = start, to = end },
            totals = new
            {
                totalServices = totalCount,
                completedServices = completedCount,
                completedToday,
                activeTechnicians = activeTechs,
                averageRepairDays = Math.Round(avgRepairDays, 2)
            },
            statusCounts,
            regionDistribution,
            technicianPerformance
        });
    }
}
