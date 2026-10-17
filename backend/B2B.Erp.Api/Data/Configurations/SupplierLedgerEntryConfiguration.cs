using B2B.Erp.Api.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace B2B.Erp.Api.Data.Configurations;

public sealed class SupplierLedgerEntryConfiguration : IEntityTypeConfiguration<SupplierLedgerEntry>
{
    public void Configure(EntityTypeBuilder<SupplierLedgerEntry> builder)
    {
        builder.ToTable("SupplierLedgerEntries");

        builder.HasKey(x => x.Id);

        builder.Property(x => x.SupplierCode)
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

        builder.Property(x => x.DocumentNo)
            .HasMaxLength(30);

        builder.Property(x => x.Description)
            .HasMaxLength(2000);

        builder.Property(x => x.TransactionType)
            .HasMaxLength(120);

        builder.HasIndex(x => new { x.SupplierCode, x.Date });

        builder.HasOne(x => x.Supplier)
            .WithMany()
            .HasForeignKey(x => x.SupplierCode)
            .HasPrincipalKey(x => x.SupplierCode)
            .OnDelete(DeleteBehavior.Restrict);

        AuditableEntityConfiguration.ConfigureAudit(builder);
    }
}
