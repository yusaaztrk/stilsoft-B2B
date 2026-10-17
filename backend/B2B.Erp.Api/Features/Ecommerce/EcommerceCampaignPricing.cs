using B2B.Erp.Api.Core.Enums;
using B2B.Erp.Api.Data;
using Microsoft.EntityFrameworkCore;
using System.Text.Json;

namespace B2B.Erp.Api.Features.Ecommerce;

/// <summary>
/// E-ticaret siparişinde kampanya indirimi — vitrinle (shop/Shop.Api/Catalog/CampaignPricing.cs)
/// AYNI kural, aynı sayı.
///
/// <para>
/// Vitrin fiyatı istemciden alınmaz, sipariş ERP'de fiyatlanır. Vitrin kampanyayı gösterip
/// ERP tam fiyattan sipariş açarsa müşteri ekranda bir tutar görür, kartından başkası çekilir.
/// Bu yüzden sipariş satırı da aynı indirimi düşer.
/// </para>
///
/// <para>
/// Kural: yalnız e-ticaret anahtarı açık (<c>Campaigns.EcommerceEnabled</c>), aktif, tarih
/// aralığındaki ÜRÜN / KATEGORİ-MARKA indirimleri; B2B'deki fiyat grubu ve bayi süzgeçlerine
/// bakılmaz. İndirim F4'e uygulanır: KDV dahil fark = F4 − F4'; vitrin fiyatı F4 olduğu için net
/// fark = (F4 − F4') / (1 + KDV). Birden çok kampanya tutarsa müşteri lehine olan.
/// </para>
/// </summary>
public static class EcommerceCampaignPricing
{
    public sealed record LiveDiscount(
        string CampaignName,
        KampanyaTipi Type,
        string? StockCode,
        string? GroupCode,
        IskontoTipi DiscountType,
        decimal Value,
        IReadOnlyList<string> ConditionStockCodes,
        IReadOnlyList<string> ConditionCategoryCodes,
        string? BrandField,
        string? BrandCode,
        decimal? TargetPrice = null);

    public sealed record ProductFacts(string StockCode, decimal? CatalogPrice, string? MainKey, string? SubKey, string? Kod4, string? Kod5);

    public static async Task<IReadOnlyList<LiveDiscount>> LoadLiveAsync(AppDbContext db, CancellationToken ct)
    {
        var now = DateTime.UtcNow;
        var campaigns = await db.Campaigns
            .AsNoTracking()
            .Include(c => c.CampaignDiscounts)
            .Include(c => c.CampaignConditions)
            .Where(c => c.EcommerceEnabled && c.IsActive && !c.IsDeleted)
            .Where(c => c.KampanyaTipi == KampanyaTipi.UrunIndirimi || c.KampanyaTipi == KampanyaTipi.KategoriMarkaIndirimi)
            .Where(c => !c.StartDate.HasValue || c.StartDate.Value <= now)
            .ToListAsync(ct);

        var rows = new List<LiveDiscount>();
        foreach (var c in campaigns)
        {
            // Bitiş günü DAHİL — /api/campaigns/active ile aynı okuma.
            if (!c.IsIndefinite && c.EndDate.HasValue && now >= c.EndDate.Value.Date.AddDays(1)) continue;

            var conditions = c.CampaignConditions.Where(x => !x.IsDeleted).ToList();
            var condStocks = conditions.SelectMany(x => ParseStockCodes(x.ProductStockCodesJson)).ToList();
            var condCats = conditions.Select(x => (x.CategoryCode ?? string.Empty).Trim()).Where(x => x.Length > 0).ToList();
            var brand = conditions.FirstOrDefault(x => !string.IsNullOrWhiteSpace(x.BrandCode));

            foreach (var d in c.CampaignDiscounts.Where(x => !x.IsDeleted && x.Deger > 0m))
            {
                rows.Add(new LiveDiscount(c.Name, c.KampanyaTipi, d.StokKodu, d.GrupKodu, d.IskontoTipi, d.Deger,
                    condStocks, condCats, brand?.BrandField, brand?.BrandCode, d.HedefFiyat));
            }
        }
        return rows;
    }

    /// <summary>
    /// KDV DAHİL birim indirim (F4 para biriminde). Kampanya tutmuyorsa 0.
    /// </summary>
    public static decimal GrossUnitDiscount(ProductFacts p, IReadOnlyList<LiveDiscount> live, out string? campaignName)
    {
        campaignName = null;
        if (live.Count == 0 || !p.CatalogPrice.HasValue || p.CatalogPrice.Value <= 0m) return 0m;

        var f4 = p.CatalogPrice.Value;
        decimal best = 0m;
        foreach (var row in live)
        {
            if (!Covers(row, p)) continue;
            // Ürüne özel kampanyalı fiyat (2026-10-07): F4 doğrudan hedefe iner (F4 para biriminde).
            var f4After = row.TargetPrice.HasValue
                ? row.TargetPrice.Value
                : row.DiscountType == IskontoTipi.Oran ? f4 * (1m - row.Value / 100m) : f4 - row.Value;
            if (f4After < 0m) f4After = 0m;
            var delta = Math.Round(f4 - f4After, 2, MidpointRounding.AwayFromZero);
            if (delta > best)
            {
                best = delta;
                campaignName = row.CampaignName;
            }
        }
        return best;
    }

    private static bool Covers(LiveDiscount row, ProductFacts p)
    {
        var sc = Norm(p.StockCode);
        var rowStock = Norm(row.StockCode);
        if (rowStock.Length > 0) return rowStock == sc;

        var main = Norm(p.MainKey);
        var sub = Norm(p.SubKey);
        var rowGroup = Norm(row.GroupCode);
        if (rowGroup.Length > 0 && (rowGroup == main || rowGroup == sub)) return BrandOk(row, p, sub);

        if (row.Type == KampanyaTipi.UrunIndirimi)
        {
            return row.ConditionStockCodes.Any(x => Norm(x) == sc);
        }

        foreach (var cat in row.ConditionCategoryCodes)
        {
            var c = Norm(cat);
            if (c.Length > 0 && (c == main || c == sub)) return BrandOk(row, p, sub);
        }
        return false;
    }

    private static bool BrandOk(LiveDiscount row, ProductFacts p, string sub)
    {
        var code = Norm(row.BrandCode);
        var field = Norm(row.BrandField);
        if (code.Length == 0 || field.Length == 0) return true;
        return field switch
        {
            "KOD4" => Norm(p.Kod4) == code,
            "KOD5" => Norm(p.Kod5) == code,
            "SUBCATEGORY" => sub == code,
            _ => false
        };
    }

    private static string Norm(string? v) => (v ?? string.Empty).Trim().ToUpperInvariant();

    private static IEnumerable<string> ParseStockCodes(string? json)
    {
        var raw = (json ?? string.Empty).Trim();
        if (raw.Length == 0) yield break;

        List<string> list;
        try
        {
            using var doc = JsonDocument.Parse(raw);
            var root = doc.RootElement;
            list = new List<string>();
            if (root.ValueKind == JsonValueKind.Array)
            {
                list.AddRange(root.EnumerateArray().Where(x => x.ValueKind == JsonValueKind.String).Select(x => x.GetString() ?? string.Empty));
            }
            else if (root.ValueKind == JsonValueKind.Object)
            {
                foreach (var name in new[] { "ProductStockCodes", "productStockCodes" })
                {
                    if (root.TryGetProperty(name, out var arr) && arr.ValueKind == JsonValueKind.Array)
                    {
                        list.AddRange(arr.EnumerateArray().Where(x => x.ValueKind == JsonValueKind.String).Select(x => x.GetString() ?? string.Empty));
                    }
                }
            }
        }
        catch (JsonException)
        {
            yield break;
        }

        foreach (var x in list) yield return x;
    }
}
