using Npgsql;
using System.Text.Json;

namespace Shop.Api.Catalog;

/*
  VİTRİN KAMPANYA FİYATI (2026-09-19, kullanıcı: "B2B'de oluşturulan kampanyalar e-ticarete de
  yansısın").

  Kampanyalar ERP'nindir; vitrin kataloğu gibi doğrudan ERP veritabanından okunur. Vitrine
  yalnız ANAHTARI AÇIK (`Campaigns.EcommerceEnabled`) ürün / kategori indirimleri gelir; B2B'deki
  fiyat grubu ve bayi süzgeçlerine bakılmaz — vitrin için tek şart anahtar + tarih aralığı.

  HESAP: indirim F4'e (katalog fiyatı) uygulanır. Vitrin fiyatı zaten F4 (grup 1 net × KDV = F4),
  dolayısıyla vitrinde yeni brüt = brüt − (F4 − F4'), net = brütün KDV hariç hâli. ERP'deki
  sipariş ucu (`SalesOrdersController.CreateEcommerceOrder` → `EcommerceCampaignPricing`) aynı
  farkı aynı kuralla düşer; ikisi ayrışırsa müşteri ekranda bir tutar görüp kartından başka
  tutar çekilir. Birden çok kampanya tutarsa MÜŞTERİ LEHİNE olan (en düşük fiyat).

  Kampanya listesi 60 sn önbellekte; açık kampanya yoksa katalog yoluna HİÇ dokunulmaz.
*/
public sealed class CampaignPricing
{
    private static readonly TimeSpan CacheTtl = TimeSpan.FromSeconds(60);

    private sealed record LiveDiscount(
        Guid CampaignId,
        string CampaignName,
        int Type,                 // 4 = ürün, 5 = kategori/marka
        string? StockCode,
        string? GroupCode,
        bool IsPercent,
        decimal Value,
        IReadOnlyList<string> ConditionStockCodes,
        IReadOnlyList<string> ConditionCategoryCodes,
        string? BrandField,
        string? BrandCode,
        decimal? TargetPrice);   // ürüne özel kampanyalı F4 (F4 para biriminde), 2026-10-07

    private sealed record ProductMeta(decimal? F4, string? F4Currency, string? MainKey, string? SubKey, string? Kod4, string? Kod5);

    private readonly Dictionary<string, (DateTime At, IReadOnlyList<LiveDiscount> Rows)> _cache = new();
    private readonly object _lock = new();

    public async Task ApplyAsync(NpgsqlConnection conn, string cacheKey, IList<CatalogItem> items, IReadOnlyDictionary<string, decimal> rates, CancellationToken ct)
    {
        if (items.Count == 0) return;

        var live = await LoadLiveAsync(conn, cacheKey, ct);
        if (live.Count == 0) return;

        var codes = items.Select(x => x.StockCode).Where(x => !string.IsNullOrWhiteSpace(x)).Distinct(StringComparer.OrdinalIgnoreCase).ToArray();
        var meta = await LoadProductMetaAsync(conn, codes, ct);

        foreach (var item in items)
        {
            if (!meta.TryGetValue(item.StockCode, out var m) || !m.F4.HasValue || m.F4.Value <= 0m) continue;

            // F4 dövizliyse katalogla AYNI kurdan TL'ye; kur yoksa bu ürün atlanır (yanlış tutar basılmaz).
            var f4Cur = (m.F4Currency ?? "TRY").Trim().ToUpperInvariant();
            var f4Rate = 1m;
            if (f4Cur.Length > 0 && f4Cur != "TRY" && f4Cur != "TL")
            {
                if (!rates.TryGetValue(f4Cur, out var fxRate) || fxRate <= 0m) continue;
                f4Rate = fxRate;
                m = m with { F4 = Math.Round(m.F4.Value * fxRate, 2, MidpointRounding.AwayFromZero) };
            }

            decimal bestGross = item.GrossPrice;
            LiveDiscount? bestRow = null;

            foreach (var row in live)
            {
                if (!Covers(row, item.StockCode, m)) continue;

                var f4 = m.F4.Value;
                // Ürüne özel kampanyalı fiyat (2026-10-07): F4 doğrudan hedefe iner (aynı kurla TL).
                var f4After = row.TargetPrice.HasValue
                    ? Math.Round(row.TargetPrice.Value * f4Rate, 2, MidpointRounding.AwayFromZero)
                    : row.IsPercent ? f4 * (1m - row.Value / 100m) : f4 - row.Value;
                if (f4After < 0m) f4After = 0m;

                var delta = Math.Round(f4 - f4After, 2, MidpointRounding.AwayFromZero);
                if (delta <= 0m) continue;

                var gross = Math.Max(0m, Math.Round(item.GrossPrice - delta, 2, MidpointRounding.AwayFromZero));
                if (gross < bestGross)
                {
                    bestGross = gross;
                    bestRow = row;
                }
            }

            if (bestRow is null || bestGross >= item.GrossPrice) continue;

            item.OriginalGrossPrice = item.GrossPrice;
            item.CampaignName = bestRow.CampaignName;
            item.CampaignPercent = bestRow.IsPercent ? bestRow.Value : null;
            item.CampaignDiscountGross = Math.Round(item.GrossPrice - bestGross, 2, MidpointRounding.AwayFromZero);
            item.GrossPrice = bestGross;
            item.NetPrice = Math.Round(bestGross / (1m + item.TaxRate / 100m), 2, MidpointRounding.AwayFromZero);
        }
    }

    /// <summary>Kural B2B rozetiyle aynı: ürünlü satır yalnız o ürünü kapsar; grup yalnız ürünsüz satırda.</summary>
    private static bool Covers(LiveDiscount row, string stockCode, ProductMeta m)
    {
        var sc = Norm(stockCode);
        var rowStock = Norm(row.StockCode);
        if (rowStock.Length > 0) return rowStock == sc;

        var main = Norm(m.MainKey);
        var sub = Norm(m.SubKey);
        var rowGroup = Norm(row.GroupCode);
        if (rowGroup.Length > 0 && (rowGroup == main || rowGroup == sub)) return BrandOk(row, m, sub);

        if (row.Type == 4)
        {
            return row.ConditionStockCodes.Any(x => Norm(x) == sc);
        }

        // Tip 5: şarttaki kategori
        foreach (var cat in row.ConditionCategoryCodes)
        {
            var c = Norm(cat);
            if (c.Length == 0) continue;
            if (c == main || c == sub) return BrandOk(row, m, sub);
        }
        return false;
    }

    private static bool BrandOk(LiveDiscount row, ProductMeta m, string sub)
    {
        var code = Norm(row.BrandCode);
        var field = Norm(row.BrandField);
        if (code.Length == 0 || field.Length == 0) return true;
        return field switch
        {
            "KOD4" => Norm(m.Kod4) == code,
            "KOD5" => Norm(m.Kod5) == code,
            "SUBCATEGORY" => sub == code,
            _ => false
        };
    }

    private static string Norm(string? v) => (v ?? string.Empty).Trim().ToUpperInvariant();

    private async Task<IReadOnlyList<LiveDiscount>> LoadLiveAsync(NpgsqlConnection conn, string cacheKey, CancellationToken ct)
    {
        lock (_lock)
        {
            if (_cache.TryGetValue(cacheKey, out var hit) && DateTime.UtcNow - hit.At < CacheTtl)
            {
                return hit.Rows;
            }
        }

        var rows = new List<LiveDiscount>();

        // Kolon yoksa (ERP henüz güncellenmemiş) sessizce boş liste: vitrin eskisi gibi çalışır.
        const string sql = """
            SELECT c."Id", c."Name", c."KampanyaTipi", d."StokKodu", d."GrupKodu", d."IskontoTipi", d."Deger",
                   COALESCE((SELECT string_agg(COALESCE(cc."ProductStockCodesJson", ''), E'\n')
                             FROM public."CampaignConditions" cc WHERE cc."CampaignId" = c."Id" AND cc."IsDeleted" = false), '') AS stock_json,
                   COALESCE((SELECT string_agg(COALESCE(cc."CategoryCode", ''), E'\n')
                             FROM public."CampaignConditions" cc WHERE cc."CampaignId" = c."Id" AND cc."IsDeleted" = false), '') AS cats,
                   (SELECT cc."BrandField" FROM public."CampaignConditions" cc WHERE cc."CampaignId" = c."Id" AND cc."IsDeleted" = false AND COALESCE(cc."BrandCode", '') <> '' LIMIT 1) AS brand_field,
                   (SELECT cc."BrandCode"  FROM public."CampaignConditions" cc WHERE cc."CampaignId" = c."Id" AND cc."IsDeleted" = false AND COALESCE(cc."BrandCode", '') <> '' LIMIT 1) AS brand_code,
                   -- to_jsonb: ERP kolonu henüz eklememişse NULL döner, sorgu düşmez (2026-10-07)
                   (to_jsonb(d) ->> 'HedefFiyat')::numeric AS hedef_fiyat
            FROM public."Campaigns" c
            JOIN public."CampaignDiscounts" d ON d."CampaignId" = c."Id" AND d."IsDeleted" = false
            WHERE c."EcommerceEnabled" = true
              AND c."IsActive" = true
              AND c."IsDeleted" = false
              AND c."KampanyaTipi" IN (4, 5)
              AND (c."StartDate" IS NULL OR c."StartDate" <= now())
              AND (c."IsIndefinite" = true OR c."EndDate" IS NULL OR now() < (c."EndDate"::date + 1))
              AND d."Deger" > 0
            """;

        try
        {
            await using var cmd = new NpgsqlCommand(sql, conn);
            await using var reader = await cmd.ExecuteReaderAsync(ct);
            while (await reader.ReadAsync(ct))
            {
                var stockJson = reader.IsDBNull(7) ? string.Empty : reader.GetString(7);
                var cats = reader.IsDBNull(8) ? string.Empty : reader.GetString(8);

                rows.Add(new LiveDiscount(
                    reader.GetGuid(0),
                    reader.GetString(1),
                    reader.GetInt32(2),
                    reader.IsDBNull(3) ? null : reader.GetString(3),
                    reader.IsDBNull(4) ? null : reader.GetString(4),
                    // IskontoTipi: Tutar = 1, Oran = 2
                    reader.GetInt32(5) == 2,
                    reader.GetDecimal(6),
                    ParseStockCodes(stockJson),
                    cats.Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries),
                    reader.IsDBNull(9) ? null : reader.GetString(9),
                    reader.IsDBNull(10) ? null : reader.GetString(10),
                    reader.IsDBNull(11) ? null : reader.GetDecimal(11)));
            }
        }
        catch (PostgresException)
        {
            rows.Clear();
        }

        lock (_lock)
        {
            _cache[cacheKey] = (DateTime.UtcNow, rows);
        }
        return rows;
    }

    private static IReadOnlyList<string> ParseStockCodes(string joined)
    {
        var list = new List<string>();
        foreach (var chunk in joined.Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
        {
            try
            {
                using var doc = JsonDocument.Parse(chunk);
                var root = doc.RootElement;
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
                // bozuk şart satırı kampanyayı düşürmez, yalnız o listeyi atlar
            }
        }
        return list;
    }

    private static async Task<Dictionary<string, ProductMeta>> LoadProductMetaAsync(NpgsqlConnection conn, string[] codes, CancellationToken ct)
    {
        var result = new Dictionary<string, ProductMeta>(StringComparer.OrdinalIgnoreCase);
        if (codes.Length == 0) return result;

        const string sql = """
            SELECT p."StockCode", pp4."Price", pp4."Currency", mc."Key", c."Key", p."Kod4", p."Kod5"
            FROM public."Products" p
            LEFT JOIN public."PriceGroups" g4 ON g4."Code" = 4
            LEFT JOIN public."ProductPrices" pp4 ON pp4."ProductId" = p."Id" AND pp4."PriceGroupId" = g4."Id"
            LEFT JOIN public."ProductCategories" mc ON mc."Id" = p."MainCategoryId"
            LEFT JOIN public."ProductCategories" c ON c."Id" = p."CategoryId"
            WHERE p."StockCode" = ANY(@codes)
            """;

        await using var cmd = new NpgsqlCommand(sql, conn);
        cmd.Parameters.AddWithValue("codes", codes);
        await using var reader = await cmd.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct))
        {
            var sc = reader.GetString(0);
            if (result.ContainsKey(sc)) continue;
            result[sc] = new ProductMeta(
                reader.IsDBNull(1) ? null : reader.GetDecimal(1),
                reader.IsDBNull(2) ? null : reader.GetString(2),
                reader.IsDBNull(3) ? null : reader.GetString(3),
                reader.IsDBNull(4) ? null : reader.GetString(4),
                reader.IsDBNull(5) ? null : reader.GetString(5),
                reader.IsDBNull(6) ? null : reader.GetString(6));
        }
        return result;
    }
}
