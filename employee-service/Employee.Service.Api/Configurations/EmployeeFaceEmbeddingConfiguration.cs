using B2B.Erp.Api.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace B2B.Erp.Api.Data.Configurations;

public sealed class EmployeeFaceEmbeddingConfiguration : IEntityTypeConfiguration<EmployeeFaceEmbedding>
{
    public void Configure(EntityTypeBuilder<EmployeeFaceEmbedding> builder)
    {
        builder.ToTable("EmployeeFaceEmbeddings");

        builder.HasKey(x => x.Id);

        AuditableEntityConfiguration.ConfigureAudit(builder);

        builder.Property(x => x.EmbeddingJson)
            .IsRequired();

        builder.HasOne(x => x.Employee)
            .WithMany()
            .HasForeignKey(x => x.EmployeeId)
            .OnDelete(DeleteBehavior.Restrict);

        builder.HasIndex(x => x.EmployeeId);
    }
}
