using Microsoft.EntityFrameworkCore;
using ServiceOps.Application.Dtos;
using ServiceOps.Application.Interfaces;
using ServiceOps.Domain.Entities;
using ServiceOps.Infrastructure.Data;

namespace ServiceOps.Application.Services;

public class RouteService : IRouteService
{
    private readonly ApplicationDbContext _context;

    public RouteService(ApplicationDbContext context)
    {
        _context = context;
    }

    public async Task<RouteDto?> GetByIdAsync(Guid id)
    {
        var route = await _context.Routes
            .Include(r => r.Technician)
            .Include(r => r.Region)
            .Include(r => r.Stops)
                .ThenInclude(s => s.Service)
            .FirstOrDefaultAsync(r => r.Id == id);

        if (route == null) return null;

        return MapToDto(route);
    }

    public async Task<List<RouteListItemDto>> GetAllAsync(RouteFilterDto? filter = null)
    {
        var query = _context.Routes
            .Include(r => r.Technician)
            .Include(r => r.Region)
            .AsQueryable();

        if (filter?.DateFrom != null)
            query = query.Where(r => r.PlannedDate >= filter.DateFrom);
        if (filter?.DateTo != null)
            query = query.Where(r => r.PlannedDate <= filter.DateTo);
        if (filter?.TechnicianId != null)
            query = query.Where(r => r.TechnicianId == filter.TechnicianId);
        if (filter?.RegionId != null)
            query = query.Where(r => r.RegionId == filter.RegionId);
        if (filter?.Status != null)
            query = query.Where(r => r.Status == filter.Status);

        var routes = await query.OrderByDescending(r => r.PlannedDate).ToListAsync();
        return routes.Select(MapToListItemDto).ToList();
    }

    public async Task<List<RouteListItemDto>> GetTodayRoutesAsync()
    {
        var today = DateTime.UtcNow.Date;
        var routes = await _context.Routes
            .Include(r => r.Technician)
            .Include(r => r.Region)
            .Where(r => r.PlannedDate.Date == today)
            .OrderBy(r => r.PlannedDate)
            .ToListAsync();

        return routes.Select(MapToListItemDto).ToList();
    }

    public async Task<List<TechnicianLocationDto>> GetTechnicianLocationsAsync()
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
            CurrentStops = t.Routes.SelectMany(r => r.Stops).Count(s => s.Status == StopStatus.InProgress || s.Status == StopStatus.Pending),
            NextStopAddress = t.Routes.SelectMany(r => r.Stops)
                .Where(s => s.Status == StopStatus.Pending)
                .OrderBy(s => s.Sequence)
                .Select(s => s.Address)
                .FirstOrDefault(),
            // Ham bayrak değil, konum tazeliğinden türetilen değer — bkz. Technician.IsOnlineNow.
            IsOnline = t.IsOnlineNow,
            Phone = t.Phone
        }).ToList();
    }

    public async Task<List<RegionStatsDto>> GetRegionStatsAsync()
    {
        var regions = await _context.Regions
            .Include(r => r.Technicians)
            .Include(r => r.Routes)
            .Where(r => r.IsActive)
            .ToListAsync();

        var totalServices = await _context.ServiceRecords.CountAsync();

        return regions.Select(r => new RegionStatsDto
        {
            RegionName = r.Name,
            TechnicianCount = r.Technicians.Count(t => t.IsActive),
            ActiveRoutes = r.Routes.Count(route => route.Status == RouteStatus.InProgress || route.Status == RouteStatus.Planned),
            CompletedServices = r.TotalServiceCount,
            PercentageOfTotal = totalServices > 0 ? (double)r.TotalServiceCount / totalServices * 100 : 0
        }).ToList();
    }

    public async Task<RouteDto> CreateAsync(CreateRouteDto dto)
    {
        var route = new Route
        {
            Id = Guid.NewGuid(),
            RouteNumber = await GenerateRouteNumber(),
            Name = dto.Name,
            Description = dto.Description,
            TechnicianId = dto.TechnicianId,
            RegionId = dto.RegionId,
            PlannedDate = dto.PlannedDate,
            Status = RouteStatus.Planned,
            TotalStops = dto.Stops.Count,
            Stops = dto.Stops.Select(s => new RouteStop
            {
                Id = Guid.NewGuid(),
                Sequence = s.Sequence,
                ServiceId = s.ServiceId,
                Address = s.Address,
                Latitude = s.Latitude,
                Longitude = s.Longitude,
                EstimatedArrival = s.EstimatedArrival,
                EstimatedDuration = s.EstimatedDuration,
                Status = StopStatus.Pending
            }).ToList()
        };

        _context.Routes.Add(route);
        await _context.SaveChangesAsync();

        return MapToDto(route);
    }

    public async Task<RouteDto?> UpdateAsync(Guid id, CreateRouteDto dto)
    {
        var route = await _context.Routes
            .Include(r => r.Stops)
            .FirstOrDefaultAsync(r => r.Id == id);

        if (route == null) return null;

        route.Name = dto.Name;
        route.Description = dto.Description;
        route.TechnicianId = dto.TechnicianId;
        route.RegionId = dto.RegionId;
        route.PlannedDate = dto.PlannedDate;
        route.TotalStops = dto.Stops.Count;

        // Update stops
        _context.RouteStops.RemoveRange(route.Stops);
        route.Stops = dto.Stops.Select(s => new RouteStop
        {
            Id = Guid.NewGuid(),
            Sequence = s.Sequence,
            ServiceId = s.ServiceId,
            Address = s.Address,
            Latitude = s.Latitude,
            Longitude = s.Longitude,
            EstimatedArrival = s.EstimatedArrival,
            EstimatedDuration = s.EstimatedDuration,
            Status = s.Status ?? StopStatus.Pending
        }).ToList();

        route.CompletedStops = route.Stops.Count(st => st.Status == StopStatus.Completed);

        await _context.SaveChangesAsync();
        return MapToDto(route);
    }

    public async Task<bool> DeleteAsync(Guid id)
    {
        var route = await _context.Routes.FindAsync(id);
        if (route == null) return false;

        _context.Routes.Remove(route);
        await _context.SaveChangesAsync();
        return true;
    }

    public async Task<RouteDto?> UpdateStatusAsync(Guid id, UpdateRouteStatusDto dto)
    {
        var route = await _context.Routes.FindAsync(id);
        if (route == null) return null;

        route.Status = dto.Status;
        route.UpdatedAt = DateTime.UtcNow;

        if (dto.Status == RouteStatus.InProgress && route.StartTime == null)
            route.StartTime = DateTime.UtcNow;
        if (dto.Status == RouteStatus.Completed && route.EndTime == null)
            route.EndTime = DateTime.UtcNow;

        await _context.SaveChangesAsync();
        return MapToDto(route);
    }

    public async Task<RouteDto?> UpdateCompletedStopsAsync(Guid id, int completedStops)
    {
        var route = await _context.Routes.FindAsync(id);
        if (route == null) return null;

        route.CompletedStops = Math.Max(0, Math.Min(completedStops, route.TotalStops));
        route.UpdatedAt = DateTime.UtcNow;

        await _context.SaveChangesAsync();
        return MapToDto(route);
    }

    private async Task<string> GenerateRouteNumber()
    {
        var count = await _context.Routes.CountAsync();
        return $"RT-{DateTime.UtcNow:yyyyMMdd}-{count + 1:D4}";
    }

    private static RouteDto MapToDto(Route route)
    {
        return new RouteDto
        {
            Id = route.Id,
            RouteNumber = route.RouteNumber,
            Name = route.Name,
            Description = route.Description,
            Status = route.Status,
            TechnicianId = route.TechnicianId,
            TechnicianName = route.Technician?.FullName,
            TechnicianAvatar = route.Technician?.AvatarUrl,
            RegionName = route.Region?.Name,
            PlannedDate = route.PlannedDate,
            EstimatedDuration = route.EstimatedDuration,
            TotalStops = route.TotalStops,
            CompletedStops = route.CompletedStops,
            Stops = route.Stops?.Select(s => new RouteStopDto
            {
                Id = s.Id,
                Sequence = s.Sequence,
                ServiceId = s.ServiceId,
                Address = s.Address,
                Latitude = s.Latitude,
                Longitude = s.Longitude,
                Status = s.Status,
                EstimatedArrival = s.EstimatedArrival,
                ServiceType = s.Service?.Type.ToTurkishString(),
                CustomerName = s.Service?.CustomerName
            }).OrderBy(s => s.Sequence).ToList() ?? new List<RouteStopDto>(),
            PathGeoJson = route.PathGeoJson,
            TotalDistanceKm = route.TotalDistanceKm
        };
    }

    private static RouteListItemDto MapToListItemDto(Route route)
    {
        return new RouteListItemDto
        {
            Id = route.Id,
            RouteNumber = route.RouteNumber,
            Name = route.Name,
            Status = route.Status,
            StatusLabel = route.Status.ToTurkishString(),
            TechnicianName = route.Technician?.FullName,
            TechnicianAvatar = route.Technician?.AvatarUrl,
            TotalStops = route.TotalStops,
            CompletedStops = route.CompletedStops,
            RegionName = route.Region?.Name,
            PlannedDate = route.PlannedDate,
            EstimatedDuration = route.EstimatedDuration
        };
    }
}
