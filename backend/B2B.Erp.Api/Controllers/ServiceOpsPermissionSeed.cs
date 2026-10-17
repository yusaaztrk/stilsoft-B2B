namespace B2B.Erp.Api.Controllers;

/// <summary>
/// ServiceOps sayfa anahtarlarının seed SQL'i İKİ ayrı yerde yaşıyor:
/// <c>PagesController.EnsureGenelAyarlarPageExistsAsync</c> ve <c>RolesController</c>'daki aynı
/// adlı metot. İkisi 5060'tan sonra ayrışmış durumda ve yeni bir anahtar yalnızca birine
/// yazılırsa, o anahtarı diğer uçtan gelen istek göremiyor.
///
/// Yeni eklenen anahtarların ikizlenmemesi için metin BURADA tek kopya tutuluyor; iki metot da
/// bunu ekliyor. Blok tamamen idempotent: sayfa varsa eklenmez, rol yetkisi zaten satır olarak
/// duruyorsa (kullanıcı elle kapatmış olsa bile) DOKUNULMAZ — <c>CanAccess</c> güncellemesi
/// satırı silmiyor, false'a çekiyor, dolayısıyla <c>ON CONFLICT DO NOTHING</c> elle yapılan
/// kapatmayı geri açmaz.
///
/// ROL KİMLİĞİ YERİNE ROL KODU: her firmanın kendi veritabanı ve kendi <c>Roles</c> tablosu var,
/// aynı rol her firmada aynı Id'yi taşımıyor (DEMOTEST'te Admin=6 yok, KlimaEkibi=30).
/// Sabit Id listesi yabancı anahtar hatası verip seed'in tamamını düşürüyordu.
/// </summary>
internal static class ServiceOpsPermissionSeed
{
    /// <summary>
    /// Kapalı başlaması gereken roller. Geçmiş görme sahaya kapalı (kullanıcı kuralı):
    /// teknisyen kendi işini görür ama kaydın kim neyi ne zaman değiştirdiği dökümünü görmez.
    /// </summary>
    private const string HistoryClosedRoleCodes = "'servispersonel','klimaekibi','sahamontajekibi','bayi','altbayi'";

    /// <summary>Kolon yetkileri yalnızca bayi tarafına kapalı; iç ekipte hepsi açık.</summary>
    private const string DealerRoleCodes = "'bayi','altbayi'";

    public const string Sql = @"
/* ====================================================================================
   İŞLEM GEÇMİŞİ + KABUL KOLON YETKİLERİ + ARAÇ DEPOSU ROL AÇILIŞI
   Kimlik aralığı 5110+ : 5070..5073 iki ayrı blokta FARKLI anahtarlarla kullanılmış
   durumda (biri hakediş, biri kabul kolonları), o aralık kirli.
   ==================================================================================== */

INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 5110, 'İşlem Geçmişini Görme', TRUE, 'servisGecmisi', 'serviceOps', 110
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id"" = 5110 OR (""ModuleKey"" = 'serviceOps' AND ""Key"" = 'servisGecmisi'));

INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 5111, 'Büyük Ev Kabul - Aksiyon Sütunu', TRUE, 'buyukEvAletleriKabul.aksiyon', 'serviceOps', 111
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id"" = 5111 OR (""ModuleKey"" = 'serviceOps' AND ""Key"" = 'buyukEvAletleriKabul.aksiyon'));

INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 5112, 'Küçük Ev Kabul - Aksiyon Sütunu', TRUE, 'kucukUrunKabul.aksiyon', 'serviceOps', 112
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id"" = 5112 OR (""ModuleKey"" = 'serviceOps' AND ""Key"" = 'kucukUrunKabul.aksiyon'));

INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 5113, 'Montaj Kabul - Memnuniyet Sütunu', TRUE, 'montajKabul.memnuniyet', 'serviceOps', 113
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id"" = 5113 OR (""ModuleKey"" = 'serviceOps' AND ""Key"" = 'montajKabul.memnuniyet'));

INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 5114, 'Montaj Kabul - Aksiyon Sütunu', TRUE, 'montajKabul.aksiyon', 'serviceOps', 114
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id"" = 5114 OR (""ModuleKey"" = 'serviceOps' AND ""Key"" = 'montajKabul.aksiyon'));

/* Kalem satırındaki İŞLEMLER sütunu, kaydın Aksiyon sütunundan AYRI bir yetki: biri faturanın
   tamamını (fiş, geri al, sil), diğeri TEK BİR montaj kalemini (düzenle, geçmiş) yönetiyor.
   Bayi kaydı görebilmeli ama kalemlere dokunamamalı. */
INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 5115, 'Montaj Kabul - Kalem İşlemler Sütunu', TRUE, 'montajKabul.kalemIslemleri', 'serviceOps', 115
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id"" = 5115 OR (""ModuleKey"" = 'serviceOps' AND ""Key"" = 'montajKabul.kalemIslemleri'));

/* Memnuniyet anahtarları PagesController'ın eski bloğunda tanımlı ama RolesController'ın
   kopyasında yok. İkisi de bu dosyayı eklediği için burada tekrar güvenceye alınıyor. */
INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 5070, 'Büyük Ev Kabul - Memnuniyet Sütunu', TRUE, 'buyukEvAletleriKabul.memnuniyet', 'serviceOps', 70
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id"" = 5070 OR (""ModuleKey"" = 'serviceOps' AND ""Key"" = 'buyukEvAletleriKabul.memnuniyet'));

INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 5072, 'Küçük Ev Kabul - Memnuniyet Sütunu', TRUE, 'kucukUrunKabul.memnuniyet', 'serviceOps', 72
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id"" = 5072 OR (""ModuleKey"" = 'serviceOps' AND ""Key"" = 'kucukUrunKabul.memnuniyet'));

/* GEÇMİŞ GÖRME: kapalı rol listesi DIŞINDAKİ herkese açık.
   Rol adı sabit listeye yazılmıyor — firmaya özel roller (KADIR, MAGAZA, mudur2rolu…) da
   varsayılan olarak açık başlasın diye ""hariç"" kurulmuş bir sorgu. */
INSERT INTO ""RolePagePermissions"" (""RoleId"", ""PageId"", ""CanAccess"")
SELECT r.""Id"", p.""Id"", TRUE
FROM ""Roles"" r
CROSS JOIN ""Pages"" p
WHERE p.""ModuleKey"" = 'serviceOps' AND p.""Key"" = 'servisGecmisi'
  AND lower(r.""Code"") NOT IN (" + HistoryClosedRoleCodes + @")
ON CONFLICT (""RoleId"", ""PageId"") DO NOTHING;

/* Kapalı roller için satırı AÇIKÇA false ile aç: satır hiç yoksa yetki ekranında
   ""verilmemiş"" ile ""hiç sorulmamış"" ayırt edilemiyor ve sonraki bir toplu ekleme
   yanlışlıkla açabiliyor. */
INSERT INTO ""RolePagePermissions"" (""RoleId"", ""PageId"", ""CanAccess"")
SELECT r.""Id"", p.""Id"", FALSE
FROM ""Roles"" r
CROSS JOIN ""Pages"" p
WHERE p.""ModuleKey"" = 'serviceOps' AND p.""Key"" = 'servisGecmisi'
  AND lower(r.""Code"") IN (" + HistoryClosedRoleCodes + @")
ON CONFLICT (""RoleId"", ""PageId"") DO NOTHING;

/* KABUL KOLONLARI: bayi/alt bayi hariç herkese açık. */
INSERT INTO ""RolePagePermissions"" (""RoleId"", ""PageId"", ""CanAccess"")
SELECT r.""Id"", p.""Id"", TRUE
FROM ""Roles"" r
CROSS JOIN ""Pages"" p
WHERE p.""ModuleKey"" = 'serviceOps'
  AND p.""Key"" IN ('buyukEvAletleriKabul.memnuniyet', 'buyukEvAletleriKabul.aksiyon',
                   'kucukUrunKabul.memnuniyet', 'kucukUrunKabul.aksiyon',
                   'montajKabul.memnuniyet', 'montajKabul.aksiyon', 'montajKabul.kalemIslemleri')
  AND lower(r.""Code"") NOT IN (" + DealerRoleCodes + @")
ON CONFLICT (""RoleId"", ""PageId"") DO NOTHING;

INSERT INTO ""RolePagePermissions"" (""RoleId"", ""PageId"", ""CanAccess"")
SELECT r.""Id"", p.""Id"", FALSE
FROM ""Roles"" r
CROSS JOIN ""Pages"" p
WHERE p.""ModuleKey"" = 'serviceOps'
  AND p.""Key"" IN ('buyukEvAletleriKabul.memnuniyet', 'buyukEvAletleriKabul.aksiyon',
                   'kucukUrunKabul.memnuniyet', 'kucukUrunKabul.aksiyon',
                   'montajKabul.memnuniyet', 'montajKabul.aksiyon', 'montajKabul.kalemIslemleri')
  AND lower(r.""Code"") IN (" + DealerRoleCodes + @")
ON CONFLICT (""RoleId"", ""PageId"") DO NOTHING;

/* ARAÇ DEPOLARI saha ekiplerine açılıyor (kullanıcı kararı).
   Yalnızca sayfanın kendisi — 'aracDepolari.tumIsleriGorme' BİLEREK verilmiyor: kapsam
   anahtarı olmayan kullanıcı kendi depo yetkisindeki depoları görür, başkasınınkini görmez. */
INSERT INTO ""RolePagePermissions"" (""RoleId"", ""PageId"", ""CanAccess"")
SELECT r.""Id"", p.""Id"", TRUE
FROM ""Roles"" r
CROSS JOIN ""Pages"" p
WHERE p.""ModuleKey"" = 'serviceOps' AND p.""Key"" = 'aracDepolari'
  AND lower(r.""Code"") IN ('servispersonel','klimaekibi','sahamontajekibi')
ON CONFLICT (""RoleId"", ""PageId"") DO NOTHING;
";
}
