using B2B.Erp.Api.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace B2B.Erp.Api.Data.Configurations;

public sealed class ProductWarrantyRegistrationConfiguration : IEntityTypeConfiguration<ProductWarrantyRegistration>
{
    public void Configure(EntityTypeBuilder<ProductWarrantyRegistration> builder)
    {
        builder.ToTable("ProductWarrantyRegistrations");

        builder.HasKey(x => x.Id);

        builder.Property(x => x.ProductId).IsRequired();
        builder.Property(x => x.ProductCode).IsRequired().HasMaxLength(80);
        builder.Property(x => x.ProductName).IsRequired().HasMaxLength(255);
        builder.Property(x => x.SerialNumber).IsRequired().HasMaxLength(120);
        builder.Property(x => x.CustomerFullName).IsRequired().HasMaxLength(255);
        builder.Property(x => x.PhoneNumber).IsRequired().HasMaxLength(40);
        builder.Property(x => x.Email).HasMaxLength(255);
        builder.Property(x => x.City).HasMaxLength(120);
        builder.Property(x => x.Description).HasMaxLength(1000);
        builder.Property(x => x.WarrantyStartDate).IsRequired();

        AuditableEntityConfiguration.ConfigureAudit(builder);

        builder.HasIndex(x => x.SerialNumber);
        builder.HasIndex(x => x.ProductCode);
        builder.HasIndex(x => x.CreateTime);
    }
}
