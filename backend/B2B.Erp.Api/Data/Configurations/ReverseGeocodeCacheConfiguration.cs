using B2B.Erp.Api.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace B2B.Erp.Api.Data.Configurations;

public sealed class ReverseGeocodeCacheConfiguration : IEntityTypeConfiguration<ReverseGeocodeCache>
{
    public void Configure(EntityTypeBuilder<ReverseGeocodeCache> builder)
    {
        builder.ToTable("ReverseGeocodeCaches");

        builder.HasKey(x => x.Id);

        builder.Property(x => x.RoundedLatitude)
            .HasColumnType("numeric(9,2)")
            .IsRequired();

        builder.Property(x => x.RoundedLongitude)
            .HasColumnType("numeric(9,2)")
            .IsRequired();

        builder.Property(x => x.City)
            .HasMaxLength(120)
            .IsRequired(false);

        builder.Property(x => x.District)
            .HasMaxLength(120)
            .IsRequired(false);

        builder.Property(x => x.LastFetchedUtc)
            .IsRequired();

        builder.HasIndex(x => new { x.RoundedLatitude, x.RoundedLongitude }).IsUnique();
    }
}
