using ServiceOps.Application.Dtos;

namespace ServiceOps.Application.Interfaces;

public interface IRouteService
{
    Task<RouteDto?> GetByIdAsync(Guid id);
    Task<List<RouteListItemDto>> GetAllAsync(RouteFilterDto? filter = null);
    Task<List<RouteListItemDto>> GetTodayRoutesAsync();
    Task<RouteDto> CreateAsync(CreateRouteDto dto);
    Task<RouteDto?> UpdateAsync(Guid id, CreateRouteDto dto);
    Task<bool> DeleteAsync(Guid id);
    Task<RouteDto?> UpdateStatusAsync(Guid id, UpdateRouteStatusDto dto);
    Task<RouteDto?> UpdateCompletedStopsAsync(Guid id, int completedStops);
    Task<List<TechnicianLocationDto>> GetTechnicianLocationsAsync();
    Task<List<RegionStatsDto>> GetRegionStatsAsync();
}
