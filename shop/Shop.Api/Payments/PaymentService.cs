using System.Text.Json;
using Shop.Api.Erp;
using Shop.Api.Orders;

namespace Shop.Api.Payments;

public sealed record PaymentStartResult(bool Success, string? OrderNo, string? HtmlForm, string? Error);

public sealed record PaymentStatusView(
    string OrderNo,
    bool IsPaid,
    string Status,
    decimal Amount,
    string Currency,
    string Message);

/// <summary>
/// Mağaza tarafındaki ödeme akışı.
///
/// Burada KART BİLGİSİ SAKLANMAZ ve LOG'A YAZILMAZ: kart, tarayıcıdan gelip ERP'ye geçer,
/// arada hiçbir yere düşmez. ERP internete açılmadığı için tek geçiş yolu burası.
///
/// Ödemenin doğruluğu da burada karara bağlanmıyor. "Ödeme başarılı" bilgisinin tek kaynağı
/// ERP'nin imza doğrulamasından geçmiş kaydı; mağaza onu SORAR, tarayıcının döndüğü adrese ya
/// da istemcinin iddiasına bakmaz. Bankanın müşteriyi hangi adrese yolladığı denetlenmiyor,
/// dolayısıyla o adres bir kanıt değil.
/// </summary>
public sealed class PaymentService
{
    private readonly ErpWriteClient _erp;
    private readonly OrderService _orders;
    private readonly OrderEventLog _events;
    private readonly AccountDataService _accountData;
    private readonly Shop.Api.Members.MemberStore _members;
    private readonly Shop.Api.Catalog.CatalogQueries _catalog;
    private readonly Shop.Api.Infrastructure.ShopEmailService _email;
    private readonly Shop.Api.Infrastructure.ISmsService _sms;
    private readonly Shop.Api.Storefront.StorefrontStore _storefront;
    private readonly ILogger<PaymentService> _logger;

    public PaymentService(
        ErpWriteClient erp,
        OrderService orders,
        OrderEventLog events,
        AccountDataService accountData,
        Shop.Api.Members.MemberStore members,
        Shop.Api.Catalog.CatalogQueries catalog,
        Shop.Api.Infrastructure.ShopEmailService email,
        Shop.Api.Infrastructure.ISmsService sms,
        Shop.Api.Storefront.StorefrontStore storefront,
        ILogger<PaymentService> logger)
    {
        _storefront = storefront;
        _erp = erp;
        _orders = orders;
        _events = events;
        _accountData = accountData;
        _members = members;
        _catalog = catalog;
        _email = email;
        _sms = sms;
        _logger = logger;
    }

    /// <summary>
    /// Sepeti siparişe çevirir ve o siparişin ödemesini başlatır.
    ///
    /// TUTAR GÖNDERİLMİYOR. ERP'ye yalnızca sipariş numarası ve kart gidiyor; karttan çekilecek
    /// tutar siparişin kendisinden okunuyor. Böylece "tutar sipariş tutarıyla eşleşmeli" kuralı
    /// bir karşılaştırma olmaktan çıkıp tek kaynağa dönüşüyor.
    /// </summary>
    public async Task<PaymentStartResult> StartAsync(
        Guid memberId,
        string customerCode,
        CardInput card,
        string? deliveryNote,
        CancellationToken ct)
    {
        // Sipariş ödemeden önce doğuyor ve tekrarlamaya karşı korumalı: çift tıklama ikinci
        // sipariş açmaz, var olanı döner.
        var order = await _orders.CreateFromCartAsync(memberId, customerCode, deliveryNote, ct);
        if (!order.Success || string.IsNullOrWhiteSpace(order.OrderNo))
        {
            return new PaymentStartResult(false, null, null, order.Error ?? "Sipariş oluşturulamadı.");
        }

        var payload = new
        {
            customerCode,
            orderNo = order.OrderNo,
            cardHolderName = card.CardHolderName,
            cardNumber = card.CardNumber,
            expMonth = card.ExpMonth,
            expYear = card.ExpYear,
            cvc = card.Cvc,
            installmentCount = card.InstallmentCount,
            bankCode = card.BankCode,
            email = card.Email,
            phone = card.Phone
        };

        var response = await _erp.PostAsync("/api/ecommerce/payments/start", payload, ct);
        if (response is null)
        {
            return new PaymentStartResult(false, order.OrderNo, null, "Ödeme sistemine ulaşılamadı.");
        }

        using (response)
        {
            var body = await response.Content.ReadAsStringAsync(ct);

            if (!response.IsSuccessStatusCode)
            {
                // Gövde kart bilgisi TAŞIMAZ (yalnızca sonuç metni), o yüzden log'lanabilir.
                _logger.LogWarning("Ödeme başlatılamadı: {Status} {Body}", response.StatusCode, body);

                var reason = ReadMessage(body);
                await _events.WriteAsync(OrderEventLog.PaymentStartFailed, memberId, order.OrderNo,
                    reason ?? $"ERP {(int)response.StatusCode} döndü.", ct);

                return new PaymentStartResult(false, order.OrderNo, null, reason ?? "Ödeme başlatılamadı.");
            }

            try
            {
                using var doc = JsonDocument.Parse(body);
                var data = doc.RootElement.GetProperty("data");
                var htmlForm = data.GetProperty("htmlForm").GetString();

                if (string.IsNullOrWhiteSpace(htmlForm))
                {
                    await _events.WriteAsync(OrderEventLog.PaymentStartFailed, memberId, order.OrderNo,
                        "Banka yönlendirme formu boş geldi.", ct);
                    return new PaymentStartResult(false, order.OrderNo, null, "Banka yönlendirme formu alınamadı.");
                }

                // Kartın kendisi DEĞİL, yalnızca taksit ve banka bilgisi yazılıyor: bunlar
                // müşteriye de gösterilen alanlar.
                await _events.WriteAsync(OrderEventLog.PaymentStarted, memberId, order.OrderNo,
                    card.InstallmentCount > 1 ? $"{card.InstallmentCount} taksit" : "Tek çekim", ct);

                return new PaymentStartResult(true, order.OrderNo, htmlForm, null);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Ödeme yanıtı çözümlenemedi.");
                await _events.WriteAsync(OrderEventLog.PaymentStartFailed, memberId, order.OrderNo,
                    "Banka yanıtı çözümlenemedi.", ct);
                return new PaymentStartResult(false, order.OrderNo, null, "Ödeme başlatılamadı.");
            }
        }
    }

    /// <summary>
    /// Siparişin ödeme durumu — ve ödendiyse mağaza tarafındaki temizlik.
    ///
    /// Temizlik burada yapılıyor çünkü doğrulanmış "ödendi" cevabını ilk gören yer burası.
    /// Bekleyen sipariş kaydı silinmezse müşteri ikinci siparişini VEREMEZ: aynı sepet parmak
    /// iziyle gelen istek hep ödenmiş siparişi geri döndürür.
    /// </summary>
    public async Task<PaymentStatusView?> GetStatusAsync(
        Guid memberId,
        string customerCode,
        string orderNo,
        CancellationToken ct)
    {
        var data = await _erp.GetEcommercePaymentStatusAsync(customerCode, orderNo, ct);
        if (data is null) return null;

        var root = data.Value;

        var isPaid = root.TryGetProperty("isPaid", out var paid) && paid.ValueKind == JsonValueKind.True;
        var status = root.TryGetProperty("status", out var s) ? s.GetString() ?? "Unknown" : "Unknown";
        var message = root.TryGetProperty("message", out var m) ? m.GetString() ?? string.Empty : string.Empty;
        var amount = root.TryGetProperty("amount", out var a) && a.TryGetDecimal(out var parsed) ? parsed : 0m;
        var currency = root.TryGetProperty("currencyCode", out var c) ? c.GetString() ?? "TRY" : "TRY";

        if (isPaid)
        {
            // Olay yalnızca ilk kapanışta yazılıyor: sonuç sayfası yenilendiğinde bu yol tekrar
            // çalışıyor ve denetim kaydı aynı satırla dolmamalı.
            if (await _orders.SettlePaidOrderAsync(memberId, orderNo, ct))
            {
                await _events.WriteAsync(OrderEventLog.PaymentApproved, memberId, orderNo,
                    $"{amount:0.00} {currency}", ct);

                // Sipariş onay postası YALNIZCA burada: `SettlePaidOrderAsync` true dönmesi
                // "bu sipariş ilk kez kapandı" demek. Sonuç sayfası her yenilendiğinde bu
                // metot tekrar çalışıyor, tekillik kapısı o dönüş değeri.
                await SendOrderConfirmationAsync(memberId, customerCode, orderNo, ct);
                await SendOrderConfirmationSmsAsync(memberId, orderNo, amount, ct);
            }
        }
        else if (string.Equals(status, "Failed", StringComparison.OrdinalIgnoreCase))
        {
            await _events.WriteOnceAsync(OrderEventLog.PaymentRejected, memberId, orderNo, message, ct);
        }
        else if (string.Equals(status, "NeedsReview", StringComparison.OrdinalIgnoreCase))
        {
            // Bu durum insan bakması gereken hâl (ödeme alındı ama kayıt tekilliğe takıldı).
            // Olay kaydına düşmesi şart: mutabakat raporunun ilk baktığı yer burası.
            await _events.WriteOnceAsync(OrderEventLog.PaymentNeedsReview, memberId, orderNo, message, ct);
        }

        return new PaymentStatusView(orderNo, isPaid, status, amount, currency, message);
    }

    /// <summary>
    /// Sipariş onay postası. ASLA FIRLATMAZ: postanın gitmemesi ödemeyi ya da sipariş
    /// kapanışını bozmamalı — parası çekilmiş müşteriye ekranda hata göstermek, postasız
    /// kalmasından çok daha kötüdür. Hata log'a yazılır.
    /// </summary>
    private async Task SendOrderConfirmationAsync(
        Guid memberId,
        string customerCode,
        string orderNo,
        CancellationToken ct)
    {
        try
        {
            var member = await _members.FindByIdAsync(memberId, ct);
            if (member is null || string.IsNullOrWhiteSpace(member.Email)) return;

            // Misafir oturumlarının e-postası uydurma (@guest.stilsoft); oraya posta atmak
            // her seferinde geri döner ve gönderen adresin itibarını düşürür.
            if (member.Email.EndsWith("@guest.stilsoft", StringComparison.OrdinalIgnoreCase)) return;

            var detail = await _accountData.GetOrderDetailAsync(customerCode, orderNo, ct);
            if (detail is null) return;

            var order = detail.Order;

            /*
             * MONTAJ BEDELİ SİPARİŞ SATIRINDAN OKUNAMAZ.
             *
             * Bedel, satırın birim fiyatının İÇİNE katılıyor (B2B'deki kural) — satırda ayrı
             * bir alan yok. Tutarı tekrar üretmenin tek yolu ürün kartındaki `InstallationFee`.
             *
             * ARTIK SATIRIN `Montage` DAMGASINA BAKILIYOR (2026-09-09). Önceden montaj,
             * montajlanabilir HER ürüne otomatik uygulandığı için "bedeli olan her satır
             * bedeli taşır" varsayımı doğruydu. Montaj müşterinin seçimi olunca bu varsayım
             * yanlış oldu: montaj istemeyen müşterinin postasında ödemediği bir montaj
             * bedeli yazardı.
             *
             * Bu sayı yalnızca postadaki BİLGİ NOTU için; hiçbir toplama katılmıyor.
             */
            decimal installationTotal = 0m;
            var stockCodes = order.Lines
                .Where(x => x.Montage)
                .Select(x => x.StockCode)
                .Where(x => x.Length > 0)
                .ToList();

            if (stockCodes.Count > 0)
            {
                var byCode = await _catalog.GetByStockCodesAsync(stockCodes, ct);
                foreach (var line in order.Lines)
                {
                    if (line.Montage
                        && byCode.TryGetValue(line.StockCode, out var product)
                        && product.IsInstallable
                        && product.InstallationFee is > 0)
                    {
                        installationTotal += product.InstallationFee.Value * line.Quantity;
                    }
                }
            }

            var contact = await _erp.GetCustomerContactAsync(customerCode, ct);
            var address = contact is null
                ? null
                : string.Join(", ", new[] { contact.Address, contact.District, contact.City }
                    .Where(x => !string.IsNullOrWhiteSpace(x)));

            await _email.SendOrderConfirmationEmailAsync(
                member.Email,
                string.IsNullOrWhiteSpace(member.FullName) ? "Müşterimiz" : member.FullName,
                order,
                address,
                Math.Round(installationTotal, 2, MidpointRounding.AwayFromZero));

            _logger.LogInformation("[Ecommerce] Sipariş onay postası gönderildi. OrderNo={OrderNo}", orderNo);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex,
                "[Ecommerce] Sipariş onay postası gönderilemedi. OrderNo={OrderNo}. " +
                "SİPARİŞ VE ÖDEME ETKİLENMEDİ.", orderNo);
        }
    }

    /// <summary>
    /// "Siparişiniz alındı" SMS'i — ödeme onaylandığında bir kez (2026-09-09 kullanıcı kararı).
    ///
    /// Yalnızca BU mesaj gönderiliyor; kargo aşamaları için SMS istenmedi (her mesaj kredi).
    /// Çağrıldığı yer sipariş onay postasıyla aynı: <c>SettlePaidOrderAsync</c> true dönmesi
    /// "bu sipariş ilk kez kapandı" demek, yani sonuç sayfası yenilendiğinde ikinci bir mesaj
    /// gitmiyor.
    ///
    /// TÜRKÇE KARAKTER YOK. Tek "ç/ğ/ş" mesajı GSM-7'den UCS-2'ye düşürüp sınırı 160'tan 70'e
    /// indiriyor; yani her SMS iki kredi oluyor. Doğrulama mesajlarında da aynı kural geçerli.
    ///
    /// ASLA FIRLATMAZ: SMS gitmedi diye ödeme ya da sipariş kapanışı bozulmaz.
    /// </summary>
    private async Task SendOrderConfirmationSmsAsync(
        Guid memberId,
        string orderNo,
        decimal amount,
        CancellationToken ct)
    {
        try
        {
            if (!_sms.IsConfigured) return;

            var member = await _members.FindByIdAsync(memberId, ct);
            if (member is null || string.IsNullOrWhiteSpace(member.Phone)) return;

            var phone = _sms.NormalizeMsisdn(member.Phone);
            if (phone.Length == 0)
            {
                _logger.LogInformation(
                    "[Ecommerce] Sipariş SMS'i gönderilmedi, telefon biçimi geçersiz. OrderNo={OrderNo}", orderNo);
                return;
            }

            // Mağaza numarası mesajın SONUNDA (2026-10-04 kullanıcı isteği): müşteri sorusu olunca
            // siteyi açmadan doğrudan arayabilsin.
            var telefon = SmsText.Ascii((await _storefront.GetAsync(ct)).PhoneNumber);
            var text = string.IsNullOrWhiteSpace(telefon)
                ? $"Siparisiniz alindi. Siparis No: {orderNo}. Tutar: {amount:0.00} TL. Tesekkur ederiz."
                : $"Siparisiniz alindi. Siparis No: {orderNo}. Tutar: {amount:0.00} TL. Tesekkur ederiz. Bilgi: {telefon}";

            var result = await _sms.SendAsync(phone, text, ct);

            if (result.Success)
            {
                _logger.LogInformation("[Ecommerce] Sipariş SMS'i gönderildi. OrderNo={OrderNo}", orderNo);
            }
            else
            {
                _logger.LogWarning(
                    "[Ecommerce] Sipariş SMS'i gönderilemedi. OrderNo={OrderNo} Hata={Error}",
                    orderNo, result.ErrorCode);
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex,
                "[Ecommerce] Sipariş SMS'i gönderilemedi. OrderNo={OrderNo}. SİPARİŞ VE ÖDEME ETKİLENMEDİ.",
                orderNo);
        }
    }

    /// <summary>Kartın bankası ve o sipariş tutarı için taksit seçenekleri.</summary>
    public async Task<JsonElement?> GetCardOptionsAsync(
        string customerCode,
        string orderNo,
        string bin,
        CancellationToken ct)
    {
        var path = $"/api/ecommerce/payments/card-options?bin={Uri.EscapeDataString(bin)}" +
                   $"&orderNo={Uri.EscapeDataString(orderNo)}" +
                   $"&customerCode={Uri.EscapeDataString(customerCode)}";

        var response = await _erp.GetAsync(path, ct);
        if (response is null) return null;

        using (response)
        {
            if (!response.IsSuccessStatusCode) return null;

            try
            {
                using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync(ct));
                return doc.RootElement.TryGetProperty("data", out var data) ? data.Clone() : null;
            }
            catch
            {
                return null;
            }
        }
    }

    private static string? ReadMessage(string body)
    {
        try
        {
            using var doc = JsonDocument.Parse(body);
            return doc.RootElement.TryGetProperty("message", out var m) ? m.GetString() : null;
        }
        catch
        {
            return null;
        }
    }
}

/// <summary>
/// Tarayıcıdan gelen kart bilgisi. Kaydedilmez, log'lanmaz; yalnızca ERP'ye taşınır.
/// </summary>
public sealed record CardInput(
    string CardHolderName,
    string CardNumber,
    string ExpMonth,
    string ExpYear,
    string Cvc,
    int InstallmentCount,
    int BankCode,
    string Email,
    string Phone);
