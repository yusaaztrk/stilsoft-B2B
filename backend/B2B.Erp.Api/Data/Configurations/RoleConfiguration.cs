using B2B.Erp.Api.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace B2B.Erp.Api.Data.Configurations;

public class RoleConfiguration : IEntityTypeConfiguration<Role>
{
    private static readonly DateTime SeedCreatedAt = new DateTime(2026, 1, 1, 0, 0, 0, DateTimeKind.Utc);

    public void Configure(EntityTypeBuilder<Role> builder)
    {
        builder.ToTable("Roles");

        builder.HasKey(r => r.Id);

        builder.Property(r => r.Code)
            .IsRequired()
            .HasMaxLength(50);

        builder.Property(r => r.Name)
            .IsRequired()
            .HasMaxLength(100);

        builder.Property(r => r.DisplayName)
            .IsRequired()
            .HasMaxLength(200);

        builder.Property(r => r.IsSuperAdmin)
            .IsRequired()
            .HasDefaultValue(false);

        builder.Property(r => r.Description)
            .HasMaxLength(500);

        builder.Property(r => r.IsActive)
            .IsRequired()
            .HasDefaultValue(true);

        builder.Property(r => r.CreatedAt)
            .IsRequired()
            .HasDefaultValueSql("NOW()");

        builder.HasIndex(r => r.Code)
            .IsUnique();

        builder.HasIndex(r => r.Name)
            .IsUnique();

        builder.HasMany(r => r.Users)
            .WithOne(u => u.Role)
            .HasForeignKey(u => u.RoleId)
            .OnDelete(DeleteBehavior.Restrict);

        SeedData(builder);
    }

    private void SeedData(EntityTypeBuilder<Role> builder)
    {
        builder.HasData(
            new Role { Id = 1, Code = "SuperAdmin", Name = "SuperAdmin", DisplayName = "Süper Admin", Description = "Süper yönetici - Tüm yetkiler", IsActive = true, IsSuperAdmin = true, CreatedAt = SeedCreatedAt },
            new Role { Id = 2, Code = "Yonetim", Name = "Yonetim", DisplayName = "Yönetim", Description = "Üst düzey yönetim", IsActive = true, IsSuperAdmin = false, CreatedAt = SeedCreatedAt },
            new Role { Id = 3, Code = "Mudur", Name = "Mudur", DisplayName = "Müdür", Description = "Genel müdür", IsActive = true, IsSuperAdmin = false, CreatedAt = SeedCreatedAt },
            new Role { Id = 4, Code = "MontajMudur", Name = "MontajMudur", DisplayName = "Montaj Müdürü", Description = "Montaj operasyonları yöneticisi", IsActive = true, IsSuperAdmin = false, CreatedAt = SeedCreatedAt },
            new Role { Id = 5, Code = "ServisMudur", Name = "ServisMudur", DisplayName = "Servis Müdürü", Description = "Servis operasyonları yöneticisi", IsActive = true, IsSuperAdmin = false, CreatedAt = SeedCreatedAt },
            new Role { Id = 6, Code = "Admin", Name = "Admin", DisplayName = "Admin", Description = "Sistem yöneticisi", IsActive = true, IsSuperAdmin = false, CreatedAt = SeedCreatedAt },
            new Role { Id = 7, Code = "Muhasebe", Name = "Muhasebe", DisplayName = "Muhasebe", Description = "Finansal işlemler", IsActive = true, IsSuperAdmin = false, CreatedAt = SeedCreatedAt },
            new Role { Id = 8, Code = "Bayi", Name = "Bayi", DisplayName = "Bayi", Description = "Ana bayi", IsActive = true, IsSuperAdmin = false, CreatedAt = SeedCreatedAt },
            new Role { Id = 9, Code = "AltBayi", Name = "AltBayi", DisplayName = "Alt Bayi", Description = "Alt bayi", IsActive = true, IsSuperAdmin = false, CreatedAt = SeedCreatedAt },
            new Role { Id = 10, Code = "Plasiyer", Name = "Plasiyer", DisplayName = "Plasiyer", Description = "Saha satış elemanı", IsActive = true, IsSuperAdmin = false, CreatedAt = SeedCreatedAt },
            new Role { Id = 11, Code = "ServisPersonel", Name = "ServisPersonel", DisplayName = "Servis Personeli", Description = "Teknik servis elemanı", IsActive = true, IsSuperAdmin = false, CreatedAt = SeedCreatedAt },
            new Role { Id = 12, Code = "Kurumsal", Name = "Kurumsal", DisplayName = "Kurumsal", Description = "Kurumsal müşteri", IsActive = true, IsSuperAdmin = false, CreatedAt = SeedCreatedAt }
        );
    }
}
