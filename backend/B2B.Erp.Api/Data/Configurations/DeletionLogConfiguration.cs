using B2B.Erp.Api.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace B2B.Erp.Api.Data.Configurations;

public sealed class DeletionLogConfiguration : IEntityTypeConfiguration<DeletionLog>
{
    public void Configure(EntityTypeBuilder<DeletionLog> builder)
    {
        builder.ToTable("DeletionLogs");

        builder.HasKey(x => x.Id);

        builder.Property(x => x.ModuleKey)
            .IsRequired()
            .HasMaxLength(50);

        builder.Property(x => x.PageKey)
            .IsRequired()
            .HasMaxLength(100);

        builder.Property(x => x.RecordType)
            .IsRequired()
            .HasMaxLength(50);

        builder.Property(x => x.RecordId)
            .IsRequired()
            .HasMaxLength(64);

        builder.Property(x => x.ParentType)
            .HasMaxLength(50);

        builder.Property(x => x.ParentId)
            .HasMaxLength(64);

        builder.Property(x => x.Description)
            .HasMaxLength(500);

        builder.Property(x => x.DetailsJson)
            .HasColumnType("text");

        builder.Property(x => x.Reason)
            .HasMaxLength(1000);

        builder.Property(x => x.CreateUser)
            .IsRequired()
            .HasMaxLength(50);

        builder.Property(x => x.EditUser)
            .HasMaxLength(50);

        builder.HasIndex(x => x.CreateTime);
        builder.HasIndex(x => new { x.ModuleKey, x.PageKey, x.CreateTime });
        builder.HasIndex(x => new { x.RecordType, x.RecordId });
    }
}
