using B2B.Erp.Api.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace B2B.Erp.Api.Data.Configurations;

public sealed class MuhtelifCustomerConfiguration : IEntityTypeConfiguration<MuhtelifCustomer>
{
    public void Configure(EntityTypeBuilder<MuhtelifCustomer> builder)
    {
        builder.ToTable("MuhtelifCustomers");

        builder.HasKey(x => x.Id);

        builder.Property(x => x.Id)
            .ValueGeneratedOnAdd();

        builder.Property(x => x.OwnerCustomerCode)
            .HasMaxLength(50);

        builder.HasIndex(x => x.OwnerCustomerCode);

        builder.Property(x => x.CustomerCode)
            .IsRequired()
            .HasMaxLength(50);

        builder.Property(x => x.Name)
            .IsRequired()
            .HasMaxLength(255);

        builder.Property(x => x.City)
            .HasMaxLength(100);

        builder.Property(x => x.District)
            .HasMaxLength(100);

        builder.Property(x => x.Address)
            .HasMaxLength(500);

        builder.Property(x => x.Phone)
            .HasMaxLength(50);

        builder.Property(x => x.Email)
            .HasMaxLength(255);

        builder.Property(x => x.TaxOffice)
            .HasMaxLength(100);

        builder.Property(x => x.TaxNumber)
            .HasMaxLength(50);

        AuditableEntityConfiguration.ConfigureAudit(builder);
    }
}
