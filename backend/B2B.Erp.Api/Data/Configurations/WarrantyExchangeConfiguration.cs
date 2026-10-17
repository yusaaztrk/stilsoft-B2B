using B2B.Erp.Api.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace B2B.Erp.Api.Data.Configurations;

public sealed class WarrantyExchangeConfiguration : IEntityTypeConfiguration<WarrantyExchange>
{
    public void Configure(EntityTypeBuilder<WarrantyExchange> builder)
    {
        builder.ToTable("WarrantyExchanges");

        builder.HasKey(x => x.Id);

        // Fark hesaplanan bir özellik; kolonu yok. Yoksa EF onu eşleştirmeye çalışır ve
        // sorgu "DifferenceAmount kolonu yok" diye düşer.
        builder.Ignore(x => x.DifferenceAmount);

        builder.Property(x => x.ExchangeNo).IsRequired().HasMaxLength(30);
        builder.HasIndex(x => x.ExchangeNo).IsUnique();

        builder.Property(x => x.CustomerCode).IsRequired().HasMaxLength(50);
        builder.Property(x => x.InvoiceNo).HasMaxLength(50);

        builder.Property(x => x.ReturnedStockCode).IsRequired().HasMaxLength(50);
        builder.Property(x => x.ReturnedProductName).HasMaxLength(300);
        builder.Property(x => x.ReturnedQuantity).HasPrecision(18, 3);
        builder.Property(x => x.ReturnedUnitPrice).HasPrecision(18, 2);
        builder.Property(x => x.ReturnedSerialNo).HasMaxLength(100);

        builder.Property(x => x.GivenStockCode).IsRequired().HasMaxLength(50);
        builder.Property(x => x.GivenProductName).HasMaxLength(300);
        builder.Property(x => x.GivenQuantity).HasPrecision(18, 3);
        builder.Property(x => x.GivenUnitPrice).HasPrecision(18, 2);
        builder.Property(x => x.GivenSerialNo).HasMaxLength(100);

        builder.Property(x => x.DiscountAmount).HasPrecision(18, 2);
        builder.Property(x => x.CurrencyRate).HasPrecision(18, 6);

        builder.Property(x => x.Description).HasMaxLength(2000);

        builder.Property(x => x.CreateUser).IsRequired().HasMaxLength(50);
        builder.Property(x => x.EditUser).HasMaxLength(50);

        builder.HasIndex(x => new { x.CustomerCode, x.Date });
        builder.HasIndex(x => x.Date);
    }
}

public sealed class WarrantyExchangeSettingConfiguration : IEntityTypeConfiguration<WarrantyExchangeSetting>
{
    public void Configure(EntityTypeBuilder<WarrantyExchangeSetting> builder)
    {
        builder.ToTable("WarrantyExchangeSettings");

        builder.HasKey(x => x.Id);

        // Tek satırlık ayar tablosu: kimlik her zaman 1, üretilmez.
        builder.Property(x => x.Id).ValueGeneratedNever();

        builder.Property(x => x.CreateUser).IsRequired().HasMaxLength(50);
        builder.Property(x => x.EditUser).HasMaxLength(50);
    }
}
