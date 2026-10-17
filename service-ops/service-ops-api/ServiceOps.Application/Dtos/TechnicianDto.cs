using ServiceOps.Domain.Entities;

namespace ServiceOps.Application.Dtos;

public class TechnicianDto
{
    public Guid Id { get; set; }
    public string EmployeeNumber { get; set; } = string.Empty;
    public string FirstName { get; set; } = string.Empty;
    public string LastName { get; set; } = string.Empty;
    public string FullName => $"{FirstName} {LastName}".Trim();

    /// <summary>
    /// Avatar baş harfleri.
    ///
    /// `FirstName[0]` / `LastName[0]` doğrudan indeksleniyordu ve tek adı olan (soyadı boş)
    /// bir teknisyende IndexOutOfRangeException atıyordu. Hata serileştirme sırasında oluştuğu
    /// için TEK bir kayıt BÜTÜN listeyi 500'e düşürüyordu: teknisyen listesi, planlama modalindeki
    /// ekip seçici ve haritalar aynı anda boşalıyordu — tek adlı bir kişi eklemek yeterliydi.
    /// </summary>
    public string Initials
    {
        get
        {
            var ilk = string.IsNullOrWhiteSpace(FirstName) ? "" : FirstName.Trim()[..1];
            var son = string.IsNullOrWhiteSpace(LastName) ? "" : LastName.Trim()[..1];
            if (ilk.Length == 0 && son.Length == 0) return "?";
            // Tek adlıda ikinci harf adın kendisinden alınır ki rozet tek harf kalmasın.
            if (son.Length == 0 && FirstName.Trim().Length > 1) return FirstName.Trim()[..2].ToUpperInvariant();
            return (ilk + son).ToUpperInvariant();
        }
    }
    public string? Username { get; set; }
    public string? Email { get; set; }
    public string Phone { get; set; } = string.Empty;
    public string? AvatarUrl { get; set; }
    public TechnicianStatus Status { get; set; }
    public string StatusLabel => Status.ToTurkishString();
    public string StatusColor => GetStatusColor(Status);
    public string[] Roles { get; set; } = Array.Empty<string>();
    public string[] ExpertiseAreas { get; set; } = Array.Empty<string>();
    public Guid? PrimaryRegionId { get; set; }
    public string? RegionName { get; set; }
    public int DailyTasks { get; set; }
    public int MaxDailyTasks { get; set; }
    public int PlannedServicesToday { get; set; }
    public int RouteStopsToday { get; set; }
    public bool IsCapacityAvailable { get; set; }
    public int CompletedTasks { get; set; }
    public int TotalTasks { get; set; }
    public int CancelledTasks { get; set; }
    public double SuccessRate { get; set; }
    public TimeSpan TotalWorkDuration { get; set; }
    public double Rating { get; set; }
    public double? CurrentLatitude { get; set; }
    public double? CurrentLongitude { get; set; }
    public DateTime? LastLocationUpdate { get; set; }
    public bool IsActive { get; set; }
    public bool IsOnline { get; set; }
    public string? TenantCode { get; set; }
    
    // Warehouse & Accounts Assignment
    public int? WarehouseCode { get; set; }
    public string? WarehouseName { get; set; }
    public int? CashAccountId { get; set; }
    public string? CashAccountName { get; set; }
    public int? BankAccountId { get; set; }
    public string? BankAccountName { get; set; }
    public int? PosAccountId { get; set; }
    public string? PosAccountName { get; set; }
    
    private static string GetStatusColor(TechnicianStatus status) => status switch
    {
        TechnicianStatus.Available => "available",
        TechnicianStatus.OnField => "onfield",
        TechnicianStatus.OnBreak => "onbreak",
        TechnicianStatus.OffDuty => "offduty",
        _ => "inactive"
    };
}

public class TechnicianLocationDto
{
    public Guid Id { get; set; }
    public string FullName { get; set; } = string.Empty;
    public string? AvatarUrl { get; set; }
    public double? Latitude { get; set; }
    public double? Longitude { get; set; }
    public TechnicianStatus Status { get; set; }
    public DateTime LastUpdate { get; set; }
    public int CurrentStops { get; set; }
    public string? NextStopAddress { get; set; }
    public string? TenantCode { get; set; }
    public bool IsOnline { get; set; }
    public string? Phone { get; set; }
}

public class CreateTechnicianDto
{
    public string FirstName { get; set; } = string.Empty;
    public string LastName { get; set; } = string.Empty;
    public string Phone { get; set; } = string.Empty;
    public string? Email { get; set; }
    public string[] Roles { get; set; } = Array.Empty<string>();
    public string[] ExpertiseAreas { get; set; } = Array.Empty<string>();
    public Guid? PrimaryRegionId { get; set; }
    public Guid[]? RegionIds { get; set; }
    public int MaxDailyTasks { get; set; } = 8;

    // Technician login credentials (admin provided)
    public string? Username { get; set; }
    public string? Password { get; set; }
    public string? TenantCode { get; set; }
    
    // Warehouse & Accounts Assignment
    public int? WarehouseCode { get; set; }
    public string? WarehouseName { get; set; }
    public int? CashAccountId { get; set; }
    public string? CashAccountName { get; set; }
    public int? BankAccountId { get; set; }
    public string? BankAccountName { get; set; }
    public int? PosAccountId { get; set; }
    public string? PosAccountName { get; set; }
}

public class UpdateTechnicianLocationDto
{
    public double Latitude { get; set; }
    public double Longitude { get; set; }
}

public class UpdateTechnicianPasswordDto
{
    public string Password { get; set; } = string.Empty;
}
