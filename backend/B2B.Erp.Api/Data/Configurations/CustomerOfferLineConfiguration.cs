using B2B.Erp.Api.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace B2B.Erp.Api.Data.Configurations;

public sealed class CustomerOfferLineConfiguration : IEntityTypeConfiguration<CustomerOfferLine>
{
    public void Configure(EntityTypeBuilder<CustomerOfferLine> builder)
    {
        builder.ToTable("CustomerOfferLines");

        builder.HasKey(x => x.Id);

        builder.Property(x => x.Id)
            .ValueGeneratedOnAdd();

        builder.Property(x => x.CustomerOfferId)
            .IsRequired();

        builder.Property(x => x.ProductId)
            .IsRequired();

        builder.Property(x => x.StockCode)
            .IsRequired()
            .HasMaxLength(50);

        builder.HasIndex(x => x.StockCode);

        builder.Property(x => x.Description)
            .HasMaxLength(500);

        builder.Property(x => x.Quantity)
            .HasPrecision(18, 3);

        builder.Property(x => x.UnitPrice)
            .HasPrecision(18, 2);

        builder.Property(x => x.VatRate)
            .HasPrecision(18, 2);

        builder.Property(x => x.DiscountType)
            .IsRequired();

        builder.Property(x => x.DiscountValue)
            .HasPrecision(18, 2);

        builder.Property(x => x.LineNo)
            .IsRequired();

        builder.HasIndex(x => new { x.CustomerOfferId, x.LineNo });

        builder.HasOne(x => x.CustomerOffer)
            .WithMany(x => x.Lines)
            .HasForeignKey(x => x.CustomerOfferId)
            .OnDelete(DeleteBehavior.Cascade);

        builder.HasOne(x => x.Product)
            .WithMany()
            .HasForeignKey(x => x.ProductId)
            .OnDelete(DeleteBehavior.Restrict);

        AuditableEntityConfiguration.ConfigureAudit(builder);
    }
}
