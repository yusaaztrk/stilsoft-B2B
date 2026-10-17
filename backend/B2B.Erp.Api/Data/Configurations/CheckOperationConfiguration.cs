using B2B.Erp.Api.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace B2B.Erp.Api.Data.Configurations;

public sealed class CheckOperationConfiguration : IEntityTypeConfiguration<CheckOperation>
{
    public void Configure(EntityTypeBuilder<CheckOperation> builder)
    {
        builder.ToTable("CheckOperations");

        builder.HasKey(x => x.Id);

        builder.Property(x => x.Date)
            .IsRequired();

        builder.Property(x => x.Amount)
            .HasPrecision(18, 2)
            .IsRequired();

        builder.Property(x => x.CurrencyTypeId)
            .IsRequired();

        builder.Property(x => x.Description)
            .HasMaxLength(2000);

        builder.Property(x => x.TargetCustomerCode)
            .HasMaxLength(50);

        builder.HasIndex(x => new { x.DocumentType, x.DocumentId, x.Date });

        builder.HasOne(x => x.BankAccountDefinition)
            .WithMany()
            .HasForeignKey(x => x.BankAccountDefinitionId)
            .OnDelete(DeleteBehavior.Restrict);

        builder.HasOne(x => x.TargetCustomer)
            .WithMany()
            .HasForeignKey(x => x.TargetCustomerCode)
            .HasPrincipalKey(x => x.CustomerCode)
            .OnDelete(DeleteBehavior.Restrict);

        AuditableEntityConfiguration.ConfigureAudit(builder);
    }
}
