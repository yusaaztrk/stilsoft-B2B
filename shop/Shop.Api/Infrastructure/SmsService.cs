using System.Net.Http.Headers;
using System.Text;
using System.Xml.Linq;

namespace Shop.Api.Infrastructure;

/// <summary>
/// PostaGüvercini SMS ayarları (`PostaGuvercini` bölümü, <c>appsettings.Local.json</c>).
///
/// SIRLAR KODA GÖMÜLMEZ. ERP'deki WhatsApp erişim anahtarı kaynak koda <c>const</c> olarak
/// yazılmıştı ve kodun kendi yorumu "depoda göründüğü için yanmış sayılmalı" diyor. Aynı
/// hatayı tekrarlamıyoruz: kullanıcı adı/şifre yalnızca git dışındaki yerel ayar dosyasında.
/// </summary>
public sealed class SmsOptions
{
    /// <summary>
    /// SMS özellikleri açık mı. Kullanıcı adı ya da şifre boşsa <b>zaten kapalıdır</b> —
    /// bu bayrak, kredentials dolu olsa bile geçici olarak kapatabilmek için.
    /// </summary>
    public bool Enabled { get; set; } = true;

    public string Username { get; set; } = string.Empty;
    public string Password { get; set; } = string.Empty;

    /// <summary>
    /// Servis adresi. <b>Varsayılan HTTPS</b> — dokümandaki adres <c>http://</c> ile yazılı ve
    /// kullanıcı adı+şifre her istekte gövdede gidiyor; düz metin taşımak kabul edilemez.
    /// HTTPS canlıda denendi ve geçerli sertifikayla 200 dönüyor (2026-09-09).
    /// </summary>
    public string Endpoint { get; set; } = "https://www.postaguvercini.com/api_ws/smsservice.asmx";

    /// <summary>
    /// Operatöre gidecek numara biçimi. <b>Dokümanda YAZMIYOR</b>, bu yüzden ayarlanabilir:
    /// yanlış biçim seçilirse SMS sessizce ulaşmaz ve bunu yeniden derlemeden düzeltebilmek
    /// gerekiyor.
    ///
    /// <list type="bullet">
    /// <item><c>National</c> (varsayılan): <c>5330001234</c> — 10 hane, baştaki sıfır yok.</item>
    /// <item><c>CountryCode</c>: <c>905330001234</c></item>
    /// <item><c>Plus</c>: <c>+905330001234</c></item>
    /// <item><c>Raw</c>: yalnız rakamlar, dokunulmaz.</item>
    /// </list>
    /// </summary>
    public string MsisdnFormat { get; set; } = "National";

    /// <summary>Ülke kodu (KKTC cep hatları Türk operatörlerinde, +90).</summary>
    public string CountryCode { get; set; } = "90";

    public int TimeoutSeconds { get; set; } = 15;
}

/// <summary>
/// Gönderim türü (2026-10-11, TMessage): doğrulama kodları ayrı OTP ucundan ve ayrı bakiyeden gider.
/// Sağlayıcı ayırmıyorsa (PostaGüvercini) yok sayılır.
/// </summary>
public enum SmsKind
{
    /// <summary>Bilgilendirme / sipariş / kampanya — varsayılan.</summary>
    Bulk,
    /// <summary>Tek kullanımlık doğrulama kodu (üyelik, şifre sıfırlama).</summary>
    Otp
}

public sealed record SmsSendResult(bool Success, string? MessageId, string? ErrorCode)
{
    public static SmsSendResult Fail(string code) => new(false, null, code);
}

/// <summary>Başarısız bir gönderim kaydı — panelde teşhis için tutuluyor.</summary>
public sealed record SmsFailure(DateTime AtUtc, string MaskedPhone, string ErrorCode);

public interface ISmsService
{
    /// <summary>Kredentials var mı ve özellik açık mı. Kapalıysa SMS uçları kapalı davranır.</summary>
    bool IsConfigured { get; }

    /// <summary>
    /// SON BAŞARISIZ GÖNDERİMLER (2026-09-21).
    ///
    /// NEDEN VAR: "SMS gitmiyor" şikayeti geldiğinde sağlayıcının verdiği gerçek hata kodu
    /// yalnızca sunucu günlüğünde kalıyordu; panelden bakan kişi "gönderilemedi" dışında bir
    /// şey göremiyor ve sorunun kredi mi, şifre mi, numara biçimi mi olduğunu bilemiyordu.
    /// Kod (ör. <c>ERR01</c>) doğrudan sağlayıcının belgesindeki nedeni gösteriyor.
    ///
    /// Bellekte, sınırlı sayıda ve numaranın yalnız maskeli hâliyle tutuluyor; hiçbir yere
    /// yazılmıyor, süreç yeniden başlayınca sıfırlanıyor.
    /// </summary>
    IReadOnlyList<SmsFailure> RecentFailures { get; }

    Task<SmsSendResult> SendAsync(string phone, string message, CancellationToken ct = default, SmsKind kind = SmsKind.Bulk);

    /// <summary>Kalan kredi (toplu SMS). Hata durumunda <c>null</c>.</summary>
    Task<int?> GetCreditAsync(CancellationToken ct = default);

    /// <summary>OTP (doğrulama kodu) bakiyesi — ayrı bakiye tutan sağlayıcıda (TMessage). Yoksa <c>null</c>.</summary>
    Task<int?> GetOtpCreditAsync(CancellationToken ct = default) => Task.FromResult<int?>(null);

    /// <summary>Alıcının göreceği gönderici adı (alfanumerik başlık). Hata durumunda <c>null</c>.</summary>
    Task<string?> GetSenderNameAsync(CancellationToken ct = default);

    /// <summary>Numarayı operatörün beklediği biçime çevirir. Geçersizse boş döner.</summary>
    string NormalizeMsisdn(string phone);
}

/// <summary>
/// PostaGüvercini SOAP istemcisi.
///
/// NEDEN ELLE YAZILMIŞ SOAP: servis bir <c>.asmx</c> (SOAP 1.1). Üretilmiş bir WCF istemcisi
/// <c>System.ServiceModel.*</c> paketlerini ve bir bağlantı/zaman aşımı yapılandırma katmanını
/// beraberinde getirirdi. Yedi metottan yalnız <b>üçünü</b> kullanıyoruz; zarfı elle kurmak hem
/// bağımlılık eklemiyor hem zaman aşımı/günlük davranışını tamamen bize bırakıyor.
///
/// WSDL'den doğrulanan incelikler (2026-09-09, canlı):
/// <list type="bullet">
/// <item>Ad alanı <c>http://83.66.137.24/PgApiWs</c>, SOAPAction = ad alanı + "/" + metot.</item>
/// <item><c>SendDate</c>/<c>ExpireDate</c> <c>minOccurs="1" nillable="true"</c> — yani
///       <b>elemanlar bulunmak zorunda</b>, "hemen gönder" demek için <c>xsi:nil="true"</c>
///       ile yazılırlar. Elemanı hiç koymamak isteği geçersiz kılar.</item>
/// <item>Dizi tipi <c>ArrayOfString</c>, iç eleman adı <c>string</c>.</item>
/// <item>Sonuç dizisi ya mesaj kimliği ya <c>ERRxxxx</c> hata kodu taşır (dokümanda EK A).</item>
/// </list>
/// </summary>
public sealed class SmsService : ISmsService
{
    private const string Ns = "http://83.66.137.24/PgApiWs";

    private readonly HttpClient _http;
    private readonly SmsOptions _options;
    private readonly ILogger<SmsService> _logger;

    public SmsService(HttpClient http, IConfiguration configuration, ILogger<SmsService> logger)
    {
        _http = http;
        _logger = logger;

        _options = new SmsOptions();
        configuration.GetSection("PostaGuvercini").Bind(_options);

        var timeout = TimeSpan.FromSeconds(_options.TimeoutSeconds > 0 ? _options.TimeoutSeconds : 15);
        if (_http.Timeout != timeout) _http.Timeout = timeout;
    }

    public bool IsConfigured =>
        _options.Enabled
        && !string.IsNullOrWhiteSpace(_options.Username)
        && !string.IsNullOrWhiteSpace(_options.Password);

    // ------------------------------------------------------- son hatalar (teşhis)

    /// <summary>Panelde gösterilen en fazla hata sayısı. Bellekte, sürece bağlı.</summary>
    private const int MaxFailuresKept = 20;

    private static readonly object _failureLock = new();
    private static readonly List<SmsFailure> _failures = new();

    public IReadOnlyList<SmsFailure> RecentFailures
    {
        get { lock (_failureLock) return _failures.ToArray(); }
    }

    /// <summary>
    /// Hata kaydı. Numara MASKELENİYOR: panelde hangi numaraya gidemediğini ayırt etmeye
    /// yetecek kadar (son 4 hane) bilgi kalıyor, tam numara bellekte tutulmuyor.
    /// </summary>
    private static void KaydetHata(string msisdn, string errorCode)
    {
        var maske = msisdn.Length <= 4 ? new string('•', msisdn.Length) : new string('•', msisdn.Length - 4) + msisdn[^4..];

        lock (_failureLock)
        {
            _failures.Insert(0, new SmsFailure(DateTime.UtcNow, maske, errorCode));
            if (_failures.Count > MaxFailuresKept) _failures.RemoveRange(MaxFailuresKept, _failures.Count - MaxFailuresKept);
        }
    }

    // ------------------------------------------------------------------ numara

    /// <summary>
    /// Numarayı ayarlanan biçime çevirir.
    ///
    /// Girdi çok biçimli geliyor: <c>0533 000 12 34</c>, <c>+90 533…</c>, <c>0090533…</c>.
    /// Önce yalnız rakamlar alınır, uluslararası önek (<c>00</c>) ve ülke kodu soyulup
    /// <b>tek bir kanonik hâle</b> (baştaki sıfırsız ulusal numara) indirilir; çıktı biçimi
    /// ondan sonra kurulur. Böylece hangi biçimde yazılırsa yazılsın aynı numara üretilir.
    /// </summary>
    public string NormalizeMsisdn(string phone)
    {
        var digits = new string((phone ?? string.Empty).Where(char.IsDigit).ToArray());
        if (digits.Length == 0) return string.Empty;

        if (_options.MsisdnFormat.Equals("Raw", StringComparison.OrdinalIgnoreCase))
        {
            return digits;
        }

        var cc = (_options.CountryCode ?? "90").Trim();

        // Uluslararası arama öneki
        if (digits.StartsWith("00", StringComparison.Ordinal)) digits = digits[2..];

        // Ülke kodu — yalnız arkasından makul uzunlukta bir numara kalıyorsa soyulur.
        // Koşulsuz soymak "90…" ile başlayan yerel numaraları bozardı.
        if (cc.Length > 0 && digits.StartsWith(cc, StringComparison.Ordinal) && digits.Length - cc.Length >= 9)
        {
            digits = digits[cc.Length..];
        }

        digits = digits.TrimStart('0');

        // KKTC/Türk cep hattı: 10 hane ve 5 ile başlar. Tutmuyorsa geçersiz sayılır —
        // operatöre uydurma numara göndermek krediyi harcar ve sessizce başarısız olur.
        if (digits.Length != 10 || !digits.StartsWith('5')) return string.Empty;

        return _options.MsisdnFormat.ToLowerInvariant() switch
        {
            "countrycode" => cc + digits,
            "plus" => "+" + cc + digits,
            _ => digits,
        };
    }

    // ------------------------------------------------------------------ gönderim

    public async Task<SmsSendResult> SendAsync(string phone, string message, CancellationToken ct = default, SmsKind kind = SmsKind.Bulk)
    {
        if (!IsConfigured) return SmsSendResult.Fail("SMS_DISABLED");

        var msisdn = NormalizeMsisdn(phone);
        if (msisdn.Length == 0) return SmsSendResult.Fail("INVALID_PHONE");
        if (string.IsNullOrWhiteSpace(message)) return SmsSendResult.Fail("EMPTY_MESSAGE");

        var body =
            $"""
             <SmsInsert_1_N xmlns="{Ns}">
               <Username>{Esc(_options.Username)}</Username>
               <Password>{Esc(_options.Password)}</Password>
               <SendDate xsi:nil="true" />
               <ExpireDate xsi:nil="true" />
               <Recepients><string>{Esc(msisdn)}</string></Recepients>
               <Message>{Esc(message)}</Message>
             </SmsInsert_1_N>
             """;

        var doc = await CallAsync("SmsInsert_1_N", body, ct);
        if (doc is null)
        {
            // Ağ/zaman aşımı: sağlayıcıya hiç ulaşılamadı. Kredi ya da şifre sorunundan
            // AYRI bir neden; panelde ayırt edilebilmesi için ayrıca kaydediliyor.
            KaydetHata(msisdn, "TRANSPORT");
            return SmsSendResult.Fail("TRANSPORT");
        }

        var results = doc.Descendants(XName.Get("string", Ns)).Select(x => x.Value.Trim()).ToList();
        var first = results.FirstOrDefault() ?? string.Empty;

        // Hata kodları ERR ile başlıyor (dokümanda EK A). Geri kalanı mesaj kimliğidir.
        if (first.Length == 0 || first.StartsWith("ERR", StringComparison.OrdinalIgnoreCase))
        {
            // NUMARA GÜNLÜĞE YAZILIR, KREDENTIALS YAZILMAZ. İlk gerçek gönderimde biçimin
            // (`MsisdnFormat`) doğru olup olmadığı ancak böyle anlaşılır.
            _logger.LogWarning(
                "SMS gönderilemedi. Numara: {Msisdn}, sonuç: {Result}",
                msisdn,
                first.Length == 0 ? "(boş yanıt)" : first);

            var kod = first.Length == 0 ? "EMPTY_RESULT" : first;
            KaydetHata(msisdn, kod);
            return SmsSendResult.Fail(kod);
        }

        return new SmsSendResult(true, first, null);
    }

    public async Task<int?> GetCreditAsync(CancellationToken ct = default)
    {
        if (!IsConfigured) return null;

        var doc = await CallAsync("CreditBalance", Credentials("CreditBalance"), ct);
        var value = doc?.Descendants(XName.Get("CreditBalanceResult", Ns)).FirstOrDefault()?.Value;

        return int.TryParse(value, out var credit) ? credit : null;
    }

    public async Task<string?> GetSenderNameAsync(CancellationToken ct = default)
    {
        if (!IsConfigured) return null;

        var doc = await CallAsync("IdCheck", Credentials("IdCheck"), ct);
        var value = doc?.Descendants(XName.Get("IdCheckResult", Ns)).FirstOrDefault()?.Value?.Trim();

        return string.IsNullOrWhiteSpace(value) ? null : value;
    }

    // ------------------------------------------------------------------ taşıma

    private string Credentials(string method) =>
        $"""
         <{method} xmlns="{Ns}">
           <Username>{Esc(_options.Username)}</Username>
           <Password>{Esc(_options.Password)}</Password>
         </{method}>
         """;

    private async Task<XDocument?> CallAsync(string method, string bodyXml, CancellationToken ct)
    {
        var envelope =
            $"""
             <?xml version="1.0" encoding="utf-8"?>
             <soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
               <soap:Body>
             {bodyXml}
               </soap:Body>
             </soap:Envelope>
             """;

        try
        {
            using var request = new HttpRequestMessage(HttpMethod.Post, _options.Endpoint)
            {
                Content = new StringContent(envelope, Encoding.UTF8)
            };
            request.Content.Headers.ContentType = new MediaTypeHeaderValue("text/xml") { CharSet = "utf-8" };
            request.Headers.Add("SOAPAction", $"\"{Ns}/{method}\"");

            using var response = await _http.SendAsync(request, ct);
            var text = await response.Content.ReadAsStringAsync(ct);

            if (!response.IsSuccessStatusCode)
            {
                /*
                  SOAP HATASI 500 İLE GELİR — canlıda doğrulandı (2026-09-09): hatalı
                  kredentialsla çağrı yapıldığında servis

                      HTTP 500 + <faultstring>HATA: Giriş bilgileri hatalı!</faultstring>

                  döndürüyor. Ham gövdeyi günlüğe basmak bu mesajı 500 karakterlik bir XML
                  yığınının içine gömerdi; ayarları ilk kez girerken asıl okunacak satır bu.
                  `faultstring` çekilebiliyorsa yalnız o yazılır.
                */
                var fault = TryReadFaultString(text);

                _logger.LogWarning(
                    "PostaGüvercini {Method} HTTP {Status}. {Detail}",
                    method,
                    (int)response.StatusCode,
                    fault is not null
                        ? $"Servis mesajı: {fault}"
                        : $"Yanıt: {(text.Length > 500 ? text[..500] : text)}");

                return null;
            }

            return XDocument.Parse(text);
        }
        catch (TaskCanceledException) when (!ct.IsCancellationRequested)
        {
            _logger.LogWarning("PostaGüvercini {Method} zaman aşımına uğradı.", method);
            return null;
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "PostaGüvercini {Method} çağrısında hata.", method);
            return null;
        }
    }

    /// <summary>
    /// SOAP Fault gövdesinden <c>faultstring</c>'i çeker. Ayrıştırılamazsa <c>null</c>.
    /// Ad alanından bağımsız aranıyor: SOAP 1.1 ve 1.2 zarflarında farklı ad alanları var.
    /// </summary>
    private static string? TryReadFaultString(string body)
    {
        try
        {
            var value = XDocument.Parse(body)
                .Descendants()
                .FirstOrDefault(x => x.Name.LocalName is "faultstring" or "Text")
                ?.Value
                ?.Trim();

            return string.IsNullOrWhiteSpace(value) ? null : value;
        }
        catch
        {
            return null;
        }
    }

    /// <summary>
    /// XML kaçışı. Şifrede <c>&amp;</c> ya da <c>&lt;</c> geçerse zarf bozulur ve istek
    /// sessizce başarısız olurdu; mesaj metni de müşteri adı taşıyabiliyor.
    /// </summary>
    private static string Esc(string value) =>
        System.Security.SecurityElement.Escape(value ?? string.Empty) ?? string.Empty;
}
