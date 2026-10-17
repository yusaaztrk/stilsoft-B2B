using Npgsql;
using Shop.Api.Infrastructure;
using Shop.Api.Members;

namespace Shop.Api.Marketing;

/// <summary>
/// ÜYELERE TOPLU SMS (2026-09-20) — panelin "Kampanyalar" sekmesinden.
///
/// Kıbrıs müşterisi Facebook'a ve telefona bakıyor; "bu hafta klimada 5.000 TL indirim" SMS'i
/// yeni siteden çok daha hızlı satış getiriyor. Gönderim ARKA PLANDA koşar: 800 numara × ~0,3 sn
/// bir HTTP isteğinde tamamlanmaz (Plesk 2 dakikada keser). Panel başlatır, ilerlemeyi sorar.
///
/// Güvenlik kapıları:
/// <list type="bullet">
/// <item>Aynı anda tek gönderim (tekrar tıklama → 409).</item>
/// <item>Alıcı: aktif, telefonu olan, SMS'ten çıkmamış GERÇEK üyeler (misafir satırları hariç).
///       Her tur en fazla <see cref="MaxRecipients"/> kişi; aynı numaraya bir gönderimde bir SMS.</item>
/// <item>Metin ASCII'ye çevrilir (Türkçe karakter SMS'i iki kredi yapıyor), 300 karakteri geçemez.</item>
/// <item>Her gönderim <c>marketing_sms_log</c>'a yazılır: kim, ne zaman, ne yazdı, kaça gitti.</item>
/// </list>
///
/// Singleton: ilerleme RAM'de; süreç yeniden başlarsa yarım kalan gönderim devam ETMEZ (log'da
/// finished_at boş kalır) — yarısı gitmiş bir kampanyayı baştan atmak, üyeye çift SMS demek.
/// </summary>
public sealed class CampaignSmsService
{
    public const int MaxRecipients = 800;
    public const int MaxMessageLength = 300;

    private readonly IServiceScopeFactory _scopes;
    private readonly ILogger<CampaignSmsService> _logger;
    private readonly object _gate = new();
    private JobState? _current;

    public CampaignSmsService(IServiceScopeFactory scopes, ILogger<CampaignSmsService> logger)
    {
        _scopes = scopes;
        _logger = logger;
    }

    public sealed class JobState
    {
        public long LogId { get; init; }
        public string Message { get; init; } = string.Empty;
        public string StartedBy { get; init; } = string.Empty;
        public DateTime StartedAtUtc { get; init; }
        public int Total { get; init; }
        public int Sent;
        public int Failed;
        public bool Finished;
        public string? Error;
    }

    public JobState? Current
    {
        get { lock (_gate) return _current; }
    }

    public bool IsRunning
    {
        get { lock (_gate) return _current is { Finished: false }; }
    }

    /// <summary>Kaç üyeye gidecek (gönderim öncesi panelde "N kişiye gidecek, emin misin?").</summary>
    public async Task<int> CountAudienceAsync(CancellationToken ct)
    {
        using var scope = _scopes.CreateScope();
        var tenant = scope.ServiceProvider.GetRequiredService<TenantResolver>();
        await scope.ServiceProvider.GetRequiredService<ShopSchema>().EnsureAsync(ct);
        await using var conn = new NpgsqlConnection(tenant.ShopConnectionString());
        await conn.OpenAsync(ct);
        await using var cmd = new NpgsqlCommand(AudienceSql("count(DISTINCT regexp_replace(m.phone, '[^0-9]', '', 'g'))::int"), conn);
        return Convert.ToInt32(await cmd.ExecuteScalarAsync(ct));
    }

    private static string AudienceSql(string select) =>
        $"""
         SELECT {select}
         FROM public.members m
         WHERE m.is_active
           AND COALESCE(m.sms_opt_out, false) = false
           AND COALESCE(m.phone, '') <> ''
           AND m.email NOT LIKE '%@guest.stilsoft'
         """;

    /// <summary>Gönderimi başlatır; zaten koşuyorsa <c>false</c>.</summary>
    public async Task<(bool Started, string? Error, JobState? State)> StartAsync(string message, string startedBy, CancellationToken ct)
    {
        message = SmsText.Ascii((message ?? string.Empty).Trim());
        if (message.Length == 0) return (false, "Mesaj boş.", null);
        if (message.Length > MaxMessageLength) return (false, $"Mesaj {MaxMessageLength} karakteri geçemez.", null);

        lock (_gate)
        {
            if (_current is { Finished: false }) return (false, "Bir gönderim zaten sürüyor.", _current);
        }

        // Alıcı listesi ve log kaydı — başlamadan önce; sayı 0 ise hiç başlamaz.
        List<(Guid Id, string Phone)> audience;
        long logId;
        using (var scope = _scopes.CreateScope())
        {
            var sp = scope.ServiceProvider;
            var sms = sp.GetRequiredService<ISmsService>();
            if (!sms.IsConfigured) return (false, "SMS servisi kapalı (PostaGuvercini bilgileri girilmemiş).", null);

            var tenant = sp.GetRequiredService<TenantResolver>();
            await sp.GetRequiredService<ShopSchema>().EnsureAsync(ct);
            await using var conn = new NpgsqlConnection(tenant.ShopConnectionString());
            await conn.OpenAsync(ct);

            audience = new List<(Guid, string)>();
            var seen = new HashSet<string>(StringComparer.Ordinal);
            await using (var cmd = new NpgsqlCommand(AudienceSql("m.id, m.phone") + " ORDER BY m.created_at DESC LIMIT " + (MaxRecipients * 2), conn))
            await using (var reader = await cmd.ExecuteReaderAsync(ct))
            {
                while (await reader.ReadAsync(ct))
                {
                    var phone = sms.NormalizeMsisdn(reader.GetString(1));
                    if (phone.Length == 0 || !seen.Add(phone)) continue;
                    audience.Add((reader.GetGuid(0), phone));
                    if (audience.Count >= MaxRecipients) break;
                }
            }
            if (audience.Count == 0) return (false, "Gönderilecek üye yok (telefonu olan aktif üye bulunamadı).", null);

            await using (var ins = new NpgsqlCommand(
                "INSERT INTO public.marketing_sms_log (sent_by, message, recipients) VALUES (@u, @m, @n) RETURNING id", conn))
            {
                ins.Parameters.AddWithValue("u", startedBy);
                ins.Parameters.AddWithValue("m", message);
                ins.Parameters.AddWithValue("n", audience.Count);
                logId = Convert.ToInt64(await ins.ExecuteScalarAsync(ct));
            }
        }

        var state = new JobState
        {
            LogId = logId,
            Message = message,
            StartedBy = startedBy,
            StartedAtUtc = DateTime.UtcNow,
            Total = audience.Count
        };
        lock (_gate)
        {
            if (_current is { Finished: false }) return (false, "Bir gönderim zaten sürüyor.", _current);
            _current = state;
        }

        // Arka plan: istek bitse de sürer. Süreç kapanırsa yarım kalır (üstteki açıklama).
        _ = Task.Run(() => RunAsync(state, audience, CancellationToken.None));
        return (true, null, state);
    }

    private async Task RunAsync(JobState state, List<(Guid Id, string Phone)> audience, CancellationToken ct)
    {
        try
        {
            using var scope = _scopes.CreateScope();
            var sms = scope.ServiceProvider.GetRequiredService<ISmsService>();
            foreach (var (_, phone) in audience)
            {
                try
                {
                    var r = await sms.SendAsync(phone, state.Message, ct);
                    if (r.Success) Interlocked.Increment(ref state.Sent);
                    else Interlocked.Increment(ref state.Failed);
                }
                catch (Exception ex)
                {
                    Interlocked.Increment(ref state.Failed);
                    _logger.LogWarning(ex, "[KampanyaSms] Gönderim hatası");
                }
                // Operatörü boğmamak için küçük ara.
                await Task.Delay(120, ct);
            }
        }
        catch (Exception ex)
        {
            state.Error = ex.Message;
            _logger.LogError(ex, "[KampanyaSms] Gönderim yarıda kesildi");
        }
        finally
        {
            state.Finished = true;
            await FinishLogAsync(state);
            _logger.LogInformation("[KampanyaSms] Bitti: {Sent} gitti, {Failed} gitmedi / {Total}", state.Sent, state.Failed, state.Total);
        }
    }

    private async Task FinishLogAsync(JobState state)
    {
        try
        {
            using var scope = _scopes.CreateScope();
            var tenant = scope.ServiceProvider.GetRequiredService<TenantResolver>();
            await using var conn = new NpgsqlConnection(tenant.ShopConnectionString());
            await conn.OpenAsync();
            await using var cmd = new NpgsqlCommand(
                "UPDATE public.marketing_sms_log SET succeeded = @s, failed = @f, finished_at = now() WHERE id = @id", conn);
            cmd.Parameters.AddWithValue("s", state.Sent);
            cmd.Parameters.AddWithValue("f", state.Failed);
            cmd.Parameters.AddWithValue("id", state.LogId);
            await cmd.ExecuteNonQueryAsync();
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "[KampanyaSms] Log kapatılamadı");
        }
    }

    public sealed record LogRow(long Id, DateTime SentAtUtc, string? SentBy, string Message, int Recipients, int Succeeded, int Failed, DateTime? FinishedAtUtc);

    public async Task<IReadOnlyList<LogRow>> RecentAsync(int take, CancellationToken ct)
    {
        using var scope = _scopes.CreateScope();
        var tenant = scope.ServiceProvider.GetRequiredService<TenantResolver>();
        await scope.ServiceProvider.GetRequiredService<ShopSchema>().EnsureAsync(ct);
        await using var conn = new NpgsqlConnection(tenant.ShopConnectionString());
        await conn.OpenAsync(ct);
        await using var cmd = new NpgsqlCommand(
            "SELECT id, sent_at, sent_by, message, recipients, succeeded, failed, finished_at FROM public.marketing_sms_log ORDER BY id DESC LIMIT @n", conn);
        cmd.Parameters.AddWithValue("n", Math.Clamp(take, 1, 50));
        var rows = new List<LogRow>();
        await using var reader = await cmd.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct))
        {
            rows.Add(new LogRow(
                reader.GetInt64(0),
                reader.GetDateTime(1).ToUniversalTime(),
                reader.IsDBNull(2) ? null : reader.GetString(2),
                reader.GetString(3),
                reader.GetInt32(4),
                reader.GetInt32(5),
                reader.GetInt32(6),
                reader.IsDBNull(7) ? null : reader.GetDateTime(7).ToUniversalTime()));
        }
        return rows;
    }
}
