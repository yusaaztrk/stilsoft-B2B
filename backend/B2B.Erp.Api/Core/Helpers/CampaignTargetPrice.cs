using B2B.Erp.Api.Data;
using B2B.Erp.Api.Entities;
using Microsoft.EntityFrameworkCore;

namespace B2B.Erp.Api.Core.Helpers;

/// <summary>
/// SEÇİLİ ÜRÜN İNDİRİMİ — ÜRÜNE ÖZEL KAMPANYALI FİYAT (2026-10-07 kullanıcı isteği: "bir kampanyada
/// 25'e yakın ürün, listede her birinin yeni fiyatını yazarız").
///
/// <para>
/// Satırda <see cref="CampaignDiscount.HedefFiyat"/> doluysa kampanya "F4'ten şu kadar düş" değil
/// "F4 bu olsun" demektir. Geçerli indirim HER OKUMADA güncel F4'ten türetilir:
/// <c>indirim = güncel F4 − hedef</c> (tutar, F4 para biriminde). Ürünün F4'ü sonradan değişse
/// bile kampanyalı F4 yazılan fiyat kalır; diğer fiyat grupları yine formülle türer
/// (<see cref="CampaignCatalogDiscount"/>).
/// </para>
///
/// <para>
/// <c>Deger</c> kolonunda kayıt anındaki fark durur: hedefi bilmeyen eski okuyucular (vitrin eski
/// sürümü, raporlar) en azından kayıt anının doğru indirimini görür. Hedef fiyat F4'e eşit ya da
/// üstündeyse indirim 0'dır — kampanya fiyatı ARTIRMAZ.
/// </para>
/// </summary>
public static class CampaignTargetPrice
{
    /// <summary>
    /// Satırın verilen F4 için geçerli tutar indirimi (F4 para biriminde). Hedef fiyatı yoksa
    /// kayıtlı <c>Deger</c> döner (oran ya da tutar, satırın kendi türünde).
    /// </summary>
    public static decimal EffectiveValue(CampaignDiscount d, decimal? catalogPrice)
    {
        if (!d.HedefFiyat.HasValue) return d.Deger;
        return Difference(catalogPrice, d.HedefFiyat.Value);
    }

    /// <summary>F4 − hedef; F4 yoksa ya da hedef F4'ün altında değilse 0.</summary>
    public static decimal Difference(decimal? catalogPrice, decimal targetPrice)
    {
        if (!catalogPrice.HasValue || catalogPrice.Value <= 0m || targetPrice < 0m) return 0m;
        var diff = catalogPrice.Value - targetPrice;
        return diff > 0m ? Math.Round(diff, 4, MidpointRounding.AwayFromZero) : 0m;
    }

    /// <summary>
    /// Stok kodlarının F4 (katalog, fiyat grubu 4) fiyatı ve para birimi. Bulunamayan kod sözlükte yok.
    /// </summary>
    public static async Task<Dictionary<string, (decimal Price, string Currency)>> LoadCatalogPricesAsync(
        AppDbContext db, IEnumerable<string> stockCodes, CancellationToken ct)
    {
        var codes = stockCodes
            .Where(x => !string.IsNullOrWhiteSpace(x))
            .Select(x => x.Trim())
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();

        var result = new Dictionary<string, (decimal Price, string Currency)>(StringComparer.OrdinalIgnoreCase);
        if (codes.Count == 0) return result;

        var rows = await db.ProductPrices
            .AsNoTracking()
            .Where(pp => pp.PriceGroup.Code == 4 && codes.Contains(pp.Product.StockCode))
            .Select(pp => new { pp.Product.StockCode, pp.Price, pp.Currency })
            .ToListAsync(ct);

        foreach (var r in rows)
        {
            if (r.Price <= 0m || result.ContainsKey(r.StockCode)) continue;
            result[r.StockCode] = (r.Price, r.Currency ?? "TL");
        }
        return result;
    }
}
