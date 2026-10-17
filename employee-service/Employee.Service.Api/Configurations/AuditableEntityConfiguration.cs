using B2B.Erp.Api.Entities;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace B2B.Erp.Api.Data.Configurations;

public static class AuditableEntityConfiguration
{
    public static void ConfigureAudit<T>(EntityTypeBuilder<T> builder) where T : AuditableEntity
    {
        builder.Property(x => x.CreateUser)
            .IsRequired()
            .HasMaxLength(50);

        builder.Property(x => x.CreateTime)
            .IsRequired();

        builder.Property(x => x.EditUser)
            .HasMaxLength(50);

        builder.Property(x => x.EditTime);
    }
}
