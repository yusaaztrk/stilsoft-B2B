using B2B.Erp.Api.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace B2B.Erp.Api.Data.Configurations;

public sealed class SalesmanConfiguration : IEntityTypeConfiguration<Salesman>
{
    public void Configure(EntityTypeBuilder<Salesman> builder)
    {
        builder.ToTable("Salesmen");

        builder.HasKey(x => x.SalesmanCode);

        builder.Property(x => x.SalesmanCode)
            .IsRequired()
            .HasMaxLength(50);

        builder.Property(x => x.Description)
            .IsRequired()
            .HasMaxLength(255);

        builder.Property(x => x.CustomerCode)
            .HasMaxLength(50);

        AuditableEntityConfiguration.ConfigureAudit(builder);
    }
}
