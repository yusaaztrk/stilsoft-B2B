using Npgsql;
using Shop.Api.Infrastructure;

namespace Shop.Api.Catalog;

/// <summary>
/// Vitrin içi arama kaydı (2026-09-20).
///
/// NEDEN: Ziyaretçinin ne aradığı hiçbir yere yazılmıyordu. Oysa vitrinde ürün görünmesi
/// üç şarta bağlı (aktif + görsel + katalog fiyatı), ve görseli olmadığı için listeye hiç
/// girmeyen yüzlerce ürün var. "Klima arandı, sonuç çıkmadı" satırı, hangi ürünün
/// fotoğrafının çekilmesi ya da stoklanması gerektiğini doğrudan söylüyor.
///
/// NE KAYDEDİLMİYOR: üye kimliği, IP, oturum. Yalnız terim + sonuç sayısı + zaman.
///
/// YAZMA HATASI İSTEĞİ BOZMAZ: kayıt tutmak vitrinin işi değil; tablo yoksa, veritabanı
/// meşgulse ya da başka bir şey ters giderse arama sonucu yine de döner (bkz. TryRecordAsync).
/// </summary>
public sealed class SearchLogService
{
    /// <summary>Bundan kısa terim kaydedilmez: tek harf aramaları veri değil gürültü.</summary>
    public const int MinTermLength = 2;

    /// <summary>Kayıt bu kadar gün tutulur; daha eskisi seyrek çalışan budamada silinir.</summary>
    private const int RetentionDays = 180;

    private readonly TenantResolver _tenant;
    private readonly ILogger<SearchLogService> _log;

    /// <summary>Her yazmada DELETE çalıştırmamak için: yalnızca ara sıra buda.</summary>
    private static int _writeCounter;
    private const int PruneEvery = 500;

    public SearchLogService(TenantResolver tenant, ILogger<SearchLogService> log)
    {
        _tenant = tenant;
        _log = log;
    }

    /// <summary>
    /// Aramayı kaydeder. Hiçbir koşulda dışarı hata atmaz — çağıran vitrin listesi uçudur.
    /// </summary>
    public async Task TryRecordAsync(string? rawTerm, int resultCount, CancellationToken ct = default)
    {
        var raw = (rawTerm ?? string.Empty).Trim();
        if (raw.Length < MinTermLength) return;
        if (raw.Length > 200) raw = raw[..200];

        var norm = Normalize(raw);
        if (norm.Length < MinTermLength) return;

        try
        {
            await using var conn = new NpgsqlConnection(_tenant.ShopConnectionString());
            await conn.OpenAsync(ct);

            await using (var cmd = new NpgsqlCommand(
                "INSERT INTO public.search_log (term, raw_term, result_count) VALUES (@t, @r, @c)", conn))
            {
                cmd.Parameters.AddWithValue("t", norm);
                cmd.Parameters.AddWithValue("r", raw);
                cmd.Parameters.AddWithValue("c", resultCount);
                await cmd.ExecuteNonQueryAsync(ct);
            }

            if (Interlocked.Increment(ref _writeCounter) % PruneEvery == 0)
            {
                await using var prune = new NpgsqlCommand(
                    $"DELETE FROM public.search_log WHERE searched_at < now() - interval '{RetentionDays} days'", conn);
                await prune.ExecuteNonQueryAsync(ct);
            }
        }
        catch (Exception ex)
        {
            _log.LogDebug(ex, "Arama kaydı yazılamadı ({Term})", norm);
        }
    }

    /// <summary>
    /// Panel raporu: en çok aranan, sonuç çıkmayan ve son aramalar tek çağrıda.
    /// </summary>
    public async Task<SearchInsights> GetInsightsAsync(int days, int limit, CancellationToken ct = default)
    {
        days = Math.Clamp(days, 1, RetentionDays);
        limit = Math.Clamp(limit, 5, 200);

        var result = new SearchInsights { Days = days };

        await using var conn = new NpgsqlConnection(_tenant.ShopConnectionString());
        await conn.OpenAsync(ct);

        await using (var cmd = new NpgsqlCommand($"""
            SELECT count(*)::int,
                   count(*) FILTER (WHERE result_count = 0)::int,
                   count(DISTINCT term)::int
            FROM public.search_log
            WHERE searched_at >= now() - make_interval(days => {days})
            """, conn))
        await using (var r = await cmd.ExecuteReaderAsync(ct))
        {
            if (await r.ReadAsync(ct))
            {
                result.TotalSearches = r.GetInt32(0);
                result.ZeroResultSearches = r.GetInt32(1);
                result.DistinctTerms = r.GetInt32(2);
            }
        }

        result.TopTerms = await RowsAsync(conn, $"""
            SELECT term, count(*)::int AS adet, max(raw_term) AS ornek,
                   round(avg(result_count))::int AS ortalama_sonuc,
                   max(searched_at) AS son
            FROM public.search_log
            WHERE searched_at >= now() - make_interval(days => {days})
            GROUP BY term
            ORDER BY adet DESC, son DESC
            LIMIT {limit}
            """, ct);

        result.ZeroResultTerms = await RowsAsync(conn, $"""
            SELECT term, count(*)::int AS adet, max(raw_term) AS ornek,
                   0 AS ortalama_sonuc,
                   max(searched_at) AS son
            FROM public.search_log
            WHERE searched_at >= now() - make_interval(days => {days})
              AND result_count = 0
            GROUP BY term
            ORDER BY adet DESC, son DESC
            LIMIT {limit}
            """, ct);

        return result;
    }

    private static async Task<List<SearchTermRow>> RowsAsync(NpgsqlConnection conn, string sql, CancellationToken ct)
    {
        var list = new List<SearchTermRow>();
        await using var cmd = new NpgsqlCommand(sql, conn);
        await using var r = await cmd.ExecuteReaderAsync(ct);
        while (await r.ReadAsync(ct))
        {
            list.Add(new SearchTermRow
            {
                Term = r.GetString(0),
                Count = r.GetInt32(1),
                Sample = r.IsDBNull(2) ? r.GetString(0) : r.GetString(2),
                AverageResults = r.IsDBNull(3) ? 0 : r.GetInt32(3),
                LastSearchedUtc = r.GetDateTime(4)
            });
        }
        return list;
    }

    /// <summary>
    /// Sadeleştirme: "KLİMA  24 BTU" ile "klima 24 btu" aynı satırda toplansın diye.
    /// Türkçe harfler ASCII karşılığına iniyor — ziyaretçi çoğu zaman "sutyen/şutyen",
    /// "firin/fırın" farkını gözetmeden yazıyor, ikisini ayrı terim saymak raporu böler.
    /// </summary>
    public static string Normalize(string s)
    {
        var lowered = s.Replace('I', 'ı').Replace('İ', 'i').ToLowerInvariant();
        var sb = new System.Text.StringBuilder(lowered.Length);
        var lastWasSpace = false;

        foreach (var ch in lowered)
        {
            var c = ch switch
            {
                'ç' => 'c', 'ğ' => 'g', 'ı' => 'i', 'ö' => 'o', 'ş' => 's', 'ü' => 'u',
                _ => ch
            };

            if (char.IsLetterOrDigit(c))
            {
                sb.Append(c);
                lastWasSpace = false;
            }
            else if (!lastWasSpace && sb.Length > 0)
            {
                sb.Append(' ');
                lastWasSpace = true;
            }
        }

        return sb.ToString().Trim();
    }
}

public sealed class SearchInsights
{
    public int Days { get; set; }
    public int TotalSearches { get; set; }
    public int ZeroResultSearches { get; set; }
    public int DistinctTerms { get; set; }
    public List<SearchTermRow> TopTerms { get; set; } = new();
    public List<SearchTermRow> ZeroResultTerms { get; set; } = new();
}

public sealed class SearchTermRow
{
    public string Term { get; set; } = string.Empty;
    public string Sample { get; set; } = string.Empty;
    public int Count { get; set; }
    public int AverageResults { get; set; }
    public DateTime LastSearchedUtc { get; set; }
}
