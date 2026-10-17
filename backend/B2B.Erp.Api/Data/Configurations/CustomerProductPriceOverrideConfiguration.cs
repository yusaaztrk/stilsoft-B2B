using B2B.Erp.Api.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace B2B.Erp.Api.Data.Configurations;

public sealed class CustomerProductPriceOverrideConfiguration : IEntityTypeConfiguration<CustomerProductPriceOverride>
{
    public void Configure(EntityTypeBuilder<CustomerProductPriceOverride> builder)
    {
        builder.ToTable("CustomerProductPriceOverrides");

        builder.HasKey(x => x.Id);

        builder.Property(x => x.Id)
            .ValueGeneratedNever();

        builder.Property(x => x.CustomerCode)
            .IsRequired()
            .HasMaxLength(50);

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

        builder.Property(x => x.IsActive)
            .IsRequired()
            .HasDefaultValue(true);

        builder.HasIndex(x => new { x.CustomerCode, x.ProductId, x.PriceGroupId })
            .IsUnique();

        builder.HasOne(x => x.Customer)
            .WithMany()
            .HasForeignKey(x => x.CustomerCode)
            .HasPrincipalKey(x => x.CustomerCode)
            .OnDelete(DeleteBehavior.Restrict);

        builder.HasOne(x => x.Product)
            .WithMany()
            .HasForeignKey(x => x.ProductId)
            .OnDelete(DeleteBehavior.Cascade);

        builder.HasOne(x => x.PriceGroup)
            .WithMany()
            .HasForeignKey(x => x.PriceGroupId)
            .OnDelete(DeleteBehavior.Restrict);
    }
}
