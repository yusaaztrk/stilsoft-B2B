namespace B2B.Erp.Api.Data.Services;

/// <summary>
/// SİLME AYARLARI — kasa, banka, çek/senet, depo, sipariş ve garanti kayıtları için 24 saat
/// düğmeleri (2026-09-16 kullanıcı isteği: "kasa banka işlemlerinde ve silme gereken her sayfada
/// 24 saat kuralı ve başkasının yaptığını silememe olması lazım").
///
/// <para>
/// Her anahtar Rol Yetkileri → Silme Ayarları'nda bir düğmedir ve <b>KISITTIR</b>: rolde açıksa o
/// sayfadaki kayıt oluşturulduktan 24 saat sonra silinemez. Kontrol
/// <c>ControllerExtensions.DeleteRuleViolationAsync</c> içinde; "başkasının kaydı" kuralı düğmesiz,
/// her zaman çalışır (<c>deleteRule/tumIslemleriSilebilsin</c> ile açılır).
/// </para>
///
/// <para>
/// <b>Yetki satırı YAZILMAZ</b> — düğmeler herkeste kapalı başlar, kullanıcı rol rol açar
/// (Garanti Değişim'deki <c>deleteRule/garantiDegisim</c> ile aynı karar). SuperAdmin rolüne
/// <c>SuperAdminPageAccessSchema</c> satır açabilir; zararsız, SSA/SuperAdmin kurala takılmaz.
/// </para>
///
/// <para>
/// Sayfa kimliği sabit yazılmaz (firma veritabanlarında 600'lü kimlikler başka sayfalarda olabilir):
/// her veritabanında MAX+1. Metin tek yerde, iki yerden çalıştırılır (Program.cs varsayılan
/// veritabanı + TenantConnectionStringResolver her firma), bkz. <see cref="InvoiceTrackingSchema"/>.
/// </para>
/// </summary>
public static class DeleteRuleSchema
{
    /// <summary>Anahtar, görünen ad, sıra. Ekrandaki açıklamalar frontend UsersPage PERMISSION_INFO'da.</summary>
    public static readonly (string Key, string DisplayName, int SortOrder)[] Rules =
    {
        ("deleteRule/kasaHareket", "Kasa Giriş/Çıkış", 7),
        ("deleteRule/kasaTransfer", "Kasalar Arası Transfer", 8),
        ("deleteRule/virman", "Virman", 9),
        ("deleteRule/bankaHareket", "Banka Havale/EFT", 10),
        ("deleteRule/bankaMasraf", "Banka Masrafları", 11),
        ("deleteRule/kredi", "Krediler", 12),
        ("deleteRule/posAktarim", "POS Aktarım", 13),
        ("deleteRule/musteriCeki", "Müşteri Çekleri", 14),
        ("deleteRule/borcCeki", "Borç Çekleri", 15),
        ("deleteRule/borcSenedi", "Borç Senetleri", 16),
        ("deleteRule/depoTransfer", "Depo Transfer", 17),
        ("deleteRule/irsaliye", "İrsaliye", 18),
        ("deleteRule/siparis", "Sipariş", 19),
        ("deleteRule/garantiKayit", "Garanti Kayıtları", 20),
    };

    public static readonly string DeleteRuleDdl = BuildDdl();

    private static string BuildDdl()
    {
        var sb = new System.Text.StringBuilder();
        sb.AppendLine("DO $$");
        sb.AppendLine("BEGIN");
        sb.AppendLine("IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='Pages') THEN");
        foreach (var (key, displayName, sortOrder) in Rules)
        {
            var k = key.Replace("'", "''");
            var d = displayName.Replace("'", "''");
            sb.AppendLine("  INSERT INTO \"Pages\" (\"Id\", \"DisplayName\", \"IsActive\", \"Key\", \"ModuleKey\", \"SortOrder\")");
            sb.AppendLine($"  SELECT (SELECT COALESCE(MAX(\"Id\"), 0) + 1 FROM \"Pages\"), '{d}', TRUE, '{k}', 'deleteRule', {sortOrder}");
            sb.AppendLine($"  WHERE NOT EXISTS (SELECT 1 FROM \"Pages\" WHERE \"ModuleKey\"='deleteRule' AND \"Key\"='{k}');");
        }
        sb.AppendLine("END IF;");
        sb.AppendLine("END $$;");
        return sb.ToString();
    }
}
