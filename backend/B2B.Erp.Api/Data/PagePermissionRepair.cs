using Microsoft.EntityFrameworkCore;

namespace B2B.Erp.Api.Data;

/// <summary>
/// Sayfa/izin tablolarının onarımı — ÇİFT SAYFA KAYITLARI.
///
/// SORUN NEYDİ
/// -----------
/// Bazı tenant veritabanlarında aynı (ModuleKey, Key) için BİRDEN FAZLA "Pages" satırı oluşmuştu.
/// Doğrulandı (2026-08-11, b2b_erp_tenant_DEMOTEST):
///     bank/bankaHavaleEft -> Id 20 ve 20001
///     users/depolar       -> Id 43 ve 9991
///     users/tedarikciEkle -> Id 51 ve 1001
///
/// NASIL OLUŞTU
/// ------------
/// Zinciri şu: o tenant'ın migration'ları kırık olduğu için (RolePagePermissions üzerinde FK
/// ihlali) `IX_Pages_ModuleKey_Key` TEKİL İNDEKSİ hiç oluşmamış. İndeks yokken, sayfa tohumlayan
/// idempotent SQL blokları ikinci satırı engelleyemiyor: o blokların koruması
/// `WHERE NOT EXISTS (... "Id" = 20001)` biçiminde, yani KİMLİĞE bakıyor. Sayfa daha önce başka
/// bir kimlikle (20) yaratılmışsa koruma tutmuyor ve ikinci satır ekleniyor.
///
/// NEDEN ÖNEMLİ (kozmetik değil)
/// ------------------------------
/// PageAuthorizationFilter yetkiyi şöyle çözüyor: önce (ModuleKey, Key) ile EŞLEŞEN BÜTÜN sayfa
/// kimliklerini topluyor, sonra `Any(izin.CanAccess && pageIds.Contains(izin.PageId))` diyor.
/// Yani İKİ SATIRDAN BİRİ AÇIKSA yetki veriliyor. Sonuç: yönetici Rol Yetkileri ekranında
/// düğmeyi kapatıyor, kaydediyor, ama erişim devam ediyor — çünkü kapattığı satır iki kayıttan
/// yalnızca biriydi. Doğrulandı: rol 10 ve 12 için bank/bankaHavaleEft, Id 20'de kapalı,
/// Id 20001'de açıktı.
///
/// Ekranda da her sayfa iki kart olarak görünüyordu.
///
/// BİRLEŞTİRME KURALI: "bugünkü davranışı koru"
/// --------------------------------------------
/// İzinler kanonik satıra MANTIKSAL VEYA ile taşınıyor: iki satırdan biri açıksa sonuç açık.
/// Sebebi, yetki kontrolünün BUGÜN zaten böyle davranıyor olması. Yalnızca kanonik satırın
/// değerini almak, bugün erişimi olan rollerin erişimini sessizce KESERDİ — bu, kimsenin
/// istemediği bir yan etki olurdu. Birleştirmeden sonra düğmeler gerçekten çalışır ve yönetici
/// kapatmak istediğini bilerek kapatabilir.
///
/// Kanonik satır EN KÜÇÜK kimliktir: tohumlama kimlikleri deterministik olarak küçükten büyüğe
/// veriliyor, sonradan elle eklenen yüksek kimlikler (20001, 9991, 1001) sonradan gelen kopya.
/// </summary>
public static class PagePermissionRepair
{
    /// <summary>
    /// Çift sayfa kayıtlarını birleştirir ve tekrarı kalıcı olarak engelleyen tekil indeksi kurar.
    /// Tamamen idempotent: çifti olmayan bir veritabanında hiçbir satıra dokunmaz.
    /// </summary>
    public static async Task MergeDuplicatePagesAsync(DbContext db, CancellationToken cancellationToken = default)
    {
        // Sıra ÖNEMLİ. İndeks en sonda kurulmalı, çünkü çiftler durduğu sürece kurulamaz;
        // kurulduktan sonra da yeni çift oluşması imkânsız hâle gelir.
        await db.Database.ExecuteSqlRawAsync(@"
-- 1) Kanonik satırda KARŞILIĞI OLMAYAN izinleri kopyala.
--    (Kopya satıra verilmiş ama kanoniğe hiç yazılmamış roller; ör. yalnızca Id 20001'de
--     satırı olan bir rol. Bunlar atlanırsa o rol erişimini kaybeder.)
INSERT INTO ""RolePagePermissions"" (""RoleId"", ""PageId"", ""CanAccess"")
SELECT src.""RoleId"", d.keep_id, src.""CanAccess""
FROM (
    SELECT ""Id"", MIN(""Id"") OVER (PARTITION BY ""ModuleKey"", ""Key"") AS keep_id
    FROM ""Pages""
) d
JOIN ""RolePagePermissions"" src ON src.""PageId"" = d.""Id""
WHERE d.""Id"" <> d.keep_id
ON CONFLICT (""RoleId"", ""PageId"") DO NOTHING;

-- 2) Kopyada AÇIK olan izni kanoniğe taşı (mantıksal VEYA).
--    Yetki kontrolü bugün zaten ""herhangi biri açıksa yetki var"" diyor; bu adım o davranışı
--    tek satıra indirger, değiştirmez.
UPDATE ""RolePagePermissions"" keep
SET ""CanAccess"" = TRUE
FROM (
    SELECT ""Id"", MIN(""Id"") OVER (PARTITION BY ""ModuleKey"", ""Key"") AS keep_id
    FROM ""Pages""
) d
JOIN ""RolePagePermissions"" src
    ON src.""PageId"" = d.""Id"" AND src.""CanAccess"" = TRUE
WHERE d.""Id"" <> d.keep_id
  AND keep.""PageId"" = d.keep_id
  AND keep.""RoleId"" = src.""RoleId""
  AND keep.""CanAccess"" = FALSE;

-- 3) Kopya sayfaları sil. İzinleri FK üzerinden cascade ile düşer; taşınması gerekenler
--    1. ve 2. adımda kanoniğe alındı.
DELETE FROM ""Pages"" p
USING (
    SELECT ""Id"", MIN(""Id"") OVER (PARTITION BY ""ModuleKey"", ""Key"") AS keep_id
    FROM ""Pages""
) d
WHERE p.""Id"" = d.""Id"" AND d.""Id"" <> d.keep_id;

-- 4) Asıl koruma. Bu indeks olmadan yukarıdaki temizlik bir daha bozulur; kimliğe bakan
--    tohumlama blokları ikinci satırı yine ekleyebilir. Migration zinciri kırık tenant'larda
--    indeks hiç oluşmamıştı, bu yüzden burada da kuruluyor.
CREATE UNIQUE INDEX IF NOT EXISTS ""IX_Pages_ModuleKey_Key""
    ON ""Pages"" (""ModuleKey"", ""Key"");
", cancellationToken);
    }
}
