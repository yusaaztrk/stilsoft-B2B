using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Npgsql;
using Shop.Api.Cart;
using Shop.Api.Erp;
using Shop.Api.Infrastructure;
using Shop.Api.Members;

namespace Shop.Api.Orders;

public sealed record OrderResult(bool Success, string? OrderNo, decimal GrandTotal, string? Error);

public sealed class OrderSummary
{
    public int Id { get; init; }
    public string OrderNo { get; init; } = string.Empty;
    public DateTime ProcessedAt { get; init; }
    public decimal Subtotal { get; init; }
    public decimal VatTotal { get; init; }
    public decimal GrandTotal { get; init; }
    public List<OrderSummaryLine> Lines { get; init; } = new();
}

public sealed class OrderSummaryLine
{
    public string StockCode { get; init; } = string.Empty;
    public decimal Quantity { get; init; }
    public decimal UnitPrice { get; init; }
    public decimal VatRate { get; init; }
}

/// <summary>
/// Sipariş oluşturma ve okuma.
///
/// Sipariş ERP'de doğar; mağaza yalnızca hangi ürünlerden kaç adet istendiğini söyler.
/// Tutarı ERP hesaplar — mağazanın hesapladığı tutar yalnızca ekranda gösterilen bilgidir,
/// resmi kaynak değildir. İkisinin tutması gerekir; tutmuyorsa ERP'ninki doğrudur.
/// </summary>
public sealed class OrderService
{
    private readonly ErpWriteClient _erp;
    private readonly CartService _cart;
    private readonly TenantResolver _tenant;
    private readonly ShopSchema _schema;
    private readonly OrderEventLog _events;
    private readonly ILogger<OrderService> _logger;

    /// <summary>
    /// Bekleyen siparişin "aynı sipariş" sayılacağı süre. Bunun ötesinde müşteri gerçekten
    /// yeniden sipariş vermek istiyordur.
    /// </summary>
    private static readonly TimeSpan PendingWindow = TimeSpan.FromHours(2);

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true
    };

    public OrderService(
        ErpWriteClient erp,
        CartService cart,
        TenantResolver tenant,
        ShopSchema schema,
        OrderEventLog events,
        ILogger<OrderService> logger)
    {
        _erp = erp;
        _cart = cart;
        _tenant = tenant;
        _schema = schema;
        _events = events;
        _logger = logger;
    }

    private async Task<NpgsqlConnection> OpenAsync(CancellationToken ct)
    {
        await _schema.EnsureAsync(ct);
        var conn = new NpgsqlConnection(_tenant.ShopConnectionString());
        await conn.OpenAsync(ct);
        return conn;
    }

    /// <summary>Sepetin içeriğini tek bir değere indirger; iki çağrının aynı sepet olup olmadığı buradan anlaşılır.</summary>
    private static string Fingerprint(CartView cart)
    {
        // Montaj seçimi parmak izinin PARÇASI: müşteri ödeme adımına gitmeden montajı açıp
        // kapatırsa sepet gerçekten değişmiştir ve siparişin yeniden açılması gerekir.
        // Dışarıda bırakılsaydı, bekleyen sipariş "aynı sepet" sayılıp montajsız hâliyle
        // geri verilir; ekranda montajlı görünen sepetin parası montajsız çekilirdi.
        var text = string.Join('|', cart.Lines
            .OrderBy(x => x.StockCode, StringComparer.Ordinal)
            .Select(x => $"{x.StockCode}:{x.Quantity}:{x.UnitGrossPrice}:{(x.WantsInstallation ? "M" : "-")}"));

        return Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(text)));
    }

    private async Task<(string OrderNo, decimal Total)?> FindPendingAsync(Guid memberId, string fingerprint, CancellationToken ct)
    {
        await using var conn = await OpenAsync(ct);
        await using var cmd = new NpgsqlCommand("""
            SELECT order_no, grand_total FROM public.pending_orders
            WHERE member_id = @m AND cart_fingerprint = @f AND created_at > @since
            """, conn);

        cmd.Parameters.AddWithValue("m", memberId);
        cmd.Parameters.AddWithValue("f", fingerprint);
        cmd.Parameters.AddWithValue("since", DateTime.UtcNow.Subtract(PendingWindow));

        await using var reader = await cmd.ExecuteReaderAsync(ct);
        if (!await reader.ReadAsync(ct)) return null;

        return (reader.GetString(0), reader.GetDecimal(1));
    }

    private async Task RememberPendingAsync(Guid memberId, string orderNo, decimal total, string fingerprint, CancellationToken ct)
    {
        await using var conn = await OpenAsync(ct);
        await using var cmd = new NpgsqlCommand("""
            INSERT INTO public.pending_orders (member_id, order_no, grand_total, cart_fingerprint, created_at)
            VALUES (@m, @o, @t, @f, now())
            ON CONFLICT (member_id) DO UPDATE
            SET order_no = @o, grand_total = @t, cart_fingerprint = @f, created_at = now()
            """, conn);

        cmd.Parameters.AddWithValue("m", memberId);
        cmd.Parameters.AddWithValue("o", orderNo);
        cmd.Parameters.AddWithValue("t", total);
        cmd.Parameters.AddWithValue("f", fingerprint);

        await cmd.ExecuteNonQueryAsync(ct);
    }

    /// <summary>
    /// Ödeme tamamlanınca ya da sipariş iptal edilince çağrılır.
    ///
    /// <paramref name="onlyOrderNo"/> verilirse yalnızca o sipariş için olan kayıt silinir:
    /// müşteri arada yeni bir sipariş açmış olabilir ve onun bekleyen kaydı, eski bir siparişin
    /// ödeme onayı yüzünden silinmemeli.
    /// </summary>
    /// <returns>Gerçekten silinen kayıt sayısı — "ilk kez mi kapanıyor" sorusunun cevabı.</returns>
    public async Task<int> ClearPendingAsync(Guid memberId, CancellationToken ct, string? onlyOrderNo = null)
    {
        await using var conn = await OpenAsync(ct);

        var sql = onlyOrderNo is null
            ? "DELETE FROM public.pending_orders WHERE member_id = @m"
            : "DELETE FROM public.pending_orders WHERE member_id = @m AND order_no = @o";

        await using var cmd = new NpgsqlCommand(sql, conn);
        cmd.Parameters.AddWithValue("m", memberId);
        if (onlyOrderNo is not null) cmd.Parameters.AddWithValue("o", onlyOrderNo);

        return await cmd.ExecuteNonQueryAsync(ct);
    }

    /// <summary>
    /// Ödemesi doğrulanmış bir siparişin mağaza tarafındaki izlerini kapatır: bekleyen sipariş
    /// kaydı ve sepet.
    ///
    /// Tek yerde duruyor çünkü iki yoldan çağrılıyor — ödeme sonucu sayfası (hızlı yol) ve
    /// yeni sipariş denemesi (geç fark edilen hâl). İkisinin farklı davranması, sepeti duran
    /// ama siparişi kapanmış bir müşteri demek olurdu.
    /// </summary>
    /// <returns>
    /// Kapanış ilk kez mi yapıldı. Sonuç sayfası yenilendiğinde bu yol tekrar çalışıyor;
    /// olay kaydının aynı satırla dolmaması için çağıranlar buna bakıyor.
    /// </returns>
    public async Task<bool> SettlePaidOrderAsync(Guid memberId, string orderNo, CancellationToken ct)
    {
        var cleared = await ClearPendingAsync(memberId, ct, orderNo);
        await _cart.ClearAsync(memberId, ct);

        if (cleared > 0)
        {
            await _events.WriteAsync(OrderEventLog.OrderSettled, memberId, orderNo, "Bekleyen sipariş ve sepet temizlendi.", ct);
        }

        return cleared > 0;
    }

    /// <summary>
    /// Sepeti siparişe çevirir.
    ///
    /// Sepet BURADA TEMİZLENMİYOR: sipariş henüz ödenmedi. Ödeme başarısız olursa müşterinin
    /// sepeti duruyor olmalı, yoksa baştan doldurması gerekir. Temizlik ödeme onayında yapılır.
    /// </summary>
    public async Task<OrderResult> CreateFromCartAsync(
        Guid memberId,
        string customerCode,
        string? deliveryNote,
        CancellationToken ct)
    {
        var cart = await _cart.GetAsync(memberId, ct);

        if (cart.Lines.Count == 0)
        {
            return new OrderResult(false, null, 0, "Sepetiniz boş.");
        }

        // Çift tıklama, sayfa yenileme ya da geri-ileri gezinme aynı siparişi ikinci kez
        // açmamalı. Sepet değişmediyse var olan bekleyen sipariş geri veriliyor.
        var fingerprint = Fingerprint(cart);
        var pending = await FindPendingAsync(memberId, fingerprint, ct);
        if (pending is not null)
        {
            // Bekleyen sipariş ÖDENMİŞ olabilir: müşteri banka sayfasından döndükten sonra
            // tarayıcıyı kapattıysa ödeme onayındaki temizlik hiç çalışmamıştır. O hâlde bu
            // kayıt bayat — geri verilirse müşteri ödediği siparişin ekranına düşer ve bir
            // daha hiç sipariş veremez. Kararı ERP veriyor, mağazanın kendi kaydı değil.
            if (await _erp.IsEcommerceOrderPaidAsync(customerCode, pending.Value.OrderNo, ct))
            {
                _logger.LogInformation(
                    "Bekleyen sipariş zaten ödenmiş, temizleniyor: {OrderNo}", pending.Value.OrderNo);

                await SettlePaidOrderAsync(memberId, pending.Value.OrderNo, ct);

                // Sepet, ödenmiş siparişin ta kendisiydi (parmak izi tuttu). Aynı sepetle
                // sessizce ikinci bir sipariş açmak yerine durum söyleniyor.
                return new OrderResult(false, null, 0,
                    $"Önceki siparişiniz ({pending.Value.OrderNo}) ödendi ve sepetiniz temizlendi. Siparişlerinizden takip edebilirsiniz.");
            }

            _logger.LogInformation("Mevcut bekleyen sipariş geri verildi: {OrderNo}", pending.Value.OrderNo);
            await _events.WriteAsync(OrderEventLog.OrderReused, memberId, pending.Value.OrderNo,
                "Sepet değişmediği için yeni sipariş açılmadı.", ct);

            // SEPETİN PARMAK İZİ notu KAPSAMIYOR (bkz. Fingerprint) — müşteri notu değiştirip
            // ödemeyi tekrar denediğinde sepet aynı sayılıp bu bekleyen sipariş geri veriliyor,
            // ama YENİ not hiçbir yere yazılmıyordu (2026-09-13 kullanıcı bulgusu: "böyle
            // yazdım gelmedi"). Sipariş yeniden açılmasa da not burada güncelleniyor.
            //
            // TRY/CATCH ŞART: bu ödeme akışının TAM ORTASINDA çalışıyor. ERP'ye anlık
            // ulaşılamazsa (ağ dalgalanması, kısa kesinti) `_erp.PostAsync` içindeki
            // `HttpClient.SendAsync` istisna fırlatır ve o istisna yakalanmazsa müşterinin
            // ÖDEMESİ, sırf notu güncelleyemedik diye "başarısız" döner — not en fazla eksik
            // kalsın, ödeme asla buna kurban gitmemeli.
            try
            {
                await _erp.PostAsync(
                    $"/api/ecommerce/orders/{Uri.EscapeDataString(pending.Value.OrderNo)}/delivery-note",
                    new { deliveryNote },
                    ct);
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Bekleyen siparişin notu güncellenemedi: {OrderNo}", pending.Value.OrderNo);
            }

            return new OrderResult(true, pending.Value.OrderNo, pending.Value.Total, null);
        }

        var payload = new
        {
            customerCode,
            deliveryNote,
            lines = cart.Lines.Select(x => new
            {
                stockCode = x.StockCode,
                quantity = (decimal)x.Quantity,
                wantsInstallation = x.WantsInstallation
            })
        };

        var response = await _erp.PostAsync("/api/ecommerce/orders", payload, ct);
        if (response is null) return new OrderResult(false, null, 0, "Sipariş sistemine ulaşılamadı.");

        using (response)
        {
            var body = await response.Content.ReadAsStringAsync(ct);

            if (!response.IsSuccessStatusCode)
            {
                _logger.LogError("Sipariş oluşturulamadı: {Status} {Body}", response.StatusCode, body);

                // ERP'nin açıklaması kullanıcıya gösterilebilir olduğunda gösterilir
                // ("şu ürün artık satışta değil" gibi) — genel bir hata metni yardımcı olmaz.
                string? reason = null;
                try
                {
                    using var problem = JsonDocument.Parse(body);
                    if (problem.RootElement.TryGetProperty("message", out var m))
                    {
                        reason = m.GetString();
                    }
                }
                catch
                {
                }

                await _events.WriteAsync(OrderEventLog.OrderFailed, memberId, null,
                    reason ?? $"ERP {(int)response.StatusCode} döndü.", ct);

                return new OrderResult(false, null, 0, reason ?? "Sipariş oluşturulamadı.");
            }

            try
            {
                using var doc = JsonDocument.Parse(body);
                var data = doc.RootElement.GetProperty("data");

                var orderNo = data.GetProperty("orderNo").GetString() ?? string.Empty;
                var grandTotal = data.GetProperty("grandTotal").GetDecimal();

                await RememberPendingAsync(memberId, orderNo, grandTotal, fingerprint, ct);
                await _events.WriteAsync(OrderEventLog.OrderCreated, memberId, orderNo,
                    $"{cart.Lines.Count} kalem, toplam {grandTotal:0.00}.", ct);

                return new OrderResult(true, orderNo, grandTotal, null);
            }
            catch (Exception ex)
            {
                // Sipariş ERP'de oluşmuş olabilir ama yanıtı okuyamadık: kullanıcıya "olmadı"
                // demek yanlış olur, çünkü tekrar denerse ikinci sipariş açılır.
                _logger.LogError(ex, "Sipariş yanıtı çözümlenemedi: {Body}", body);
                return new OrderResult(false, null, 0, "Siparişiniz alınmış olabilir. Lütfen siparişlerinizi kontrol edin.");
            }
        }
    }

    public async Task<IReadOnlyList<OrderSummary>> ListAsync(string customerCode, CancellationToken ct)
    {
        var response = await _erp.GetAsync($"/api/ecommerce/orders/{Uri.EscapeDataString(customerCode)}", ct);
        if (response is null) return Array.Empty<OrderSummary>();

        using (response)
        {
            if (!response.IsSuccessStatusCode) return Array.Empty<OrderSummary>();

            var body = await response.Content.ReadAsStringAsync(ct);

            try
            {
                using var doc = JsonDocument.Parse(body);
                var data = doc.RootElement.GetProperty("data");
                return JsonSerializer.Deserialize<List<OrderSummary>>(data.GetRawText(), JsonOptions)
                       ?? new List<OrderSummary>();
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Sipariş listesi çözümlenemedi.");
                return Array.Empty<OrderSummary>();
            }
        }
    }
}
