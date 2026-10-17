using B2B.Erp.Api.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace B2B.Erp.Api.Data.Configurations;

public sealed class EcommerceOrderPaymentConfiguration : IEntityTypeConfiguration<EcommerceOrderPayment>
{
    public void Configure(EntityTypeBuilder<EcommerceOrderPayment> builder)
    {
        builder.ToTable("EcommerceOrderPayments");

        builder.HasKey(x => x.MerchantOrderId);

        builder.Property(x => x.MerchantOrderId).IsRequired().HasMaxLength(100);
        builder.Property(x => x.SalesOrderNo).IsRequired().HasMaxLength(50);
        builder.Property(x => x.CustomerCode).IsRequired().HasMaxLength(50);
        builder.Property(x => x.Amount).HasColumnType("numeric(18,2)").IsRequired();
        builder.Property(x => x.CurrencyCode).IsRequired().HasMaxLength(3);
        builder.Property(x => x.Status).IsRequired();
        builder.Property(x => x.AuthCode).HasMaxLength(50);
        builder.Property(x => x.FailureMessage).HasMaxLength(500);

        // Aynı sütun üzerinde iki indeks var, o yüzden ikisi de ADIYLA tanımlanıyor: adsız
        // çağrı EF'te aynı indeksi ikinci kez yapılandırır ve tekil olan sıradan olanın
        // üzerine biner.
        builder.HasIndex(x => x.SalesOrderNo, "IX_EcommerceOrderPayments_SalesOrderNo");
        builder.HasIndex(x => x.CustomerCode, "IX_EcommerceOrderPayments_CustomerCode");

        // "Aynı sipariş ikinci kez ödenmiş sayılmaz" kuralının kendisi.
        //
        // Kod tarafındaki kontrol iki eşzamanlı callback'i durduramaz — ikisi de "henüz ödenmemiş"
        // görüp ikisi de yazar. Kısmi tekil indeks bunu veritabanı seviyesinde imkânsız kılar:
        // bir sipariş numarası için Paid durumunda EN FAZLA bir satır olabilir. İkinci yazma
        // hatayla döner ve ödeme "insan bakmalı" olarak kaydedilir; sessizce iki kez tahsil
        // edilmiş sayılmaz.
        builder.HasIndex(x => x.SalesOrderNo, "UX_EcommerceOrderPayments_SalesOrderNo_Paid")
            .IsUnique()
            .HasFilter("\"Status\" = 1");
    }
}
