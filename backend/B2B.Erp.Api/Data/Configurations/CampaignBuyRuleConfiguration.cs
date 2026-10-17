using B2B.Erp.Api.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace B2B.Erp.Api.Data.Configurations;

public sealed class CampaignBuyRuleConfiguration : IEntityTypeConfiguration<CampaignBuyRule>
{
    public void Configure(EntityTypeBuilder<CampaignBuyRule> builder)
    {
        builder.ToTable("CampaignBuyRules");

        builder.HasKey(x => x.Id);
        builder.Property(x => x.Id).ValueGeneratedNever();

        builder.Property(x => x.CreateUser).HasMaxLength(50).IsRequired();
        builder.Property(x => x.EditUser).HasMaxLength(50);

        builder.Property(x => x.IsDeleted).HasDefaultValue(false);
        builder.Property(x => x.RequiredQuantity).HasDefaultValue(1);

        builder.HasOne(x => x.Campaign)
            .WithMany(x => x.CampaignBuyRules)
            .HasForeignKey(x => x.CampaignId)
            .OnDelete(DeleteBehavior.Cascade);

        builder.HasOne(x => x.Product)
            .WithMany()
            .HasForeignKey(x => x.ProductId)
            .OnDelete(DeleteBehavior.Restrict);
    }
}
