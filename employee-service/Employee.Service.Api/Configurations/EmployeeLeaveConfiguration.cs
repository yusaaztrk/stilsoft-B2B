using B2B.Erp.Api.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace B2B.Erp.Api.Data.Configurations;

public sealed class EmployeeLeaveConfiguration : IEntityTypeConfiguration<EmployeeLeave>
{
    public void Configure(EntityTypeBuilder<EmployeeLeave> builder)
    {
        builder.ToTable("EmployeeLeaves");

        builder.HasKey(x => x.Id);

        builder.Property(x => x.LeaveStartTime)
            .IsRequired();

        builder.Property(x => x.ReturnTime)
            .IsRequired();

        builder.Property(x => x.Description)
            .HasMaxLength(2000);

        builder.Property(x => x.LeaveType)
            .IsRequired();

        builder.Property(x => x.Status)
            .IsRequired();

        builder.Property(x => x.DayCount)
            .HasPrecision(6, 2)
            .IsRequired();

        builder.Property(x => x.DecidedBy)
            .HasMaxLength(50);

        builder.Property(x => x.RejectReason)
            .HasMaxLength(500);

        builder.HasIndex(x => new { x.EmployeeId, x.LeaveStartTime });

        builder.HasOne(x => x.Employee)
            .WithMany()
            .HasForeignKey(x => x.EmployeeId)
            .OnDelete(DeleteBehavior.Cascade);

        AuditableEntityConfiguration.ConfigureAudit(builder);
    }
}
