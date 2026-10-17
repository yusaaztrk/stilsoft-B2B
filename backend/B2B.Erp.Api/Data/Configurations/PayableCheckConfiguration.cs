using B2B.Erp.Api.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace B2B.Erp.Api.Data.Configurations;

public sealed class PayableCheckConfiguration : IEntityTypeConfiguration<PayableCheck>
{
    public void Configure(EntityTypeBuilder<PayableCheck> builder)
    {
        builder.ToTable("PayableChecks");

        builder.HasKey(x => x.Id);

        builder.Property(x => x.DocumentNo)
            .IsRequired()
            .HasMaxLength(30);

        builder.HasIndex(x => x.DocumentNo)
            .IsUnique();

        builder.Property(x => x.CustomerCode)
            .HasMaxLength(50);

        builder.Property(x => x.IssueDate)
            .IsRequired();

        builder.Property(x => x.DueDate)
            .IsRequired();

        builder.Property(x => x.Amount)
            .HasPrecision(18, 2)
            .IsRequired();

        builder.Property(x => x.CurrencyTypeId)
            .IsRequired();

        builder.Property(x => x.CurrencyRate)
            .HasPrecision(18, 6)
            .IsRequired();

        builder.Property(x => x.CurrencyAmount)
            .HasPrecision(18, 2)
            .IsRequired();

        builder.Property(x => x.BankName)
            .HasMaxLength(120);

        builder.Property(x => x.BranchName)
            .HasMaxLength(120);

        builder.Property(x => x.CheckNo)
            .HasMaxLength(50);

        builder.Property(x => x.Status)
            .IsRequired();

        builder.HasOne(x => x.Supplier)
            .WithMany()
            .HasForeignKey(x => x.SupplierId)
            .OnDelete(DeleteBehavior.Restrict);

        builder.HasOne(x => x.Customer)
            .WithMany()
            .HasForeignKey(x => x.CustomerCode)
            .HasPrincipalKey(x => x.CustomerCode)
            .OnDelete(DeleteBehavior.Restrict);

        builder.HasOne(x => x.BankAccountDefinition)
            .WithMany()
            .HasForeignKey(x => x.BankAccountDefinitionId)
            .OnDelete(DeleteBehavior.Restrict);

        AuditableEntityConfiguration.ConfigureAudit(builder);
    }
}
