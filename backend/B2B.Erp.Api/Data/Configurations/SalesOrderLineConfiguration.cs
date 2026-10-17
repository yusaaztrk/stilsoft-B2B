using B2B.Erp.Api.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace B2B.Erp.Api.Data.Configurations;

public sealed class SalesOrderLineConfiguration : IEntityTypeConfiguration<SalesOrderLine>
{
    public void Configure(EntityTypeBuilder<SalesOrderLine> builder)
    {
        builder.ToTable("SalesOrderLines");

        builder.HasKey(x => x.Id);

        builder.Property(x => x.Id)
            .ValueGeneratedOnAdd();

        builder.Property(x => x.SalesOrderId);

        builder.Property(x => x.InstallationId);

        builder.Property(x => x.StockCode)
            .IsRequired()
            .HasMaxLength(50);

        builder.Property(x => x.Description)
            .HasMaxLength(500);

        builder.Property(x => x.Quantity)
            .HasPrecision(18, 3);

        builder.Property(x => x.UnitPrice)
            .HasPrecision(18, 2);

        builder.Property(x => x.CurrencyTypeId)
            .IsRequired()
            .HasDefaultValue(0);

        builder.Property(x => x.CurrencyRate)
            .HasPrecision(18, 6)
            .IsRequired()
            .HasDefaultValue(1m);

        builder.Property(x => x.CurrencyUnitPrice)
            .HasPrecision(18, 2)
            .IsRequired()
            .HasDefaultValue(0m);

        builder.Property(x => x.VatRate)
            .HasPrecision(18, 2);

        builder.Property(x => x.IsGift);

        builder.Property(x => x.DiscountAmount)
            .HasPrecision(18, 2);

        builder.Property(x => x.LineNo);

        builder.Property(x => x.CampaignCode)
            .HasMaxLength(50);

        builder.Property(x => x.Montage);

        builder.Property(x => x.GroupId);

        builder.Property(x => x.OrderNo)
            .IsRequired()
            .HasMaxLength(30);

        builder.HasIndex(x => new { x.SalesOrderId, x.LineNo });
        builder.HasIndex(x => x.StockCode);
        builder.HasIndex(x => x.OrderNo);

        builder.HasOne(x => x.Installation)
            .WithMany()
            .HasForeignKey(x => x.InstallationId)
            .OnDelete(DeleteBehavior.SetNull);

        AuditableEntityConfiguration.ConfigureAudit(builder);
    }
}
