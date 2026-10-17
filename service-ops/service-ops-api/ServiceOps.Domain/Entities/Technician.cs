using System;
using System.Collections.Generic;

namespace ServiceOps.Domain.Entities;

public class Technician
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string EmployeeNumber { get; set; } = string.Empty;
    public string FirstName { get; set; } = string.Empty;
    public string LastName { get; set; } = string.Empty;
    public string FullName => $"{FirstName} {LastName}";
    public string? Email { get; set; }
    public string Phone { get; set; } = string.Empty;
    public string? AvatarUrl { get; set; }
    
    // Status
    public TechnicianStatus Status { get; set; } = TechnicianStatus.Available;
    
    // Expertise & Roles
    public string[] Roles { get; set; } = Array.Empty<string>();
    public string[] ExpertiseAreas { get; set; } = Array.Empty<string>();
    public string[] Specializations { get; set; } = Array.Empty<string>();
    
    // Region Assignment
    public Guid? PrimaryRegionId { get; set; }
    public Region? PrimaryRegion { get; set; }
    public ICollection<Region> AssignedRegions { get; set; } = new List<Region>();
    
    // Work Info
    public TimeSpan WorkStartTime { get; set; } = TimeSpan.FromHours(9);
    public TimeSpan WorkEndTime { get; set; } = TimeSpan.FromHours(18);
    public int MaxDailyTasks { get; set; } = 8;
    public bool CanInstall { get; set; } = false;
    
    // Performance
    public double Rating { get; set; } = 5.0;
    public int CompletedTasks { get; set; } = 0;
    public int TotalTasks { get; set; } = 0;
    public int CancelledTasks { get; set; } = 0;
    public double SuccessRate { get; set; } = 100.0;
    public TimeSpan TotalWorkDuration { get; set; } = TimeSpan.Zero;
    
    // Location (for real-time tracking)
    public double? CurrentLatitude { get; set; }
    public double? CurrentLongitude { get; set; }
    public DateTime? LastLocationUpdate { get; set; }

    /// <summary>
    /// Konumun "taze" sayıldığı süre. Uygulama dakikada bir yazıyor
    /// (webview `LOCATION_INTERVAL_MS` = 60 sn); eşik beş turluk pay bırakıyor, böylece
    /// asansör/bodrum gibi kısa kapsama kesintileri teknisyeni çevrimdışı göstermez.
    /// </summary>
    public static readonly TimeSpan LocationStaleAfter = TimeSpan.FromMinutes(5);

    /// <summary>
    /// GERÇEKTEN çevrimiçi mi. Haritalar ve listeler bunu kullanmalı, ham <see cref="IsOnline"/>
    /// bayrağını değil.
    ///
    /// <see cref="IsOnline"/> saklanan bir bayrak: konum yazılınca true'ya çekiliyor ama telefon
    /// sustuğunda kimse false'a çekmiyor — çünkü onu çekecek olan şey zaten susmuş telefon.
    /// Şarjı biten telefon bu yüzden haritada SONSUZA KADAR "Çevrimiçi" görünüyor ve son bilinen
    /// noktada duruyordu; panele bakan kişi teknisyenin hâlâ orada olduğunu sanıyordu.
    ///
    /// Kural: bayrak açık olacak VE son konum <see cref="LocationStaleAfter"/> içinde olacak.
    /// Hiç konum göndermemiş teknisyen (uygulamayı kullanmayan) çevrimdışı görünür — bu doğru:
    /// nerede olduğu bilinmiyor.
    ///
    /// NOT: hesaplanan özellik, veritabanına yazılmaz. Yalnızca ToList() sonrası bellekteki
    /// nesnelerde kullanılabilir; IQueryable projeksiyonuna konursa EF çeviremez.
    /// </summary>
    public bool IsOnlineNow =>
        IsOnline
        && LastLocationUpdate.HasValue
        && DateTime.UtcNow - LastLocationUpdate.Value < LocationStaleAfter;


    // Warehouse & Accounts Assignment
    public int? WarehouseCode { get; set; }
    public string? WarehouseName { get; set; }
    public int? CashAccountId { get; set; }
    public string? CashAccountName { get; set; }
    public int? BankAccountId { get; set; }
    public string? BankAccountName { get; set; }
    public int? PosAccountId { get; set; }
    public string? PosAccountName { get; set; }
    
    // Auth
    public string? UserId { get; set; }
    public string? TenantCode { get; set; }
    public bool IsActive { get; set; } = true;
    public bool IsOnline { get; set; } = false;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    
    // Navigation
    public ICollection<ServiceRecord> AssignedServices { get; set; } = new List<ServiceRecord>();
    public ICollection<WorkOrder> WorkOrders { get; set; } = new List<WorkOrder>();
    public ICollection<Route> Routes { get; set; } = new List<Route>();
    public ICollection<WorkLog> WorkLogs { get; set; } = new List<WorkLog>();
}

public enum TechnicianStatus
{
    Available = 0,
    OnField = 1,
    OnBreak = 2,
    OffDuty = 3,
    Inactive = 4
}
