using B2B.Erp.Api.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace B2B.Erp.Api.Data.Configurations;

public sealed class CampaignActionConfiguration : IEntityTypeConfiguration<CampaignAction>
{
    public void Configure(EntityTypeBuilder<CampaignAction> builder)
    {
        builder.ToTable("CampaignActions");

        builder.HasKey(x => x.Id);

        builder.Property(x => x.Id)
            .ValueGeneratedNever();

        builder.Property(x => x.CampaignId)
            .IsRequired();

        builder.Property(x => x.ActionType)
            .IsRequired();

        builder.Property(x => x.TargetProductId);

        builder.Property(x => x.TargetPriceGroupId);

        builder.Property(x => x.Value)
            .IsRequired()
            .HasPrecision(18, 4);

        builder.Property(x => x.Quantity)
            .IsRequired();

        builder.Property(x => x.IsDeleted)
            .IsRequired()
            .HasDefaultValue(false);

        builder.HasIndex(x => x.CampaignId);

        AuditableEntityConfiguration.ConfigureAudit(builder);
    }
}
