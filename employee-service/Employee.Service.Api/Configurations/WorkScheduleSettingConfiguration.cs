using B2B.Erp.Api.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace B2B.Erp.Api.Data.Configurations;

public sealed class WorkScheduleSettingConfiguration : IEntityTypeConfiguration<WorkScheduleSetting>
{
    public void Configure(EntityTypeBuilder<WorkScheduleSetting> builder)
    {
        builder.ToTable("WorkScheduleSettings");

        builder.HasKey(x => x.Id);

        builder.Property(x => x.Name)
            .IsRequired()
            .HasMaxLength(100);

        builder.Property(x => x.OvertimeMultiplier)
            .HasPrecision(5, 2)
            .IsRequired();

        builder.Ignore(x => x.WeeklyMinutes);
        builder.Ignore(x => x.WeightedWeeklyMinutes);

        AuditableEntityConfiguration.ConfigureAudit(builder);
    }
}
