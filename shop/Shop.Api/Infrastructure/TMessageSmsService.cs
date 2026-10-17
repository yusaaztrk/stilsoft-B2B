using System.Net;
using System.Net.Http.Headers;
using System.Text.Json;

namespace Shop.Api.Infrastructure;

/// <summary>
/// KKTCELL TMessage ayarları (<c>TMessage</c> bölümü, <c>appsettings.Local.json</c>). 2026-10-11:
/// mağaza SMS'i PostaGüvercini'den TMessage'a taşındı. Kullanıcı adı/şifre TMessage panelinde
/// "API Entegrasyonu → Yeni API Kullanıcısı Oluştur" ile üretilir; koda gömülmez.
///
/// ÖNKOŞUL: KKTCELL'e sunucunun ÇIKIŞ IP'si bildirilmeli — bildirilmeyen IP'den gelen istek reddedilir.
/// </summary>
public sealed class TMessageOptions
{
    /// <summary>Kredentials doluyken bile geçici kapatmak için.</summary>
    public bool Enabled { get; set; } = true;

    public string BaseUrl { get; set; } = "https://tmessagecompanyapi.kktcell.com";

    /// <summary>API kullanıcı adı (dokümanda "ApiUN").</summary>
    public string ApiUN { get; set; } = string.Empty;

    /// <summary>API şifresi (dokümanda "ApiPP").</summary>
    public string ApiPP { get; set; } = string.Empty;

    /// <summary>KKTCELL'in verdiği gönderici adı (alıcının telefonunda görünen başlık).</summary>
    public string SenderName { get; set; } = string.Empty;

    /// <summary>Doğrulama kodlarının "kampanya adı" (TMessage raporlarında bu adla görünür).</summary>
    public string OtpMessageName { get; set; } = "Dogrulama";

    /// <summary>Diğer bütün mesajların (sipariş, havale, stok, sepet, kampanya) "kampanya adı".</summary>
    public string BulkMessageName { get; set; } = "Bilgilendirme";

    public int TimeoutSeconds { get; set; } = 15;
}

/// <summary>
/// KKTCELL TMessage REST istemcisi (2026-10-11, dokümanı: "TMessage API Entegrasyon").
///
/// Akış: <c>POST /api/register</c> (ApiUN/ApiPP) → 5 dakika geçerli AccessToken → sonraki her istekte
/// <c>Authorization: Bearer</c>. Token süreç içinde PAYLAŞILIR (statik) ve süresi bitmeden 30 sn önce
/// yenilenir; her SMS'te yeniden "register" yapmak hem yavaş hem servise gereksiz yük.
///
/// İki ayrı gönderim ve iki ayrı bakiye var:
///  - OTP  <c>/api/otpmessage/send</c> (tek numara) — yalnız doğrulama kodları (<see cref="SmsKind.Otp"/>).
///  - Toplu <c>/api/message/send</c> (NumberList) — diğer her şey.
/// Numara biçimi dokümanda net: <c>5XXXXXXXXX</c> (10 hane, başında 0 ve ülke kodu yok).
///
/// Her cevap aynı zarfta: <c>{ ResultBool, ResultInt, ResultText, Object, Objects }</c>;
/// ResultInt 1 = başarılı, register'da 6 = kullanıcı adı/şifre hatalı.
/// </summary>
public sealed class TMessageSmsService : ISmsService
{
    /// <summary>Alan adları dokümandaki gibi (SenderName, ApiUN…) — Web varsayılanı camelCase'e çevirirdi.</summary>
    private static readonly JsonSerializerOptions JsonOpts = new() { PropertyNamingPolicy = null };

    /// <summary>
    /// Gövde TEK PARÇA ve Content-Length'li gider. JsonContent/PostAsJsonAsync gövdeyi uzunluk vermeden
    /// "chunked" akıtıyor; lokal denemede karşı taraf gövdeyi BOŞ okudu (2026-10-11). Uzunluklu gövde her
    /// sunucuda güvenli.
    /// </summary>
    private static StringContent Json(object body) =>
        new(JsonSerializer.Serialize(body, JsonOpts), System.Text.Encoding.UTF8, "application/json");

    private readonly HttpClient _http;
    private readonly TMessageOptions _options;
    private readonly ILogger<TMessageSmsService> _logger;

    // Token süreç geneli: servis "typed client" olarak geçici (transient) üretiliyor.
    private static readonly SemaphoreSlim TokenGate = new(1, 1);
    private static string? _token;
    private static DateTimeOffset _tokenValidUntil;

    public TMessageSmsService(HttpClient http, IConfiguration configuration, ILogger<TMessageSmsService> logger)
    {
        _http = http;
        _logger = logger;
        _options = new TMessageOptions();
        configuration.GetSection("TMessage").Bind(_options);

        var timeout = TimeSpan.FromSeconds(_options.TimeoutSeconds > 0 ? _options.TimeoutSeconds : 15);
        if (_http.Timeout != timeout) _http.Timeout = timeout;
    }

    /// <summary>TMessage kullanıcı adı girilmiş mi — Program.cs sağlayıcıyı buna göre seçer.</summary>
    public static bool HasCredentials(IConfiguration configuration) =>
        !string.IsNullOrWhiteSpace(configuration["TMessage:ApiUN"]) && !string.IsNullOrWhiteSpace(configuration["TMessage:ApiPP"]);

    public bool IsConfigured =>
        _options.Enabled
        && !string.IsNullOrWhiteSpace(_options.ApiUN)
        && !string.IsNullOrWhiteSpace(_options.ApiPP)
        && !string.IsNullOrWhiteSpace(_options.SenderName);

    // ------------------------------------------------------- son hatalar (teşhis, panelde)

    private const int MaxFailuresKept = 20;
    private static readonly object FailureLock = new();
    private static readonly List<SmsFailure> Failures = new();

    public IReadOnlyList<SmsFailure> RecentFailures
    {
        get { lock (FailureLock) return Failures.ToArray(); }
    }

    private static void KaydetHata(string msisdn, string errorCode)
    {
        var maske = msisdn.Length <= 4 ? new string('•', msisdn.Length) : new string('•', msisdn.Length - 4) + msisdn[^4..];
        lock (FailureLock)
        {
            Failures.Insert(0, new SmsFailure(DateTime.UtcNow, maske, errorCode));
            if (Failures.Count > MaxFailuresKept) Failures.RemoveRange(MaxFailuresKept, Failures.Count - MaxFailuresKept);
        }
    }

    // ------------------------------------------------------------------ numara

    /// <summary>
    /// <c>5XXXXXXXXX</c> biçimi (dokümandaki tek biçim). Girdi <c>0533…</c>, <c>+90 533…</c>,
    /// <c>0090533…</c> olabilir; hepsi aynı 10 haneye iner. Cep hattı değilse boş döner — uydurma
    /// numaraya göndermek krediyi harcar ve sessizce başarısız olur.
    /// </summary>
    public string NormalizeMsisdn(string phone)
    {
        var digits = new string((phone ?? string.Empty).Where(char.IsDigit).ToArray());
        if (digits.StartsWith("00", StringComparison.Ordinal)) digits = digits[2..];
        if (digits.StartsWith("90", StringComparison.Ordinal) && digits.Length >= 11) digits = digits[2..];
        digits = digits.TrimStart('0');
        return digits.Length == 10 && digits[0] == '5' ? digits : string.Empty;
    }

    // ------------------------------------------------------------------ gönderim

    public async Task<SmsSendResult> SendAsync(string phone, string message, CancellationToken ct = default, SmsKind kind = SmsKind.Bulk)
    {
        if (!IsConfigured) return SmsSendResult.Fail("SMS_DISABLED");

        var msisdn = NormalizeMsisdn(phone);
        if (msisdn.Length == 0) return SmsSendResult.Fail("INVALID_PHONE");
        if (string.IsNullOrWhiteSpace(message)) return SmsSendResult.Fail("EMPTY_MESSAGE");

        object body = kind == SmsKind.Otp
            ? new { SenderName = _options.SenderName, MessageName = _options.OtpMessageName, MessageContent = message, Number = msisdn }
            : new { SenderName = _options.SenderName, MessageName = _options.BulkMessageName, MessageContent = message, NumberList = new[] { msisdn } };
        var path = kind == SmsKind.Otp ? "/api/otpmessage/send" : "/api/message/send";

        var (ok, code) = await CallAsync(HttpMethod.Post, path, body, ct);

        /*
          OTP REDDEDİLİRSE TOPLU SMS'TEN GÖNDER (2026-10-12, canlı olay).
          Hesapta OTP bakiyesi 0, toplu SMS bakiyesi ~10.000'di: doğrulama kodları OTP ucunda reddedildi,
          müşteri "Doğrulama kodu gönderilemedi" gördü. KKTCELL'in iki ayrı paketi var; OTP paketi yokken
          ya da bitince kod toplu bakiyeden gider. Bağlantı/giriş hatasında (TRANSPORT, AUTH) denenmez —
          o hata toplu uçta da aynıdır. OTP paketi yüklenince kendiliğinden yine OTP ucu kullanılır.
        */
        if (!ok && kind == SmsKind.Otp && code != "TRANSPORT" && !code.StartsWith("AUTH", StringComparison.Ordinal))
        {
            _logger.LogWarning("TMessage OTP gönderimi reddedildi ({Result}); kod toplu SMS bakiyesinden gönderiliyor. Numara: {Msisdn}", code, msisdn);
            var bulkBody = new { SenderName = _options.SenderName, MessageName = _options.OtpMessageName, MessageContent = message, NumberList = new[] { msisdn } };
            (ok, code) = await CallAsync(HttpMethod.Post, "/api/message/send", bulkBody, ct);
        }

        if (!ok)
        {
            // NUMARA GÜNLÜĞE YAZILIR (biçim sorunu ancak böyle görülür), KREDENTIALS YAZILMAZ.
            _logger.LogWarning("TMessage SMS gönderilemedi ({Kind}). Numara: {Msisdn}, sonuç: {Result}", kind, msisdn, code);
            KaydetHata(msisdn, code);
            return SmsSendResult.Fail(code);
        }
        // TMessage mesaj kimliği döndürmüyor.
        return new SmsSendResult(true, null, null);
    }

    /// <summary>Toplu SMS bakiyesi (kalan mesaj adedi).</summary>
    public Task<int?> GetCreditAsync(CancellationToken ct = default) => BalanceAsync("/api/balance/bulksms", ct);

    /// <summary>OTP SMS bakiyesi — doğrulama kodları bundan düşer.</summary>
    public Task<int?> GetOtpCreditAsync(CancellationToken ct = default) => BalanceAsync("/api/balance/otpsms", ct);

    /// <summary>TMessage'ta gönderici adını soran uç yok; ayardaki ad gösterilir.</summary>
    public Task<string?> GetSenderNameAsync(CancellationToken ct = default) =>
        Task.FromResult(string.IsNullOrWhiteSpace(_options.SenderName) ? null : _options.SenderName);

    private async Task<int?> BalanceAsync(string path, CancellationToken ct)
    {
        if (!IsConfigured) return null;
        var (ok, _, obj) = await CallWithObjectAsync(HttpMethod.Get, path, null, ct);
        if (!ok || obj is not { ValueKind: JsonValueKind.Object } o) return null;
        return o.TryGetProperty("TotalMessageCount", out var n) && n.TryGetInt32(out var v) ? v : null;
    }

    // ------------------------------------------------------------------ taşıma

    private async Task<(bool Ok, string Code)> CallAsync(HttpMethod method, string path, object? body, CancellationToken ct)
    {
        var (ok, code, _) = await CallWithObjectAsync(method, path, body, ct);
        return (ok, code);
    }

    /// <summary>
    /// Token'lı çağrı. 401 gelirse token bir kez yenilenip tekrar denenir (5 dk dolmuş ya da servis
    /// tarafında düşmüş olabilir). Hata kodları panelde okunacak biçimde: <c>TMSG_HTTP_403</c>,
    /// <c>TMSG_6: ...</c>, <c>TRANSPORT</c>, <c>AUTH: ...</c>.
    /// </summary>
    private async Task<(bool Ok, string Code, JsonElement? Object)> CallWithObjectAsync(HttpMethod method, string path, object? body, CancellationToken ct)
    {
        for (var attempt = 1; attempt <= 2; attempt++)
        {
            var token = await GetTokenAsync(forceRefresh: attempt == 2, ct);
            if (token.Error is not null) return (false, token.Error, null);

            try
            {
                using var req = new HttpRequestMessage(method, _options.BaseUrl.TrimEnd('/') + path);
                req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token.Value);
                if (body is not null) req.Content = Json(body);

                using var res = await _http.SendAsync(req, ct);
                if (res.StatusCode == HttpStatusCode.Unauthorized && attempt == 1) continue;

                var text = await res.Content.ReadAsStringAsync(ct);
                if (!res.IsSuccessStatusCode)
                {
                    _logger.LogWarning("TMessage {Path} HTTP {Status}: {Body}", path, (int)res.StatusCode, text.Length > 300 ? text[..300] : text);
                    return (false, $"TMSG_HTTP_{(int)res.StatusCode}", null);
                }
                return ReadEnvelope(text);
            }
            catch (TaskCanceledException) when (!ct.IsCancellationRequested)
            {
                _logger.LogWarning("TMessage {Path} zaman aşımına uğradı.", path);
                return (false, "TRANSPORT", null);
            }
            catch (HttpRequestException ex)
            {
                _logger.LogWarning(ex, "TMessage {Path} ulaşılamadı.", path);
                return (false, "TRANSPORT", null);
            }
        }
        return (false, "TMSG_HTTP_401", null);
    }

    private static (bool Ok, string Code, JsonElement? Object) ReadEnvelope(string text)
    {
        try
        {
            using var doc = JsonDocument.Parse(text);
            var r = doc.RootElement;
            var ok = r.TryGetProperty("ResultBool", out var b) && b.ValueKind == JsonValueKind.True;
            var resultInt = r.TryGetProperty("ResultInt", out var i) && i.TryGetInt32(out var iv) ? iv : -1;
            var resultText = r.TryGetProperty("ResultText", out var t) ? t.GetString() : null;
            JsonElement? obj = r.TryGetProperty("Object", out var o) && o.ValueKind != JsonValueKind.Null ? o.Clone() : null;
            if (ok && resultInt == 1) return (true, string.Empty, obj);
            var code = $"TMSG_{resultInt}: {resultText}".Trim();
            return (false, code.Length > 120 ? code[..120] : code, obj);
        }
        catch (JsonException)
        {
            return (false, "TMSG_BAD_RESPONSE", null);
        }
    }

    private async Task<(string? Value, string? Error)> GetTokenAsync(bool forceRefresh, CancellationToken ct)
    {
        if (!forceRefresh && _token is not null && DateTimeOffset.UtcNow < _tokenValidUntil) return (_token, null);

        await TokenGate.WaitAsync(ct);
        try
        {
            if (!forceRefresh && _token is not null && DateTimeOffset.UtcNow < _tokenValidUntil) return (_token, null);

            using var res = await _http.PostAsync(_options.BaseUrl.TrimEnd('/') + "/api/register",
                Json(new { ApiUN = _options.ApiUN, ApiPP = _options.ApiPP }), ct);
            var text = await res.Content.ReadAsStringAsync(ct);
            if (!res.IsSuccessStatusCode)
            {
                // IP izni verilmediyse genelde burada 401/403 döner.
                _logger.LogWarning("TMessage giriş (register) HTTP {Status}: {Body}", (int)res.StatusCode, text.Length > 300 ? text[..300] : text);
                return (null, $"AUTH_HTTP_{(int)res.StatusCode}");
            }

            var (ok, code, obj) = ReadEnvelope(text);
            if (!ok || obj is not { ValueKind: JsonValueKind.Object } o || !o.TryGetProperty("AccessToken", out var at) || string.IsNullOrWhiteSpace(at.GetString()))
            {
                _logger.LogWarning("TMessage giriş başarısız: {Code}", code.Length == 0 ? "token yok" : code);
                return (null, code.StartsWith("TMSG_6", StringComparison.Ordinal) ? "AUTH: kullanıcı adı/şifre hatalı" : "AUTH: " + code);
            }

            _token = at.GetString();
            // Süreyi servisten oku; okunamazsa 4 dk say. Bitmeden 30 sn önce yenile.
            var until = o.TryGetProperty("AccessTokenExpiry", out var ex) && DateTimeOffset.TryParse(ex.GetString(), out var exp)
                ? exp
                : DateTimeOffset.UtcNow.AddMinutes(4);
            _tokenValidUntil = until.AddSeconds(-30);
            return (_token, null);
        }
        catch (TaskCanceledException) when (!ct.IsCancellationRequested)
        {
            return (null, "TRANSPORT");
        }
        catch (HttpRequestException ex)
        {
            _logger.LogWarning(ex, "TMessage giriş servisine ulaşılamadı.");
            return (null, "TRANSPORT");
        }
        finally
        {
            TokenGate.Release();
        }
    }
}
