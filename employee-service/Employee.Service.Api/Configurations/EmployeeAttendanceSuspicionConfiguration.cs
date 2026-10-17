using B2B.Erp.Api.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace B2B.Erp.Api.Data.Configurations;

public sealed class EmployeeAttendanceSuspicionConfiguration : IEntityTypeConfiguration<EmployeeAttendanceSuspicion>
{
    public void Configure(EntityTypeBuilder<EmployeeAttendanceSuspicion> builder)
    {
        builder.ToTable("EmployeeAttendanceSuspicions");

        builder.HasKey(x => x.Id);

        builder.Property(x => x.EventKind).HasMaxLength(10).IsRequired();
        builder.Property(x => x.RuleCode).HasMaxLength(40).IsRequired();
        builder.Property(x => x.Detail).HasMaxLength(500).IsRequired();
        builder.Property(x => x.Source).HasMaxLength(20).IsRequired();
        builder.Property(x => x.Latitude).HasColumnType("numeric(9,6)");
        builder.Property(x => x.Longitude).HasColumnType("numeric(9,6)");
        builder.Property(x => x.ReviewedBy).HasMaxLength(50).IsRequired(false);
        builder.Property(x => x.ReviewNote).HasMaxLength(500).IsRequired(false);

        builder.HasIndex(x => new { x.EmployeeId, x.CreateTime });
        builder.HasIndex(x => x.CreateTime);
    }
}
