using B2B.Erp.Api.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace B2B.Erp.Api.Data.Configurations;

public sealed class ProductPriceHistoryConfiguration : IEntityTypeConfiguration<ProductPriceHistory>
{
    public void Configure(EntityTypeBuilder<ProductPriceHistory> builder)
    {
        builder.ToTable("ProductPriceHistories");

        builder.HasKey(x => x.Id);
        builder.Property(x => x.Id).ValueGeneratedNever();

        builder.Property(x => x.ProductId).IsRequired();
        builder.Property(x => x.StockCode).HasMaxLength(50).IsRequired();
        builder.Property(x => x.PriceGroupCode).IsRequired();

        builder.Property(x => x.OldPrice).HasPrecision(18, 2).IsRequired();
        builder.Property(x => x.NewPrice).HasPrecision(18, 2).IsRequired();
        builder.Property(x => x.ChangeRate).HasPrecision(18, 6).IsRequired(false);

        builder.Property(x => x.ChangedAt).IsRequired();
        builder.Property(x => x.ChangedBy).HasMaxLength(100).IsRequired();
        builder.Property(x => x.Source).HasMaxLength(50).IsRequired();

        // Ekran "son 2 değişiklik"i sorguluyor: ürün + grup + tarih sırası.
        builder.HasIndex(x => new { x.ProductId, x.PriceGroupCode, x.ChangedAt });
    }
}
