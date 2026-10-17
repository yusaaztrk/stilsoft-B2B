using B2B.Erp.Api.Entities;
using B2B.Erp.Api.Data.Configurations;
using Microsoft.EntityFrameworkCore;

namespace B2B.Erp.Api.Data;

public class AppDbContext : DbContext
{
    public AppDbContext(DbContextOptions<AppDbContext> options) : base(options)
    {
    }
    public DbSet<Employee> Employees => Set<Employee>();
    public DbSet<EmployeePayment> EmployeePayments => Set<EmployeePayment>();
    public DbSet<EmployeeBonusPlan> EmployeeBonusPlans => Set<EmployeeBonusPlan>();
    public DbSet<EmployeeMealPlan> EmployeeMealPlans => Set<EmployeeMealPlan>();
    public DbSet<EmployeeAccrualSnapshot> EmployeeAccrualSnapshots => Set<EmployeeAccrualSnapshot>();
    public DbSet<EmployeeMonthlyOverride> EmployeeMonthlyOverrides => Set<EmployeeMonthlyOverride>();

    /// <summary>Tanimlanmis maas hakedisi — cari ekstredeki maas alacaginin TEK kaynagi.</summary>
    public DbSet<EmployeeSalaryAccrual> EmployeeSalaryAccruals => Set<EmployeeSalaryAccrual>();

    /// <summary>Gun bazli hakedis duzeltmeleri (unutulan cikis, yarim gun vb.).</summary>
    public DbSet<EmployeeDailyAccrualOverride> EmployeeDailyAccrualOverrides => Set<EmployeeDailyAccrualOverride>();

    // Personel kasası ERP'nin CashAccounts/CashAccountTransactions tablolarından AYRIDIR.
    public DbSet<EmployeeCashAccount> EmployeeCashAccounts => Set<EmployeeCashAccount>();
    public DbSet<EmployeeCashTransaction> EmployeeCashTransactions => Set<EmployeeCashTransaction>();

    public DbSet<EmployeeCheckIn> EmployeeCheckIns => Set<EmployeeCheckIn>();

    public DbSet<EmployeeFaceEmbedding> EmployeeFaceEmbeddings => Set<EmployeeFaceEmbedding>();
    public DbSet<EmployeeLeave> EmployeeLeaves => Set<EmployeeLeave>();
    public DbSet<EmployeeLocationSetting> EmployeeLocationSettings => Set<EmployeeLocationSetting>();

    /// <summary>
    /// ERP kullanicisi — SALT OKUNUR. Portala yonetici olarak giris icin okunur, yazilmaz.
    /// Tablonun sahibi ERP; semasi oranin Program.cs drift-fix bloklarindan gelir.
    /// </summary>
    public DbSet<User> Users => Set<User>();

    public DbSet<Page> Pages => Set<Page>();
    public DbSet<RolePagePermission> RolePagePermissions => Set<RolePagePermission>();

    public DbSet<WorkScheduleSetting> WorkScheduleSettings => Set<WorkScheduleSetting>();
    public DbSet<WorkShiftBlock> WorkShiftBlocks => Set<WorkShiftBlock>();
    public DbSet<Holiday> Holidays => Set<Holiday>();

    public DbSet<NumberSeries> NumberSeries => Set<NumberSeries>();
    public DbSet<ReverseGeocodeCache> ReverseGeocodeCaches => Set<ReverseGeocodeCache>();
    public DbSet<EmployeeAttendanceSuspicion> EmployeeAttendanceSuspicions => Set<EmployeeAttendanceSuspicion>();
    public DbSet<EmployeePhoto> EmployeePhotos => Set<EmployeePhoto>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.ApplyConfigurationsFromAssembly(typeof(AppDbContext).Assembly);
        base.OnModelCreating(modelBuilder);
    }
}
