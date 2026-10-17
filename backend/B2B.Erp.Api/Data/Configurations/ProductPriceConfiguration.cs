using B2B.Erp.Api.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace B2B.Erp.Api.Data.Configurations;

public sealed class ProductPriceConfiguration : IEntityTypeConfiguration<ProductPrice>
{
    public void Configure(EntityTypeBuilder<ProductPrice> builder)
    {
        builder.ToTable("ProductPrices");

        builder.HasKey(x => x.Id);

        builder.Property(x => x.Id)
            .ValueGeneratedNever();

        builder.Property(x => x.ProductId)
            .IsRequired();

        builder.Property(x => x.PriceGroupId)
            .IsRequired();

        builder.Property(x => x.Price)
            .IsRequired()
            .HasPrecision(18, 2);

        builder.Property(x => x.Currency)
            .IsRequired()
            .HasMaxLength(3);

        builder.HasIndex(x => new { x.ProductId, x.PriceGroupId })
            .IsUnique();

        builder.HasOne(x => x.Product)
            .WithMany(x => x.ProductPrices)
            .HasForeignKey(x => x.ProductId)
            .OnDelete(DeleteBehavior.Cascade);

        builder.HasOne(x => x.PriceGroup)
            .WithMany(x => x.ProductPrices)
            .HasForeignKey(x => x.PriceGroupId)
            .OnDelete(DeleteBehavior.Restrict);
    }
}
