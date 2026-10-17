using B2B.Erp.Api.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace B2B.Erp.Api.Data.Configurations;

public class UserConfiguration : IEntityTypeConfiguration<User>
{
    private static readonly DateTime SeedCreateTime = new DateTime(2026, 1, 1, 0, 0, 0, DateTimeKind.Utc);

    public void Configure(EntityTypeBuilder<User> builder)
    {
        builder.ToTable("Users");

        builder.HasKey(u => u.Id);

        builder.Property(u => u.Username)
            .IsRequired()
            .HasMaxLength(50);

        builder.Property(u => u.Mail)
            .IsRequired()
            .HasMaxLength(255);

        builder.Property(u => u.FirmaCode)
            .HasMaxLength(64);

        builder.Property(u => u.Password)
            .IsRequired()
            .HasMaxLength(500);

        builder.Property(u => u.Unvan)
            .IsRequired()
            .HasMaxLength(200);

        // 30 KARAKTER (2026-08-20). Kolon 20'ydi: yeni telefon biçimi en uzun hâlinde
        // (17 hane + 3 ayraç) TAM 20 karakter ediyor, yani sıfır paylı. Diğer bütün telefon
        // kolonları zaten 30 ve üstü; bu kolonun tek başına sınırda kalması, ileride biçim
        // bir karakter uzadığında sessiz kırpma ya da yazma hatası demekti.
        builder.Property(u => u.Gsm)
            .HasMaxLength(30);

        // Holds a list of customer codes, not one code — see User.Carikodu.
        builder.Property(u => u.Carikodu)
            .HasMaxLength(8000);

        // Tek bir kod: teknisyenin kendisinin cari kodu, gördüğü carilerin listesi değil.
        builder.Property(u => u.ServiceOpsCariKodu)
            .HasMaxLength(50);

        builder.Property(u => u.SalesmanCode)
            .HasMaxLength(50);

        builder.Property(u => u.DefaultWarehouseCode);
        builder.Property(u => u.DiscountRate).HasPrecision(5, 2);

        builder.Property(u => u.IsActive)
            .IsRequired()
            .HasDefaultValue(true);

        builder.Property(u => u.ServiceOpsAccess)
            .IsRequired()
            .HasDefaultValue(false);

        builder.Property(u => u.EmployeeAccess)
            .IsRequired()
            .HasDefaultValue(false);

        builder.Property(u => u.AsistanAccess)
            .IsRequired()
            .HasDefaultValue(false);

        builder.Property(u => u.CariEkstreTipleri)
            .HasMaxLength(200);

        AuditableEntityConfiguration.ConfigureAudit(builder);

        builder.HasIndex(u => u.Username)
            .IsUnique();

        builder.HasIndex(u => u.Mail)
            .IsUnique();

        builder.HasOne(u => u.Role)
            .WithMany(r => r.Users)
            .HasForeignKey(u => u.RoleId)
            .OnDelete(DeleteBehavior.Restrict);

        builder.HasMany(u => u.RefreshTokens)
            .WithOne(rt => rt.User)
            .HasForeignKey(rt => rt.UserId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}