using System;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using ServiceOps.Api.Hubs;
using ServiceOps.Domain.Entities;
using ServiceOps.Infrastructure.Data;

namespace ServiceOps.Api.Services;

public class ApproachingJobsNotificationService : BackgroundService
{
    private readonly IServiceProvider _serviceProvider;
    private readonly IHubContext<ServiceOpsHub> _hubContext;
    private readonly ILogger<ApproachingJobsNotificationService> _logger;

    public ApproachingJobsNotificationService(
        IServiceProvider serviceProvider,
        IHubContext<ServiceOpsHub> hubContext,
        ILogger<ApproachingJobsNotificationService> logger)
    {
        _serviceProvider = serviceProvider;
        _hubContext = hubContext;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _logger.LogInformation("Approaching Jobs Notification Service is starting.");

        try
        {
            while (!stoppingToken.IsCancellationRequested)
            {
                try
                {
                    await CheckApproachingJobsAsync();
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "Error occurred while checking approaching jobs.");
                }

                // Check every 30 seconds
                await Task.Delay(TimeSpan.FromSeconds(30), stoppingToken);
            }
        }
        catch (OperationCanceledException)
        {
            _logger.LogInformation("Approaching Jobs Notification Service is stopping due to cancellation.");
        }
    }

    private async Task CheckApproachingJobsAsync()
    {
        using var scope = _serviceProvider.CreateScope();
        var context = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>();

        // Cyprus local time is UTC+3.
        var cyprusTime = DateTime.UtcNow.AddHours(3);
        var todayStr = cyprusTime.ToString("yyyy-MM-dd");
        var currentTime = cyprusTime.TimeOfDay;

        // Query active service records for today with planned start time
        var records = await context.ServiceRecords
            .Where(r => r.RouteDate == todayStr &&
                        r.AssignedTechnicianId != null &&
                        r.PlannedStartTime != null &&
                        r.Status != ServiceStatus.Ready &&
                        r.Status != ServiceStatus.Delivered &&
                        r.Status != ServiceStatus.Cancelled)
            .ToListAsync();

        foreach (var record in records)
        {
            // Parse PlannedStartTime (format: "HH:mm")
            if (TimeSpan.TryParse(record.PlannedStartTime, out var plannedStart))
            {
                var timeDiff = plannedStart - currentTime;

                // If scheduled start is within the next 30 minutes (and not in the past more than 15 minutes)
                if (timeDiff.TotalMinutes >= -15 && timeDiff.TotalMinutes <= 30)
                {
                    // Check if notification already exists to avoid duplication
                    var exists = await context.Notifications
                        .AnyAsync(n => n.JobId == record.Id && n.Title == "Yaklaşan Servis Görevi");

                    if (!exists)
                    {
                        var notification = new Notification
                        {
                            Id = Guid.NewGuid(),
                            TechnicianId = record.AssignedTechnicianId.Value,
                            Title = "Yaklaşan Servis Görevi",
                            Message = $"Fiş No: {record.ServiceNumber} - Müşteri: {record.CustomerName} - Saat: {record.PlannedStartTime}. Görevinizin başlama saati yaklaşıyor.",
                            IsRead = false,
                            CreatedAt = DateTime.UtcNow,
                            JobType = "ServiceRecord",
                            JobId = record.Id
                        };

                        context.Notifications.Add(notification);
                        await context.SaveChangesAsync();

                        // Notify clients via SignalR
                        await _hubContext.Clients.All.SendAsync("service_record_updated", new { id = record.Id, action = "approaching_job" });
                        
                        _logger.LogInformation($"Notification sent to technician {record.AssignedTechnicianId} for approaching job {record.ServiceNumber}.");
                    }
                }
            }
        }
    }
}
