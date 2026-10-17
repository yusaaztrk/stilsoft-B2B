using B2B.Erp.Api.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace B2B.Erp.Api.Data.Configurations;

public sealed class EmployeePaymentConfiguration : IEntityTypeConfiguration<EmployeePayment>
{
    public void Configure(EntityTypeBuilder<EmployeePayment> builder)
    {
        builder.ToTable("EmployeePayments");

        builder.HasKey(x => x.Id);

        builder.Property(x => x.PaymentDate)
            .IsRequired();

        builder.Property(x => x.Type)
            .IsRequired();

        builder.Property(x => x.Amount)
            .HasPrecision(18, 2)
            .IsRequired();

        builder.Property(x => x.Description)
            .HasMaxLength(2000);

        builder.Property(x => x.SalaryPeriod)
            .HasMaxLength(7);

        builder.Property(x => x.MovementCurrencyRate)
            .HasPrecision(18, 6);

        builder.Property(x => x.MovementCurrencyAmount)
            .HasPrecision(18, 2);

        builder.HasIndex(x => new { x.EmployeeId, x.PaymentDate });
        builder.HasIndex(x => new { x.EmployeeId, x.Type, x.SalaryPeriod });

        builder.HasOne(x => x.Employee)
            .WithMany()
            .HasForeignKey(x => x.EmployeeId)
            .OnDelete(DeleteBehavior.Cascade);

        AuditableEntityConfiguration.ConfigureAudit(builder);
    }
}
