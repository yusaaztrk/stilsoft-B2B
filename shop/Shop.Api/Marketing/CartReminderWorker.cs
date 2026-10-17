using Npgsql;
using Shop.Api.Catalog;
using Shop.Api.Infrastructure;
using Shop.Api.Members;
using Shop.Api.Storefront;

namespace Shop.Api.Marketing;

/// <summary>
/// SEPET HATIRLATMA SMS'İ (2026-09-20).
///
/// Sepete ürün atıp ödemeye gelmeyen üyeye, sepete son dokunuştan N saat sonra BİR KEZ SMS gider.
/// Kural (paneldeki ayarlar: <c>CartReminderEnabled</c>, <c>CartReminderDelayHours</c>, metin):
/// <list type="bullet">
/// <item>SMS servisi açık değilse (PostaGüvercini bilgileri girilmemiş) hiçbir şey yapmaz.</item>
/// <item>Üyede telefon yok / SMS'ten çıkmış (<c>sms_opt_out</c>) / pasif → atlanır.</item>
/// <item>Ödeme adımına gelmiş (bekleyen siparişi olan) üye "sepeti unutmuş" değildir, ona gitmez;
///       havale bekleyenler de burada — onlara zaten havale SMS'i gitti.</item>
/// <item>Aynı sepet (parmak izi) için ikinci SMS gitmez; sepet değiştiyse bile son SMS'in
///       üstünden 7 gün geçmeden yeniden gitmez. Üyeyi SMS'e boğmak, satış değil şikâyet getirir.</item>
/// <item>Son dokunuş 3 günden eskiyse artık gitmez: "iki hafta önceki sepet" hatırlatması rahatsız eder.</item>
/// </list>
///
/// Tenant: HTTP bağlamı olmadığı için <c>Shop:TenantCode</c> (tek mağaza). İkinci mağaza açılırsa
/// firma listesi üzerinden döngü gerekir — bugün gerek yok.
/// </summary>
public sealed class CartReminderWorker : BackgroundService
{
    private readonly IServiceScopeFactory _scopes;
    private readonly IConfiguration _configuration;
    private readonly ILogger<CartReminderWorker> _logger;

    public CartReminderWorker(IServiceScopeFactory scopes, IConfiguration configuration, ILogger<CartReminderWorker> logger)
    {
        _scopes = scopes;
        _configuration = configuration;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var minutes = _configuration.GetValue<int?>("Shop:CartReminder:IntervalMinutes") ?? 30;
        if (minutes <= 0)
        {
            _logger.LogInformation("[SepetHatirlatma] Kapalı (IntervalMinutes <= 0).");
            return;
        }

        // Açılışta hemen koşmasın: ERP/DB ayağa kalkarken gürültü olmasın.
        try { await Task.Delay(TimeSpan.FromMinutes(2), stoppingToken); } catch (OperationCanceledException) { return; }

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await RunOnceAsync(stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                return;
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "[SepetHatirlatma] Tur başarısız; bir sonraki turda yeniden denenecek.");
            }

            try { await Task.Delay(TimeSpan.FromMinutes(minutes), stoppingToken); } catch (OperationCanceledException) { return; }
        }
    }

    /// <summary>Bir tur. Panelden "şimdi çalıştır" için de kullanılır; kaç SMS gittiğini döner.</summary>
    public async Task<int> RunOnceAsync(CancellationToken ct)
    {
        using var scope = _scopes.CreateScope();
        var sp = scope.ServiceProvider;
        var sms = sp.GetRequiredService<ISmsService>();
        if (!sms.IsConfigured) return 0;

        var storefront = sp.GetRequiredService<StorefrontStore>();
        var settings = await storefront.GetAsync(ct);
        if (!settings.CartReminderEnabled) return 0;

        var delayHours = Math.Clamp(settings.CartReminderDelayHours <= 0 ? 3 : settings.CartReminderDelayHours, 1, 72);
        var tenant = sp.GetRequiredService<TenantResolver>();
        var schema = sp.GetRequiredService<ShopSchema>();
        var catalog = sp.GetRequiredService<CatalogQueries>();
        var siteBase = (_configuration["Shop:StorefrontBaseUrl"] ?? "https://example.com").TrimEnd('/');

        await schema.EnsureAsync(ct);

        var candidates = new List<(Guid MemberId, string FullName, string Phone, string Fingerprint, string FirstStockCode, int Lines)>();
        await using (var conn = new NpgsqlConnection(tenant.ShopConnectionString()))
        {
            await conn.OpenAsync(ct);
            await using var cmd = new NpgsqlCommand("""
                SELECT m.id, m.full_name, m.phone,
                       string_agg(c.stock_code || ':' || c.quantity, '|' ORDER BY c.stock_code) AS fp,
                       (array_agg(c.stock_code ORDER BY c.added_at))[1] AS first_code,
                       count(*)::int AS lines
                FROM public.cart_items c
                JOIN public.members m ON m.id = c.member_id
                LEFT JOIN public.pending_orders po ON po.member_id = m.id
                LEFT JOIN public.cart_reminders r ON r.member_id = m.id
                WHERE m.is_active
                  AND COALESCE(m.sms_opt_out, false) = false
                  AND COALESCE(m.phone, '') <> ''
                  AND po.member_id IS NULL
                  AND (r.sent_at IS NULL OR r.sent_at < now() - interval '7 days')
                GROUP BY m.id, m.full_name, m.phone, r.cart_fingerprint
                HAVING max(c.added_at) < now() - make_interval(hours => @h)
                   AND max(c.added_at) > now() - interval '3 days'
                   AND (r.cart_fingerprint IS NULL OR r.cart_fingerprint <> string_agg(c.stock_code || ':' || c.quantity, '|' ORDER BY c.stock_code))
                LIMIT 200
                """, conn);
            cmd.Parameters.AddWithValue("h", delayHours);
            await using var reader = await cmd.ExecuteReaderAsync(ct);
            while (await reader.ReadAsync(ct))
            {
                candidates.Add((
                    reader.GetGuid(0),
                    reader.IsDBNull(1) ? string.Empty : reader.GetString(1),
                    reader.GetString(2),
                    reader.GetString(3),
                    reader.IsDBNull(4) ? string.Empty : reader.GetString(4),
                    reader.GetInt32(5)));
            }
        }

        if (candidates.Count == 0) return 0;

        // Ürün adları tek sorguda (yayından kalkmış ürün adsız kalır; o zaman genel metin).
        var names = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        try
        {
            var codes = candidates.Select(c => c.FirstStockCode).Where(c => c.Length > 0).Distinct().ToList();
            if (codes.Count > 0)
            {
                var items = await catalog.GetByStockCodesAsync(codes, ct);
                foreach (var it in items.Values) names[it.StockCode] = it.Name;
            }
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "[SepetHatirlatma] Ürün adları okunamadı; genel metinle devam.");
        }

        var template = string.IsNullOrWhiteSpace(settings.CartReminderText)
            ? new StorefrontSettings().CartReminderText
            : settings.CartReminderText;

        var sent = 0;
        foreach (var c in candidates)
        {
            ct.ThrowIfCancellationRequested();
            var phone = sms.NormalizeMsisdn(c.Phone);
            if (phone.Length == 0) continue;

            var firstName = SmsText.Ascii((c.FullName ?? string.Empty).Trim().Split(' ', StringSplitOptions.RemoveEmptyEntries).FirstOrDefault() ?? string.Empty);
            var product = names.TryGetValue(c.FirstStockCode, out var n) ? SmsText.Ascii(SmsText.Shorten(n, 40)) : "urunler";
            if (c.Lines > 1) product += $" (+{c.Lines - 1} urun)";

            var text = template
                .Replace("{ad}", firstName.Length == 0 ? "degerli musterimiz" : firstName)
                .Replace("{urun}", product)
                .Replace("{adet}", c.Lines.ToString())
                .Replace("{link}", $"{siteBase}/sepet");
            text = SmsText.Ascii(text);

            // Önce kayıt, sonra gönderim: gönderim patlarsa bir sonraki tur aynı üyeye ikinci kez
            // denemez (7 gün kuralı). Tersi — önce gönder sonra yaz — çökmede çift SMS demek.
            await MarkAsync(tenant, c.MemberId, c.Fingerprint, ct);
            var result = await sms.SendAsync(phone, text, ct);
            if (result.Success) sent++;
            else _logger.LogWarning("[SepetHatirlatma] SMS gitmedi ({Member}): {Error}", c.MemberId, result.ErrorCode);
        }

        if (sent > 0) _logger.LogInformation("[SepetHatirlatma] {Count} hatırlatma gönderildi.", sent);
        return sent;
    }

    private static async Task MarkAsync(TenantResolver tenant, Guid memberId, string fingerprint, CancellationToken ct)
    {
        await using var conn = new NpgsqlConnection(tenant.ShopConnectionString());
        await conn.OpenAsync(ct);
        await using var cmd = new NpgsqlCommand("""
            INSERT INTO public.cart_reminders (member_id, cart_fingerprint, sent_at)
            VALUES (@m, @f, now())
            ON CONFLICT (member_id) DO UPDATE SET cart_fingerprint = EXCLUDED.cart_fingerprint, sent_at = now()
            """, conn);
        cmd.Parameters.AddWithValue("m", memberId);
        cmd.Parameters.AddWithValue("f", fingerprint);
        await cmd.ExecuteNonQueryAsync(ct);
    }
}

/// <summary>SMS metni yardımcıları — Türkçe karakter GSM-7 dışına çıkıp SMS'i iki kredi yapıyor.</summary>
public static class SmsText
{
    public static string Ascii(string s)
        => (s ?? string.Empty)
            .Replace('ç', 'c').Replace('Ç', 'C').Replace('ğ', 'g').Replace('Ğ', 'G').Replace('ı', 'i').Replace('İ', 'I')
            .Replace('ö', 'o').Replace('Ö', 'O').Replace('ş', 's').Replace('Ş', 'S').Replace('ü', 'u').Replace('Ü', 'U');

    public static string Shorten(string s, int max)
    {
        s = (s ?? string.Empty).Trim();
        return s.Length <= max ? s : s[..max].TrimEnd() + "..";
    }
}
