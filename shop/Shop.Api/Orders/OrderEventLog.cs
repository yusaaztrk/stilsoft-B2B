using Npgsql;
using Shop.Api.Infrastructure;
using Shop.Api.Members;

namespace Shop.Api.Orders;

/// <summary>
/// Sipariş olay kaydı — mağaza tarafında ne olduğunun izi.
///
/// NEDEN VAR: bugüne kadar "müşteri ödedim diyor ama siparişi göremiyorum" gibi bir durumda
/// bakılacak tek yer ERP'nin tahsilat tablosuydu. Orası bankanın ne dediğini biliyor, müşterinin
/// ne yaptığını bilmiyor: kaç kez denedi, hangi hatayı aldı, sonuç sayfasına hiç döndü mü.
/// Bu tablo o boşluğu dolduruyor.
///
/// YAZMA HİÇBİR ZAMAN AKIŞI KIRMAZ. Olay kaydı yazılamadıysa sipariş yine de verilmeli; bu
/// yüzden bütün hatalar burada yutuluyor ve yalnızca log'a düşüyor. Tersi, bir denetim
/// kaydının kusuru yüzünden satış kaybetmek olurdu.
///
/// KART BİLGİSİ, ŞİFRE, OTURUM ANAHTARI ASLA YAZILMAZ. <c>detail</c> alanına yalnızca
/// müşteriye de gösterilebilecek metinler giriyor.
/// </summary>
public sealed class OrderEventLog
{
    private readonly TenantResolver _tenant;
    private readonly ShopSchema _schema;
    private readonly ClientAddress _client;
    private readonly IHttpContextAccessor _http;
    private readonly ILogger<OrderEventLog> _logger;

    // Olay adları Türkçe ve sabit: bu tabloya bakan kişi çoğunlukla geliştirici değil.
    public const string OrderCreated = "siparis.olusturuldu";
    public const string OrderReused = "siparis.tekrar-kullanildi";
    public const string OrderFailed = "siparis.olusturulamadi";
    public const string PaymentStarted = "odeme.baslatildi";
    public const string PaymentStartFailed = "odeme.baslatilamadi";
    public const string PaymentApproved = "odeme.onaylandi";
    public const string PaymentRejected = "odeme.reddedildi";
    public const string PaymentNeedsReview = "odeme.inceleniyor";
    public const string OrderSettled = "siparis.kapatildi";

    /// <summary>Bayi panelinden iptal. "Bu sipariş neden iptal edildi" sorusunun tek dayanağı.</summary>
    public const string OrderCancelled = "siparis.iptal-edildi";

    public OrderEventLog(
        TenantResolver tenant,
        ShopSchema schema,
        ClientAddress client,
        IHttpContextAccessor http,
        ILogger<OrderEventLog> logger)
    {
        _tenant = tenant;
        _schema = schema;
        _client = client;
        _http = http;
        _logger = logger;
    }

    public async Task WriteAsync(
        string evt,
        Guid? memberId,
        string? orderNo,
        string? detail,
        CancellationToken ct)
    {
        try
        {
            await _schema.EnsureAsync(ct);

            var context = _http.HttpContext;
            var ip = context is null ? null : _client.ResolveIp(context);

            await using var conn = new NpgsqlConnection(_tenant.ShopConnectionString());
            await conn.OpenAsync(ct);

            await using var cmd = new NpgsqlCommand("""
                INSERT INTO public.order_events (order_no, member_id, event, detail, client_ip, created_at)
                VALUES (@o, @m, @e, @d, @ip, now())
                """, conn);

            cmd.Parameters.AddWithValue("o", (object?)orderNo ?? DBNull.Value);
            cmd.Parameters.AddWithValue("m", (object?)memberId ?? DBNull.Value);
            cmd.Parameters.AddWithValue("e", evt);
            cmd.Parameters.AddWithValue("d", (object?)Trim(detail) ?? DBNull.Value);
            cmd.Parameters.AddWithValue("ip", string.IsNullOrWhiteSpace(ip) ? DBNull.Value : ip);

            await cmd.ExecuteNonQueryAsync(ct);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Sipariş olayı yazılamadı: {Event} {OrderNo}", evt, orderNo);
        }
    }

    /// <summary>
    /// Aynı olay üst üste tekrarlanıyorsa yazmaz.
    ///
    /// Sonuç sayfası her yenilendiğinde ödeme durumu yeniden sorulıyor; "ödeme reddedildi"
    /// satırının onlarca kez düşmesi denetim kaydını okunamaz hâle getirirdi. Araya başka bir
    /// olay girdiyse (müşteri yeniden denedi) yeniden yazılır — bilgi kaybı yok.
    /// </summary>
    public async Task WriteOnceAsync(
        string evt,
        Guid? memberId,
        string? orderNo,
        string? detail,
        CancellationToken ct)
    {
        try
        {
            if (!string.IsNullOrWhiteSpace(orderNo))
            {
                await _schema.EnsureAsync(ct);

                await using var conn = new NpgsqlConnection(_tenant.ShopConnectionString());
                await conn.OpenAsync(ct);

                await using var cmd = new NpgsqlCommand(
                    "SELECT event FROM public.order_events WHERE order_no = @o ORDER BY id DESC LIMIT 1", conn);
                cmd.Parameters.AddWithValue("o", orderNo);

                var last = await cmd.ExecuteScalarAsync(ct) as string;
                if (string.Equals(last, evt, StringComparison.Ordinal)) return;
            }
        }
        catch (Exception ex)
        {
            // Okunamadıysa yazmaya devam: eksik kayıttansa fazlası iyidir.
            _logger.LogWarning(ex, "Son olay okunamadı: {OrderNo}", orderNo);
        }

        await WriteAsync(evt, memberId, orderNo, detail, ct);
    }

    /// <summary>
    /// Olayı yalnız o sipariş için İLK KEZ yazar; yazıldıysa true. SMS gibi tekrarı para
    /// eden işler için (havale IBAN mesajı, süre aşımı bildirimi) — `WriteOnceAsync` yalnız
    /// SON olaya bakıyor, arada başka olay girince aynı mesaj ikinci kez giderdi.
    /// </summary>
    public async Task<bool> TryWriteFirstAsync(string evt, Guid? memberId, string? orderNo, string? detail, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(orderNo)) return false;
        try
        {
            await _schema.EnsureAsync(ct);
            await using var conn = new NpgsqlConnection(_tenant.ShopConnectionString());
            await conn.OpenAsync(ct);
            await using var cmd = new NpgsqlCommand(
                "SELECT 1 FROM public.order_events WHERE order_no = @o AND event = @e LIMIT 1", conn);
            cmd.Parameters.AddWithValue("o", orderNo);
            cmd.Parameters.AddWithValue("e", evt);
            if (await cmd.ExecuteScalarAsync(ct) is not null) return false;
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Olay kontrolü yapılamadı: {OrderNo}", orderNo);
            return false;
        }

        await WriteAsync(evt, memberId, orderNo, detail, ct);
        return true;
    }

    /// <summary>Bir siparişin olay dökümü — bayi panelindeki mutabakat ekranı için.</summary>
    public async Task<IReadOnlyList<OrderEventRow>> ListForOrderAsync(string orderNo, CancellationToken ct)
    {
        await _schema.EnsureAsync(ct);

        await using var conn = new NpgsqlConnection(_tenant.ShopConnectionString());
        await conn.OpenAsync(ct);

        await using var cmd = new NpgsqlCommand("""
            SELECT event, detail, client_ip, created_at
            FROM public.order_events
            WHERE order_no = @o
            ORDER BY created_at, id
            """, conn);

        cmd.Parameters.AddWithValue("o", orderNo);

        var rows = new List<OrderEventRow>();
        await using var reader = await cmd.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct))
        {
            rows.Add(new OrderEventRow(
                reader.GetString(0),
                reader.IsDBNull(1) ? null : reader.GetString(1),
                reader.IsDBNull(2) ? null : reader.GetString(2),
                reader.GetDateTime(3)));
        }

        return rows;
    }

    // Serbest metin sınırsız uzayabiliyor (ERP'den gelen hata gövdesi gibi); denetim kaydı
    // okunabilir kalsın diye kırpılıyor.
    private static string? Trim(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return null;
        var text = value.Trim();
        return text.Length <= 500 ? text : text[..500];
    }
}

public sealed record OrderEventRow(string Event, string? Detail, string? ClientIp, DateTime CreatedAt);
