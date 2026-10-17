using B2B.Erp.Api.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace B2B.Erp.Api.Data.Configurations;

public sealed class InvoiceConfiguration : IEntityTypeConfiguration<Invoice>
{
    public void Configure(EntityTypeBuilder<Invoice> builder)
    {
        builder.ToTable("Invoices");

        builder.HasKey(x => x.Id);

        builder.Property(x => x.Id)
            .ValueGeneratedOnAdd();

        builder.Property(x => x.Type)
            .HasConversion(
                v => ((char)v).ToString(),
                v => (InvoiceType)v[0])
            .IsRequired()
            .HasMaxLength(1);

        builder.Property(x => x.InvoiceNo)
            .IsRequired()
            .HasMaxLength(30);

        builder.HasIndex(x => x.InvoiceNo)
            .IsUnique();

        builder.Property(x => x.SourceCustomerOfferId);

        builder.HasIndex(x => x.SourceCustomerOfferId);

        builder.Property(x => x.SourcePurchaseInvoiceId);

        builder.HasIndex(x => x.SourcePurchaseInvoiceId);

        builder.Property(x => x.CustomerCode)
            .IsRequired()
            .HasMaxLength(50);

        builder.Property(x => x.CustomerNameOverride)
            .HasMaxLength(200);

        builder.Property(x => x.CustomerInvoiceTypeOverride)
            .HasMaxLength(50);

        builder.Property(x => x.DeliveryCustomerCode)
            .IsRequired()
            .HasMaxLength(50);

        builder.Property(x => x.Date)
            .IsRequired();

        builder.Property(x => x.VatIncluded)
            .IsRequired();

        builder.Property(x => x.Subtotal)
            .HasPrecision(18, 2);

        builder.Property(x => x.Discount)
            .HasPrecision(18, 2);

        builder.Property(x => x.NetTotal)
            .HasPrecision(18, 2);

        builder.Property(x => x.VatTotal)
            .HasPrecision(18, 2);

        builder.Property(x => x.GrandTotal)
            .HasPrecision(18, 2);

        builder.Property(x => x.SalesmanCode)
            .HasMaxLength(50);

        builder.Property(x => x.Description)
            .HasMaxLength(2000);

        builder.Property(x => x.InstallationName)
            .HasMaxLength(100);

        builder.Property(x => x.InstallationPhone)
            .HasMaxLength(30);

        builder.Property(x => x.IsManuallyPaid)
            .IsRequired()
            .HasDefaultValue(false);

        builder.Property(x => x.IsPriceOverridden)
            .IsRequired()
            .HasDefaultValue(false);

        AuditableEntityConfiguration.ConfigureAudit(builder);
    }
}
