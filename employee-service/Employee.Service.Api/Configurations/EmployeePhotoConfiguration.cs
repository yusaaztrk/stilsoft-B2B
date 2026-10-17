using B2B.Erp.Api.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace B2B.Erp.Api.Data.Configurations;

public sealed class EmployeePhotoConfiguration : IEntityTypeConfiguration<EmployeePhoto>
{
    public void Configure(EntityTypeBuilder<EmployeePhoto> builder)
    {
        builder.ToTable("EmployeePhotos");
        builder.HasKey(x => x.EmployeeId);
        builder.Property(x => x.EmployeeId).ValueGeneratedNever();
        builder.Property(x => x.Data).HasColumnType("bytea").IsRequired();
        builder.Property(x => x.ContentType).HasMaxLength(50).IsRequired();
        builder.Property(x => x.UpdatedBy).HasMaxLength(50).IsRequired(false);
    }
}
