using ServiceOps.Domain.Entities;

namespace ServiceOps.Application.Dtos;

public class RouteDto
{
    public Guid Id { get; set; }
    public string RouteNumber { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string? Description { get; set; }
    public RouteStatus Status { get; set; }
    public string StatusLabel => Status.ToTurkishString();
    public string StatusColor => GetStatusColor(Status);
    
    // Technician
    public Guid? TechnicianId { get; set; }
    public string? TechnicianName { get; set; }
    public string? TechnicianAvatar { get; set; }
    /// <summary>
    /// Baş harfler. Eskiden `Split(' ')[1][0]` ile ikinci kelimeye doğrudan gidiyordu: TEK
    /// KELİMELİK bir isim (soyadı olmayan teknisyen) IndexOutOfRangeException atıyor ve hata
    /// serileştirme sırasında oluştuğu için rota listesinin TAMAMI 500'e düşüyordu.
    /// Kardeşi: <see cref="TechnicianDto.Initials"/>.
    /// </summary>
    public string? TechnicianInitials
    {
        get
        {
            if (string.IsNullOrWhiteSpace(TechnicianName)) return null;
            var parcalar = TechnicianName.Split(' ', StringSplitOptions.RemoveEmptyEntries);
            if (parcalar.Length == 0) return null;
            if (parcalar.Length == 1)
                return (parcalar[0].Length > 1 ? parcalar[0][..2] : parcalar[0]).ToUpperInvariant();
            return $"{parcalar[0][0]}{parcalar[1][0]}".ToUpperInvariant();
        }
    }
    
    // Region
    public string? RegionName { get; set; }
    
    // Schedule
    public DateTime PlannedDate { get; set; }
    public string PlannedDateFormatted => PlannedDate.ToString("dd.MM.yyyy");
    public TimeSpan? EstimatedDuration { get; set; }
    public string? EstimatedDurationFormatted => EstimatedDuration?.ToString(@"hh\:mm");
    
    // Stops
    public int TotalStops { get; set; }
    public int CompletedStops { get; set; }
    public List<RouteStopDto> Stops { get; set; } = new();
    
    // Distance
    public double? TotalDistanceKm { get; set; }
    
    // Path (GeoJSON)
    public string? PathGeoJson { get; set; }
    
    // Map bounds for Cyprus
    public double MapCenterLat { get; set; } = 35.2;
    public double MapCenterLng { get; set; } = 33.4;
    public int MapZoom { get; set; } = 10;
    
    private static string GetStatusColor(RouteStatus status) => status switch
    {
        RouteStatus.Planned => "planned",
        RouteStatus.InProgress => "inprogress",
        RouteStatus.Completed => "completed",
        RouteStatus.Cancelled => "cancelled",
        RouteStatus.Delayed => "delayed",
        _ => "unknown"
    };
}

public class RouteStopDto
{
    public Guid Id { get; set; }
    public int Sequence { get; set; }
    public Guid? ServiceId { get; set; }
    public string? Address { get; set; }
    public double? Latitude { get; set; }
    public double? Longitude { get; set; }
    public StopStatus Status { get; set; }
    public string StatusLabel => Status.ToString();
    public string StatusColor => GetStopStatusColor(Status);
    public TimeSpan? EstimatedArrival { get; set; }
    public string? EstimatedArrivalFormatted => EstimatedArrival?.ToString(@"hh\:mm");
    public string? ServiceType { get; set; }
    public string? CustomerName { get; set; }
    public string? Notes { get; set; }
    
    private static string GetStopStatusColor(StopStatus status) => status switch
    {
        StopStatus.Pending => "pending",
        StopStatus.InProgress => "inprogress",
        StopStatus.Completed => "completed",
        StopStatus.Skipped => "skipped",
        StopStatus.Delayed => "delayed",
        _ => "unknown"
    };
}

public class RouteListItemDto
{
    public Guid Id { get; set; }
    public string RouteNumber { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public RouteStatus Status { get; set; }
    public string StatusLabel { get; set; } = string.Empty;
    public string? TechnicianName { get; set; }
    public string? TechnicianAvatar { get; set; }
    public int TotalStops { get; set; }
    public int CompletedStops { get; set; }
    public string? RegionName { get; set; }
    public DateTime PlannedDate { get; set; }
    public TimeSpan? EstimatedDuration { get; set; }
}

public class CreateRouteDto
{
    public string Name { get; set; } = string.Empty;
    public string? Description { get; set; }
    public Guid? TechnicianId { get; set; }
    public Guid? RegionId { get; set; }
    public DateTime PlannedDate { get; set; }
    public List<CreateRouteStopDto> Stops { get; set; } = new();
}

public class CreateRouteStopDto
{
    public int Sequence { get; set; }
    public Guid? ServiceId { get; set; }
    public string? Address { get; set; }
    public double? Latitude { get; set; }
    public double? Longitude { get; set; }
    public TimeSpan? EstimatedArrival { get; set; }
    public TimeSpan? EstimatedDuration { get; set; }
    public StopStatus? Status { get; set; }
}

public class UpdateRouteStatusDto
{
    public RouteStatus Status { get; set; }
}

public class RouteFilterDto
{
    public DateTime? DateFrom { get; set; }
    public DateTime? DateTo { get; set; }
    public Guid? TechnicianId { get; set; }
    public Guid? RegionId { get; set; }
    public RouteStatus? Status { get; set; }
}

// Region DTOs
public class RegionDto
{
    public Guid Id { get; set; }
    public string Name { get; set; } = string.Empty;
    public string? Description { get; set; }
    public double? CenterLatitude { get; set; }
    public double? CenterLongitude { get; set; }
    public int TechnicianCount { get; set; }
    public int ActiveServiceCount { get; set; }
    public int TotalServiceCount { get; set; }
    public bool IsActive { get; set; }
}

public class RegionStatsDto
{
    public string RegionName { get; set; } = string.Empty;
    public int TechnicianCount { get; set; }
    public int ActiveRoutes { get; set; }
    public int CompletedServices { get; set; }
    public double PercentageOfTotal { get; set; }
}
