namespace B2B.Erp.Api.Data.Services;

/// <summary>
/// SUPERADMIN SAYFA YETKİSİ TELAFİSİ (2026-08-21).
///
/// <para>
/// <b>Belirti.</b> superadmin rolündeki kullanıcı bir ekranı açmaya çalıştığında
/// <c>"Yetkiniz yok"</c> (403) alıyor. Mesajın tek kaynağı
/// <c>PageAuthorizationFilter</c>.
/// </para>
///
/// <para>
/// <b>Sebep.</b> O filtrede superadmin için bir bypass YOKTUR — yalnızca SSA
/// (<c>IsSuperSuperAdmin</c> claim'i) sayfa kontrolünü atlar. superadmin'in yetkisi
/// tamamen <c>RolePagePermissions</c> satırlarından gelir. Bu satırlar da ilk kurulumda
/// <c>RolePagePermissionConfiguration</c> ile tohumlanır. Sonradan eklenen her sayfa
/// (installmentRules, taksitOranlari, depolar, genelAyarlar, maliDonemler, deleteRule/*...)
/// yalnızca <c>Pages</c> tablosuna yazılıyor, superadmin'e yetki satırı yazılmıyor —
/// yani sayfa var, kimsenin yetkisi yok, ekran 403 dönüyor.
/// </para>
///
/// <para>
/// <b>Ne yapıyor.</b> <c>Roles.IsSuperAdmin = TRUE</c> olan rollere, yetki satırı HİÇ
/// OLMAYAN aktif sayfalar için satır açıyor. Var olan satıra DOKUNMUYOR: Rol Yetkileri
/// ekranından bilerek kapatılmış bir sayfa her açılışta geri açılmamalı (b2b_erp'de
/// <c>bildirimlerGonder</c>, DEMOTEST'te 7 sayfa bilerek kapalı).
/// </para>
///
/// <para>
/// <b>Dışlanan anahtarlar.</b> Bazı "sayfa" kayıtları aslında KISITLAMA bayrağıdır —
/// yetki vermek erişimi genişletmez, DARALTIR. Bunlar listeye alınmaz:
/// <c>bsyHHide</c> (ürünü gösterme), <c>bsyHComingSoon</c> (ComingSoon ile göster),
/// <c>siparisSadeceFiyat4Gorsun</c>, <c>hakedis.sadeceKendiIsleri</c>.
/// </para>
///
/// <para>
/// Desen <see cref="LoanSchema"/>/<see cref="BankExpenseSchema"/> ile aynı: bu depoda
/// şema/veri düzeltmesi migration ile değil, açılışta çalışan idempotent SQL ile yapılır.
/// Hem varsayılan veritabanına hem de her firma veritabanına uygulanır.
/// </para>
/// </summary>
public static class SuperAdminPageAccessSchema
{
    public const string BackfillSql = @"
-- Pages kimlik dizisi onarımı. Bu depodaki tohumlamaların çoğu ""Id""yi ELLE yazıyor
-- (20011, 5073, 10459...) ve elle yazılan kimlik diziyi ilerletmiyor. Sonuç: kimlik
-- yazmayan bir INSERT ""duplicate key value violates unique constraint PK_Pages"" ile
-- düşüyor ve o INSERT'in içinde bulunduğu tohumlama partisinin TAMAMI iptal oluyor.
-- b2b_erp'de dizi 20011'de takılıydı; PagesController'daki kimliksiz INSERT'ler bu yüzden
-- sessizce çalışmıyordu.
SELECT setval(
    pg_get_serial_sequence('""Pages""', 'Id'),
    GREATEST((SELECT COALESCE(MAX(""Id""), 1) FROM ""Pages""), 1)
)
WHERE pg_get_serial_sequence('""Pages""', 'Id') IS NOT NULL;

-- Taksit Oranları (POS) sayfası: [AuthorizePage(""pos"",""taksitOranlari"")] bu satır yoksa
-- ""bilinmeyen sayfa"" sayılır ve uç herkese 403 döner.
-- Kimlik elle veriliyor ki dizinin durumundan bağımsız çalışsın.
INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT (SELECT COALESCE(MAX(""Id""), 0) + 1 FROM ""Pages""), 'Taksit Oranları', TRUE, 'taksitOranlari', 'pos', 3
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""ModuleKey""='pos' AND ""Key""='taksitOranlari');

-- superadmin: yetki satırı hiç olmayan aktif sayfalar açılır.
INSERT INTO ""RolePagePermissions"" (""RoleId"", ""PageId"", ""CanAccess"")
SELECT r.""Id"", p.""Id"", TRUE
FROM ""Roles"" r
CROSS JOIN ""Pages"" p
WHERE r.""IsSuperAdmin"" = TRUE
  AND p.""IsActive"" = TRUE
  AND p.""Key"" NOT IN (
        'bsyHHide',
        'bsyHComingSoon',
        'siparisSadeceFiyat4Gorsun',
        'hakedis.sadeceKendiIsleri'
      )
  AND NOT EXISTS (
        SELECT 1 FROM ""RolePagePermissions"" x
        WHERE x.""RoleId"" = r.""Id"" AND x.""PageId"" = p.""Id""
      )
ON CONFLICT (""RoleId"", ""PageId"") DO NOTHING;
";
}
