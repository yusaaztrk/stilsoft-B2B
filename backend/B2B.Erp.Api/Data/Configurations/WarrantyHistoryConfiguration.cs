using B2B.Erp.Api.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace B2B.Erp.Api.Data.Configurations;

public sealed class WarrantyHistoryConfiguration : IEntityTypeConfiguration<WarrantyHistory>
{
    public void Configure(EntityTypeBuilder<WarrantyHistory> builder)
    {
        builder.ToTable("WarrantyHistories");

        builder.HasKey(x => x.Id);

        builder.Property(x => x.Status)
            .IsRequired()
            .HasMaxLength(50);

        builder.Property(x => x.Description)
            .HasMaxLength(1000);

        builder.Property(x => x.CreatedTime)
            .IsRequired();

        builder.Property(x => x.CreatedByUser)
            .IsRequired()
            .HasMaxLength(255);
    }
}
