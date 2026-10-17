using B2B.Erp.Api.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace B2B.Erp.Api.Data.Configurations;

public sealed class EmployeeCheckInConfiguration : IEntityTypeConfiguration<EmployeeCheckIn>
{
    public void Configure(EntityTypeBuilder<EmployeeCheckIn> builder)
    {
        builder.ToTable("EmployeeCheckIns");

        builder.HasKey(x => x.Id);

        builder.Property(x => x.CheckInTime).IsRequired();
        builder.Property(x => x.CheckOutTime).IsRequired(false);
        builder.Property(x => x.Latitude).HasColumnType("numeric(9,6)");
        builder.Property(x => x.Longitude).HasColumnType("numeric(9,6)");
        builder.Property(x => x.CheckOutLatitude).HasColumnType("numeric(9,6)");
        builder.Property(x => x.CheckOutLongitude).HasColumnType("numeric(9,6)");

        builder.Property(x => x.City)
            .HasMaxLength(120)
            .IsRequired(false);

        builder.Property(x => x.District)
            .HasMaxLength(120)
            .IsRequired(false);

        builder.HasOne(x => x.Employee)
            .WithMany()
            .HasForeignKey(x => x.EmployeeId)
            .OnDelete(DeleteBehavior.Restrict);

        builder.HasIndex(x => new { x.EmployeeId, x.CheckInTime });
    }
}
