using B2B.Erp.Api.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace B2B.Erp.Api.Data.Configurations;

public sealed class PurchaseInvoiceConfiguration : IEntityTypeConfiguration<PurchaseInvoice>
{
    public void Configure(EntityTypeBuilder<PurchaseInvoice> builder)
    {
        builder.ToTable("PurchaseInvoices");

        builder.HasKey(x => x.Id);

        builder.Property(x => x.Id)
            .ValueGeneratedOnAdd();

        builder.Property(x => x.DocumentNo)
            .IsRequired()
            .HasMaxLength(15);

        builder.HasIndex(x => x.DocumentNo)
            .IsUnique();

        builder.Property(x => x.Date)
            .IsRequired();

        builder.Property(x => x.Kind)
            .IsRequired();

        builder.Property(x => x.TerminStatus)
            .IsRequired()
            .HasDefaultValue(PurchaseInvoiceTerminStatus.Waiting);

        builder.Property(x => x.SupplierCode)
            .HasMaxLength(50);

        builder.Property(x => x.ServiceCode)
            .HasMaxLength(50);

        builder.Property(x => x.CustomerCode)
            .HasMaxLength(50);

        builder.Property(x => x.MuhtelifCustomerId);

        builder.Property(x => x.VatExempt)
            .IsRequired();

        builder.Property(x => x.Approved)
            .IsRequired();

        builder.Property(x => x.Subtotal)
            .HasPrecision(18, 2);

        builder.Property(x => x.DiscountTotal)
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

        builder.Property(x => x.EstimatedArrivalDate);

        builder.HasOne(x => x.MuhtelifCustomer)
            .WithMany()
            .HasForeignKey(x => x.MuhtelifCustomerId)
            .OnDelete(DeleteBehavior.Restrict);

        builder.HasMany(x => x.Lines)
            .WithOne(x => x.PurchaseInvoice)
            .HasForeignKey(x => x.PurchaseInvoiceId)
            .OnDelete(DeleteBehavior.Cascade);

        AuditableEntityConfiguration.ConfigureAudit(builder);
    }
}
