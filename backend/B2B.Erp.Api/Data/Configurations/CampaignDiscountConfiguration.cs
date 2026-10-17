using B2B.Erp.Api.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace B2B.Erp.Api.Data.Configurations;

public sealed class CampaignDiscountConfiguration : IEntityTypeConfiguration<CampaignDiscount>
{
    public void Configure(EntityTypeBuilder<CampaignDiscount> builder)
    {
        builder.ToTable("CampaignDiscounts");

        builder.HasKey(x => x.Id);

        builder.Property(x => x.Id)
            .ValueGeneratedNever();

        builder.Property(x => x.CampaignId)
            .IsRequired();

        builder.Property(x => x.StokKodu)
            .HasMaxLength(50)
            .IsRequired(false);

        builder.Property(x => x.GrupKodu)
            .HasMaxLength(50)
            .IsRequired(false);

        builder.Property(x => x.MinSepetTutari)
            .HasPrecision(18, 2)
            .IsRequired();

        builder.Property(x => x.IskontoTipi)
            .IsRequired();

        builder.Property(x => x.Deger)
            .HasPrecision(18, 4)
            .IsRequired();

        builder.Property(x => x.HedefFiyat)
            .HasPrecision(18, 4)
            .IsRequired(false);

        builder.Property(x => x.IskontoFiyat1)
            .HasPrecision(18, 4)
            .IsRequired(false);

        builder.Property(x => x.IskontoFiyat2)
            .HasPrecision(18, 4)
            .IsRequired(false);

        builder.Property(x => x.IskontoFiyat3)
            .HasPrecision(18, 4)
            .IsRequired(false);

        builder.Property(x => x.IskontoFiyat4)
            .HasPrecision(18, 4)
            .IsRequired(false);

        builder.Property(x => x.IskontoFiyat5)
            .HasPrecision(18, 4)
            .IsRequired(false);

        builder.Property(x => x.IskontoFiyat6)
            .HasPrecision(18, 4)
            .IsRequired(false);

        builder.Property(x => x.IsDeleted)
            .HasDefaultValue(false)
            .IsRequired();

        builder.HasOne(x => x.Campaign)
            .WithMany(x => x.CampaignDiscounts)
            .HasForeignKey(x => x.CampaignId)
            .OnDelete(DeleteBehavior.Cascade);

        AuditableEntityConfiguration.ConfigureAudit(builder);
    }
}
