using System.Text.Json;
using Npgsql;
using Shop.Api.Erp;
using Shop.Api.Infrastructure;
using Shop.Api.Members;
using Shop.Api.Orders;
using Shop.Api.Storefront;

namespace Shop.Api.Payments;

/// <summary>
/// HAVALE / EFT — mağaza tarafı (2026-09-20). Kayıt ve kural ERP'de (<c>EcommerceBankTransferService</c>);
/// burası müşteri/bayi uçlarını ERP'ye bağlar, SMS'leri atar ve sipariş kapanışını yapar.
///
/// Müşteri: "Havale/EFT" seçer → sipariş açılır (kart yoluyla aynı `CreateFromCartAsync`) →
/// ERP'de havale kaydı → IBAN'lar ekranda + SMS'te → "Gönderdim".
/// Bayi: panelde açık havale listesi → "Ödeme alındı" (banka hareketi paneldeki ERP ucuyla
/// yazılır, burada muhasebe yok) → ERP Paid + tamamlama → müşteriye SMS, sepet/bekleyen
/// sipariş temizliği (kart ödemesinin sonuç sayfasında yaptığının aynısı).
/// </summary>
public sealed class BankTransferService
{
    private readonly ErpWriteClient _erp;
    private readonly OrderService _orders;
    private readonly OrderEventLog _events;
    private readonly MemberStore _members;
    private readonly StorefrontStore _storefront;
    private readonly ISmsService _sms;
    private readonly ILogger<BankTransferService> _logger;

    public BankTransferService(
        ErpWriteClient erp, OrderService orders, OrderEventLog events, MemberStore members,
        StorefrontStore storefront, ISmsService sms, ILogger<BankTransferService> logger)
    {
        _erp = erp;
        _orders = orders;
        _events = events;
        _members = members;
        _storefront = storefront;
        _sms = sms;
        _logger = logger;
    }

    public sealed record BankTransferView(bool Success, string? Error, string? OrderNo, string? Status, decimal Amount, IReadOnlyList<BankTransferAccount> Accounts, int TimeoutHours);

    public async Task<bool> IsEnabledAsync(CancellationToken ct)
    {
        var s = await _storefront.GetAsync(ct);
        return s.BankTransferAccounts.Any(a => !string.IsNullOrWhiteSpace(a.Iban));
    }

    /// <summary>Müşteri havaleyi seçti: sipariş + ERP havale kaydı + IBAN SMS'i.</summary>
    public async Task<BankTransferView> RequestAsync(Guid memberId, string customerCode, string? deliveryNote, CancellationToken ct)
    {
        var settings = await _storefront.GetAsync(ct);
        var accounts = settings.BankTransferAccounts.Where(a => !string.IsNullOrWhiteSpace(a.Iban)).ToList();
        if (accounts.Count == 0)
            return new BankTransferView(false, "Havale/EFT şu anda kullanılamıyor.", null, null, 0m, accounts, settings.BankTransferTimeoutHours);

        var order = await _orders.CreateFromCartAsync(memberId, customerCode, deliveryNote, ct);
        if (!order.Success || string.IsNullOrWhiteSpace(order.OrderNo))
            return new BankTransferView(false, order.Error ?? "Sipariş oluşturulamadı.", null, null, 0m, accounts, settings.BankTransferTimeoutHours);

        var (ok, err, status, amount) = await CallErpAsync("/api/ecommerce/payments/bank-transfer/request", new { customerCode, orderNo = order.OrderNo }, ct);
        if (!ok)
            return new BankTransferView(false, err ?? "Havale kaydı açılamadı.", order.OrderNo, status, amount, accounts, settings.BankTransferTimeoutHours);

        // Kayıt ilk kez açıldıysa SMS; "Requested" tekrar döndüğünde de gider ama olay kaydı tekilliği yeter.
        if (await _events.TryWriteFirstAsync("havale.istendi", memberId, order.OrderNo, $"{amount:0.00} TRY", ct))
        {
            await SendSmsAsync(memberId, BuildIbanSms(order.OrderNo, amount, accounts[0]), ct);
        }

        return new BankTransferView(true, null, order.OrderNo, status, amount, accounts, settings.BankTransferTimeoutHours);
    }

    /// <summary>Müşteri "Gönderdim" dedi.</summary>
    public async Task<BankTransferView> MarkSentAsync(Guid memberId, string customerCode, string orderNo, string? note, CancellationToken ct)
    {
        var settings = await _storefront.GetAsync(ct);
        var accounts = settings.BankTransferAccounts.Where(a => !string.IsNullOrWhiteSpace(a.Iban)).ToList();

        var (ok, err, status, amount) = await CallErpAsync("/api/ecommerce/payments/bank-transfer/sent", new { customerCode, orderNo, note }, ct);
        if (!ok) return new BankTransferView(false, err ?? "Bildirim kaydedilemedi.", orderNo, status, amount, accounts, settings.BankTransferTimeoutHours);

        await _events.WriteOnceAsync("havale.gonderildi", memberId, orderNo, note ?? string.Empty, ct);
        return new BankTransferView(true, null, orderNo, status, amount, accounts, settings.BankTransferTimeoutHours);
    }

    /// <summary>Panel: açık havaleler (süresi dolanlar bu çağrıda kapanır ve müşteriye SMS gider).</summary>
    public async Task<JsonElement?> ListOpenAsync(CancellationToken ct)
    {
        var settings = await _storefront.GetAsync(ct);
        var response = await _erp.GetAsync($"/api/ecommerce/payments/bank-transfer/open?timeoutHours={settings.BankTransferTimeoutHours}", ct);
        if (response is null) return null;
        using (response)
        {
            var body = await response.Content.ReadAsStringAsync(ct);
            if (!response.IsSuccessStatusCode) return null;
            using var doc = JsonDocument.Parse(body);
            var root = doc.RootElement.Clone();

            if (root.TryGetProperty("expired", out var expired) && expired.ValueKind == JsonValueKind.Array)
            {
                foreach (var e in expired.EnumerateArray())
                {
                    var orderNo = e.TryGetProperty("orderNo", out var o) ? o.GetString() : null;
                    var customerCode = e.TryGetProperty("customerCode", out var c) ? c.GetString() : null;
                    if (string.IsNullOrWhiteSpace(orderNo) || string.IsNullOrWhiteSpace(customerCode)) continue;
                    var member = await _members.FindByCustomerCodeAsync(customerCode, ct);
                    if (member is null) continue;
                    if (await _events.TryWriteFirstAsync("havale.suresi-doldu", member.Id, orderNo, string.Empty, ct))
                    {
                        await SendSmsAsync(member.Id, $"Siparis No {orderNo} icin havale bildirimi gelmedigi icin siparis kapatildi. Dilerseniz example.com uzerinden yeniden siparis verebilirsiniz.", ct);
                    }
                }
            }

            await SendPendingRemindersAsync(root, settings, ct);
            return root;
        }
    }

    /// <summary>
    /// HAVALE HATIRLATMASI (2026-09-20).
    ///
    /// Havaleyi seçip "Gönderdim" demeyen müşteriye, ayarlanan saatten sonra BİR KEZ SMS.
    /// Tekillik <see cref="OrderEventLog.TryWriteFirstAsync"/> ile: sipariş başına tek
    /// "havale.hatirlatma" satırı yazılabiliyor, dolayısıyla ayrı bir "gönderildi mi" kolonu
    /// gerekmiyor.
    ///
    /// Yalnız "istendi" durumundakilere gider: "Gönderdim" demiş müşteriye hatırlatma
    /// göndermek, parayı gönderdiğini bilmiyormuşuz izlenimi verir.
    /// </summary>
    private async Task SendPendingRemindersAsync(JsonElement root, StorefrontSettings settings, CancellationToken ct)
    {
        var reminderHours = settings.BankTransferReminderHours;
        if (reminderHours <= 0) return;
        if (reminderHours >= settings.BankTransferTimeoutHours) return;   // sipariş önce kapanır
        if (!_sms.IsConfigured) return;

        if (!root.TryGetProperty("data", out var data) || data.ValueKind != JsonValueKind.Array) return;

        var limit = DateTime.UtcNow.AddHours(-reminderHours);

        foreach (var row in data.EnumerateArray())
        {
            var status = row.TryGetProperty("status", out var s) ? s.GetString() : null;
            if (!string.Equals(status, "BankTransferRequested", StringComparison.OrdinalIgnoreCase)) continue;

            if (!row.TryGetProperty("requestedAtUtc", out var r) || !r.TryGetDateTime(out var requestedAt)) continue;
            if (requestedAt.ToUniversalTime() > limit) continue;

            var orderNo = row.TryGetProperty("orderNo", out var o) ? o.GetString() : null;
            var customerCode = row.TryGetProperty("customerCode", out var c) ? c.GetString() : null;
            if (string.IsNullOrWhiteSpace(orderNo) || string.IsNullOrWhiteSpace(customerCode)) continue;

            var member = await _members.FindByCustomerCodeAsync(customerCode, ct);
            if (member is null) continue;

            if (!await _events.TryWriteFirstAsync("havale.hatirlatma", member.Id, orderNo, $"{reminderHours} saat", ct)) continue;

            var accounts = settings.BankTransferAccounts.Where(a => !string.IsNullOrWhiteSpace(a.Iban)).ToList();
            var amount = row.TryGetProperty("amount", out var a) && a.TryGetDecimal(out var parsed) ? parsed : 0m;
            var kalan = Math.Max(1, settings.BankTransferTimeoutHours - reminderHours);

            var text = accounts.Count > 0
                // Hatırlatmada da KISA KOD yazıyor: müşteri bu SMS'e bakarak ödeme yapıyor,
                // iki mesajda iki farklı açıklama istemek onu tereddüde düşürürdü.
                ? $"Hatirlatma: {orderNo} numarali siparisinizin havalesi bekleniyor. Tutar {amount:0.00} TL. {Ascii(accounts[0].BankName)} IBAN: {accounts[0].Iban.Replace(" ", "")}. Aciklamaya {ShortPaymentCode(orderNo)} yazin. {kalan} saat icinde bildirilmezse siparis iptal olur."
                : $"Hatirlatma: {orderNo} numarali siparisinizin havalesi bekleniyor. {kalan} saat icinde bildirilmezse siparis iptal olur.";

            await SendSmsAsync(member.Id, text, ct);
        }
    }

    /// <summary>Panel: "Ödeme alındı" — ERP'de Paid + tamamlama; burada temizlik + SMS.</summary>
    public async Task<(bool Success, string? Error)> ConfirmAsync(string orderNo, string customerCode, string? reference, CancellationToken ct)
    {
        var (ok, err, _, amount) = await CallErpAsync("/api/ecommerce/payments/bank-transfer/confirm", new { orderNo, reference }, ct);
        if (!ok) return (false, err ?? "Onay kaydedilemedi.");

        var member = await _members.FindByCustomerCodeAsync(customerCode, ct);
        if (member is not null)
        {
            if (await _orders.SettlePaidOrderAsync(member.Id, orderNo, ct))
            {
                await _events.WriteAsync(OrderEventLog.PaymentApproved, member.Id, orderNo, $"{amount:0.00} TRY (havale)", ct);
            }
            var telefon = SmsText.Ascii((await _storefront.GetAsync(ct)).PhoneNumber);
            await SendSmsAsync(member.Id, $"Odemeniz alindi, tesekkur ederiz. Siparis No: {orderNo}. Siparisiniz hazirlaniyor; teslimat icin sizi arayacagiz.{(string.IsNullOrWhiteSpace(telefon) ? "" : " Bilgi: " + telefon)}", ct);
        }
        return (true, null);
    }

    public async Task<(bool Success, string? Error)> RejectAsync(string orderNo, string customerCode, string? reason, CancellationToken ct)
    {
        var (ok, err, _, _) = await CallErpAsync("/api/ecommerce/payments/bank-transfer/reject", new { orderNo, reason }, ct);
        if (!ok) return (false, err ?? "Kayıt kapatılamadı.");

        var member = await _members.FindByCustomerCodeAsync(customerCode, ct);
        if (member is not null)
        {
            await _events.WriteOnceAsync(OrderEventLog.PaymentRejected, member.Id, orderNo, reason ?? "Havale onaylanmadı.", ct);
            var telefon = SmsText.Ascii((await _storefront.GetAsync(ct)).PhoneNumber);
            await SendSmsAsync(member.Id, $"Siparis No {orderNo} icin havale onaylanamadi. Bilgi icin bizi arayabilirsiniz{(string.IsNullOrWhiteSpace(telefon) ? "." : ": " + telefon)}", ct);
        }
        return (true, null);
    }

    private async Task<(bool Ok, string? Error, string? Status, decimal Amount)> CallErpAsync(string path, object payload, CancellationToken ct)
    {
        var response = await _erp.PostAsync(path, payload, ct);
        if (response is null) return (false, "ERP'ye ulaşılamadı.", null, 0m);
        using (response)
        {
            var body = await response.Content.ReadAsStringAsync(ct);
            try
            {
                using var doc = JsonDocument.Parse(body);
                var root = doc.RootElement;
                var data = root.TryGetProperty("data", out var d) ? d : root;
                var status = data.TryGetProperty("status", out var s) ? s.GetString() : null;
                var amount = data.TryGetProperty("amount", out var a) && a.TryGetDecimal(out var parsed) ? parsed : 0m;
                if (!response.IsSuccessStatusCode)
                {
                    var msg = root.TryGetProperty("message", out var m) ? m.GetString() : null;
                    return (false, msg, status, amount);
                }
                return (true, null, status, amount);
            }
            catch (JsonException)
            {
                return (response.IsSuccessStatusCode, response.IsSuccessStatusCode ? null : "ERP beklenmeyen cevap verdi.", null, 0m);
            }
        }
    }

    /// <summary>
    /// KISA ÖDEME KODU — sipariş numarasının son 6 hanesi (2026-09-21).
    ///
    /// Sipariş numarası 15 hane (<c>S26092103181284</c>). Müşteri bunu banka uygulamasında
    /// açıklama kutusuna ELLE yazıyor; uzun olduğu için ya yanlış yazıyor ya da hiç yazmıyor,
    /// o zaman ödeme siparişle eşleşmiyor ve bayi elle arıyor.
    ///
    /// NEDEN SON 6: numara tarih + sıra taşıyor; ayırt edici olan kısım sondaki sıra.
    /// Baştan almak bütün siparişlerde aynı çıkardı.
    ///
    /// Vitrindeki karşılığı <c>BankTransferPanel.kisaOdemeKodu</c> — ikisi AYNI kuralı
    /// uygulamak zorunda, yoksa müşterinin yazdığı kod panelde aranan kodla tutmaz.
    /// </summary>
    public static string ShortPaymentCode(string orderNo)
    {
        var temiz = (orderNo ?? string.Empty).Replace(" ", string.Empty);
        return temiz.Length <= 6 ? temiz : temiz[^6..];
    }

    private static string BuildIbanSms(string orderNo, decimal amount, BankTransferAccount acc)
        => $"Siparis No {orderNo}. Tutar {amount:0.00} TL. {Ascii(acc.BankName)} IBAN: {acc.Iban.Replace(" ", "")} ({Ascii(acc.AccountHolder)}). Aciklamaya {ShortPaymentCode(orderNo)} yazin; gonderince sitede Gonderdim tusuna basin.";

    /// <summary>Türkçe karakter GSM-7 dışına çıkarıp SMS'i iki kredi yapıyor (bkz. PaymentService).</summary>
    private static string Ascii(string s)
        => (s ?? string.Empty)
            .Replace('ç', 'c').Replace('Ç', 'C').Replace('ğ', 'g').Replace('Ğ', 'G').Replace('ı', 'i').Replace('İ', 'I')
            .Replace('ö', 'o').Replace('Ö', 'O').Replace('ş', 's').Replace('Ş', 'S').Replace('ü', 'u').Replace('Ü', 'U');

    private async Task SendSmsAsync(Guid memberId, string text, CancellationToken ct)
    {
        try
        {
            if (!_sms.IsConfigured) return;
            var member = await _members.FindByIdAsync(memberId, ct);
            if (member is null || string.IsNullOrWhiteSpace(member.Phone)) return;
            var phone = _sms.NormalizeMsisdn(member.Phone);
            if (phone.Length == 0) return;
            var result = await _sms.SendAsync(phone, text, ct);
            if (!result.Success) _logger.LogWarning("[Havale] SMS gönderilemedi: {Error}", result.ErrorCode);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "[Havale] SMS gönderiminde hata");
        }
    }
}
