using ServiceOps.Application.Dtos;
using ServiceOps.Domain.Entities;

namespace ServiceOps.Application.Interfaces;

public interface ITechnicianService
{
    Task<TechnicianDto?> GetByIdAsync(Guid id);
    Task<List<TechnicianDto>> GetAllAsync(TechnicianStatus? status = null, string? role = null);
    Task<List<TechnicianDto>> GetAvailableAsync(DateTime? date = null);
    Task<TechnicianDto> CreateAsync(CreateTechnicianDto dto);
    Task<TechnicianDto?> UpdateAsync(Guid id, CreateTechnicianDto dto);
    // UpdatePasswordAsync KALDIRILDI: şifre yalnızca B2B `Users` tablosunda tutuluyor.
    // Şifre değiştirme ucu B2B tarafında (ServiceOpsTechniciansController).
    Task<bool> DeleteAsync(Guid id);
    Task<TechnicianDto?> UpdateStatusAsync(Guid id, TechnicianStatus status);
    Task<TechnicianDto?> UpdateOnlineStatusAsync(Guid id, bool isOnline);
    Task<TechnicianDto?> UpdateLocationAsync(Guid id, UpdateTechnicianLocationDto dto);
    Task<TechnicianDto?> AssignWarehouseAsync(
        Guid id, 
        int? warehouseCode, string? warehouseName, 
        int? cashAccountId, string? cashAccountName, 
        int? bankAccountId, string? bankAccountName, 
        int? posAccountId, string? posAccountName);
    Task<List<TechnicianLocationDto>> GetLocationsAsync();
    Task<Dictionary<TechnicianStatus, int>> GetStatusCountsAsync();
    Task IncrementTotalTasksAsync(Guid technicianId);
    Task IncrementCompletedTasksAsync(Guid technicianId);
    Task IncrementCancelledTasksAsync(Guid technicianId);
    Task AddWorkDurationAsync(Guid technicianId, TimeSpan duration);
}
