using B2B.Erp.Api.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace B2B.Erp.Api.Data.Configurations;

public sealed class BankAccountTransactionConfiguration : IEntityTypeConfiguration<BankAccountTransaction>
{
    public void Configure(EntityTypeBuilder<BankAccountTransaction> builder)
    {
        builder.ToTable("BankAccountTransactions");

        builder.HasKey(x => x.Id);

        builder.Property(x => x.Date)
            .IsRequired();

        builder.Property(x => x.Amount)
            .HasPrecision(18, 2)
            .IsRequired();

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

        builder.Property(x => x.DocumentNo)
            .HasMaxLength(30);

        builder.Property(x => x.MaturityDate);

        builder.Property(x => x.Description)
            .HasMaxLength(2000);

        builder.Property(x => x.IsPosFee)
            .IsRequired()
            .HasDefaultValue(false);

        builder.HasIndex(x => new { x.BankAccountDefinitionId, x.Date, x.CreateTime, x.Id });
        builder.HasIndex(x => new { x.Date, x.CreateTime, x.Id });

        builder.HasOne(x => x.BankAccountDefinition)
            .WithMany()
            .HasForeignKey(x => x.BankAccountDefinitionId)
            .OnDelete(DeleteBehavior.Restrict);

        AuditableEntityConfiguration.ConfigureAudit(builder);
    }
}
