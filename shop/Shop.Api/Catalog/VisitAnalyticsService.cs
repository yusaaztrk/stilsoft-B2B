using Npgsql;
using Shop.Api.Infrastructure;
using Shop.Api.Members;

namespace Shop.Api.Catalog;

/// <summary>
/// ZİYARET HUNİSİ (2026-09-21).
///
/// SORULAN SORU: "toplam kaç kişi girdi, kaç tanesi üye olmadan gezdi, nerede takıldı?"
/// Bugüne kadar buna cevap verecek hiçbir veri yoktu: GA4 kimliği panelde boş, girilse bile
/// oradaki oturum bizim sipariş numaramızla eşleşmiyor ve "nerede takıldı" sorusu cevapsız
/// kalıyor.
///
/// ÖLÇÜLEN: oturum başına ULAŞILAN EN İLERİ ADIM.
///   giris → urun → sepet → odeme → siparis
/// Her adım oturum başına bir kez yazılıyor (benzersiz indeks); aynı kişinin on ürün gezmesi
/// huniyi şişirmiyor.
///
/// KİŞİSEL VERİ YOK: IP, tarayıcı parmak izi, e-posta tutulmuyor. `session_id` tarayıcıda
/// üretilen rastgele bir değer. Üye girişi varsa `member_id` doluyor — "misafir" ile "üye"
/// ayrımı buradan çıkıyor.
///
/// NEDEN GA4 YERİNE BU: GA4 reklam ölçümü için iyi ama panelden bakan kişiye "sepete gelen
/// 40 kişiden 33'ü ödemeye geçmedi" cümlesini kuramıyor. Burada huni, siparişin kendi
/// verisiyle aynı veritabanında.
/// </summary>
public sealed class VisitAnalyticsService
{
    /// <summary>Huninin sırası. Sıra ÖNEMLİ: "en ileri adım" bu diziye göre hesaplanıyor.</summary>
    public static readonly string[] Steps = { "giris", "urun", "sepet", "odeme", "siparis" };

    private static readonly Dictionary<string, string> StepLabels = new()
    {
        ["giris"] = "Siteye girdi",
        ["urun"] = "Ürün inceledi",
        ["sepet"] = "Sepete ekledi",
        ["odeme"] = "Ödemeye geçti",
        ["siparis"] = "Sipariş verdi",
    };

    private readonly TenantResolver _tenant;
    private readonly ShopSchema _schema;
    private readonly ILogger<VisitAnalyticsService> _logger;

    public VisitAnalyticsService(TenantResolver tenant, ShopSchema schema, ILogger<VisitAnalyticsService> logger)
    {
        _tenant = tenant;
        _schema = schema;
        _logger = logger;
    }

    /// <summary>
    /// Adım kaydı. Hata YUTULUYOR: ölçüm yüzünden vitrinin bir isteği bile başarısız olmamalı.
    /// </summary>
    public async Task TryRecordAsync(string sessionId, string step, Guid? memberId, string? path, CancellationToken ct)
    {
        sessionId = (sessionId ?? string.Empty).Trim();
        step = (step ?? string.Empty).Trim().ToLowerInvariant();

        // Oturum kimliği istemciden geliyor; uzunluğu sınırlanıyor ki tabloya çöp yazılamasın.
        if (sessionId.Length is < 8 or > 40) return;
        if (!Steps.Contains(step)) return;

        try
        {
            await _schema.EnsureAsync(ct);
            await using var conn = new NpgsqlConnection(_tenant.ShopConnectionString());
            await conn.OpenAsync(ct);

            await using var cmd = new NpgsqlCommand("""
                INSERT INTO public.visit_events (session_id, step, member_id, path)
                VALUES (@s, @st, @m, @p)
                ON CONFLICT (session_id, step) DO NOTHING
                """, conn);
            cmd.Parameters.AddWithValue("s", sessionId);
            cmd.Parameters.AddWithValue("st", step);
            cmd.Parameters.AddWithValue("m", (object?)memberId ?? DBNull.Value);
            cmd.Parameters.AddWithValue("p", (object?)Kirp(path, 300) ?? DBNull.Value);
            await cmd.ExecuteNonQueryAsync(ct);
        }
        catch (Exception ex)
        {
            _logger.LogDebug(ex, "[Huni] Adım kaydedilemedi: {Step}", step);
        }
    }

    public sealed record FunnelStep(string Step, string Label, int Sessions, int DroppedHere);

    public sealed record FunnelReport(
        int Days,
        int TotalSessions,
        int GuestSessions,
        int MemberSessions,
        IReadOnlyList<FunnelStep> Steps,
        IReadOnlyList<PathRow> TopExitPaths);

    /// <summary>Oturumun terk ettiği son adres — "nerede takıldı" sorusunun somut hâli.</summary>
    public sealed record PathRow(string Path, string Step, int Sessions);

    public async Task<FunnelReport> GetFunnelAsync(int days, CancellationToken ct)
    {
        days = Math.Clamp(days, 1, 180);

        await _schema.EnsureAsync(ct);
        await using var conn = new NpgsqlConnection(_tenant.ShopConnectionString());
        await conn.OpenAsync(ct);

        /*
         * TEK SORGU, TEK GEÇİŞ.
         *
         * `oturumlar`: her oturumun ulaştığı en ileri adımın SIRA NUMARASI ve üye olup olmadığı.
         * Adımın adı yerine sırası tutuluyor; "sepete geldi ama ödemeye geçmedi" karşılaştırması
         * ancak sıralı bir değerle yapılabilir.
         *
         * Bir oturum "üye" sayılıyorsa herhangi bir adımında member_id dolmuş demektir —
         * müşteri ödeme adımında giriş yaptığında oturumun tamamı üye sayılmalı.
         */
        var oturumlar = new List<(int MaxStep, bool IsMember)>();
        await using (var cmd = new NpgsqlCommand($"""
            SELECT max(idx) AS max_step, bool_or(member_id IS NOT NULL) AS uye
            FROM (
              SELECT session_id, member_id,
                     array_position(@steps, step) AS idx
              FROM public.visit_events
              WHERE created_at > now() - make_interval(days => {days})
            ) t
            WHERE idx IS NOT NULL
            GROUP BY session_id
            """, conn))
        {
            cmd.Parameters.AddWithValue("steps", Steps);
            await using var reader = await cmd.ExecuteReaderAsync(ct);
            while (await reader.ReadAsync(ct))
            {
                oturumlar.Add((reader.GetInt32(0), !reader.IsDBNull(1) && reader.GetBoolean(1)));
            }
        }

        var toplam = oturumlar.Count;
        var uye = oturumlar.Count(x => x.IsMember);

        /*
         * HUNİ: n. adıma "ulaşan" oturum = en ileri adımı n ya da daha ileri olan oturum.
         * "Burada takılan" = en ileri adımı TAM OLARAK n olan oturum; yani bir sonrakine
         * hiç geçmemiş olanlar. Panelde asıl bakılacak sayı bu.
         */
        var adimlar = new List<FunnelStep>();
        for (var i = 0; i < Steps.Length; i++)
        {
            var sira = i + 1;                                  // array_position 1 tabanlı
            var ulasan = oturumlar.Count(x => x.MaxStep >= sira);
            var takilan = oturumlar.Count(x => x.MaxStep == sira);
            adimlar.Add(new FunnelStep(Steps[i], StepLabels[Steps[i]], ulasan, takilan));
        }

        // Son adımda "takılan" kavramı yok: sipariş verdiyse zaten dönüşmüştür.
        if (adimlar.Count > 0)
        {
            var sonuncu = adimlar[^1];
            adimlar[^1] = sonuncu with { DroppedHere = 0 };
        }

        /*
         * EN ÇOK TERK EDİLEN ADRESLER: oturumun en ileri adımındaki sayfa. Huni "sepette
         * takılıyorlar" der; bu liste "hangi sayfada" der. İkisi birlikte harekete geçirir.
         */
        var yollar = new List<PathRow>();
        await using (var cmd = new NpgsqlCommand($"""
            WITH son AS (
              SELECT DISTINCT ON (session_id)
                     session_id, step, path
              FROM public.visit_events
              WHERE created_at > now() - make_interval(days => {days})
                AND path IS NOT NULL
                AND array_position(@steps, step) IS NOT NULL
              ORDER BY session_id, array_position(@steps, step) DESC, created_at DESC
            )
            SELECT path, step, count(*)::int
            FROM son
            WHERE step <> 'siparis'
            GROUP BY path, step
            ORDER BY count(*) DESC
            LIMIT 25
            """, conn))
        {
            cmd.Parameters.AddWithValue("steps", Steps);
            await using var reader = await cmd.ExecuteReaderAsync(ct);
            while (await reader.ReadAsync(ct))
            {
                yollar.Add(new PathRow(reader.GetString(0), reader.GetString(1), reader.GetInt32(2)));
            }
        }

        return new FunnelReport(days, toplam, toplam - uye, uye, adimlar, yollar);
    }

    /// <summary>Budama: huni verisi kalıcı arşiv değil, karar aracı. 180 günden eskisi siliniyor.</summary>
    public async Task<int> PruneAsync(CancellationToken ct)
    {
        await _schema.EnsureAsync(ct);
        await using var conn = new NpgsqlConnection(_tenant.ShopConnectionString());
        await conn.OpenAsync(ct);
        await using var cmd = new NpgsqlCommand(
            "DELETE FROM public.visit_events WHERE created_at < now() - interval '180 days'", conn);
        return await cmd.ExecuteNonQueryAsync(ct);
    }

    private static string? Kirp(string? s, int max)
    {
        s = (s ?? string.Empty).Trim();
        if (s.Length == 0) return null;
        return s.Length <= max ? s : s[..max];
    }
}
