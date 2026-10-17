using B2B.Erp.Api.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace B2B.Erp.Api.Data.Configurations;

public sealed class VirmanConfiguration : IEntityTypeConfiguration<Virman>
{
    public void Configure(EntityTypeBuilder<Virman> builder)
    {
        builder.ToTable("Virmans");

        builder.HasKey(x => x.Id);

        builder.Property(x => x.DocumentNo)
            .IsRequired()
            .HasMaxLength(50);

        builder.HasIndex(x => x.DocumentNo)
            .IsUnique();

        builder.Property(x => x.Date)
            .IsRequired();

        builder.Property(x => x.SourceCustomerCode)
            .IsRequired()
            .HasMaxLength(50);

        builder.Property(x => x.TargetCustomerCode)
            .IsRequired()
            .HasMaxLength(50);

        builder.Property(x => x.Amount)
            .HasPrecision(18, 2)
            .IsRequired();

        builder.Property(x => x.Description)
            .HasMaxLength(2000);

        builder.HasOne(x => x.SourceCustomer)
            .WithMany()
            .HasForeignKey(x => x.SourceCustomerCode)
            .OnDelete(DeleteBehavior.Restrict);

        builder.HasOne(x => x.TargetCustomer)
            .WithMany()
            .HasForeignKey(x => x.TargetCustomerCode)
            .OnDelete(DeleteBehavior.Restrict);

        AuditableEntityConfiguration.ConfigureAudit(builder);
    }
}
