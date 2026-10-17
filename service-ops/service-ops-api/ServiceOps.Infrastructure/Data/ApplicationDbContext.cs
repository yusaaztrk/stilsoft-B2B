using Microsoft.EntityFrameworkCore;
using ServiceOps.Domain.Entities;
using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using System.Text.Json;

namespace ServiceOps.Infrastructure.Data;

public class ApplicationDbContext : DbContext
{
    private readonly IHttpContextAccessor? _httpContextAccessor;

    public ApplicationDbContext(
        DbContextOptions<ApplicationDbContext> options,
        IHttpContextAccessor? httpContextAccessor = null) 
        : base(options)
    {
        _httpContextAccessor = httpContextAccessor;
    }

    public DbSet<UserActivityLog> UserActivityLogs { get; set; }

    public DbSet<ServiceRecord> ServiceRecords { get; set; }
    public DbSet<ServiceUser> ServiceUsers { get; set; }
    public DbSet<Technician> Technicians { get; set; }
    public DbSet<Customer> Customers { get; set; }
    public DbSet<Dealer> Dealers { get; set; }
    public DbSet<Region> Regions { get; set; }
    public DbSet<Route> Routes { get; set; }
    public DbSet<RouteStop> RouteStops { get; set; }
    public DbSet<WorkOrder> WorkOrders { get; set; }
    public DbSet<Inventory> Inventories { get; set; }
    public DbSet<InventoryUsage> InventoryUsages { get; set; }
    public DbSet<ServiceProduct> ServiceProducts { get; set; }
    public DbSet<SparePart> SpareParts { get; set; }
    public DbSet<ExplodedDiagram> ExplodedDiagrams { get; set; }
    public DbSet<SparePartOrderRequest> SparePartOrderRequests { get; set; }
    public DbSet<WorkLog> WorkLogs { get; set; }
    public DbSet<ServiceNote> ServiceNotes { get; set; }
    public DbSet<InstallationTask> InstallationTasks { get; set; }
    public DbSet<ServiceRecordItem> ServiceRecordItems { get; set; }
    public DbSet<Activity> Activities { get; set; }
    public DbSet<CargoTrackingTask> CargoTrackingTasks { get; set; }
    public DbSet<Notification> Notifications { get; set; }
    public DbSet<DeviceToken> DeviceTokens { get; set; }
    public DbSet<TechnicianEarning> TechnicianEarnings { get; set; }
    public DbSet<TechnicianLedgerEntry> TechnicianLedgerEntries { get; set; }

    public override async Task<int> SaveChangesAsync(CancellationToken cancellationToken = default)
    {
        /*
         * BURADA BİR ZAMANLAR ATAMA BİLDİRİMİ ÜRETİLİYORDU. KALDIRILDI.
         *
         * SaveChanges her atamayı yakalayıp Notification satırı yazıyordu; aynı atamalar
         * IJobAssignmentNotifier üzerinden de bildiriliyordu. Sonuç: her atamada İKİ bildirim —
         * biri canlı gelen ve kişi başına gruplanmış olan, öbürü satır satır ve sessiz olan.
         * Kullanıcı tarafında "bildirimler çift geliyor" şikâyetinin sebebi buydu.
         *
         * Ayrıca buradan üretilen bildirim SignalR'a düşemiyordu: Infrastructure katmanı Hub'ı
         * tanımıyor. Yani sessiz kopya, mobilde sesli okumaya da hiç girmiyordu.
         *
         * Tek kapı artık IJobAssignmentNotifier (ServiceOps.Api/Services). Atama yapan dört yer
         * de oradan geçiyor; planlama saati değişikliği de ServiceRecordsController'dan aynı
         * kapıya bağlandı.
         */

        // Process UserActivityLogs
        var activityLogs = new List<UserActivityLog>();
        var (username, displayName) = ResolveUserAndDisplayName();

        foreach (var entry in ChangeTracker.Entries())
        {
            if (entry.Entity is UserActivityLog) continue;

            string moduleKey = "";
            string pageKey = "";
            string actionType = "";
            string description = "";
            string? recordId = null;

            if (entry.Entity is ServiceRecord service)
            {
                moduleKey = "servis";
                pageKey = service.Type == ServiceType.Installation ? "montajKabul" : "servisKabul";
                recordId = service.Id.ToString();

                if (entry.State == EntityState.Added)
                {
                    actionType = "CREATE";
                    description = service.Type == ServiceType.Installation
                        ? $"Yeni montaj kaydı oluşturuldu: {service.ServiceNumber} ({service.CustomerName})"
                        : $"Yeni servis kaydı oluşturuldu: {service.ServiceNumber} ({service.CustomerName})";
                }
                else if (entry.State == EntityState.Modified)
                {
                    var isDeletedProp = entry.Property("IsDeleted");
                    if (isDeletedProp.IsModified)
                    {
                        if ((bool)isDeletedProp.CurrentValue)
                        {
                            actionType = "DELETE";
                            description = service.Type == ServiceType.Installation
                                ? $"Montaj kaydı silindi: {service.ServiceNumber} ({service.CustomerName})"
                                : $"Servis kaydı silindi: {service.ServiceNumber} ({service.CustomerName})";
                        }
                        else
                        {
                            actionType = "RESTORE";
                            description = service.Type == ServiceType.Installation
                                ? $"Montaj kaydı geri yüklendi: {service.ServiceNumber} ({service.CustomerName})"
                                : $"Servis kaydı geri yüklendi: {service.ServiceNumber} ({service.CustomerName})";
                        }
                    }
                    else
                    {
                        actionType = "UPDATE";
                        description = service.Type == ServiceType.Installation
                            ? $"Montaj kaydı güncellendi: {service.ServiceNumber} ({service.CustomerName})"
                            : $"Servis kaydı güncellendi: {service.ServiceNumber} ({service.CustomerName})";
                    }
                }
            }
            else if (entry.Entity is CargoTrackingTask cargo)
            {
                moduleKey = "kargo";
                pageKey = "kargoTakibi";
                recordId = cargo.Id.ToString();

                if (entry.State == EntityState.Added)
                {
                    actionType = "CREATE";
                    description = $"Yeni kargo kaydı oluşturuldu: {cargo.OrderNumber} ({cargo.CustomerName})";
                }
                else if (entry.State == EntityState.Modified)
                {
                    actionType = "UPDATE";
                    description = $"Kargo kaydı güncellendi: {cargo.OrderNumber} ({cargo.CustomerName}) - Durum: {cargo.Status}";
                }
            }
            else if (entry.Entity is Technician tech)
            {
                moduleKey = "ayarlar";
                pageKey = "teknisyenler";
                recordId = tech.Id.ToString();

                if (entry.State == EntityState.Added)
                {
                    actionType = "CREATE";
                    description = $"Teknisyen tanımlandı: {tech.FirstName} {tech.LastName}";
                }
                else if (entry.State == EntityState.Modified)
                {
                    actionType = "UPDATE";
                    description = $"Teknisyen güncellendi: {tech.FirstName} {tech.LastName}";
                }
            }

            if (!string.IsNullOrEmpty(actionType))
            {
                activityLogs.Add(new UserActivityLog
                {
                    Id = Guid.NewGuid(),
                    Username = username,
                    UserDisplayName = displayName,
                    ModuleKey = moduleKey,
                    PageKey = pageKey,
                    ActionType = actionType,
                    Description = description,
                    RecordId = recordId,
                    CreateTime = DateTime.UtcNow
                });
            }
        }

        if (activityLogs.Count > 0)
        {
            this.Set<UserActivityLog>().AddRange(activityLogs);
        }

        return await base.SaveChangesAsync(cancellationToken);
    }

    private (string username, string displayName) ResolveUserAndDisplayName()
    {
        var httpContext = _httpContextAccessor?.HttpContext;
        if (httpContext?.User == null)
        {
            return ("System", "System");
        }

        var username = httpContext.User.FindFirst(ClaimTypes.Name)?.Value 
            ?? httpContext.User.FindFirst("name")?.Value 
            ?? httpContext.User.FindFirst(ClaimTypes.NameIdentifier)?.Value
            ?? "System";

        var displayName = httpContext.User.FindFirst("fullName")?.Value 
            ?? httpContext.User.FindFirst(ClaimTypes.GivenName)?.Value 
            ?? httpContext.User.FindFirst("Unvan")?.Value
            ?? username;

        return (username, displayName);
    }

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);

        // Notification
        modelBuilder.Entity<Notification>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.HasIndex(e => e.TechnicianId);
            entity.HasIndex(e => e.CreatedAt);
        });

        // DeviceToken — telefonun bildirim adresi.
        modelBuilder.Entity<DeviceToken>(entity =>
        {
            entity.HasKey(e => e.Id);
            // Anahtar BENZERSİZ: aynı cihaz her açılışta kaydını yeniliyor, ikinci satır açmamalı.
            // Cihaz el değiştirdiğinde de bu satırın sahibi güncellenir — yoksa eski teknisyen
            // yeni sahibinin işlerini duymaya devam ederdi.
            entity.HasIndex(e => e.Token).IsUnique();
            entity.HasIndex(e => e.TechnicianId);
            entity.Property(e => e.Token).HasMaxLength(512);
            entity.Property(e => e.Platform).HasMaxLength(16);
        });

        // ServiceRecord
        modelBuilder.Entity<ServiceRecord>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.HasIndex(e => e.ServiceNumber).IsUnique();
            entity.HasIndex(e => e.Status);
            entity.HasIndex(e => e.CreatedAt);
            entity.HasOne(e => e.Customer).WithMany(c => c.Services).HasForeignKey(e => e.CustomerId);
            entity.HasOne(e => e.Dealer).WithMany(d => d.Services).HasForeignKey(e => e.DealerId);
            entity.HasOne(e => e.AssignedTechnician).WithMany(t => t.AssignedServices).HasForeignKey(e => e.AssignedTechnicianId);
            entity.HasOne(e => e.Region).WithMany(r => r.Services).HasForeignKey(e => e.RegionId);
            entity.Property(e => e.ServiceCost).HasPrecision(18, 2);
            entity.Property(e => e.PartsCost).HasPrecision(18, 2);
            entity.HasQueryFilter(e => !e.IsDeleted);
        });

        // Technician
        modelBuilder.Entity<Technician>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.HasIndex(e => e.EmployeeNumber).IsUnique();
            entity.HasIndex(e => e.Status);
            entity.HasIndex(e => e.TenantCode);
            entity.HasOne(e => e.PrimaryRegion).WithMany().HasForeignKey(e => e.PrimaryRegionId);
        });

        // ServiceUser — kullanıcı adı ile teknisyen kaydı arasındaki eşleme (bkz. entity özeti).
        // Role indeksi kaldırıldı: rol artık burada tutulmuyor, B2B'deki Users.RoleId'den okunuyor.
        modelBuilder.Entity<ServiceUser>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.HasIndex(e => e.Username).IsUnique();
            entity.HasOne(e => e.Technician)
                .WithOne()
                .HasForeignKey<ServiceUser>(e => e.TechnicianId)
                .IsRequired(false);
        });

        modelBuilder.Entity<SparePartOrderRequest>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.HasIndex(e => new { e.TenantCode, e.Status, e.CreatedAt });
            entity.HasIndex(e => new { e.TenantCode, e.ErpProductId, e.Status });
            entity.Property(e => e.TenantCode).HasMaxLength(64);
            entity.Property(e => e.TechnicianName).HasMaxLength(256);
            entity.Property(e => e.StockCode).HasMaxLength(64);
            entity.Property(e => e.PartName).HasMaxLength(256);
            entity.Property(e => e.Status).HasMaxLength(32);
        });

        // Customer
        modelBuilder.Entity<Customer>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.HasIndex(e => e.CustomerNumber).IsUnique();
            entity.HasIndex(e => e.Phone);
            entity.HasOne(e => e.Region).WithMany().HasForeignKey(e => e.RegionId);
        });

        // Dealer
        modelBuilder.Entity<Dealer>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.HasIndex(e => e.DealerCode).IsUnique();
            entity.HasOne(e => e.Region).WithMany().HasForeignKey(e => e.RegionId);
            entity.Property(e => e.CommissionRate).HasPrecision(5, 2);
            entity.Property(e => e.DiscountRate).HasPrecision(5, 2);
        });

        // Region
        modelBuilder.Entity<Region>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.HasIndex(e => e.Name).IsUnique();
            entity.HasOne(e => e.ParentRegion).WithMany(r => r.SubRegions).HasForeignKey(e => e.ParentRegionId);
        });

        // Route
        modelBuilder.Entity<Route>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.HasIndex(e => e.RouteNumber).IsUnique();
            entity.HasOne(e => e.Technician).WithMany(t => t.Routes).HasForeignKey(e => e.TechnicianId);
            entity.HasOne(e => e.Region).WithMany(r => r.Routes).HasForeignKey(e => e.RegionId);
        });

        // RouteStop
        modelBuilder.Entity<RouteStop>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.HasOne(e => e.Route).WithMany(r => r.Stops).HasForeignKey(e => e.RouteId);
            entity.HasOne(e => e.Service).WithMany().HasForeignKey(e => e.ServiceId);
        });

        // WorkOrder
        modelBuilder.Entity<WorkOrder>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.HasIndex(e => e.WorkOrderNumber).IsUnique();
            entity.HasOne(e => e.Service).WithMany(s => s.WorkOrders).HasForeignKey(e => e.ServiceId);
            entity.HasOne(e => e.Technician).WithMany(t => t.WorkOrders).HasForeignKey(e => e.TechnicianId);
            entity.Property(e => e.LaborCost).HasPrecision(18, 2);
            entity.Property(e => e.PartsCost).HasPrecision(18, 2);
            entity.Property(e => e.TotalCost).HasPrecision(18, 2);
        });

        // Inventory
        modelBuilder.Entity<Inventory>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.HasIndex(e => new { e.TenantCode, e.PartNumber }).IsUnique();
            entity.HasIndex(e => e.TenantCode);
            entity.HasIndex(e => e.Status);
            entity.Property(e => e.UnitCost).HasPrecision(18, 2);
            entity.Property(e => e.UnitPrice).HasPrecision(18, 2);
        });

        // InventoryUsage
        modelBuilder.Entity<InventoryUsage>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.HasOne(e => e.Inventory).WithMany(i => i.Usages).HasForeignKey(e => e.InventoryId);
            entity.HasOne(e => e.Service).WithMany(s => s.InventoryUsages).HasForeignKey(e => e.ServiceId);
            entity.HasOne(e => e.WorkOrder).WithMany(w => w.PartsUsed).HasForeignKey(e => e.WorkOrderId);
            entity.Property(e => e.UnitCost).HasPrecision(18, 2);
            entity.Property(e => e.TotalCost).HasPrecision(18, 2);
        });

        // ServiceProduct
        modelBuilder.Entity<ServiceProduct>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.HasIndex(e => e.TenantCode);
            entity.HasIndex(e => new { e.TenantCode, e.Name });
            entity.HasIndex(e => new { e.TenantCode, e.StockCode });
        });

        // SparePart
        modelBuilder.Entity<SparePart>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.HasIndex(e => e.TenantCode);
            entity.HasIndex(e => e.ProductId);
            entity.HasIndex(e => new { e.TenantCode, e.ProductId, e.Name });
            entity.HasIndex(e => new { e.TenantCode, e.ProductId, e.ExplodedViewPartNumber });
            entity.HasOne(e => e.Product)
                .WithMany(p => p.SpareParts)
                .HasForeignKey(e => e.ProductId);
        });

        // ExplodedDiagram
        modelBuilder.Entity<ExplodedDiagram>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.HasIndex(e => e.TenantCode);
            entity.HasIndex(e => e.ProductId);
            entity.HasOne(e => e.Product)
                .WithMany(p => p.ExplodedDiagrams)
                .HasForeignKey(e => e.ProductId);
        });

        // InstallationTask
        modelBuilder.Entity<InstallationTask>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.HasIndex(e => e.Status);
            entity.HasIndex(e => e.PlannedAt);
            entity.HasIndex(e => e.ServiceRecordItemId);
            entity.Property(e => e.Priority).HasDefaultValue(0);
            entity.HasOne(e => e.Service)
                .WithMany(s => s.InstallationTasks)
                .HasForeignKey(e => e.ServiceId)
                .OnDelete(DeleteBehavior.Cascade);
            entity.HasOne(e => e.Item)
                .WithMany()
                .HasForeignKey(e => e.ServiceRecordItemId)
                .OnDelete(DeleteBehavior.SetNull);
            entity.HasOne(e => e.AssignedTechnician)
                .WithMany()
                .HasForeignKey(e => e.AssignedTechnicianId)
                .OnDelete(DeleteBehavior.SetNull);
        });

        // ServiceRecordItem — montaj kabul kaleminin kendisi
        modelBuilder.Entity<ServiceRecordItem>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.HasIndex(e => new { e.ServiceId, e.SortOrder });
            entity.HasIndex(e => e.ExternalRef);
            entity.Property(e => e.ProductName).HasMaxLength(512);
            entity.Property(e => e.ProductStockCode).HasMaxLength(64);
            entity.Property(e => e.SerialNumber).HasMaxLength(128);
            entity.Property(e => e.ExternalRef).HasMaxLength(64);
            entity.Property(e => e.CustomerName).HasMaxLength(256);
            entity.Property(e => e.CustomerPhone).HasMaxLength(64);
            entity.Property(e => e.CustomerAddress).HasMaxLength(1024);
            entity.HasOne(e => e.Service)
                .WithMany(s => s.Items)
                .HasForeignKey(e => e.ServiceId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        // Activity
        modelBuilder.Entity<Activity>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.HasIndex(e => e.Type);
            entity.HasIndex(e => e.CreatedAt);
            entity.HasIndex(e => e.CorrelationId);
            entity.Property(e => e.Payload).HasColumnType("jsonb");
            entity.HasOne(e => e.Service)
                .WithMany(s => s.Activities)
                .HasForeignKey(e => e.ServiceId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        // WorkLog
        modelBuilder.Entity<WorkLog>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.HasOne(e => e.Technician).WithMany(t => t.WorkLogs).HasForeignKey(e => e.TechnicianId);
            entity.HasOne(e => e.WorkOrder).WithMany(w => w.WorkLogs).HasForeignKey(e => e.WorkOrderId);
            entity.HasOne(e => e.Service).WithMany().HasForeignKey(e => e.ServiceId);
            entity.Property(e => e.HourlyRate).HasPrecision(18, 2);
            entity.Property(e => e.TotalCost).HasPrecision(18, 2);
        });

        // ServiceNote
        modelBuilder.Entity<ServiceNote>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.HasOne(e => e.Service).WithMany(s => s.Notes).HasForeignKey(e => e.ServiceId);
            entity.HasIndex(e => e.Type);
            entity.HasIndex(e => e.CreatedAt);
        });

        // CargoTrackingTask
        modelBuilder.Entity<CargoTrackingTask>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.HasIndex(e => e.OrderNumber).IsUnique();
            entity.HasIndex(e => e.Status);
            entity.HasOne(e => e.AssignedTechnician)
                .WithMany()
                .HasForeignKey(e => e.AssignedTechnicianId)
                .OnDelete(DeleteBehavior.SetNull);
        });

        modelBuilder.Entity<TechnicianEarning>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.HasIndex(e => new { e.SourceType, e.SourceId }).IsUnique();
            entity.HasIndex(e => new { e.TechnicianId, e.CompletedAt });
            entity.HasIndex(e => e.Status);
            entity.Property(e => e.Amount).HasPrecision(18, 2);
            entity.Property(e => e.Currency).HasMaxLength(8);
            entity.Property(e => e.TenantCode).HasMaxLength(64);
            entity.Property(e => e.TechnicianCariCode).HasMaxLength(64);
            entity.HasOne(e => e.Technician)
                .WithMany()
                .HasForeignKey(e => e.TechnicianId)
                .OnDelete(DeleteBehavior.Restrict);
        });

        modelBuilder.Entity<TechnicianLedgerEntry>(entity =>
        {
            entity.HasKey(e => e.Id);

            // Aynı hak edişten ikinci bir defter satırı çıkmasın: hak ediş onaylanınca defter
            // hareketi yazılıyor ve bu işlem yeniden denenebiliyor. Filtreli indeks, SourceId'si
            // olmayan elle girişlerin (ödeme/düzeltme) birbirini engellememesi için.
            entity.HasIndex(e => new { e.EntryType, e.SourceId })
                .IsUnique()
                .HasFilter("\"SourceId\" IS NOT NULL");

            entity.HasIndex(e => new { e.TechnicianId, e.EntryDate });

            entity.Property(e => e.Debit).HasPrecision(18, 2);
            entity.Property(e => e.Credit).HasPrecision(18, 2);
            entity.Property(e => e.ExchangeRate).HasPrecision(18, 6);
            entity.Property(e => e.LocalAmount).HasPrecision(18, 2);
            entity.Property(e => e.Currency).HasMaxLength(8);
            entity.Property(e => e.TenantCode).HasMaxLength(64);
            entity.Property(e => e.ReferenceNumber).HasMaxLength(64);
            entity.Property(e => e.Description).HasMaxLength(512);

            entity.HasOne(e => e.Technician)
                .WithMany()
                .HasForeignKey(e => e.TechnicianId)
                .OnDelete(DeleteBehavior.Restrict);
        });
    }
}
