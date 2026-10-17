using B2B.Erp.Api.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace B2B.Erp.Api.Data.Configurations;

public sealed class WorkShiftBlockConfiguration : IEntityTypeConfiguration<WorkShiftBlock>
{
    public void Configure(EntityTypeBuilder<WorkShiftBlock> builder)
    {
        builder.ToTable("WorkShiftBlocks");

        builder.HasKey(x => x.Id);

        builder.Property(x => x.PayMultiplier)
            .HasPrecision(5, 2)
            .IsRequired();

        builder.Property(x => x.Label)
            .HasMaxLength(80);

        builder.HasIndex(x => new { x.WorkScheduleSettingId, x.DayOfWeek, x.StartMinute });

        builder.HasOne(x => x.WorkScheduleSetting)
            .WithMany(x => x.Blocks)
            .HasForeignKey(x => x.WorkScheduleSettingId)
            .OnDelete(DeleteBehavior.Cascade);

        builder.Ignore(x => x.DurationMinutes);

        AuditableEntityConfiguration.ConfigureAudit(builder);
    }
}
