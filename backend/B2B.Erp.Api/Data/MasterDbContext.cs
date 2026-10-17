using B2B.Erp.Api.Entities;
using Microsoft.EntityFrameworkCore;

namespace B2B.Erp.Api.Data;

public sealed class MasterDbContext : DbContext
{
    public MasterDbContext(DbContextOptions<MasterDbContext> options) : base(options)
    {
    }

    public DbSet<Tenant> Tenants => Set<Tenant>();
    public DbSet<GlobalUser> GlobalUsers => Set<GlobalUser>();
    public DbSet<GlobalUserTenant> GlobalUserTenants => Set<GlobalUserTenant>();
    public DbSet<TenantEnabledPage> TenantEnabledPages => Set<TenantEnabledPage>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);

        modelBuilder.Entity<Tenant>(b =>
        {
            b.HasKey(x => x.Id);
            b.HasIndex(x => x.Code).IsUnique();
            b.Property(x => x.Code).HasMaxLength(64).IsRequired();
            b.Property(x => x.Name).HasMaxLength(256).IsRequired();
            b.Property(x => x.DbName).HasMaxLength(128).IsRequired();

            b.Property(x => x.LogoPath).HasMaxLength(512);
            b.Property(x => x.HeaderGradientFrom).HasMaxLength(32);
            b.Property(x => x.HeaderGradientTo).HasMaxLength(32);
        });

        modelBuilder.Entity<GlobalUser>(b =>
        {
            b.HasKey(x => x.Id);
            b.HasIndex(x => x.Username).IsUnique();
            b.HasIndex(x => x.Mail).IsUnique();

            b.Property(x => x.Username).HasMaxLength(128).IsRequired();
            b.Property(x => x.PasswordHash).HasMaxLength(512).IsRequired();
            b.Property(x => x.Mail).HasMaxLength(256).IsRequired();
        });

        modelBuilder.Entity<GlobalUserTenant>(b =>
        {
            b.HasKey(x => x.Id);
            b.HasIndex(x => new { x.GlobalUserId, x.TenantId }).IsUnique();

            b.HasOne(x => x.GlobalUser)
                .WithMany(x => x.Tenants)
                .HasForeignKey(x => x.GlobalUserId)
                .OnDelete(DeleteBehavior.Cascade);

            b.HasOne(x => x.Tenant)
                .WithMany(x => x.GlobalUsers)
                .HasForeignKey(x => x.TenantId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<TenantEnabledPage>(b =>
        {
            b.HasKey(x => x.Id);
            b.HasIndex(x => new { x.TenantId, x.PageId }).IsUnique();

            b.HasOne(x => x.Tenant)
                .WithMany(x => x.EnabledPages)
                .HasForeignKey(x => x.TenantId)
                .OnDelete(DeleteBehavior.Cascade);
        });
    }
}
