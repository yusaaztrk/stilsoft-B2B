using Microsoft.EntityFrameworkCore;
using ServiceOps.Application.Dtos;
using ServiceOps.Application.Interfaces;
using ServiceOps.Domain.Entities;
using ServiceOps.Infrastructure.Data;
using System.Security.Cryptography;
using System.Text;

namespace ServiceOps.Application.Services;

public class TechnicianService : ITechnicianService
{
    private readonly ApplicationDbContext _context;

    private sealed record TechnicianMetrics(
        int PlannedServicesToday,
        int RouteStopsToday,
        int InstallationTasksToday,
        int CompletedTasks,
        int TotalTasks,
        int CancelledTasks,
        TimeSpan TotalWorkDuration);

    public TechnicianService(ApplicationDbContext context)
    {
        _context = context;
    }

    public async Task<TechnicianDto?> GetByIdAsync(Guid id)
    {
        var today = DateTime.UtcNow.Date;
        var next = today.AddDays(1);

        var tech = await _context.Technicians
            .Include(t => t.PrimaryRegion)
            .Include(t => t.AssignedRegions)
            .Include(t => t.Routes)
            .FirstOrDefaultAsync(t => t.Id == id);

        if (tech == null) return null;

        var serviceCountToday = await _context.ServiceRecords
            .AsNoTracking()
            .CountAsync(s => s.AssignedTechnicianId == id
                             && s.PlannedAt != null
                             && s.PlannedAt >= today && s.PlannedAt < next
                             && s.Status != ServiceStatus.Delivered
                             && s.Status != ServiceStatus.Cancelled);

        var routeStopsToday = tech.Routes?
            .Where(r => r.PlannedDate.Date == today)
            .Sum(r => r.TotalStops) ?? 0;

        var metricsMap = await BuildMetricsAsync(new[] { id });
        var metrics = metricsMap.TryGetValue(id, out var m)
            ? m with { PlannedServicesToday = serviceCountToday, RouteStopsToday = routeStopsToday }
            : new TechnicianMetrics(serviceCountToday, routeStopsToday, 0, 0, 0, 0, TimeSpan.Zero);

        return MapToDto(tech, metrics);
    }

    public async Task<List<TechnicianDto>> GetAllAsync(TechnicianStatus? status = null, string? role = null)
    {
        var today = DateTime.UtcNow.Date;
        var next = today.AddDays(1);

        var query = _context.Technicians
            .Include(t => t.PrimaryRegion)
            .Include(t => t.AssignedRegions)
            .Include(t => t.Routes)
            .Where(t => t.IsActive)
            .AsQueryable();

        if (status.HasValue)
            query = query.Where(t => t.Status == status.Value);

        // Rol süzgeci artık YALNIZCA teknisyenin kendi `Roles` dizisinden. Eskiden buna ek olarak
        // `ServiceUsers.Role` de taranıyordu; o kolon kaldırıldı (rol tek kaynak olarak B2B'de,
        // ekip bilgisi ise zaten `Technicians.Roles`'ta duruyor).
        //
        // "Technician" SÜZGEÇ DEĞİLDİR: bu tablodaki her satır zaten bir teknisyen. Çağıranlar
        // (ör. Personel Ekstresi) bunu eski `ServiceUsers.Role` kolonuna göre yazmıştı ve o kolon
        // kalkınca hiçbir ekip dizisinde "Technician" yazmadığı için liste boşalıyordu.
        if (!string.IsNullOrWhiteSpace(role)
            && !string.Equals(role, "Technician", StringComparison.OrdinalIgnoreCase))
        {
            query = query.Where(t => t.Roles.Contains(role));
        }

        var technicians = await query.OrderBy(t => t.FirstName).ToListAsync();

        var techIds = technicians.Select(t => t.Id).ToList();
        var serviceLoads = await _context.ServiceRecords
            .AsNoTracking()
            .Where(s => s.AssignedTechnicianId != null
                        && techIds.Contains(s.AssignedTechnicianId.Value)
                        && s.PlannedAt != null
                        && s.PlannedAt >= today && s.PlannedAt < next
                        && s.Status != ServiceStatus.Delivered
                        && s.Status != ServiceStatus.Cancelled)
            .GroupBy(s => s.AssignedTechnicianId!.Value)
            .Select(g => new { TechnicianId = g.Key, Count = g.Count() })
            .ToListAsync();

        var serviceMap = serviceLoads.ToDictionary(x => x.TechnicianId, x => x.Count);
        var metricsMap = await BuildMetricsAsync(techIds);

        return technicians
            .Select(t =>
            {
                var serviceCount = serviceMap.TryGetValue(t.Id, out var c) ? c : 0;
                var routeStops = t.Routes?
                    .Where(r => r.PlannedDate.Date == today)
                    .Sum(r => r.TotalStops) ?? 0;
                var metrics = metricsMap.TryGetValue(t.Id, out var m)
                    ? m with { PlannedServicesToday = serviceCount, RouteStopsToday = routeStops }
                    : new TechnicianMetrics(serviceCount, routeStops, 0, 0, 0, 0, TimeSpan.Zero);
                return MapToDto(t, metrics);
            })
            .ToList();
    }

    public async Task<List<TechnicianDto>> GetAvailableAsync(DateTime? date = null)
    {
        var targetDate = DateTime.SpecifyKind((date ?? DateTime.UtcNow).Date, DateTimeKind.Utc);
        var next = DateTime.SpecifyKind(targetDate.AddDays(1), DateTimeKind.Utc);
        var technicians = await _context.Technicians
            .Include(t => t.PrimaryRegion)
            .Include(t => t.AssignedRegions)
            .Include(t => t.Routes)
            .Where(t => t.IsActive && t.Status == TechnicianStatus.Available)
            .ToListAsync();

        var techIds = technicians.Select(t => t.Id).ToList();

        var serviceLoads = await _context.ServiceRecords
            .AsNoTracking()
            .Where(s => s.AssignedTechnicianId != null
                        && techIds.Contains(s.AssignedTechnicianId.Value)
                        && s.Status != ServiceStatus.Delivered
                        && s.Status != ServiceStatus.Cancelled)
            .GroupBy(s => s.AssignedTechnicianId!.Value)
            .Select(g => new { TechnicianId = g.Key, Count = g.Count() })
            .ToListAsync();

        var serviceMap = serviceLoads.ToDictionary(x => x.TechnicianId, x => x.Count);
        var metricsMap = await BuildMetricsAsync(techIds, targetDate);

        // Filter technicians with available capacity (planned services + planned route stops)
        var availableTechs = technicians
            .Select(t =>
            {
                var routeStops = t.Routes
                    .Where(r => r.PlannedDate.Date == targetDate)
                    .Sum(r => r.TotalStops);
                var svc = serviceMap.TryGetValue(t.Id, out var c) ? c : 0;
                var metrics = metricsMap.TryGetValue(t.Id, out var m)
                    ? m with { PlannedServicesToday = svc, RouteStopsToday = routeStops }
                    : new TechnicianMetrics(svc, routeStops, 0, 0, 0, 0, TimeSpan.Zero);
                return MapToDto(t, metrics);
            })
            .ToList();

        return availableTechs;
    }

    public async Task<TechnicianDto> CreateAsync(CreateTechnicianDto dto)
    {
        var username = (dto.Username ?? string.Empty).Trim();

        if (string.IsNullOrWhiteSpace(username))
            throw new InvalidOperationException("Teknisyen kullanıcı adı zorunludur");

        // Şifre burada ne saklanıyor ne de doğrulanıyor: ServiceOps artık kimlik doğrulamıyor.
        // `dto.Password` sözleşmede duruyor (B2B aynı gövdeyi bu uca da gönderiyor) ama
        // kullanılmıyor; şifre kuralı ve saklama B2B `Users` tarafında.
        var exists = await _context.ServiceUsers.AnyAsync(u => u.Username == username);
        if (exists)
            throw new InvalidOperationException("Bu kullanıcı adı zaten kullanılıyor");

        var tech = new Technician
        {
            Id = Guid.NewGuid(),
            EmployeeNumber = await GenerateEmployeeNumber(),
            FirstName = dto.FirstName,
            LastName = dto.LastName,
            Phone = dto.Phone,
            Email = dto.Email,
            Roles = dto.Roles,
            ExpertiseAreas = dto.ExpertiseAreas,
            PrimaryRegionId = dto.PrimaryRegionId,
            MaxDailyTasks = dto.MaxDailyTasks,
            Status = TechnicianStatus.Available,
            IsActive = true,
            CreatedAt = DateTime.UtcNow,
            TenantCode = dto.TenantCode,
            WarehouseCode = dto.WarehouseCode,
            WarehouseName = dto.WarehouseName,
            CashAccountId = dto.CashAccountId,
            CashAccountName = dto.CashAccountName,
            BankAccountId = dto.BankAccountId,
            BankAccountName = dto.BankAccountName,
            PosAccountId = dto.PosAccountId,
            PosAccountName = dto.PosAccountName
        };

        if (dto.RegionIds != null && dto.RegionIds.Any())
        {
            var regions = await _context.Regions
                .Where(r => dto.RegionIds.Contains(r.Id))
                .ToListAsync();
            foreach (var region in regions)
            {
                tech.AssignedRegions.Add(region);
            }
        }

        _context.Technicians.Add(tech);

        // Yalnızca EŞLEME satırı: kullanıcı adı -> teknisyen kaydı. Şifre burada tutulmuyor,
        // giriş B2B `Users` üzerinden yapılıyor (bkz. ServiceUser özeti). Şifreyi B2B tarafındaki
        // `ServiceOpsTechniciansController` yazıyor; bu uç ona ek olarak çağrılıyor.
        var user = new ServiceUser
        {
            Id = Guid.NewGuid(),
            Username = username,
            TechnicianId = tech.Id,
            IsActive = true,
            CreatedAt = DateTime.UtcNow
        };

        tech.UserId = username;
        _context.ServiceUsers.Add(user);
        await _context.SaveChangesAsync();

        var mapped = await _context.Technicians
            .Include(t => t.PrimaryRegion)
            .FirstAsync(t => t.Id == tech.Id);

        return MapToDto(mapped);
    }



    public async Task<TechnicianDto?> UpdateAsync(Guid id, CreateTechnicianDto dto)
    {
        var tech = await _context.Technicians.FindAsync(id);
        if (tech == null) return null;

        tech.FirstName = dto.FirstName;
        tech.LastName = dto.LastName;
        tech.Phone = dto.Phone;
        tech.Email = dto.Email;
        tech.Roles = dto.Roles;
        tech.ExpertiseAreas = dto.ExpertiseAreas;
        tech.PrimaryRegionId = dto.PrimaryRegionId;
        tech.MaxDailyTasks = dto.MaxDailyTasks;
        tech.WarehouseCode = dto.WarehouseCode;
        tech.WarehouseName = dto.WarehouseName;
        tech.CashAccountId = dto.CashAccountId;
        tech.CashAccountName = dto.CashAccountName;
        tech.BankAccountId = dto.BankAccountId;
        tech.BankAccountName = dto.BankAccountName;
        tech.PosAccountId = dto.PosAccountId;
        tech.PosAccountName = dto.PosAccountName;

        if (dto.RegionIds != null)
        {
            await _context.Entry(tech).Collection(t => t.AssignedRegions).LoadAsync();
            tech.AssignedRegions.Clear();
            var regions = await _context.Regions
                .Where(r => dto.RegionIds.Contains(r.Id))
                .ToListAsync();
            foreach (var region in regions)
            {
                tech.AssignedRegions.Add(region);
            }
        }

        await _context.SaveChangesAsync();
        return MapToDto(tech);
    }

    public async Task<bool> DeleteAsync(Guid id)
    {
        var tech = await _context.Technicians.FindAsync(id);
        if (tech == null) return false;

        tech.IsActive = false;
        await _context.SaveChangesAsync();
        return true;
    }

    public async Task<TechnicianDto?> UpdateStatusAsync(Guid id, TechnicianStatus status)
    {
        var tech = await _context.Technicians.FindAsync(id);
        if (tech == null) return null;

        tech.Status = status;
        if (status != TechnicianStatus.OffDuty && status != TechnicianStatus.Inactive)
        {
            tech.IsOnline = true;
        }
        else
        {
            tech.IsOnline = false;
        }
        await _context.SaveChangesAsync();
        return MapToDto(tech);
    }

    public async Task<TechnicianDto?> UpdateOnlineStatusAsync(Guid id, bool isOnline)
    {
        var tech = await _context.Technicians.FindAsync(id);
        if (tech == null) return null;

        tech.IsOnline = isOnline;
        await _context.SaveChangesAsync();
        return MapToDto(tech);
    }

    public async Task<TechnicianDto?> UpdateLocationAsync(Guid id, UpdateTechnicianLocationDto dto)
    {
        var tech = await _context.Technicians.FindAsync(id);
        if (tech == null) return null;

        tech.CurrentLatitude = dto.Latitude;
        tech.CurrentLongitude = dto.Longitude;
        tech.LastLocationUpdate = DateTime.UtcNow;
        tech.IsOnline = true;

        await _context.SaveChangesAsync();
        return MapToDto(tech);
    }

    public async Task<List<TechnicianLocationDto>> GetLocationsAsync()
    {
        var technicians = await _context.Technicians
            .Where(t => t.IsActive)
            .ToListAsync();

        return technicians.Select(t => new TechnicianLocationDto
        {
            Id = t.Id,
            FullName = t.FullName,
            AvatarUrl = t.AvatarUrl,
            Latitude = t.CurrentLatitude,
            Longitude = t.CurrentLongitude,
            Status = t.Status,
            LastUpdate = t.LastLocationUpdate ?? DateTime.UtcNow,
            CurrentStops = 0,
            NextStopAddress = null,
            TenantCode = t.TenantCode,
            // Ham bayrak değil, konum tazeliğinden türetilen değer — bkz. Technician.IsOnlineNow.
            IsOnline = t.IsOnlineNow,
            Phone = t.Phone
        }).ToList();
    }

    public async Task<Dictionary<TechnicianStatus, int>> GetStatusCountsAsync()
    {
        var counts = await _context.Technicians
            .Where(t => t.IsActive)
            .GroupBy(t => t.Status)
            .Select(g => new { Status = g.Key, Count = g.Count() })
            .ToListAsync();

        return counts.ToDictionary(x => x.Status, x => x.Count);
    }

    /// <summary>
    /// Teknisyen cari kodu: TEK-0001, TEK-0002, ... (arayüzde "CARİ KODU" olarak görünür).
    ///
    /// Sayıyı KAYIT SAYISINDAN değil, mevcut en büyük koddan türetir. Sayaç kullanan eski hâli
    /// (TECH-{yıl}-{adet+1}) silme sonrası çakışıyordu: 17 teknisyenden biri silinince sıradaki
    /// yeni kayıt da 17 numarayı alıyor, yani var olan bir kodun aynısı üretiliyordu. Cari kodu
    /// ileride ekstre/hak ediş bağlamak için kullanılacağı için tekrar etmemesi şart.
    ///
    /// Yalnızca TEK- önekli kodlara bakar; eski AT-/SH-/KL-/SM-/TECH- kodları sayıma girmez.
    /// </summary>
    private async Task<string> GenerateEmployeeNumber()
    {
        var existing = await _context.Technicians
            .Where(t => t.EmployeeNumber.StartsWith("TEK-"))
            .Select(t => t.EmployeeNumber)
            .ToListAsync();

        var maxNumber = 0;
        foreach (var code in existing)
        {
            var suffix = code.Substring(4);
            if (int.TryParse(suffix, out var value) && value > maxNumber)
                maxNumber = value;
        }

        return $"TEK-{maxNumber + 1:D4}";
    }

    private async Task<Dictionary<Guid, TechnicianMetrics>> BuildMetricsAsync(IEnumerable<Guid> technicianIds, DateTime? targetDate = null)
    {
        var ids = technicianIds.Distinct().ToList();
        if (ids.Count == 0) return new Dictionary<Guid, TechnicianMetrics>();

        var today = DateTime.SpecifyKind((targetDate ?? DateTime.UtcNow).Date, DateTimeKind.Utc);
        var next = DateTime.SpecifyKind(today.AddDays(1), DateTimeKind.Utc);

        var serviceStats = await _context.ServiceRecords.AsNoTracking()
            .Where(s => s.AssignedTechnicianId != null && ids.Contains(s.AssignedTechnicianId.Value))
            .GroupBy(s => s.AssignedTechnicianId!.Value)
            .Select(g => new
            {
                TechnicianId = g.Key,
                Total = g.Count(),
                Completed = g.Count(s => s.Status == ServiceStatus.Delivered || s.Status == ServiceStatus.Ready),
                Cancelled = g.Count(s => s.Status == ServiceStatus.Cancelled)
            })
            .ToListAsync();

        var installationStats = await _context.InstallationTasks.AsNoTracking()
            .Where(t => t.AssignedTechnicianId != null && ids.Contains(t.AssignedTechnicianId.Value))
            .GroupBy(t => t.AssignedTechnicianId!.Value)
            .Select(g => new
            {
                TechnicianId = g.Key,
                Total = g.Count(t => t.Status != InstallationTaskStatus.Deferred),
                Completed = g.Count(t => t.Status == InstallationTaskStatus.Completed),
                Cancelled = g.Count(t => t.Status == InstallationTaskStatus.Cancelled),
                Today = g.Count(t => t.PlannedAt != null && t.PlannedAt >= today && t.PlannedAt < next && t.Status != InstallationTaskStatus.Completed && t.Status != InstallationTaskStatus.Cancelled)
            })
            .ToListAsync();

        var cargoStats = await _context.CargoTrackingTasks.AsNoTracking()
            .Where(t => t.AssignedTechnicianId != null && ids.Contains(t.AssignedTechnicianId.Value))
            .GroupBy(t => t.AssignedTechnicianId!.Value)
            .Select(g => new
            {
                TechnicianId = g.Key,
                Total = g.Count(),
                Completed = g.Count(t => t.Status == CargoTrackingStatus.Delivered),
                TodayActive = g.Count(t => t.Status != CargoTrackingStatus.Delivered)
            })
            .ToListAsync();

        var workLogStats = await _context.WorkLogs.AsNoTracking()
            .Where(w => ids.Contains(w.TechnicianId) && w.Duration != null && w.Duration > TimeSpan.Zero)
            .Select(w => new { w.TechnicianId, Duration = w.Duration!.Value })
            .ToListAsync();

        var serviceMap = serviceStats.ToDictionary(x => x.TechnicianId);
        var installationMap = installationStats.ToDictionary(x => x.TechnicianId);
        var cargoMap = cargoStats.ToDictionary(x => x.TechnicianId);
        var workDurationMap = workLogStats
            .GroupBy(x => x.TechnicianId)
            .ToDictionary(g => g.Key, g => TimeSpan.FromTicks(g.Sum(x => x.Duration.Ticks)));

        return ids.ToDictionary(id => id, id =>
        {
            serviceMap.TryGetValue(id, out var svc);
            installationMap.TryGetValue(id, out var inst);
            cargoMap.TryGetValue(id, out var cargo);
            workDurationMap.TryGetValue(id, out var duration);
            var completed = (svc?.Completed ?? 0) + (inst?.Completed ?? 0) + (cargo?.Completed ?? 0);
            var cancelled = (svc?.Cancelled ?? 0) + (inst?.Cancelled ?? 0);
            var total = Math.Max((svc?.Total ?? 0) + (inst?.Total ?? 0) + (cargo?.Total ?? 0), completed + cancelled);
            return new TechnicianMetrics(
                0,
                0,
                (inst?.Today ?? 0) + (cargo?.TodayActive ?? 0),
                completed,
                total,
                cancelled,
                duration);
        });
    }

    private static TechnicianDto MapToDto(Technician t, TechnicianMetrics metrics)
    {
        var cap = t.MaxDailyTasks <= 0 ? 8 : t.MaxDailyTasks;
        var dailyTasks = metrics.PlannedServicesToday + metrics.RouteStopsToday + metrics.InstallationTasksToday;
        var isCapacityAvailable = true; // Capacity check removed by user request
        var finishedTasks = metrics.CompletedTasks + metrics.CancelledTasks;
        var successRate = finishedTasks == 0 ? 0 : (double)metrics.CompletedTasks / finishedTasks * 100.0;
        var rating = finishedTasks == 0 ? 0 : Math.Round(successRate / 20.0, 1);

        return new TechnicianDto
        {
            Id = t.Id,
            EmployeeNumber = t.EmployeeNumber,
            FirstName = t.FirstName,
            LastName = t.LastName,
            Username = t.UserId,
            Email = t.Email,
            Phone = t.Phone,
            AvatarUrl = t.AvatarUrl,
            Status = t.Status,
            Roles = t.Roles,
            ExpertiseAreas = t.ExpertiseAreas,
            PrimaryRegionId = t.PrimaryRegionId,
            RegionName = t.AssignedRegions != null && t.AssignedRegions.Any()
                ? string.Join(", ", t.AssignedRegions.Select(r => r.Name))
                : t.PrimaryRegion?.Name,
            DailyTasks = dailyTasks,
            MaxDailyTasks = t.MaxDailyTasks,
            PlannedServicesToday = metrics.PlannedServicesToday,
            RouteStopsToday = metrics.RouteStopsToday,
            IsCapacityAvailable = isCapacityAvailable,
            CompletedTasks = metrics.CompletedTasks,
            TotalTasks = metrics.TotalTasks,
            CancelledTasks = metrics.CancelledTasks,
            SuccessRate = successRate,
            TotalWorkDuration = metrics.TotalWorkDuration,
            Rating = rating,
            CurrentLatitude = t.CurrentLatitude,
            CurrentLongitude = t.CurrentLongitude,
            LastLocationUpdate = t.LastLocationUpdate,
            IsActive = t.IsActive,
            // Ham bayrak değil, konum tazeliğinden türetilen değer — bkz. Technician.IsOnlineNow.
            IsOnline = t.IsOnlineNow,
            TenantCode = t.TenantCode,
            WarehouseCode = t.WarehouseCode,
            WarehouseName = t.WarehouseName,
            CashAccountId = t.CashAccountId,
            CashAccountName = t.CashAccountName,
            BankAccountId = t.BankAccountId,
            BankAccountName = t.BankAccountName,
            PosAccountId = t.PosAccountId,
            PosAccountName = t.PosAccountName
        };
    }

    private static TechnicianDto MapToDto(Technician t) => MapToDto(t, new TechnicianMetrics(0, 0, 0, t.CompletedTasks, t.TotalTasks, t.CancelledTasks, t.TotalWorkDuration));

    public async Task IncrementTotalTasksAsync(Guid technicianId)
    {
        var tech = await _context.Technicians.FindAsync(technicianId);
        if (tech == null) return;
        tech.TotalTasks++;
        await _context.SaveChangesAsync();
    }

    public async Task IncrementCompletedTasksAsync(Guid technicianId)
    {
        var tech = await _context.Technicians.FindAsync(technicianId);
        if (tech == null) return;
        tech.CompletedTasks++;
        RecalculateSuccessRateAsync(tech);
        await _context.SaveChangesAsync();
    }

    public async Task IncrementCancelledTasksAsync(Guid technicianId)
    {
        var tech = await _context.Technicians.FindAsync(technicianId);
        if (tech == null) return;
        tech.CancelledTasks++;
        RecalculateSuccessRateAsync(tech);
        await _context.SaveChangesAsync();
    }

    public async Task AddWorkDurationAsync(Guid technicianId, TimeSpan duration)
    {
        var tech = await _context.Technicians.FindAsync(technicianId);
        if (tech == null) return;
        tech.TotalWorkDuration += duration;
        await _context.SaveChangesAsync();
    }

    private void RecalculateSuccessRateAsync(Technician tech)
    {
        var totalFinished = tech.CompletedTasks + tech.CancelledTasks;
        if (totalFinished == 0)
        {
            tech.SuccessRate = 100.0;
        }
        else
        {
            tech.SuccessRate = (double)tech.CompletedTasks / totalFinished * 100.0;
        }
    }

    public async Task<TechnicianDto?> AssignWarehouseAsync(
        Guid id, 
        int? warehouseCode, string? warehouseName, 
        int? cashAccountId, string? cashAccountName, 
        int? bankAccountId, string? bankAccountName, 
        int? posAccountId, string? posAccountName)
    {
        if (warehouseCode.HasValue)
        {
            var alreadyAssigned = await _context.Technicians
                .AnyAsync(t => t.Id != id && t.IsActive && t.WarehouseCode == warehouseCode.Value);
            if (alreadyAssigned)
            {
                throw new InvalidOperationException("Bu depo zaten başka bir teknisyene atanmış.");
            }
        }

        var tech = await _context.Technicians.FindAsync(id);
        if (tech == null) return null;

        tech.WarehouseCode = warehouseCode;
        tech.WarehouseName = warehouseName;
        tech.CashAccountId = cashAccountId;
        tech.CashAccountName = cashAccountName;
        tech.BankAccountId = bankAccountId;
        tech.BankAccountName = bankAccountName;
        tech.PosAccountId = posAccountId;
        tech.PosAccountName = posAccountName;

        await _context.SaveChangesAsync();
        return MapToDto(tech);
    }
}
