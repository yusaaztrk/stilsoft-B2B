using B2B.Erp.Api.Data;
using Microsoft.EntityFrameworkCore;

namespace B2B.Erp.Api.Core.Helpers;

/// <summary>
/// SSA'nın (süper süper admin) varsayılan deposu.
///
/// SSA'nın kiracı <c>Users</c> tablosunda satırı YOKTUR — giriş sırasında sentetik bir
/// kullanıcı üretilir (bkz. <c>AuthService</c>) ve <c>/auth/me</c> ayrı bir daldan cevap
/// verir. Bu yüzden diğer kullanıcılarda işe yarayan "veritabanındaki alanı güncelle"
/// yöntemi SSA için çalışmaz; depo istek anında ADIYLA çözülmek zorunda.
///
/// Neden ad ile: HASPOLAT deposunun kodu her kiracıda farklı (DEMO 21, KKTC 26,
/// DEMOTEST 10). Koda sabit bir sayı yazmak, ilk kiracıda doğru ikincisinde sessizce
/// yanlış depo demekti.
///
/// SuperAdmin rolündeki kullanıcılar buraya UĞRAMAZ; onların <c>Users.DefaultWarehouseCode</c>
/// alanı veritabanında doludur ve normal yoldan okunur.
/// </summary>
public static class PrivilegedDefaultWarehouse
{
    /// <summary>Varsayılan sayılacak deponun adı.</summary>
    public const string WarehouseName = "HASPOLAT";

    /// <summary>
    /// Kiracıdaki HASPOLAT deposunun kodunu döner; yoksa <c>null</c>.
    ///
    /// Yalnızca AKTİF depolara bakar: DEMOTEST'te "HASPOLAT" adlı depo pasife alınmış,
    /// kullanımdaki olan "HASPOLAT DEPO". Pasif bir depoyu öntanımlı yapmak, ekranda seçili
    /// görünüp kaydederken reddedilen bir alan demek olurdu.
    ///
    /// Adı tam eşleşen depo, ön ekle eşleşene tercih edilir; eşitlikte küçük kod kazanır ki
    /// sonuç çağrıdan çağrıya değişmesin.
    /// </summary>
    public static async Task<int?> ResolveAsync(AppDbContext dbContext, CancellationToken cancellationToken = default)
    {
        if (dbContext is null) return null;

        try
        {
            var matches = await dbContext.Warehouses
                .AsNoTracking()
                .Where(w => w.IsActive && w.Name != null && w.Name.ToUpper().StartsWith(WarehouseName))
                .Select(w => new { w.WarehouseCode, w.Name })
                .ToListAsync(cancellationToken);

            if (matches.Count == 0) return null;

            return matches
                .OrderByDescending(w => string.Equals(w.Name, WarehouseName, StringComparison.OrdinalIgnoreCase))
                .ThenBy(w => w.WarehouseCode)
                .Select(w => (int?)w.WarehouseCode)
                .First();
        }
        catch
        {
            // Depo çözümlenemediyse giriş/`me` akışı bozulmamalı: alan boş kalır, kullanıcı
            // depoyu elle seçer. Eskiden zaten her koşulda boş geliyordu.
            return null;
        }
    }
}
