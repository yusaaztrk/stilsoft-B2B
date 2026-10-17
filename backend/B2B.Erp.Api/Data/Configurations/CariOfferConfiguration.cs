using B2B.Erp.Api.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace B2B.Erp.Api.Data.Configurations;

public sealed class CariOfferConfiguration : IEntityTypeConfiguration<CariOffer>
{
    public void Configure(EntityTypeBuilder<CariOffer> builder)
    {
        builder.ToTable("CariOffers");

        builder.HasKey(x => x.Id);

        builder.Property(x => x.Id)
            .ValueGeneratedOnAdd();

        builder.Property(x => x.DocumentNo)
            .IsRequired()
            .HasMaxLength(15);

        builder.HasIndex(x => x.DocumentNo)
            .IsUnique();

        builder.Property(x => x.ProformaDocumentNo)
            .HasMaxLength(15);

        builder.HasIndex(x => x.ProformaDocumentNo)
            .IsUnique();

        builder.Property(x => x.Date)
            .IsRequired();

        builder.Property(x => x.CustomerCode)
            .HasMaxLength(50);

        builder.Property(x => x.DeliveryCustomerCode)
            .HasMaxLength(50);

        builder.Property(x => x.BayiMuhtelifCustomerId);

        builder.Property(x => x.VatExempt)
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

        builder.Property(x => x.InvoiceNo)
            .HasMaxLength(15);

        builder.Property(x => x.SalesmanCode)
            .HasMaxLength(50);

        builder.Property(x => x.Description)
            .HasMaxLength(2000);

        builder.HasOne(x => x.BayiMuhtelifCustomer)
            .WithMany()
            .HasForeignKey(x => x.BayiMuhtelifCustomerId)
            .OnDelete(DeleteBehavior.Restrict);

        builder.HasMany(x => x.Lines)
            .WithOne(x => x.CariOffer)
            .HasForeignKey(x => x.CariOfferId)
            .OnDelete(DeleteBehavior.Cascade);

        AuditableEntityConfiguration.ConfigureAudit(builder);
    }
}
