using B2B.Erp.Api.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace B2B.Erp.Api.Data.Configurations;

public sealed class CampaignTargetConfiguration : IEntityTypeConfiguration<CampaignTarget>
{
    public void Configure(EntityTypeBuilder<CampaignTarget> builder)
    {
        builder.ToTable("CampaignTargets");

        builder.HasKey(x => x.Id);

        builder.Property(x => x.Id)
            .ValueGeneratedNever();

        builder.Property(x => x.CampaignId)
            .IsRequired();

        builder.Property(x => x.TargetType)
            .IsRequired();

        builder.Property(x => x.TargetId)
            .HasMaxLength(100);

        builder.Property(x => x.IsDeleted)
            .IsRequired()
            .HasDefaultValue(false);

        builder.HasIndex(x => x.CampaignId);

        AuditableEntityConfiguration.ConfigureAudit(builder);
    }
}
