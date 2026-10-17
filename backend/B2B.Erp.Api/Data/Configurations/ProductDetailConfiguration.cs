using B2B.Erp.Api.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace B2B.Erp.Api.Data.Configurations;

public sealed class ProductDetailConfiguration : IEntityTypeConfiguration<ProductDetail>
{
    public void Configure(EntityTypeBuilder<ProductDetail> builder)
    {
        builder.ToTable("ProductDetails");
        builder.HasKey(x => x.Id);

        builder.Property(x => x.StockCode)
            .IsRequired()
            .HasMaxLength(50);

        // One row of copy per product. Enforced here rather than left to the importer, which
        // would otherwise be able to leave two competing descriptions behind after a re-run.
        builder.HasIndex(x => x.StockCode).IsUnique();

        // Long-form text: a feature list runs to a dozen lines and a description is a paragraph.
        builder.Property(x => x.Description).HasMaxLength(4000);
        builder.Property(x => x.Features).HasMaxLength(4000);
    }
}
