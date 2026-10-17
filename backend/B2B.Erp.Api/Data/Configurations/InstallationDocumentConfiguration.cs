using B2B.Erp.Api.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace B2B.Erp.Api.Data.Configurations;

public sealed class InstallationDocumentConfiguration : IEntityTypeConfiguration<InstallationDocument>
{
    public void Configure(EntityTypeBuilder<InstallationDocument> builder)
    {
        builder.ToTable("InstallationDocuments");

        builder.HasKey(x => x.Id);

        builder.Property(x => x.Id)
            .ValueGeneratedOnAdd();

        builder.Property(x => x.DocumentUrl)
            .IsRequired()
            .HasMaxLength(2000);

        builder.Property(x => x.UploadedDateUtc)
            .IsRequired();

        builder.HasOne(x => x.Installation)
            .WithMany()
            .HasForeignKey(x => x.InstallationId)
            .OnDelete(DeleteBehavior.Cascade);

        AuditableEntityConfiguration.ConfigureAudit(builder);
    }
}
