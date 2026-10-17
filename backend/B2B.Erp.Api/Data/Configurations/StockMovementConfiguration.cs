using B2B.Erp.Api.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace B2B.Erp.Api.Data.Configurations;

public sealed class StockMovementConfiguration : IEntityTypeConfiguration<StockMovement>
{
    public void Configure(EntityTypeBuilder<StockMovement> builder)
    {
        builder.ToTable("StockMovements");

        builder.HasKey(x => x.Id);

        builder.Property(x => x.Id)
            .ValueGeneratedOnAdd();

        builder.Property(x => x.InvoiceNo)
            .IsRequired()
            .HasMaxLength(30);

        builder.HasIndex(x => x.InvoiceNo);

        builder.Property(x => x.CustomerCode)
            .IsRequired()
            .HasMaxLength(50);

        builder.Property(x => x.DeliveryCustomerCode)
            .IsRequired()
            .HasMaxLength(50);

        builder.Property(x => x.StockCode)
            .IsRequired()
            .HasMaxLength(50);

        builder.HasIndex(x => x.StockCode);

        // DEPO BAZLI BAKİYE SORGUSU İÇİN BİLEŞİK İNDEKS (denetim md. 236).
        //
        // Bir deponun bir stoktaki bakiyesi `WHERE StockCode = ... AND WarehouseCode = ...`
        // ile hesaplanıyor (sepete ürün eklerken, fatura kesiminde, depo transferinde).
        // Tek başına `StockCode` indeksi ürünün BÜTÜN depolardaki hareketlerini okutuyordu;
        // hareket sayısı büyüdükçe her stok sorgusu ağırlaşıyor.
        builder.HasIndex(x => new { x.StockCode, x.WarehouseCode });

        builder.Property(x => x.Direction)
            .HasConversion(
                v => ((char)v).ToString(),
                v => (StockMovementDirection)v[0])
            .IsRequired()
            .HasMaxLength(1);

        builder.Property(x => x.Quantity)
            .HasPrecision(18, 3);

        builder.Property(x => x.UnitPrice)
            .HasPrecision(18, 2);

        // Para birimi başına rapor için (2026-08-19); kolonlar Program.cs drift-fix ile eklenir.
        builder.Property(x => x.CurrencyTypeId)
            .IsRequired()
            .HasDefaultValue(0);

        builder.Property(x => x.CurrencyRate)
            .IsRequired()
            .HasPrecision(18, 6)
            .HasDefaultValue(1m);

        builder.Property(x => x.CurrencyUnitPrice)
            .IsRequired()
            .HasPrecision(18, 4)
            .HasDefaultValue(0m);

        builder.Property(x => x.NetUnitPrice)
            .HasPrecision(18, 2);

        builder.Property(x => x.VatRate)
            .HasPrecision(18, 2);

        builder.Property(x => x.Delivered)
            .IsRequired();

        builder.Property(x => x.Date)
            .IsRequired();

        builder.Property(x => x.LineNo)
            .IsRequired();

        builder.Property(x => x.BagNo)
            .IsRequired()
            .HasMaxLength(200);

        builder.HasIndex(x => x.BagNo);

        builder.Property(x => x.SalesmanCode)
            .HasMaxLength(50);

        builder.Property(x => x.CustomerParentCode)
            .HasMaxLength(50);

        builder.Property(x => x.WarehouseCode)
            .IsRequired();

        builder.HasOne(x => x.Warehouse)
            .WithMany()
            .HasForeignKey(x => x.WarehouseCode)
            .OnDelete(DeleteBehavior.Restrict);

        builder.Property(x => x.InstallationId);

        builder.HasOne(x => x.Installation)
            .WithMany()
            .HasForeignKey(x => x.InstallationId)
            .OnDelete(DeleteBehavior.SetNull);

        AuditableEntityConfiguration.ConfigureAudit(builder);
    }
}
