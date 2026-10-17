using B2B.Erp.Api.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace B2B.Erp.Api.Data.Configurations;

public sealed class CashAccountTransferConfiguration : IEntityTypeConfiguration<CashAccountTransfer>
{
    public void Configure(EntityTypeBuilder<CashAccountTransfer> builder)
    {
        builder.ToTable("CashAccountTransfers");

        builder.HasKey(x => x.Id);

        builder.Property(x => x.Date)
            .IsRequired();

        builder.Property(x => x.Amount)
            .HasPrecision(18, 2)
            .IsRequired();

        builder.Property(x => x.CurrencyTypeId)
            .IsRequired()
            .HasDefaultValue(0);

        builder.Property(x => x.Description)
            .HasMaxLength(2000);

        builder.HasIndex(x => new { x.SourceCashAccountId, x.Date });
        builder.HasIndex(x => new { x.TargetCashAccountId, x.Date });

        builder.HasOne(x => x.SourceCashAccount)
            .WithMany()
            .HasForeignKey(x => x.SourceCashAccountId)
            .OnDelete(DeleteBehavior.Restrict);

        builder.HasOne(x => x.TargetCashAccount)
            .WithMany()
            .HasForeignKey(x => x.TargetCashAccountId)
            .OnDelete(DeleteBehavior.Restrict);

        AuditableEntityConfiguration.ConfigureAudit(builder);
    }
}
