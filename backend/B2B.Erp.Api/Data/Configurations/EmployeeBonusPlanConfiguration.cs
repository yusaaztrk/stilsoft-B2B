using B2B.Erp.Api.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace B2B.Erp.Api.Data.Configurations;

public sealed class EmployeeBonusPlanConfiguration : IEntityTypeConfiguration<EmployeeBonusPlan>
{
    public void Configure(EntityTypeBuilder<EmployeeBonusPlan> builder)
    {
        builder.ToTable("EmployeeBonusPlans");

        builder.HasKey(x => x.Id);

        builder.Property(x => x.PlannedDate)
            .IsRequired();

        builder.Property(x => x.Amount)
            .HasPrecision(18, 2)
            .IsRequired();

        builder.Property(x => x.Description)
            .HasMaxLength(2000);

        builder.Property(x => x.Status)
            .IsRequired();

        builder.HasIndex(x => new { x.EmployeeId, x.PlannedDate });

        builder.HasOne(x => x.Employee)
            .WithMany()
            .HasForeignKey(x => x.EmployeeId)
            .OnDelete(DeleteBehavior.Cascade);

        builder.HasOne(x => x.PaidPayment)
            .WithMany()
            .HasForeignKey(x => x.PaidPaymentId)
            .OnDelete(DeleteBehavior.Restrict);

        AuditableEntityConfiguration.ConfigureAudit(builder);
    }
}
