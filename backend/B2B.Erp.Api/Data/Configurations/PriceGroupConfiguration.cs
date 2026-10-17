using B2B.Erp.Api.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace B2B.Erp.Api.Data.Configurations;

public sealed class PriceGroupConfiguration : IEntityTypeConfiguration<PriceGroup>
{
    public void Configure(EntityTypeBuilder<PriceGroup> builder)
    {
        builder.ToTable("PriceGroups");

        builder.HasKey(x => x.Id);

        builder.Property(x => x.Id)
            .ValueGeneratedNever();

        builder.Property(x => x.Code)
            .IsRequired()
            ;

        builder.HasIndex(x => x.Code)
            .IsUnique();

        builder.Property(x => x.Name)
            .IsRequired()
            .HasMaxLength(200);

        builder.Property(x => x.InvoiceType)
            .IsRequired()
            .HasMaxLength(50)
            .HasDefaultValue("FATURA");

        builder.Property(x => x.Formula)
            .HasMaxLength(500);

        builder.Property(x => x.SortOrder)
            .IsRequired();

        builder.Property(x => x.IsActive)
            .IsRequired()
            .HasDefaultValue(true);

        builder.HasData(
            new PriceGroup { Id = new Guid("11111111-1111-1111-1111-111111111111"), Code = 1, Name = "Peşin", SortOrder = 1, IsActive = true, Formula = "REMOVE_KDV(F4)", InvoiceType = "FATURA" },
            new PriceGroup { Id = new Guid("22222222-2222-2222-2222-222222222222"), Code = 2, Name = "30 Gün", SortOrder = 2, IsActive = true, Formula = "REMOVE_KDV(F4*0.88)", InvoiceType = "FATURA" },
            new PriceGroup { Id = new Guid("33333333-3333-3333-3333-333333333333"), Code = 3, Name = "45 Gün", SortOrder = 3, IsActive = true, Formula = "REMOVE_KDV(F4*(1-DISCOUNT/100))", InvoiceType = "FATURA" },
            new PriceGroup { Id = new Guid("44444444-4444-4444-4444-444444444444"), Code = 4, Name = "60 Gün", SortOrder = 4, IsActive = true, Formula = "F4", InvoiceType = "ACIK" },
            new PriceGroup { Id = new Guid("55555555-5555-5555-5555-555555555555"), Code = 5, Name = "90 Gün", SortOrder = 5, IsActive = true, Formula = "F4*0.88", InvoiceType = "ACIK" },
            new PriceGroup { Id = new Guid("66666666-6666-6666-6666-666666666666"), Code = 6, Name = "Plasiyer", SortOrder = 6, IsActive = true, Formula = "F4*(1-DISCOUNT/100)", InvoiceType = "ACIK" },
            new PriceGroup { Id = new Guid("77777777-7777-7777-7777-777777777777"), Code = 7, Name = "Askeriye Tipi Fatura", SortOrder = 7, IsActive = true, Formula = "REMOVE_KDV(F4*(1-DISCOUNT/100))", InvoiceType = "ASKERIYE" }
        );
    }
}
