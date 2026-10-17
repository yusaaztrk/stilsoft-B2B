using B2B.Erp.Api.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace B2B.Erp.Api.Data.Configurations;

public sealed class CashAccountConfiguration : IEntityTypeConfiguration<CashAccount>
{
    public void Configure(EntityTypeBuilder<CashAccount> builder)
    {
        builder.ToTable("CashAccounts");

        builder.HasKey(x => x.Id);

        builder.Property(x => x.Code)
            .IsRequired()
            .HasMaxLength(50);

        builder.Property(x => x.Name)
            .HasMaxLength(255);

        builder.Property(x => x.LastCarryDate)
            .IsRequired()
            .HasDefaultValue(DateTime.UnixEpoch);

        builder.Property(x => x.LastCarryAmount)
            .IsRequired()
            .HasDefaultValue(0d);

        builder.Property(x => x.CurrencyTypeId)
            .IsRequired()
            .HasDefaultValue(0);

        builder.HasIndex(x => x.Code)
            .IsUnique();

        AuditableEntityConfiguration.ConfigureAudit(builder);
    }
}
