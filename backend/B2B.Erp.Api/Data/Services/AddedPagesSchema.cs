namespace B2B.Erp.Api.Data.Services;

/// <summary>
/// SONRADAN EKLENEN SAYFA/YETKİ KAYITLARI.
///
/// <para>
/// Buradaki her satır Rol Yetkileri ekranında bir düğmeye karşılık gelir. Rol adı hiçbir yere
/// yazılmaz; karar tek kaynaktan (bu yetki satırından) verilir:
/// </para>
/// <list type="bullet">
///   <item><c>invoice/musteriTeklifiCariEkle</c> — teklif penceresindeki "Cari Ekle" düğmesi (2026-09-18).</item>
///   <item><c>reports/hizmetHarcamaRaporu</c> — Hizmet Harcama Raporu sayfası (2026-09-18).</item>
/// </list>
///
/// <para>
/// <b>Yetki satırı YAZILMAZ</b> — düğme herkeste kapalı başlar, kullanıcı rol rol açar.
/// Aynı karar <see cref="DeleteRuleSchema"/> ve garanti değişimde de geçerli. SSA/SuperAdmin
/// için <see cref="SuperAdminPageAccessSchema"/> satırı kendiliğinden açabilir; zararsız.
/// </para>
///
/// <para>
/// Sayfa kimliği SABİT YAZILMAZ: firma veritabanlarında aynı kimlik başka bir sayfaya ait
/// olabiliyor ve sabit kimlikli INSERT `PK_Pages` ihlaliyle İÇİNDE BULUNDUĞU PARTİNİN TAMAMINI
/// düşürür. Her veritabanında MAX+1 kullanılır. Metin tek yerde, iki yerden çalıştırılır
/// (Program.cs varsayılan veritabanı + TenantConnectionStringResolver her firma).
/// </para>
/// </summary>
public static class AddedPagesSchema
{
    /// <summary>Anahtar, görünen ad, sıra. Ekrandaki açıklama frontend UsersPage PERMISSION_INFO'da.</summary>
    public static readonly (string ModuleKey, string Key, string DisplayName, int SortOrder)[] Pages =
    {
        ("invoice", "musteriTeklifiCariEkle", "Müşteri Teklifi: Cari Ekle", 10493),
        ("reports", "hizmetHarcamaRaporu", "Hizmet Harcama Raporu", 24),
    };

    public static readonly string AddedPagesDdl = BuildDdl();

    private static string BuildDdl()
    {
        var sb = new System.Text.StringBuilder();
        sb.AppendLine("DO $$");
        sb.AppendLine("BEGIN");
        sb.AppendLine("IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='Pages') THEN");
        foreach (var (moduleKey, key, displayName, sortOrder) in Pages)
        {
            var m = moduleKey.Replace("'", "''");
            var k = key.Replace("'", "''");
            var d = displayName.Replace("'", "''");
            sb.AppendLine("  INSERT INTO \"Pages\" (\"Id\", \"DisplayName\", \"IsActive\", \"Key\", \"ModuleKey\", \"SortOrder\")");
            sb.AppendLine($"  SELECT (SELECT COALESCE(MAX(\"Id\"), 0) + 1 FROM \"Pages\"), '{d}', TRUE, '{k}', '{m}', {sortOrder}");
            sb.AppendLine($"  WHERE NOT EXISTS (SELECT 1 FROM \"Pages\" WHERE \"ModuleKey\"='{m}' AND \"Key\"='{k}');");
        }
        sb.AppendLine("END IF;");
        sb.AppendLine("END $$;");
        return sb.ToString();
    }
}
