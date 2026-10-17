using B2B.Erp.Api.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace B2B.Erp.Api.Data.Configurations;

public sealed class BankAccountDefinitionConfiguration : IEntityTypeConfiguration<BankAccountDefinition>
{
    public void Configure(EntityTypeBuilder<BankAccountDefinition> builder)
    {
        builder.ToTable("BankAccountDefinitions");

        builder.HasKey(x => x.Id);

        builder.Property(x => x.Id)
            .ValueGeneratedOnAdd();

        builder.Property(x => x.BankDetailId)
            .IsRequired();

        builder.HasOne(x => x.BankDetail)
            .WithMany()
            .HasForeignKey(x => x.BankDetailId)
            .OnDelete(DeleteBehavior.Restrict);

        builder.Property(x => x.AccountCode)
            .IsRequired()
            .HasMaxLength(50);

        builder.Property(x => x.AccountName)
            .IsRequired()
            .HasMaxLength(200);

        builder.Property(x => x.AccountNo)
            .IsRequired()
            .HasMaxLength(50);

        builder.Property(x => x.AccountType)
            .IsRequired();

        builder.Property(x => x.CurrencyTypeId)
            .IsRequired();

        builder.Property(x => x.Budget)
            .HasPrecision(18, 2)
            .IsRequired()
            .HasDefaultValue(0m);

        builder.Property(x => x.StatementDate)
            .HasColumnType("date");

        builder.HasIndex(x => new { x.BankDetailId, x.AccountCode })
            .IsUnique();

        AuditableEntityConfiguration.ConfigureAudit(builder);
    }
}
