using ServiceOps.Application.Dtos;
using ServiceOps.Domain.Entities;

namespace ServiceOps.Application.Interfaces;

public interface IServiceRecordService
{
    Task<ServiceRecordDto?> GetByIdAsync(Guid id);
    Task<ServiceRecordDto?> GetByNumberAsync(string serviceNumber);
    Task<List<ServiceRecordDto>> GetAllAsync(ServiceStatus? status = null, Guid? technicianId = null, Guid? regionId = null, DateTime? plannedFrom = null, DateTime? plannedTo = null, string? dealerCode = null);
    Task<PagedResultDto<ServiceRecordDto>> GetPagedAsync(ServiceRecordQueryDto query);
    Task<ServiceRecordDto> CreateAsync(CreateServiceRecordDto dto, string? performerName = null);
    Task<ServiceRecordDto?> UpdateAsync(Guid id, CreateServiceRecordDto dto);
    Task<bool> DeleteAsync(Guid id);
    Task<ServiceRecordDto?> UpdateStatusAsync(Guid id, UpdateServiceStatusDto dto);
    Task<ServiceRecordDto?> AssignTechnicianAsync(Guid id, AssignTechnicianDto dto);
    Task<ServiceRecordDto?> PlanAsync(Guid id, PlanServiceRecordDto dto);
    Task<Dictionary<ServiceStatus, int>> GetStatusCountsAsync();
    Task<List<ServiceRecordDto>> GetTodayServicesAsync();
    Task<List<ServiceRecordDto>> GetDelayedServicesAsync();
    Task<ServiceRecordDto?> MarkAsPrintedAsync(Guid id, string? performedByName = null, Guid? itemId = null);

    /// <summary>Yalnizca kagit fis numarasini gunceller; diger alanlara dokunmaz.</summary>
    Task<ServiceRecordDto?> UpdateManualReceiptNoAsync(Guid id, string? manualReceiptNo);
    Task<ServiceRecordDto?> UpdateSatisfactionAsync(Guid id, UpdateSatisfactionDto dto, string satisfactionBy);
}
