using B2B.Erp.Api.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace B2B.Erp.Api.Data.Configurations;

public sealed class CariOfferLineConfiguration : IEntityTypeConfiguration<CariOfferLine>
{
    public void Configure(EntityTypeBuilder<CariOfferLine> builder)
    {
        builder.ToTable("CariOfferLines");

        builder.HasKey(x => x.Id);

        builder.Property(x => x.Id)
            .ValueGeneratedOnAdd();

        builder.Property(x => x.StockCode)
            .IsRequired()
            .HasMaxLength(50);

        builder.Property(x => x.Description)
            .HasMaxLength(2000);

        builder.Property(x => x.Quantity)
            .HasPrecision(18, 3);

        builder.Property(x => x.UnitPrice)
            .HasPrecision(18, 4);

        builder.Property(x => x.VatRate)
            .HasPrecision(18, 2);

        builder.Property(x => x.DiscountValue)
            .HasPrecision(18, 2);

        builder.HasIndex(x => new { x.CariOfferId, x.LineNo })
            .IsUnique();

        builder.HasOne(x => x.Product)
            .WithMany()
            .HasForeignKey(x => x.ProductId)
            .OnDelete(DeleteBehavior.Restrict);

        AuditableEntityConfiguration.ConfigureAudit(builder);
    }
}
