using B2B.Erp.Api.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace B2B.Erp.Api.Data.Configurations;

public sealed class UserActivityLogConfiguration : IEntityTypeConfiguration<UserActivityLog>
{
    public void Configure(EntityTypeBuilder<UserActivityLog> builder)
    {
        builder.ToTable("UserActivityLogs");

        builder.HasKey(x => x.Id);

        builder.Property(x => x.Username)
            .IsRequired()
            .HasMaxLength(50);

        builder.Property(x => x.UserDisplayName)
            .IsRequired()
            .HasMaxLength(200);

        builder.Property(x => x.ModuleKey)
            .IsRequired()
            .HasMaxLength(50);

        builder.Property(x => x.PageKey)
            .IsRequired()
            .HasMaxLength(50);

        builder.Property(x => x.ActionType)
            .IsRequired()
            .HasMaxLength(50);

        builder.Property(x => x.Description)
            .IsRequired()
            .HasMaxLength(1000);

        builder.Property(x => x.RecordId)
            .HasMaxLength(100);

        builder.Property(x => x.DetailsJson)
            .HasColumnType("text");

        builder.Property(x => x.CreateUser)
            .IsRequired()
            .HasMaxLength(50);

        builder.Property(x => x.CreateTime)
            .IsRequired();

        builder.Property(x => x.CorrelationId);

        // Indexes for fast searching and filtering
        builder.HasIndex(x => x.CreateTime);
        builder.HasIndex(x => x.CorrelationId);
        builder.HasIndex(x => new { x.Username, x.CreateTime });
        builder.HasIndex(x => new { x.ModuleKey, x.PageKey, x.CreateTime });
        builder.HasIndex(x => x.ActionType);
    }
}
