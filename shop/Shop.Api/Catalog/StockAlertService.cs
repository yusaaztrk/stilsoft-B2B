using Npgsql;
using Shop.Api.Infrastructure;
using Shop.Api.Members;

namespace Shop.Api.Catalog;

/// <summary>
/// STOK BİLDİRİMİ — "gelince haber ver" (2026-09-20).
///
/// SORUN: tükenen ürünün sayfasında tek seçenek "Stok için bize ulaşın" bağlantısıydı;
/// müşteri iletişim sayfasına gidiyor ve orada kayboluyordu. Gelen ziyaret, ilgilenen
/// müşteri ve reklam parası birlikte çöpe gidiyordu.
///
/// ÇÖZÜM: müşteri telefonunu bırakıyor, stok gelince SMS gidiyor.
///
/// İKİNCİ FAYDASI TALEP SİNYALİ: panelde "bu ürünü kaç kişi bekliyor" listesi, neyin sipariş
/// edilmesi gerektiğini tahmine gerek bırakmadan söylüyor — arama raporundaki "sonuç çıkmayan
/// aramalar" listesiyle aynı mantık.
///
/// KİŞİSEL VERİ: yalnız telefon. Bildirim gidince satır SİLİNMİYOR (talep geçmişi kalsın),
/// ama <c>notified_at</c> doluyor ve bir daha o kayıt için SMS gitmiyor.
/// </summary>
public sealed class StockAlertService
{
    /// <summary>Bir numara en fazla bu kadar ürün için bekleme kaydı bırakabilir.</summary>
    private const int MaxPerPhone = 20;

    private readonly TenantResolver _tenant;
    private readonly ShopSchema _schema;
    private readonly ISmsService _sms;
    private readonly ILogger<StockAlertService> _logger;

    public StockAlertService(TenantResolver tenant, ShopSchema schema, ISmsService sms, ILogger<StockAlertService> logger)
    {
        _tenant = tenant;
        _schema = schema;
        _sms = sms;
        _logger = logger;
    }

    public sealed record SubscribeResult(bool Success, string? Error, int WaitingCount);

    /// <summary>
    /// Kayıt. Numara normalleştirilip saklanıyor: aynı kişinin "0533...", "+90533..." yazması
    /// iki ayrı kayıt üretmemeli.
    /// </summary>
    public async Task<SubscribeResult> SubscribeAsync(string stockCode, string phone, Guid? memberId, CancellationToken ct)
    {
        stockCode = (stockCode ?? string.Empty).Trim();
        if (stockCode.Length == 0) return new SubscribeResult(false, "Ürün bulunamadı.", 0);

        var msisdn = _sms.NormalizeMsisdn(phone ?? string.Empty);
        if (msisdn.Length < 10) return new SubscribeResult(false, "Telefon numarası geçersiz.", 0);

        try
        {
            await _schema.EnsureAsync(ct);
            await using var conn = new NpgsqlConnection(_tenant.ShopConnectionString());
            await conn.OpenAsync(ct);

            await using (var guard = new NpgsqlCommand(
                "SELECT count(*)::int FROM public.stock_alerts WHERE phone = @p AND notified_at IS NULL", conn))
            {
                guard.Parameters.AddWithValue("p", msisdn);
                var mevcut = Convert.ToInt32(await guard.ExecuteScalarAsync(ct));
                if (mevcut >= MaxPerPhone)
                {
                    return new SubscribeResult(false, "Çok fazla ürün için bildirim bekliyorsunuz.", mevcut);
                }
            }

            // Aynı numara + aynı ürün ikinci kez yazılmaz; benzersiz indeks zaten engelliyor,
            // ON CONFLICT ile sessizce geçiliyor (kullanıcıya hata göstermek anlamsız).
            await using (var cmd = new NpgsqlCommand("""
                INSERT INTO public.stock_alerts (stock_code, phone, member_id)
                VALUES (@s, @p, @m)
                ON CONFLICT DO NOTHING
                """, conn))
            {
                cmd.Parameters.AddWithValue("s", stockCode);
                cmd.Parameters.AddWithValue("p", msisdn);
                cmd.Parameters.AddWithValue("m", (object?)memberId ?? DBNull.Value);
                await cmd.ExecuteNonQueryAsync(ct);
            }

            return new SubscribeResult(true, null, await WaitingCountAsync(conn, stockCode, ct));
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Stok bildirimi kaydedilemedi: {StockCode}", stockCode);
            return new SubscribeResult(false, "Kayıt alınamadı, lütfen tekrar deneyin.", 0);
        }
    }

    private static async Task<int> WaitingCountAsync(NpgsqlConnection conn, string stockCode, CancellationToken ct)
    {
        await using var cmd = new NpgsqlCommand(
            "SELECT count(*)::int FROM public.stock_alerts WHERE stock_code = @s AND notified_at IS NULL", conn);
        cmd.Parameters.AddWithValue("s", stockCode);
        return Convert.ToInt32(await cmd.ExecuteScalarAsync(ct));
    }

    /// <summary>Bildirim bekleyen stok kodları — arka plan işçisi bunlarla stok soruyor.</summary>
    public async Task<IReadOnlyList<string>> PendingStockCodesAsync(CancellationToken ct)
    {
        await _schema.EnsureAsync(ct);
        await using var conn = new NpgsqlConnection(_tenant.ShopConnectionString());
        await conn.OpenAsync(ct);

        await using var cmd = new NpgsqlCommand(
            "SELECT DISTINCT stock_code FROM public.stock_alerts WHERE notified_at IS NULL", conn);

        var list = new List<string>();
        await using var reader = await cmd.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct)) list.Add(reader.GetString(0));
        return list;
    }

    /// <summary>
    /// Bir ürün için bekleyenlere haber verir. SMS gönderilemeyen kayıt İŞARETLENMEZ:
    /// bir sonraki turda yeniden denenir. Gönderilen işaretlenir ve bir daha gitmez.
    /// </summary>
    public async Task<int> NotifyAsync(string stockCode, string productName, string productUrl, CancellationToken ct)
    {
        if (!_sms.IsConfigured) return 0;

        await _schema.EnsureAsync(ct);
        await using var conn = new NpgsqlConnection(_tenant.ShopConnectionString());
        await conn.OpenAsync(ct);

        var hedefler = new List<(long Id, string Phone)>();
        await using (var cmd = new NpgsqlCommand(
            "SELECT id, phone FROM public.stock_alerts WHERE stock_code = @s AND notified_at IS NULL", conn))
        {
            cmd.Parameters.AddWithValue("s", stockCode);
            await using var reader = await cmd.ExecuteReaderAsync(ct);
            while (await reader.ReadAsync(ct)) hedefler.Add((reader.GetInt64(0), reader.GetString(1)));
        }

        if (hedefler.Count == 0) return 0;

        var metin = $"Beklediginiz urun stoklarimiza geldi: {Ascii(productName)}. {productUrl}";
        var gonderilen = 0;

        foreach (var (id, phone) in hedefler)
        {
            try
            {
                var result = await _sms.SendAsync(phone, metin, ct);
                if (!result.Success)
                {
                    _logger.LogWarning("[StokBildirimi] SMS gönderilemedi ({Code}): {Error}", stockCode, result.ErrorCode);
                    continue;   // işaretlenmiyor: bir sonraki turda yeniden denenecek
                }

                await using var mark = new NpgsqlCommand(
                    "UPDATE public.stock_alerts SET notified_at = now() WHERE id = @id", conn);
                mark.Parameters.AddWithValue("id", id);
                await mark.ExecuteNonQueryAsync(ct);
                gonderilen++;
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "[StokBildirimi] Gönderimde hata ({Code})", stockCode);
            }
        }

        return gonderilen;
    }

    public sealed record DemandRow(string StockCode, int Waiting, DateTime FirstRequestedUtc, DateTime LastRequestedUtc);

    /// <summary>Panel: hangi ürünü kaç kişi bekliyor. Neyin sipariş edileceğini bu söylüyor.</summary>
    public async Task<IReadOnlyList<DemandRow>> DemandAsync(int limit, CancellationToken ct)
    {
        await _schema.EnsureAsync(ct);
        await using var conn = new NpgsqlConnection(_tenant.ShopConnectionString());
        await conn.OpenAsync(ct);

        await using var cmd = new NpgsqlCommand($"""
            SELECT stock_code, count(*)::int, min(created_at), max(created_at)
            FROM public.stock_alerts
            WHERE notified_at IS NULL
            GROUP BY stock_code
            ORDER BY count(*) DESC, max(created_at) DESC
            LIMIT {Math.Clamp(limit, 5, 200)}
            """, conn);

        var list = new List<DemandRow>();
        await using var reader = await cmd.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct))
        {
            list.Add(new DemandRow(reader.GetString(0), reader.GetInt32(1), reader.GetDateTime(2), reader.GetDateTime(3)));
        }
        return list;
    }

    /// <summary>Türkçe karakter SMS'i iki krediye çıkarıyor (bkz. PaymentService/BankTransferService).</summary>
    private static string Ascii(string s)
        => (s ?? string.Empty)
            .Replace('ç', 'c').Replace('Ç', 'C').Replace('ğ', 'g').Replace('Ğ', 'G').Replace('ı', 'i').Replace('İ', 'I')
            .Replace('ö', 'o').Replace('Ö', 'O').Replace('ş', 's').Replace('Ş', 'S').Replace('ü', 'u').Replace('Ü', 'U');
}
