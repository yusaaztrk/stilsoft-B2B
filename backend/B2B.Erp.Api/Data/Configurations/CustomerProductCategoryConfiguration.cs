using B2B.Erp.Api.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace B2B.Erp.Api.Data.Configurations;

public sealed class CustomerProductCategoryConfiguration : IEntityTypeConfiguration<CustomerProductCategory>
{
    public void Configure(EntityTypeBuilder<CustomerProductCategory> builder)
    {
        builder.ToTable("CustomerProductCategories");

        builder.HasKey(x => new { x.CustomerCode, x.ProductCategoryId });

        builder.Property(x => x.CustomerCode)
            .IsRequired()
            .HasMaxLength(50);

        builder.HasOne(x => x.Customer)
            .WithMany(x => x.CustomerProductCategories)
            .HasForeignKey(x => x.CustomerCode)
            .HasPrincipalKey(x => x.CustomerCode)
            .OnDelete(DeleteBehavior.Cascade);

        builder.HasOne(x => x.ProductCategory)
            .WithMany()
            .HasForeignKey(x => x.ProductCategoryId)
            .OnDelete(DeleteBehavior.Cascade);

        builder.HasIndex(x => x.ProductCategoryId);
    }
}
