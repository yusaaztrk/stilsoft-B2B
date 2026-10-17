using B2B.Erp.Api.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace B2B.Erp.Api.Data.Configurations;

public sealed class CustomerCheckConfiguration : IEntityTypeConfiguration<CustomerCheck>
{
    public void Configure(EntityTypeBuilder<CustomerCheck> builder)
    {
        builder.ToTable("CustomerChecks");

        builder.HasKey(x => x.Id);

        builder.Property(x => x.ABordroNo)
            .IsRequired()
            .HasMaxLength(15);

        builder.HasIndex(x => x.ABordroNo)
            .IsUnique();

        builder.Property(x => x.VBordroNo)
            .HasMaxLength(15);

        builder.HasIndex(x => x.VBordroNo);

        builder.Property(x => x.DocumentNo)
            .IsRequired()
            .HasMaxLength(30);

        builder.HasIndex(x => x.DocumentNo)
            .IsUnique();

        builder.Property(x => x.CustomerCode)
            .IsRequired()
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

        builder.Property(x => x.EndorsementType)
            .IsRequired();

        builder.Property(x => x.BankName)
            .HasMaxLength(120);

        builder.Property(x => x.BranchName)
            .HasMaxLength(120);

        builder.Property(x => x.DistrictName)
            .HasMaxLength(120);

        builder.Property(x => x.CheckNo)
            .HasMaxLength(50);

        builder.Property(x => x.OriginalDebtorName)
            .HasMaxLength(255);

        builder.Property(x => x.OriginalIdentityNo)
            .HasMaxLength(30);

        builder.Property(x => x.OriginalTaxNo)
            .HasMaxLength(30);

        builder.Property(x => x.PaymentStatus)
            .IsRequired();

        builder.Property(x => x.Status)
            .IsRequired();

        builder.Property(x => x.CurrentCustomerCode)
            .HasMaxLength(50);

        builder.HasIndex(x => new { x.CustomerCode, x.DueDate });

        builder.HasOne(x => x.Customer)
            .WithMany()
            .HasForeignKey(x => x.CustomerCode)
            .HasPrincipalKey(x => x.CustomerCode)
            .OnDelete(DeleteBehavior.Restrict);

        builder.HasOne(x => x.CurrentCustomer)
            .WithMany()
            .HasForeignKey(x => x.CurrentCustomerCode)
            .HasPrincipalKey(x => x.CustomerCode)
            .OnDelete(DeleteBehavior.Restrict);

        builder.HasOne(x => x.CurrentBankAccountDefinition)
            .WithMany()
            .HasForeignKey(x => x.CurrentBankAccountDefinitionId)
            .OnDelete(DeleteBehavior.Restrict);

        AuditableEntityConfiguration.ConfigureAudit(builder);
    }
}
