using System.Collections.Generic;
using B2B.Erp.Api.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace B2B.Erp.Api.Data.Configurations;

public sealed class PageConfiguration : IEntityTypeConfiguration<Page>
{
    public void Configure(EntityTypeBuilder<Page> builder)
    {
        builder.ToTable("Pages");

        builder.HasKey(p => p.Id);

        builder.Property(p => p.ModuleKey)
            .IsRequired()
            .HasMaxLength(50);

        builder.Property(p => p.Key)
            .IsRequired()
            .HasMaxLength(100);

        builder.Property(p => p.DisplayName)
            .IsRequired()
            .HasMaxLength(200);

        builder.Property(p => p.SortOrder)
            .IsRequired();

        builder.Property(p => p.IsActive)
            .IsRequired()
            .HasDefaultValue(true);

        builder.HasIndex(p => new { p.ModuleKey, p.Key })
            .IsUnique();

        builder.HasMany(p => p.RolePermissions)
            .WithOne(rp => rp.Page)
            .HasForeignKey(rp => rp.PageId)
            .OnDelete(DeleteBehavior.Cascade);

        SeedPages(builder);
    }

    private static void SeedPages(EntityTypeBuilder<Page> builder)
    {
        var pages = new List<Page>();
        var id = 1;

        void Add(string moduleKey, string key, string displayName, int sortOrder)
        {
            pages.Add(new Page
            {
                Id = id++,
                ModuleKey = moduleKey,
                Key = key,
                DisplayName = displayName,
                SortOrder = sortOrder,
                IsActive = true
            });
        }

        void AddFixedId(int fixedId, string moduleKey, string key, string displayName, int sortOrder)
        {
            pages.Add(new Page
            {
                Id = fixedId,
                ModuleKey = moduleKey,
                Key = key,
                DisplayName = displayName,
                SortOrder = sortOrder,
                IsActive = true
            });
        }

        // invoice
        Add("invoice", "siparis", "Sipariş", 1);
        Add("invoice", "satisFatura", "Satış Faturası", 2);
        Add("invoice", "kampanya", "Kampanya Tanım", 3);
        Add("invoice", "faturaDokum", "Fatura Dökümü", 4);
        AddFixedId(100, "invoice", "faturaDokumUstBilgiGuncelle", "Üst Bilgi Güncelle", 100);
        AddFixedId(150, "invoice", "proformaFaturaDokumeAktar", "Fatura Döküme Aktar", 150);
        AddFixedId(151, "invoice", "proformaBasim", "Basım", 151);
        AddFixedId(152, "invoice", "proformaSil", "Sil", 152);
        AddFixedId(103, "invoice", "alisUstBilgiGuncelle", "Üst Bilgi Güncelle (Alış)", 106);
        AddFixedId(101, "invoice", "musteriTeklifi", "Müşteri Teklifi", 101);
        AddFixedId(300, "invoice", "bsyHHide", "BSY(H): Ürünü Gösterme", 102);
        AddFixedId(301, "invoice", "bsyHComingSoon", "BSY(H): ComingSoon ile Göster", 103);
        AddFixedId(302, "invoice", "satisFaturaDepoBakiyeGorsun", "Satış Faturası: Depo Bakiyesi Görsün", 104);
        Add("invoice", "etiket", "Etiket Basım Fiyatları", 6);
        Add("invoice", "proforma", "Proforma", 7);
        Add("invoice", "magaza", "Mağaza Sipariş", 8);
        Add("invoice", "alis", "Alış Faturaları", 9);
        Add("invoice", "depoTransfer", "Depo Transfer", 10);
        Add("invoice", "stokHareket", "Stok Hareket Dökümü", 11);
        AddFixedId(104, "invoice", "depoStock", "Depo Stok Durumu", 11);
        Add("invoice", "satis", "Satış Faturaları", 12);
        Add("invoice", "depoBakiye", "Depo Bakiye Listesi", 13);

        // cash
        Add("cash", "kasaGirisCikis", "Kasa Giriş/Çıkış", 1);
        Add("cash", "kasalarArasiTransfer", "Kasalar Arası Transfer", 2);

        // pos
        Add("pos", "posPayment", "Kredi Kartı ile Ödeme", 1);
        Add("pos", "posReport", "Kredi Kartı Çekim Raporu", 2);

        // check
        Add("check", "customerCheck", "Müşteri Çeki", 1);
        Add("check", "debtCheck", "Borç Çeki", 2);
        Add("check", "debtNote", "Borç Seneti", 3);

        // bank
        Add("bank", "bankaHavaleEft", "Banka Havale/EFT", 1);

        // service
        Add("service", "kabulListesi", "Kabul Listesi", 1);
        Add("service", "montajListesi", "Montaj Listesi", 2);
        Add("service", "montajRapor", "Montaj Rapor", 3);
        Add("service", "montajAnaliz", "Montaj Analiz", 4);

        // reports
        Add("reports", "cariEkstre", "Cari Ekstre", 1);
        Add("reports", "cariBorcAlacak", "Cari Borç Alacak", 2);
        Add("reports", "yaslandirma", "Yaşlandırma", 3);
        Add("reports", "yaslandirma2024", "Yaşlandırma (2024)", 4);
        Add("reports", "cariSatisRaporu", "Cari Satış Raporu", 5);
        Add("reports", "bankaRaporlari", "Banka Raporları", 6);
        Add("reports", "kasaRaporlari", "Kasa Raporları", 7);
        Add("reports", "urunSatisRaporuDetayli", "Ürün Satış Raporu Detaylı", 8);
        Add("reports", "urunSatisRaporuAylik", "Ürün Satış Raporu (Aylık)", 9);
        Add("reports", "siparisRaporu", "Sipariş Raporu", 10);
        Add("reports", "aktifSepetRaporu", "Aktif Sepet Raporu", 11);
        Add("reports", "limitRiskSatisRaporu", "Limit Risk Satış Raporu", 12);
        Add("reports", "muhasebeStokGirisCikisRaporu", "Muhasebe Stok Giriş/Çıkış Raporu", 13);
        Add("reports", "satisPazarlamaRaporu", "Satış Pazarlama Raporu", 14);
        Add("reports", "fiyatListesi", "Fiyat Listesi", 15);

        // users
        Add("users", "kullaniciListesi", "Kullanıcı Listesi", 1);
        Add("users", "kampanya", "Kampanya Tanım", 2);
        Add("users", "stokListesi", "Stok Listesi", 3);
        Add("users", "depolar", "Depolar", 4);
        Add("users", "bankaHesapTanim", "Banka Hesap Tanım", 5);
        Add("users", "rolYetkileri", "Rol Yetkileri", 6);
        Add("users", "kategoriYonetimi", "Kategori Yönetimi", 7);
        Add("users", "urunYonetimi", "Ürün Yönetimi", 8);
        Add("users", "atiliFiyatlandirma", "Fiyat Atama", 9);
        Add("users", "fiyatKategorileri", "Fiyat Kategorileri", 10);
        Add("users", "cariEkle", "Cari Ekle", 11);
        Add("users", "tedarikciEkle", "Tedarikçi Ekle", 12);
        Add("users", "irsaliye", "Konsinye", 13);
        Add("users", "silinenKayitlar", "Silinen Kayıtlar", 14);
        Add("users", "installmentRules", "Taksit Bilgileri", 15);
        AddFixedId(400, "users", "calisan", "Çalışan", 16);
        AddFixedId(401, "users", "kasalarim", "Kasalarım", 17);
        Add("users", "bildirimler", "Bildirimler", 18);
        AddFixedId(402, "users", "kampanya", "Kampanya Tanım", 19);

        // delete settings
        AddFixedId(600, "deleteRule", "deleteRule/faturaDokum", "Fatura Dökümü", 1);
        AddFixedId(601, "deleteRule", "deleteRule/musteriTeklifi", "Müşteri Teklifi", 2);
        AddFixedId(602, "deleteRule", "deleteRule/proforma", "Proforma", 3);
        AddFixedId(603, "deleteRule", "deleteRule/alis", "Alış Faturaları", 4);

        builder.HasData(pages);
    }
}
