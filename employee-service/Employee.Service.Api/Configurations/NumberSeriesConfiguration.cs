using B2B.Erp.Api.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace B2B.Erp.Api.Data.Configurations;

public sealed class NumberSeriesConfiguration : IEntityTypeConfiguration<NumberSeries>
{
    public void Configure(EntityTypeBuilder<NumberSeries> builder)
    {
        builder.ToTable("NumberSeries");

        builder.HasKey(x => x.Key);

        builder.Property(x => x.Key)
            .IsRequired()
            .HasMaxLength(50);

        builder.Property(x => x.LastValue)
            .IsRequired();
    }
}
