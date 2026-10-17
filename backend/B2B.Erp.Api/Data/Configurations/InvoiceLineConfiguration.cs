using B2B.Erp.Api.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace B2B.Erp.Api.Data.Configurations;

public sealed class InvoiceLineConfiguration : IEntityTypeConfiguration<InvoiceLine>
{
    public void Configure(EntityTypeBuilder<InvoiceLine> builder)
    {
        builder.ToTable("InvoiceLines");

        builder.HasKey(x => x.Id);

        builder.Property(x => x.Id)
            .ValueGeneratedOnAdd();

        builder.Property(x => x.InvoiceId)
            .IsRequired();

        builder.Property(x => x.SalesOrderLineId)
            .IsRequired(false);

        builder.Property(x => x.SourcePurchaseInvoiceLineId)
            .IsRequired(false);

        builder.Property(x => x.StockCode)
            .IsRequired()
            .HasMaxLength(50);

        builder.HasIndex(x => x.StockCode);

        builder.HasIndex(x => x.SourcePurchaseInvoiceLineId);

        builder.Property(x => x.Description)
            .HasMaxLength(500);

        builder.Property(x => x.Quantity)
            .HasPrecision(18, 3);

        builder.Property(x => x.UnitPrice)
            .HasPrecision(18, 2);

        builder.Property(x => x.CurrencyTypeId)
            .IsRequired()
            .HasDefaultValue(0);

        builder.Property(x => x.CurrencyRate)
            .HasPrecision(18, 6)
            .IsRequired()
            .HasDefaultValue(1m);

        builder.Property(x => x.CurrencyUnitPrice)
            .HasPrecision(18, 2)
            .IsRequired()
            .HasDefaultValue(0m);

        builder.Property(x => x.VatRate)
            .HasPrecision(18, 2);

        builder.Property(x => x.LineNo)
            .IsRequired();

        builder.HasIndex(x => new { x.InvoiceId, x.LineNo });

        builder.HasOne(x => x.Invoice)
            .WithMany()
            .HasForeignKey(x => x.InvoiceId)
            .OnDelete(DeleteBehavior.Cascade);

        AuditableEntityConfiguration.ConfigureAudit(builder);
    }
}
