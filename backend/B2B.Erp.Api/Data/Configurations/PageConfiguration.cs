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
        // 'invoice/kampanya' KALDIRILDI (2026-08-13): Kampanya Tanım ekranı Sistem Ayarları'na
        // taşındı ve tek gerçek anahtarı 'users/kampanya' (Id 402). Fatura modülündeki kopya
        // hiçbir yerde kontrol edilmiyordu; rol yetkileri ekranında hiçbir işe yaramayan bir
        // kutu olarak duruyordu. Var olan firmalardan silinmesi PagesController'daki seed
        // bloğunda yapılıyor ('invoice/etiket' ile aynı kalıp).
        Add("invoice", "faturaDokum", "Fatura Dökümü", 4);
        AddFixedId(100, "invoice", "faturaDokumUstBilgiGuncelle", "Üst Bilgi Güncelle", 100);
        AddFixedId(110, "invoice", "faturaDokumOdemeAlindi", "Ödeme Alındı", 110);
        AddFixedId(111, "invoice", "faturaDokumNakitMiktar", "Nakit Miktar", 111);
        AddFixedId(112, "invoice", "faturaDokumBarkod", "Barkod", 112);
        AddFixedId(113, "invoice", "faturaDokumBasim", "Basım", 113);
        AddFixedId(114, "invoice", "faturaDokumSil", "Sil", 114);
        AddFixedId(115, "invoice", "faturaDokumTipSatis", "Satış Tipi", 115);
        AddFixedId(116, "invoice", "faturaDokumTipTamir", "Tamir Tipi", 116);
        AddFixedId(117, "invoice", "faturaDokumTipIade", "İade Tipi", 117);
        AddFixedId(118, "invoice", "faturaDokumTipAlis", "Alış Tipi", 118);
        AddFixedId(119, "invoice", "faturaDokumTipHizmet", "Hizmet Tipi", 119);
        AddFixedId(150, "invoice", "proformaFaturaDokumeAktar", "Fatura Döküme Aktar", 150);
        AddFixedId(151, "invoice", "proformaBasim", "Basım", 151);
        AddFixedId(152, "invoice", "proformaSil", "Sil", 152);
        AddFixedId(103, "invoice", "alisUstBilgiGuncelle", "Üst Bilgi Güncelle (Alış)", 106);
        AddFixedId(101, "invoice", "musteriTeklifi", "Müşteri Teklifi", 101);
        AddFixedId(120, "invoice", "musteriTeklifiDuzenle", "Düzenle", 120);
        AddFixedId(121, "invoice", "musteriTeklifiSil", "Sil", 121);
        AddFixedId(122, "invoice", "musteriTeklifiProformaAktar", "Proforma Aktar", 122);
        AddFixedId(123, "invoice", "musteriTeklifiBasim", "Basım", 123);
        // Taban fiyat (TOPTAN F) sınırını kaldırır. Bir KISITLAMAYI KALDIRAN yetki:
        // verilmediği sürece bugünkü davranış aynen sürer.
        AddFixedId(124, "invoice", "musteriTeklifiSinirsizIndirim", "Sınırsız İndirim", 124);
        AddFixedId(10455, "invoice", "cariTeklifleri", "Cari Müşteri Teklifi", 205);
        AddFixedId(10456, "invoice", "cariTeklifleriDuzenle", "Düzenle", 10456);
        AddFixedId(10457, "invoice", "cariTeklifleriSil", "Sil", 10457);
        AddFixedId(10458, "invoice", "cariTeklifleriProformaAktar", "Proforma Aktar", 10458);
        AddFixedId(10459, "invoice", "cariTeklifleriBasim", "Basım", 10459);
        // Kapsam yetkisi: sahibi kim olursa olsun BÜTÜN cari müşteri tekliflerini/proformalarını
        // görür. Bu olmadan kullanıcı yalnızca kendi carisine ait olanları görür. Yönetim rolleri
        // koda gömülmesin diye var (bkz. CariOffersController.CariOffersSeeAllPageKey).
        AddFixedId(10460, "invoice", "cariTeklifleriTumu", "Cari Müşteri Teklifi: Hepsini Görsün", 10460);
        AddFixedId(300, "invoice", "bsyHHide", "BSY(H): Ürünü Gösterme", 102);
        AddFixedId(301, "invoice", "bsyHComingSoon", "BSY(H): ComingSoon ile Göster", 103);
        AddFixedId(302, "invoice", "satisFaturaDepoBakiyeGorsun", "Satış Faturası: Depo Bakiyesi Görsün", 104);
        AddFixedId(303, "invoice", "satisFaturaOdemeAl", "Satış Faturası: Ödemeyi Hemen Al", 105);
        AddFixedId(304, "invoice", "satisFaturaProformaGorsun", "Satış Faturası: Proformadan Gelenleri Görsün", 106);
        AddFixedId(305, "invoice", "satisFaturaSiparisGorsun", "Satış Faturası: Siparişten Gelenleri Görsün", 107);
        AddFixedId(306, "invoice", "satisFaturaMagazaSiparisGorsun", "Satış Faturası: Mağaza Siparişinden Gelenleri Görsün", 108);
        AddFixedId(307, "invoice", "satisFaturaServisGorsun", "Satış Faturası: Servisten Gelenleri Görsün", 109);
        AddFixedId(308, "invoice", "satisFaturaKonsinyeGorsun", "Satış Faturası: Konsinyeden Gelenleri Görsün", 110);
        AddFixedId(309, "invoice", "siparisSadeceFiyat4Gorsun", "Sipariş: Sadece Fiyat 4 Görsün", 111);
        // Stok bitince satışı açan yetki. Varsayılan davranış değişmez: yetkisi olmayan rolde
        // stokta olmayan ürün sipariş edilemez (bugünkü hal). Yetki bir kısıtlamayı KALDIRIR.
        AddFixedId(310, "invoice", "stokYokSiparis", "Sipariş: Stokta Olmayanı Sipariş Edebilsin", 112);
        AddFixedId(160, "invoice", "etiketFiyatli", "Etiket Basım (Fiyatlı)", 6);
        AddFixedId(161, "invoice", "etiketFiyatsiz", "Etiket Basım (Fiyatsız)", 7);
        Add("invoice", "proforma", "Proforma", 7);
        Add("invoice", "magaza", "Mağaza Sipariş", 8);
        Add("invoice", "alis", "Alış Faturaları", 9);
        AddFixedId(130, "invoice", "alisDuzenle", "Düzenle", 130);
        AddFixedId(131, "invoice", "alisTermin", "Termin", 131);
        AddFixedId(132, "invoice", "alisSil", "Sil", 132);
        AddFixedId(133, "invoice", "alisTipAlis", "Alış Tipi", 133);
        AddFixedId(134, "invoice", "alisTipHizmet", "Hizmet Tipi", 134);
        AddFixedId(135, "invoice", "alisTipIade", "İade Tipi", 135);
        Add("invoice", "depoTransfer", "Depo Transfer", 10);
        Add("invoice", "stokHareket", "Stok Hareket Dökümü", 11);
        AddFixedId(104, "invoice", "depoStock", "Depo Stok Durumu", 11);
        // 'invoice/satis' ("Satış Faturaları") KALDIRILDI (2026-08-20): gerçek ekranın anahtarı
        // 'invoice/satisFatura' ("Satış Faturası", Id 2). Bu çoğul kopya hiçbir yerde kontrol
        // edilmiyordu — ne AuthorizePage, ne allowedKeys, ne menü/rota kapısı — rol yetkileri
        // ekranında hiçbir işe yaramayan bir kutu olarak duruyordu ('invoice/kampanya' ile aynı
        // durum). Var olan firmalardan silinmesi PagesController'daki seed bloğunda yapılıyor.
        //
        // NOT: UserActivitiesPage'deki 'satis' etiketi BIRAKILDI — eski hareket kayıtları o
        // anahtarla yazılmış, silinirse geçmiş kayıtlar etiketsiz kalır.
        Add("invoice", "depoBakiye", "Depo Bakiye Listesi", 13);
        AddFixedId(105, "invoice", "termin", "Termin", 14);
        AddFixedId(140, "invoice", "terminDurumDegistir", "Durum Değiştir", 140);
        AddFixedId(10470, "invoice", "garantiDegisim", "Garanti Değişim", 18);
        AddFixedId(10471, "invoice", "garantiDegisimSil", "Sil", 10471);

        // cash
        Add("cash", "kasaGirisCikis", "Kasa Giriş/Çıkış", 1);
        Add("cash", "kasalarArasiTransfer", "Kasalar Arası Transfer", 2);

        // pos
        Add("pos", "posPayment", "Kredi Kartı ile Ödeme", 1);
        Add("pos", "posReport", "Kredi Kartı Çekim Raporu", 2);
        AddFixedId(10480, "pos", "taksitOranlari", "Taksit Oranları", 3);

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
        Add("reports", "yaslandirma", "Müşteri Yaşlandırma Raporu", 3);
        Add("reports", "cariSatisRaporu", "Cari Satış Raporu", 4);
        Add("reports", "bankaRaporlari", "Banka Raporları", 6);
        Add("reports", "kasaRaporlari", "Kasa Raporları", 7);
        Add("reports", "urunSatisRaporuDetayli", "Ürün Satış Raporu Detaylı", 8);
        Add("reports", "urunSatisRaporuAylik", "Ürün Satış Raporu (Aylık)", 9);
        Add("reports", "siparisRaporu", "Sipariş Raporu", 10);
        Add("reports", "aktifSepetRaporu", "Aktif Sepet Raporu", 11);
        Add("reports", "limitRiskSatisRaporu", "Limit Risk Satış Raporu", 12);
        Add("reports", "muhasebeStokGirisCikisRaporu", "Stok Giriş/Çıkış Raporu", 13);
        Add("reports", "satisPazarlamaRaporu", "Satış Pazarlama Raporu", 14);
        Add("reports", "fiyatListesi", "Fiyat Listesi", 15);
        AddFixedId(500, "reports", "accountingSalesReport", "Muhasebe Satış Raporu", 16);
        AddFixedId(501, "reports", "garantiRaporlari", "Garanti Raporları", 17);
        AddFixedId(502, "reports", "yonetimEkstre", "Yönetim Ekstre Raporu", 18);

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
        // BİLDİRİMLER — ModuleKey artık 'bildirimler': hem soldaki menüde hem Rol Yetkileri
        // ekranında "Sistem Ayarları"nın altında kayboluyordu. Bildirim alma/gönderme bir ayar
        // değil, günlük kullanılan bir yetki; kendi başlığı olmalı.
        //
        // BU SATIRIN YERİ DEĞİŞTİRİLEMEZ: `Add` id'yi otomatik artırıyor, dolayısıyla listedeki
        // sırası hem bu sayfanın kimliğini hem de kendisinden SONRAKİ her sayfanın kimliğini
        // belirliyor. Taşınırsa bütün tenant'larda RolePagePermissions yanlış sayfalara bağlanır.
        // Değişen tek şey ModuleKey; sıra ve kimlik aynı kaldı (doğrulandı 2026-08-11).
        Add("bildirimler", "bildirimler", "Bildirimler", 1);
        AddFixedId(402, "users", "kampanya", "Kampanya Tanım", 19);
        AddFixedId(405, "users", "userActivities", "Kullanıcı Hareketleri", 20);
        AddFixedId(406, "users", "systemErrorLogs", "Hata Logları", 21);

        // Alt yetkiler sabit kimlikli, sırası kimseyi etkilemiyor. ModuleKey üstteki
        // 'bildirimler' sayfasıyla aynı olmalı ki üçü tek başlık altında toplansın.
        AddFixedId(403, "bildirimler", "bildirimlerGelen", "Gelen Bildirimler", 2);
        AddFixedId(404, "bildirimler", "bildirimlerGonder", "Bildirim Gönder", 3);

        // delete settings
        AddFixedId(600, "deleteRule", "deleteRule/faturaDokum", "Fatura Dökümü", 1);
        AddFixedId(601, "deleteRule", "deleteRule/musteriTeklifi", "Müşteri Teklifi", 2);
        AddFixedId(602, "deleteRule", "deleteRule/proforma", "Proforma", 3);
        AddFixedId(603, "deleteRule", "deleteRule/alis", "Alış Faturaları", 4);
        AddFixedId(604, "deleteRule", "deleteRule/tumIslemleriSilebilsin", "Tüm İşlemleri Silebilsin", 5);
        AddFixedId(605, "deleteRule", "deleteRule/garantiDegisim", "Garanti Değişim", 6);

        // virman
        Add("virman", "virmanListesi", "Virman", 1);

        // Toplu fiyat atama (2026-08-12). SABİT kimlik ve EN SONA eklendi: Add(...) sırası
        // kimlikleri kaydırdığı için araya sokulamaz. Hiçbir role açılmıyor; yalnızca
        // SuperAdmin görüyor (koddaki isSuperAdmin bypass'ı sayesinde).
        AddFixedId(700, "users", "topluFiyatAtama", "Toplu Fiyat Atama", 22);
        // Sistem Denetimi (2026-09-13). Rol Yetkileri'nden hiçbir role AÇILMIYOR (kullanıcı
        // kararı) — yalnız SuperAdmin görür (drift-fix'te RolePagePermissions'a IsSuperAdmin
        // rolü için ekleniyor). İsteyen kullanıcı sonradan başka rollere de açabilir.
        AddFixedId(701, "users", "sistemDenetimi", "Sistem Denetimi", 23);
        // Kataloglar (2026-09-13) — E-Ticaret modülünün İLK Pages kaydı. Aynı kural: varsayılan
        // kapalı, yalnız SuperAdmin görür.
        AddFixedId(702, "eticaret", "kataloglar", "Kataloglar", 7);
        // E-ticaret sayfalari (2026-09-21): 'Vitrin Yonetimi' ayri sayfalara dagitildi; kampanyalar ve
        // arama (Talep Raporu) sekmeleri Pages'te hic yoktu. Kimlikler PagesController/Program.cs tohumuyla AYNI.
        AddFixedId(5207, "eticaret", "kategoriler", "Vitrin Kategorileri", 9);
        AddFixedId(5208, "eticaret", "firmaBilgileri", "Firma & İletişim", 11);
        AddFixedId(5209, "eticaret", "odeme", "Ödeme & Havale", 12);
        AddFixedId(5210, "eticaret", "pazarlama", "Pazarlama & Güven", 13);
        AddFixedId(5211, "eticaret", "kampanyalar", "E-Ticaret Kampanyaları", 4);
        AddFixedId(5212, "eticaret", "arama", "Talep Raporu", 5);
        // Ziyaret Analizi (2026-09-21): "kac kisi girdi, kaci misafir, nerede takildi" hunisi.
        AddFixedId(5213, "eticaret", "analitik", "Ziyaret Analizi", 6);

        // Krediler (2026-08-12) — Banka İşlemleri altında. SABİT kimlik ve EN SONA, yukarıdaki
        // sebeple. Kimlik 20002, LoanSchema.LoansDdl'deki INSERT ile AYNI olmak zorunda:
        // farklı olsalardı aynı (ModuleKey, Key) çifti iki kez yazılmaya çalışılır ve tekil
        // indeks migration'ı patlatırdı. (20001 = bank/bankaHavaleEft, aynı aralık.)
        // Krediler ve Kredi Vade Takvimi BİLEREK burada DEĞİL.
        //
        // Buradaki seed sabit kimlik ister, ama sayfa kimlikleri veritabanından veritabanına
        // değişiyor (20002 ana DB'de reports/virmanRaporlari, DEMOTEST'te users/genelAyarlar).
        // Sabit kimlik yazmak PK ihlali demek. İkisi de açılışta çalışan LoanSchema.LoansDdl
        // içinde, kimliği o veritabanının MAX+1'inden alarak ekleniyor.
        //
        // POS Masrafları (bank/posMasraflari, 2026-08-13) da AYNI sebeple burada DEĞİL —
        // o da LoanSchema.LoansDdl içinde seed ediliyor.

        builder.HasData(pages);
    }
}


