using B2B.Erp.Api.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace B2B.Erp.Api.Data.Configurations;

public sealed class CashAccountTransactionConfiguration : IEntityTypeConfiguration<CashAccountTransaction>
{
    public void Configure(EntityTypeBuilder<CashAccountTransaction> builder)
    {
        builder.ToTable("CashAccountTransactions");

        builder.HasKey(x => x.Id);

        builder.Property(x => x.Date)
            .IsRequired();

        builder.Property(x => x.Amount)
            .HasPrecision(18, 2)
            .IsRequired();

        builder.Property(x => x.CurrencyTypeId)
            .IsRequired()
            .HasDefaultValue(0);

        builder.Property(x => x.CurrencyRate)
            .HasPrecision(18, 6)
            .IsRequired()
            .HasDefaultValue(1m);

        builder.Property(x => x.CurrencyAmount)
            .HasPrecision(18, 2)
            .IsRequired()
            .HasDefaultValue(0m);

        builder.Property(x => x.CounterpartyCode)
            .IsRequired()
            .HasMaxLength(50);

        builder.Property(x => x.CounterpartyName)
            .IsRequired()
            .HasMaxLength(255);

        builder.Property(x => x.Description)
            .HasMaxLength(2000);

        builder.HasIndex(x => new { x.CashAccountId, x.Date });

        builder.HasOne(x => x.CashAccount)
            .WithMany()
            .HasForeignKey(x => x.CashAccountId)
            .OnDelete(DeleteBehavior.Restrict);

        AuditableEntityConfiguration.ConfigureAudit(builder);
    }
}
