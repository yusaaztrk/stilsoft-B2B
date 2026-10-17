using Npgsql;
using Shop.Api.Infrastructure;
using Shop.Api.Members;

namespace Shop.Api.Catalog;

/// <summary>
/// "SİZİ ARAYALIM" — telefonla kapanan satışı yakalayan kanal (2026-09-21).
///
/// NEDEN VAR: müşteri kitlesi siparişi telefonda veriyor. Gündüz arayabilen zaten arıyor;
/// kaybedilen, MESAİ DIŞINDA bakan ziyaretçi. Onun için tek tıkla "adım + numaram" bırakma
/// yolu yoksa ziyaret tamamen kayboluyor: ne sepet kalıyor, ne WhatsApp mesajı, ne iz.
///
/// NEDEN SMS'E BAĞLI DEĞİL: sunucuda PostaGüvercini bilgisi hâlâ girilmediği için telefonla
/// giriş, üyesiz sipariş ve sepet hatırlatma kapalı. Bu kayıt yalnız panele düşüyor; yani
/// SMS açılmadan da ÇALIŞIYOR. Bugün elimizdeki tek çalışır durumda lead kanalı bu.
///
/// KÖTÜYE KULLANIM: numara başına günde <see cref="MaxPerPhoneDaily"/> talep. Daha fazlası
/// sessizce "alındı" cevabı alıyor (saldırgana sınırın nerede olduğu söylenmiyor) ama kayıt
/// açılmıyor. Panelde çöp birikmesin diye.
/// </summary>
public sealed class CallbackService
{
    /// <summary>Aynı numaradan 24 saatte kabul edilen en fazla talep.</summary>
    private const int MaxPerPhoneDaily = 5;

    private readonly TenantResolver _tenant;
    private readonly ShopSchema _schema;
    private readonly ISmsService _sms;
    private readonly ILogger<CallbackService> _logger;

    public CallbackService(TenantResolver tenant, ShopSchema schema, ISmsService sms, ILogger<CallbackService> logger)
    {
        _tenant = tenant;
        _schema = schema;
        _sms = sms;
        _logger = logger;
    }

    public sealed record CreateResult(bool Success, string? Error);

    public async Task<CreateResult> CreateAsync(
        string name, string phone, string? stockCode, string? productName,
        string? note, string? source, Guid? memberId, CancellationToken ct)
    {
        name = Kirp(name, 120);
        if (name.Length < 2) return new CreateResult(false, "Adınızı yazın.");

        // Numara, SMS servisinin kuralıyla normalleştiriliyor: aynı kişinin "0533…" ve
        // "+90533…" yazması iki ayrı kayıt/iki ayrı sayaç üretmesin.
        var msisdn = _sms.NormalizeMsisdn(phone ?? string.Empty);
        if (msisdn.Length < 10) return new CreateResult(false, "Telefon numarası geçersiz.");

        var kaynak = (source ?? "genel").Trim().ToLowerInvariant();
        // "404": yayından kalkmış ürün/eski adres — hangi adresin arandığı nota yazılıyor (2026-09-21).
        // "odeme" (2026-09-21): ödeme adımında takılan müşteri. Panelde ayrı etiketlenmesi
        // önemli — bu kişi ürünü seçmiş, tutarı kabul etmiş, son adımda durmuş; listedeki
        // en sıcak müşteri o.
        // "kurumsal" (2026-10-04): /kurumsal-satis teklif formu — otel, proje, ofis gibi toplu alım.
        // Panelde ayrı etiketleniyor; kurumsal satış danışmanına yönlendirilecek talep.
        if (kaynak is not ("urun" or "sepet" or "genel" or "404" or "iletisim" or "odeme" or "kurumsal")) kaynak = "genel";

        try
        {
            await _schema.EnsureAsync(ct);
            await using var conn = new NpgsqlConnection(_tenant.ShopConnectionString());
            await conn.OpenAsync(ct);

            await using (var guard = new NpgsqlCommand("""
                SELECT count(*)::int FROM public.callback_requests
                WHERE phone = @p AND created_at > now() - interval '1 day'
                """, conn))
            {
                guard.Parameters.AddWithValue("p", msisdn);
                if (Convert.ToInt32(await guard.ExecuteScalarAsync(ct)) >= MaxPerPhoneDaily)
                {
                    // Bilerek BAŞARILI dönüyor: sınırı söylemek, sınırı aşmayı kolaylaştırır.
                    return new CreateResult(true, null);
                }
            }

            await using var cmd = new NpgsqlCommand("""
                INSERT INTO public.callback_requests
                    (name, phone, stock_code, product_name, note, source, member_id)
                VALUES (@ad, @tel, @kod, @urun, @not, @kaynak, @uye)
                """, conn);
            cmd.Parameters.AddWithValue("ad", name);
            cmd.Parameters.AddWithValue("tel", msisdn);
            cmd.Parameters.AddWithValue("kod", (object?)NullaIndirgenmis(stockCode, 50) ?? DBNull.Value);
            cmd.Parameters.AddWithValue("urun", (object?)NullaIndirgenmis(productName, 300) ?? DBNull.Value);
            cmd.Parameters.AddWithValue("not", (object?)NullaIndirgenmis(note, 500) ?? DBNull.Value);
            cmd.Parameters.AddWithValue("kaynak", kaynak);
            cmd.Parameters.AddWithValue("uye", (object?)memberId ?? DBNull.Value);
            await cmd.ExecuteNonQueryAsync(ct);

            _logger.LogInformation("[Arayalim] Yeni talep: {Ad} / {Kaynak} / {Kod}", name, kaynak, stockCode ?? "-");
            return new CreateResult(true, null);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "[Arayalim] Talep kaydedilemedi");
            return new CreateResult(false, "Kayıt alınamadı, lütfen tekrar deneyin.");
        }
    }

    public sealed record CallbackRow(
        long Id, string Name, string Phone, string? StockCode, string? ProductName,
        string? Note, string Source, DateTime CreatedAtUtc, DateTime? DoneAtUtc, string? DoneNote);

    /// <summary>Panel listesi. <paramref name="sadeceBekleyen"/> kapalıysa kapatılanlar da gelir.</summary>
    public async Task<IReadOnlyList<CallbackRow>> ListAsync(bool sadeceBekleyen, int limit, CancellationToken ct)
    {
        await _schema.EnsureAsync(ct);
        await using var conn = new NpgsqlConnection(_tenant.ShopConnectionString());
        await conn.OpenAsync(ct);

        var filtre = sadeceBekleyen ? "WHERE done_at IS NULL" : string.Empty;
        await using var cmd = new NpgsqlCommand($"""
            SELECT id, name, phone, stock_code, product_name, note, source, created_at, done_at, done_note
            FROM public.callback_requests
            {filtre}
            ORDER BY done_at IS NOT NULL, created_at DESC
            LIMIT {Math.Clamp(limit, 5, 500)}
            """, conn);

        var list = new List<CallbackRow>();
        await using var reader = await cmd.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct))
        {
            list.Add(new CallbackRow(
                reader.GetInt64(0),
                reader.GetString(1),
                reader.GetString(2),
                reader.IsDBNull(3) ? null : reader.GetString(3),
                reader.IsDBNull(4) ? null : reader.GetString(4),
                reader.IsDBNull(5) ? null : reader.GetString(5),
                reader.GetString(6),
                reader.GetDateTime(7),
                reader.IsDBNull(8) ? null : reader.GetDateTime(8),
                reader.IsDBNull(9) ? null : reader.GetString(9)));
        }
        return list;
    }

    /// <summary>Bekleyen talep sayısı — panelde sekme rozetinde gösteriliyor.</summary>
    public async Task<int> PendingCountAsync(CancellationToken ct)
    {
        await _schema.EnsureAsync(ct);
        await using var conn = new NpgsqlConnection(_tenant.ShopConnectionString());
        await conn.OpenAsync(ct);
        await using var cmd = new NpgsqlCommand(
            "SELECT count(*)::int FROM public.callback_requests WHERE done_at IS NULL", conn);
        return Convert.ToInt32(await cmd.ExecuteScalarAsync(ct));
    }

    /// <summary>"Arandı" işareti. Kayıt SİLİNMİYOR; iz kalsın diye done_at yazılıyor.</summary>
    public async Task<bool> MarkDoneAsync(long id, string? doneNote, CancellationToken ct)
    {
        await _schema.EnsureAsync(ct);
        await using var conn = new NpgsqlConnection(_tenant.ShopConnectionString());
        await conn.OpenAsync(ct);

        await using var cmd = new NpgsqlCommand("""
            UPDATE public.callback_requests
            SET done_at = now(), done_note = @n
            WHERE id = @id AND done_at IS NULL
            """, conn);
        cmd.Parameters.AddWithValue("id", id);
        cmd.Parameters.AddWithValue("n", (object?)NullaIndirgenmis(doneNote, 500) ?? DBNull.Value);
        return await cmd.ExecuteNonQueryAsync(ct) > 0;
    }

    private static string Kirp(string? s, int max)
    {
        s = (s ?? string.Empty).Trim();
        return s.Length <= max ? s : s[..max];
    }

    private static string? NullaIndirgenmis(string? s, int max)
    {
        var k = Kirp(s, max);
        return k.Length == 0 ? null : k;
    }
}
