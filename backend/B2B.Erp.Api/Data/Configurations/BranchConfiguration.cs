using B2B.Erp.Api.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace B2B.Erp.Api.Data.Configurations;

public sealed class BranchConfiguration : IEntityTypeConfiguration<Branch>
{
    public void Configure(EntityTypeBuilder<Branch> builder)
    {
        builder.ToTable("Branches");

        builder.HasKey(x => x.Id);

        builder.Property(x => x.Name)
            .IsRequired()
            .HasMaxLength(200);

        AuditableEntityConfiguration.ConfigureAudit(builder);

        builder.HasData(new Branch
        {
            Id = 1,
            Name = "Merkez",
            CreateUser = "System",
            CreateTime = DateTime.UtcNow
        });
    }
}
