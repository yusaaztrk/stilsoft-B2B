using B2B.Erp.Api.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace B2B.Erp.Api.Data.Configurations;

public sealed class CampaignDiscountPriceGroupConfiguration : IEntityTypeConfiguration<CampaignDiscountPriceGroup>
{
    public void Configure(EntityTypeBuilder<CampaignDiscountPriceGroup> builder)
    {
        builder.ToTable("CampaignDiscountPriceGroups");

        builder.HasKey(x => x.Id);

        builder.Property(x => x.Id)
            .ValueGeneratedNever();

        builder.Property(x => x.CampaignDiscountId)
            .IsRequired();

        builder.Property(x => x.PriceGroupCode)
            .IsRequired();

        builder.Property(x => x.Deger)
            .HasPrecision(18, 4)
            .IsRequired();

        builder.Property(x => x.IsDeleted)
            .HasDefaultValue(false)
            .IsRequired();

        builder.HasOne(x => x.CampaignDiscount)
            .WithMany(x => x.PriceGroups)
            .HasForeignKey(x => x.CampaignDiscountId)
            .OnDelete(DeleteBehavior.Cascade);

        builder.HasIndex(x => x.CampaignDiscountId);

        AuditableEntityConfiguration.ConfigureAudit(builder);
    }
}
