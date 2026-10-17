using B2B.Erp.Api.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace B2B.Erp.Api.Data.Configurations;

public sealed class CampaignConditionConfiguration : IEntityTypeConfiguration<CampaignCondition>
{
    public void Configure(EntityTypeBuilder<CampaignCondition> builder)
    {
        builder.ToTable("CampaignConditions");

        builder.HasKey(x => x.Id);

        builder.Property(x => x.Id)
            .ValueGeneratedNever();

        builder.Property(x => x.CampaignId)
            .IsRequired();

        builder.Property(x => x.ConditionType)
            .IsRequired();

        builder.Property(x => x.TargetId)
            .HasMaxLength(100);

        builder.Property(x => x.Operator)
            .IsRequired()
            .HasMaxLength(10);

        builder.Property(x => x.Value)
            .IsRequired()
            .HasPrecision(18, 2);

        builder.Property(x => x.Metric)
            .IsRequired(false);

        builder.Property(x => x.Minimum)
            .IsRequired(false)
            .HasPrecision(18, 2);

        builder.Property(x => x.Maximum)
            .IsRequired(false)
            .HasPrecision(18, 2);

        builder.Property(x => x.CategoryCode)
            .IsRequired(false)
            .HasMaxLength(100);

        builder.Property(x => x.BrandField)
            .IsRequired(false)
            .HasMaxLength(20);

        builder.Property(x => x.BrandCode)
            .IsRequired(false)
            .HasMaxLength(50);

        builder.Property(x => x.PackageItemsJson)
            .IsRequired(false)
            .HasMaxLength(4000);

        builder.Property(x => x.ProductStockCodesJson)
            .IsRequired(false)
            .HasMaxLength(4000);

        builder.Property(x => x.IsDeleted)
            .IsRequired()
            .HasDefaultValue(false);

        builder.HasIndex(x => x.CampaignId);

        AuditableEntityConfiguration.ConfigureAudit(builder);
    }
}
