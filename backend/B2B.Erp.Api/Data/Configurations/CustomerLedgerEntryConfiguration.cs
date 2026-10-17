using B2B.Erp.Api.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace B2B.Erp.Api.Data.Configurations;

public sealed class CustomerLedgerEntryConfiguration : IEntityTypeConfiguration<CustomerLedgerEntry>
{
    public void Configure(EntityTypeBuilder<CustomerLedgerEntry> builder)
    {
        builder.ToTable("CustomerLedgerEntries");

        builder.HasKey(x => x.Id);

        builder.Property(x => x.CustomerCode)
            .IsRequired()
            .HasMaxLength(50);

        builder.Property(x => x.Date)
            .IsRequired();

        builder.Property(x => x.DueDate);

        builder.Property(x => x.Amount)
            .HasPrecision(18, 2)
            .IsRequired();

        builder.Property(x => x.CurrencyTypeId)
            .IsRequired();

        builder.Property(x => x.CurrencyRate)
            .HasPrecision(18, 6)
            .IsRequired();

        builder.Property(x => x.CurrencyAmount)
            .HasPrecision(18, 2)
            .IsRequired();

        // Paranın işlendiği cari döviz hesabı. 0 = belirtilmemiş (eski satırlar).
        builder.Property(x => x.TargetAccountCurrencyTypeId)
            .IsRequired()
            .HasDefaultValue(0);

        builder.Property(x => x.DocumentNo)
            .HasMaxLength(30);

        builder.Property(x => x.Description)
            .HasMaxLength(2000);

        builder.Property(x => x.TransactionType)
            .HasMaxLength(120);

        builder.Property(x => x.DeliveryCustomerCode)
            .HasMaxLength(50);

        builder.Property(x => x.IsOpeningBalance)
            .IsRequired()
            .HasDefaultValue(false);

        builder.Property(x => x.IsCancelled)
            .IsRequired()
            .HasDefaultValue(false);

        builder.HasIndex(x => new { x.CustomerCode, x.Date });
        builder.HasIndex(x => new { x.CustomerCode, x.AccountingPeriodId, x.Date });
        builder.HasIndex(x => new { x.CustomerCode, x.IsOpeningBalance });
        builder.HasIndex(x => new { x.CustomerCode, x.CurrencyTypeId, x.AccountingPeriodId });

        builder.HasOne(x => x.Customer)
            .WithMany()
            .HasForeignKey(x => x.CustomerCode)
            .HasPrincipalKey(x => x.CustomerCode)
            .OnDelete(DeleteBehavior.Restrict);

        builder.HasOne(x => x.AccountingPeriod)
            .WithMany()
            .HasForeignKey(x => x.AccountingPeriodId)
            .OnDelete(DeleteBehavior.SetNull);

        AuditableEntityConfiguration.ConfigureAudit(builder);
    }
}
