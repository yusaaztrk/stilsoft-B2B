using B2B.Erp.Api.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace B2B.Erp.Api.Data.Configurations;

public sealed class LoanPaymentConfiguration : IEntityTypeConfiguration<LoanPayment>
{
    public void Configure(EntityTypeBuilder<LoanPayment> builder)
    {
        builder.ToTable("LoanPayments");

        builder.HasKey(x => x.Id);

        builder.Property(x => x.Date).IsRequired();

        builder.Property(x => x.Amount)
            .HasPrecision(18, 2)
            .IsRequired();

        builder.Property(x => x.CurrencyRate)
            .HasPrecision(18, 6)
            .IsRequired()
            .HasDefaultValue(1m);

        builder.Property(x => x.TryAmount)
            .HasPrecision(18, 2)
            .IsRequired()
            .HasDefaultValue(0m);

        builder.Property(x => x.Description)
            .HasMaxLength(2000);

        builder.HasIndex(x => x.LoanId);
        builder.HasIndex(x => x.LoanInstallmentId);
        builder.HasIndex(x => x.BankAccountTransactionId);

        builder.HasOne(x => x.Loan)
            .WithMany()
            .HasForeignKey(x => x.LoanId)
            .OnDelete(DeleteBehavior.Cascade);

        builder.HasOne(x => x.Installment)
            .WithMany(x => x.Payments)
            .HasForeignKey(x => x.LoanInstallmentId)
            .OnDelete(DeleteBehavior.Cascade);

        builder.HasOne(x => x.BankAccountDefinition)
            .WithMany()
            .HasForeignKey(x => x.BankAccountDefinitionId)
            .OnDelete(DeleteBehavior.Restrict);

        AuditableEntityConfiguration.ConfigureAudit(builder);
    }
}
