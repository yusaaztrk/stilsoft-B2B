using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Options;

namespace Shop.Api.Infrastructure;

/// <summary>
/// WHATSAPP DOĞRULAMA KODU (2026-10-12, kullanıcı kararı "A": kod SMS ile AYNI ANDA WhatsApp'tan da gider).
///
/// Meta WhatsApp Cloud API'de müşteriye ilk mesajı biz attığımız için yalnız ONAYLI ŞABLON gider; doğrulama
/// kodu için Meta'nın "Kimlik doğrulama (Authentication)" türü kullanılır. Metni Meta sabitler
/// ("{{1}} doğrulama kodunuzdur…"), "Kodu kopyala" düğmesi de kodu ister — iki yere aynı kod konur.
///
/// Hat, asistanın hattıdır (+90 533 000 00 02): `PhoneNumberId` ve `AccessToken` asistanın sunucudaki
/// `appsettings.Local.json` → `WhatsApp` bölümündeki değerlerle AYNI. Bölüm boşsa sınıf KAPALI sayılır,
/// SMS tek başına eskisi gibi çalışır. Bir hata SMS'i ASLA etkilemez (çağıran ikisini ayrı değerlendirir).
/// </summary>
public sealed class WhatsAppOtpOptions
{
    public bool Enabled { get; set; } = true;
    /// <summary>Meta → WhatsApp → API Setup → "Phone number ID" (numaranın kendisi değil).</summary>
    public string PhoneNumberId { get; set; } = string.Empty;
    /// <summary>System User kalıcı token'ı — GİZLİ, yalnız sunucudaki dosyada.</summary>
    public string AccessToken { get; set; } = string.Empty;
    /// <summary>WhatsApp Yöneticisi'nde onaylanan Authentication şablonunun adı.</summary>
    public string TemplateName { get; set; } = "dogrulama_kodu";
    public string LanguageCode { get; set; } = "tr";
    /// <summary>Şablonda "Kodu kopyala" düğmesi varsa true; düğmesiz şablonda false olmalı (Meta parametreyi reddeder).</summary>
    public bool CopyCodeButton { get; set; } = true;
    public string GraphApiVersion { get; set; } = "v23.0";
    /// <summary>Yalnız lokal deneme için değişir (sahte Meta sunucusu); canlıda boş bırakılır.</summary>
    public string GraphBaseUrl { get; set; } = "https://graph.facebook.com";
    public int TimeoutSeconds { get; set; } = 10;
}

public sealed class WhatsAppOtpSender
{
    private readonly HttpClient _http;
    private readonly WhatsAppOtpOptions _options;
    private readonly ILogger<WhatsAppOtpSender> _logger;

    public WhatsAppOtpSender(HttpClient http, IOptions<WhatsAppOtpOptions> options, ILogger<WhatsAppOtpSender> logger)
    {
        _http = http;
        _options = options.Value;
        _logger = logger;
        _http.Timeout = TimeSpan.FromSeconds(Math.Clamp(_options.TimeoutSeconds, 3, 30));
    }

    public bool IsConfigured =>
        _options.Enabled
        && !string.IsNullOrWhiteSpace(_options.PhoneNumberId)
        && !string.IsNullOrWhiteSpace(_options.AccessToken)
        && !string.IsNullOrWhiteSpace(_options.TemplateName);

    /// <summary>
    /// KKTC/TR cep numarası (5XXXXXXXXX ya da 90/0 önekli) → WhatsApp biçimi 905XXXXXXXXX. Başka biçim boş döner.
    /// </summary>
    public static string ToWaId(string phone)
    {
        var d = new string((phone ?? string.Empty).Where(char.IsDigit).ToArray());
        if (d.StartsWith("00")) d = d[2..];
        if (d.StartsWith("90") && d.Length == 12) d = d[2..];
        d = d.TrimStart('0');
        return d.Length == 10 && d[0] == '5' ? "90" + d : string.Empty;
    }

    /// <summary>Kodu şablonla gönderir. Sonuç kodu günlük/teşhis içindir: WA_OK, WA_DISABLED, WA_PHONE, WA_HTTP_xxx: …, WA_TRANSPORT.</summary>
    public async Task<(bool Ok, string Result)> SendCodeAsync(string phone, string code, CancellationToken ct)
    {
        if (!IsConfigured) return (false, "WA_DISABLED");
        var to = ToWaId(phone);
        if (to.Length == 0) return (false, "WA_PHONE");

        var components = new List<object>
        {
            new { type = "body", parameters = new object[] { new { type = "text", text = code } } }
        };
        if (_options.CopyCodeButton)
        {
            components.Add(new
            {
                type = "button",
                sub_type = "url",
                index = "0",
                parameters = new object[] { new { type = "text", text = code } }
            });
        }

        var payload = new
        {
            messaging_product = "whatsapp",
            recipient_type = "individual",
            to,
            type = "template",
            template = new
            {
                name = _options.TemplateName,
                language = new { code = _options.LanguageCode },
                components
            }
        };

        using var req = new HttpRequestMessage(HttpMethod.Post,
            $"{_options.GraphBaseUrl.TrimEnd('/')}/{_options.GraphApiVersion}/{_options.PhoneNumberId}/messages")
        {
            Content = new StringContent(JsonSerializer.Serialize(payload), Encoding.UTF8, "application/json")
        };
        req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", _options.AccessToken);

        try
        {
            using var res = await _http.SendAsync(req, ct);
            var text = await res.Content.ReadAsStringAsync(ct);
            if (res.IsSuccessStatusCode) return (true, "WA_OK");

            // Meta hata gövdesi: {"error":{"message":"…","code":131026,…}} — token/numara içermez.
            var detail = text.Length > 300 ? text[..300] : text;
            _logger.LogWarning("WhatsApp doğrulama kodu gönderilemedi. HTTP {Status}: {Body}", (int)res.StatusCode, detail);
            return (false, $"WA_HTTP_{(int)res.StatusCode}");
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException)
        {
            _logger.LogWarning(ex, "WhatsApp doğrulama kodu gönderilemedi: Meta'ya ulaşılamadı.");
            return (false, "WA_TRANSPORT");
        }
    }
}
