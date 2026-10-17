using B2B.Erp.Api.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace B2B.Erp.Api.Data.Configurations;

public sealed class InstallationConfiguration : IEntityTypeConfiguration<Installation>
{
    public void Configure(EntityTypeBuilder<Installation> builder)
    {
        builder.ToTable("Installations");

        builder.HasKey(x => x.Id);

        builder.Property(x => x.Id)
            .ValueGeneratedOnAdd();

        builder.Property(x => x.DealerCode)
            .HasMaxLength(50);

        builder.Property(x => x.Type)
            .IsRequired()
            .HasMaxLength(20);

        builder.Property(x => x.Status)
            .IsRequired()
            .HasMaxLength(30);

        builder.Property(x => x.Technician)
            .HasMaxLength(100);

        builder.Property(x => x.DealerName)
            .IsRequired()
            .HasMaxLength(255);

        builder.Property(x => x.ProductName)
            .IsRequired()
            .HasMaxLength(255);

        builder.Property(x => x.Quantity)
            .HasPrecision(18, 3);

        builder.Property(x => x.InstallationName)
            .HasMaxLength(100);

        builder.Property(x => x.InstallationPhone)
            .HasMaxLength(30);

        builder.Property(x => x.Address)
            .IsRequired()
            .HasMaxLength(1000);

        builder.Property(x => x.Region)
            .IsRequired()
            .HasMaxLength(100);

        builder.Property(x => x.DealerDescription)
            .HasMaxLength(2000);

        builder.Property(x => x.LineageId);
        builder.Property(x => x.InstallationClientId);

        builder.HasIndex(x => x.InstallationClientId)
            .IsUnique()
            // PostgreSQL folds unquoted identifiers to lower case, so this predicate looked
            // for a column named "installationclientid" and any schema generated from the
            // model failed. CustomerConfiguration already quotes its filter the same way.
            .HasFilter("\"InstallationClientId\" IS NOT NULL");

        builder.HasOne(x => x.InvoiceLine)
            .WithMany(x => x.Installations)
            .HasForeignKey(x => x.InvoiceLineId)
            .OnDelete(DeleteBehavior.SetNull);

        builder.HasOne(x => x.SalesOrderLine)
            .WithMany(x => x.Installations)
            .HasForeignKey(x => x.SalesOrderLineId)
            .OnDelete(DeleteBehavior.SetNull);

        builder.HasOne(x => x.CustomerOfferLine)
            .WithMany(x => x.Installations)
            .HasForeignKey(x => x.CustomerOfferLineId)
            .OnDelete(DeleteBehavior.SetNull);

        AuditableEntityConfiguration.ConfigureAudit(builder);
    }
}
