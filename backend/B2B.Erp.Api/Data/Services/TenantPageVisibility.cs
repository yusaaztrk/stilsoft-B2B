using Microsoft.EntityFrameworkCore;

namespace B2B.Erp.Api.Data.Services;

/// <summary>
/// FİRMAYA AÇIK SAYFALAR — tek kapı.
///
/// <para>
/// Bir firmanın hangi sayfaları görebileceği master veritabanında (<c>TenantEnabledPages</c>)
/// satır satır tutuluyor. Bu liste varsa <c>/api/pages</c>, <c>/api/pages/enabled-keys</c> ve rol
/// yetkileri uçları yalnız listedeki sayfaları döndürüyor. Sorun şu: sonradan eklenen her sayfa
/// (Fatura Takip, silme anahtarları, krediler, banka masrafları...) firma veritabanının
/// <c>Pages</c> tablosuna yazılıyor ama master listesinde satırı OLMUYOR → yetkisi olsa bile
/// hiçbir ekranda görünmüyor, Rol Yetkileri'nde düğmesi bile çıkmıyor.
/// </para>
///
/// <para>
/// 2026-09-16'ya kadar bunun telafisi dört ayrı yerde elle tutulan anahtar listeleriydi
/// (PagesController'da iki, RolesController'da iki) ve listeler birbirinden farklıydı: Garanti
/// Deposu görünürken aynı anda yazılan <c>deleteRule/garantiDegisim</c> görünmüyordu. Canlıda
/// Fatura Takip ve 14 silme anahtarı tam bu yüzden gelmedi. Tohumlama partisinin sonundaki
/// master senkronu da yardımcı olamadı: parti bir yerde düşünce senkrona sıra gelmiyor.
/// </para>
///
/// <para>
/// <b>Kural:</b> firmanın listesi varsa, o listede <b>hiç satırı olmayan</b> aktif bir sayfa,
/// <b>modülü firmaya açıksa</b> (modülün en az bir sayfası açıksa) açık sayılır. Yeni modül
/// açmak hâlâ SSA kararı (modülün hiç sayfası açık değilse görünmez); modülü bilerek KAPATILMIŞ
/// sayfa (<c>IsEnabled=false</c> satırı) kapalı kalır. Eski elle listeler de burada, davranış
/// birebir korunuyor — onlar satırı kapalı olsa bile modül açıkken açılıyordu.
/// </para>
///
/// <para>
/// Bu sınıf yalnız OKUR; master'a satır yazmaz. Satır yazma (SSA ekranı, e-ticaret senkronu,
/// tohumlama partisi) olduğu yerde kalıyor.
/// </para>
/// </summary>
public static class TenantPageVisibility
{
    public sealed class Result
    {
        public bool HasAnyConfig { get; }
        public HashSet<int> EnabledPageIds { get; }

        public Result(bool hasAnyConfig, HashSet<int> enabledPageIds)
        {
            HasAnyConfig = hasAnyConfig;
            EnabledPageIds = enabledPageIds;
        }

        /// <summary>Listesi olmayan firmada her sayfa görünür; listesi olanda yalnız açık olanlar.</summary>
        public bool IsVisible(int pageId) => !HasAnyConfig || EnabledPageIds.Contains(pageId);
    }

    /// <summary>
    /// Eski telafi: <c>users</c> modülü açık olan firmada bu sabit kimlikler de açık sayılır
    /// (Çalışan, Kampanya, Gelen Bildirimler, Bildirim Gönder, Kullanıcı Hareketleri).
    /// Kimlikler bu beş sayfada bütün veritabanlarında sabit; genel kural bunları kapsamıyor
    /// çünkü modülleri (<c>employee</c>, <c>bildirimler</c>) firmada hiç açılmamış olabilir.
    /// </summary>
    private static readonly int[] UsersModuleCompanionPageIds = { 400, 402, 403, 404, 405 };

    /// <summary>
    /// Eski telafi listelerinin BİRLEŞİMİ: modülü açık olan firmada, listede kapalı satırı olsa
    /// bile açık sayılan sayfalar. Dört yerdeki listeler farklıydı; hepsi burada.
    /// </summary>
    private static readonly HashSet<(string ModuleKey, string Key)> AlwaysOnWhenModuleEnabled = new()
    {
        ("bank", "krediler"),
        ("bank", "posMasraflari"),
        ("bank", "bankaMasraflari"),
        ("pos", "taksitOranlari"),
        ("reports", "krediVadeTakvimi"),
        ("users", "garantiDeposu"),
        ("invoice", "garantiDegisim"),
        ("invoice", "garantiDegisimSil"),
        ("reports", "garantiDegisimRaporu"),
        ("invoice", "faturaDokumTipSatis"),
        ("invoice", "faturaDokumTipTamir"),
        ("invoice", "faturaDokumTipIade"),
        ("invoice", "faturaDokumTipAlis"),
        ("invoice", "faturaDokumTipHizmet"),
    };

    public static async Task<Result> ResolveAsync(
        MasterDbContext masterDb,
        AppDbContext db,
        int tenantId,
        CancellationToken cancellationToken)
    {
        var rows = await masterDb.TenantEnabledPages
            .AsNoTracking()
            .Where(x => x.TenantId == tenantId)
            .Select(x => new { x.PageId, x.IsEnabled })
            .ToListAsync(cancellationToken);

        if (rows.Count == 0)
        {
            return new Result(false, new HashSet<int>());
        }

        var enabled = rows.Where(x => x.IsEnabled).Select(x => x.PageId).ToHashSet();
        var configured = rows.Select(x => x.PageId).ToHashSet();

        var activePages = await db.Pages
            .AsNoTracking()
            .Where(p => p.IsActive)
            .Select(p => new { p.Id, p.ModuleKey, p.Key })
            .ToListAsync(cancellationToken);

        // Modül "açık" = listede açık olan en az bir sayfası var. Telafiler eklenmeden ÖNCE
        // hesaplanıyor; eski kod da böyle yapıyordu.
        var enabledModules = activePages
            .Where(p => enabled.Contains(p.Id))
            .Select(p => p.ModuleKey)
            .ToHashSet(StringComparer.Ordinal);

        if (enabledModules.Contains("users"))
        {
            foreach (var id in UsersModuleCompanionPageIds) enabled.Add(id);
        }

        foreach (var page in activePages)
        {
            if (enabled.Contains(page.Id)) continue;
            if (!enabledModules.Contains(page.ModuleKey)) continue;

            var alwaysOn = AlwaysOnWhenModuleEnabled.Contains((page.ModuleKey, page.Key));
            var neverConfigured = !configured.Contains(page.Id);

            if (alwaysOn || neverConfigured) enabled.Add(page.Id);
        }

        return new Result(true, enabled);
    }
}
