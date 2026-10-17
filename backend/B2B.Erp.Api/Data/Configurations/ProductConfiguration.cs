using B2B.Erp.Api.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace B2B.Erp.Api.Data.Configurations;

public sealed class ProductConfiguration : IEntityTypeConfiguration<Product>
{
    public void Configure(EntityTypeBuilder<Product> builder)
    {
        builder.ToTable("Products");

        builder.HasKey(x => x.Id);

        builder.Property(x => x.Id)
            .ValueGeneratedNever();

        builder.Property(x => x.CreatedAt)
            .IsRequired();

        builder.Property(x => x.StockCode)
            .IsRequired()
            .HasMaxLength(50);

        builder.HasIndex(x => x.StockCode)
            .IsUnique();

        builder.Property(x => x.Name)
            .IsRequired()
            .HasMaxLength(200);

        builder.Property(x => x.Description)
            .HasMaxLength(2000);

        builder.Property(x => x.Barcode)
            .HasMaxLength(50);



        builder.Property(x => x.ProductType)
            .IsRequired()
            .HasMaxLength(50)
            .HasDefaultValue("URUN");

        builder.Property(x => x.Kod4)
            .HasMaxLength(500);

        builder.Property(x => x.Kod5)
            .HasMaxLength(200);

        builder.Property(x => x.Unit)
            .IsRequired()
            .HasMaxLength(20);

        builder.Property(x => x.TaxRate)
            .IsRequired();

        builder.Property(x => x.DiscountRate)
            .IsRequired()
            .HasPrecision(5, 2)
            .HasDefaultValue(0m);

        builder.Property(x => x.SupplierId);

        builder.HasOne(x => x.Supplier)
            .WithMany()
            .HasForeignKey(x => x.SupplierId)
            .OnDelete(DeleteBehavior.SetNull);

        builder.Property(x => x.BoxQuantity)
            .IsRequired()
            .HasDefaultValue(0);

        builder.Property(x => x.PurchasePrice)
            .IsRequired()
            .HasPrecision(18, 2)
            .HasDefaultValue(0m);

        builder.Property(x => x.BsyVisibleFlag)
            .IsRequired()
            .HasMaxLength(1)
            .HasDefaultValue("E");

        builder.Property(x => x.BsyMinStock)
            .IsRequired()
            .HasDefaultValue(12);

        builder.Property(x => x.ContainerQuantity)
            .IsRequired()
            .HasDefaultValue(0);

        builder.Property(x => x.Freight)
            .IsRequired()
            .HasPrecision(18, 2)
            .HasDefaultValue(0m);

        builder.Property(x => x.CurrencyCode)
            .IsRequired()
            .HasDefaultValue(0);

        builder.Property(x => x.IsOfficial)
            .IsRequired();

        builder.Property(x => x.Stock)
            .IsRequired()
            .HasDefaultValue(0);

        builder.Property(x => x.IsActive)
            .IsRequired()
            .HasDefaultValue(true);

        builder.Property(x => x.ImageUrlsJson)
            .HasMaxLength(4000);
        builder.Property(x => x.VideoUrl)
            .HasMaxLength(500);
        builder.Property(x => x.VideoUrlsJson)
            .HasMaxLength(4000);

        builder.Property(x => x.ImageUrl)
            .HasMaxLength(500);

        builder.Property(x => x.IsInstallable)
            .IsRequired()
            .HasDefaultValue(false);

        builder.Property(x => x.InstallationFee)
            .HasPrecision(18, 2);

        builder.HasOne(x => x.MainCategory)
            .WithMany()
            .HasForeignKey(x => x.MainCategoryId)
            .OnDelete(DeleteBehavior.SetNull);

        builder.HasOne(x => x.Category)
            .WithMany()
            .HasForeignKey(x => x.CategoryId)
            .OnDelete(DeleteBehavior.SetNull);
    }
}
