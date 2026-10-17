using B2B.Erp.Api.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace B2B.Erp.Api.Data.Configurations;

public sealed class StockGroupConfiguration : IEntityTypeConfiguration<StockGroup>
{
    public void Configure(EntityTypeBuilder<StockGroup> builder)
    {
        builder.ToTable("StockGroups");

        builder.HasKey(x => x.Id);

        builder.Property(x => x.GroupCode)
            .IsRequired()
            .HasMaxLength(400);

        builder.Property(x => x.GroupType)
            .IsRequired()
            .HasMaxLength(50);

        builder.Property(x => x.Description)
            .HasMaxLength(500);

        builder.Property(x => x.B2BOrder)
            .IsRequired();

        AuditableEntityConfiguration.ConfigureAudit(builder);
    }
}
