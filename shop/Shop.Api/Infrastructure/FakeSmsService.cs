using System.Collections.Concurrent;

namespace Shop.Api.Infrastructure;

/// <summary>
/// SAHTE SMS SAĞLAYICISI — yalnızca lokal geliştirme ve otomatik test için.
///
/// NEDEN VAR: gerçek gönderim PostaGüvercini kredentiali, kredi ve gerçek bir telefon
/// istiyor. Kredentials girilene kadar SMS akışının (kod iste → doğrula → bilet → kayıt)
/// uçtan uca bir kez bile koşturulması mümkün değildi; sanal POS'ta aynı sorun için sahte
/// sağlayıcı yazılmıştı, aynı desen buraya taşındı.
///
/// ÜÇ BAĞIMSIZ KAPI — üçü birden açık değilse bu sınıf hiç çalışmaz:
///   1. ortam <c>Development</c>,
///   2. <c>PostaGuvercini:EnableFakeProvider</c> açık,
///   3. DI kaydı da aynı iki koşula bağlı (bkz. Program.cs).
///
/// Sınıf üretimde konteynere hiç girmez; girse bile her metodunda koşulu TEKRAR kontrol eder
/// ve kapalıysa <b>başarısız</b> döner. Asla "gönderildi" demez. İki kez kontrol bilinçli:
/// Program.cs'teki <c>if</c>in bir gün silinmesi tek satırlık bir hata, bedeli ise doğrulama
/// kodunun hiç gitmediği hâlde "gitti" sayılmasıdır — yani hesap açma kapısının açılması.
///
/// Gönderilen mesajlar RAM'de son 50 kayıtla tutuluyor. Kalıcı değil ve olması da gerekmiyor:
/// tek amacı testin kodu okuyabilmesi.
/// </summary>
public sealed class FakeSmsService : ISmsService
{
    /// <summary>Sahte gönderim kaydı — testin okuduğu şey.</summary>
    public sealed record SentMessage(DateTime SentAtUtc, string Phone, string Message);

    private static readonly ConcurrentQueue<SentMessage> Sent = new();
    private const int MaxKept = 50;

    private readonly IWebHostEnvironment _environment;
    private readonly IConfiguration _configuration;
    private readonly ILogger<FakeSmsService> _logger;
    private readonly SmsService _real;

    public FakeSmsService(
        IWebHostEnvironment environment,
        IConfiguration configuration,
        ILogger<FakeSmsService> logger,
        IHttpClientFactory httpClientFactory,
        ILogger<SmsService> realLogger)
    {
        _environment = environment;
        _configuration = configuration;
        _logger = logger;

        // Numara normalleştirmesi GERÇEK sınıftan geliyor: sahte sağlayıcının kendi kopyasını
        // yazmak, testin doğruladığı biçimlendirmenin üretimdekinden farklı olması demekti.
        _real = new SmsService(httpClientFactory.CreateClient(), configuration, realLogger);
    }

    /// <summary>Program.cs bu koşulla kaydediyor; sınıf da her çağrıda aynısını tekrar soruyor.</summary>
    public static bool IsEnabled(IWebHostEnvironment environment, IConfiguration configuration)
        => environment.IsDevelopment()
           && configuration.GetValue<bool>("PostaGuvercini:EnableFakeProvider");

    private bool Allowed => IsEnabled(_environment, _configuration);

    public bool IsConfigured => Allowed;

    public string NormalizeMsisdn(string phone) => _real.NormalizeMsisdn(phone);

    /// <summary>Sahte sağlayıcıda hata biriktirilmiyor: gönderim hep başarılı ya da reddedilmiş.</summary>
    public IReadOnlyList<SmsFailure> RecentFailures => Array.Empty<SmsFailure>();

    public Task<SmsSendResult> SendAsync(string phone, string message, CancellationToken ct = default, SmsKind kind = SmsKind.Bulk)
    {
        if (!Allowed)
        {
            _logger.LogError("[SAHTE SMS] Kapalı ortamda çağrıldı — gönderim REDDEDİLDİ.");
            return Task.FromResult(SmsSendResult.Fail("FAKE_DISABLED"));
        }

        var normalized = NormalizeMsisdn(phone);
        if (normalized.Length == 0)
        {
            // Gerçek servis de geçersiz numarayı reddediyor; sahte olan bunu gizlerse
            // numara biçimi hatası ancak canlıda ortaya çıkardı.
            return Task.FromResult(SmsSendResult.Fail("INVALID_MSISDN"));
        }

        Sent.Enqueue(new SentMessage(DateTime.UtcNow, normalized, message));
        while (Sent.Count > MaxKept) Sent.TryDequeue(out _);

        _logger.LogWarning("[SAHTE SMS] ({Kind}) {Phone} → {Message}", kind, normalized, message);

        return Task.FromResult(new SmsSendResult(true, $"FAKE-{Guid.NewGuid():N}"[..16], null));
    }

    public Task<int?> GetCreditAsync(CancellationToken ct = default)
        => Task.FromResult(Allowed ? (int?)9999 : null);

    public Task<string?> GetSenderNameAsync(CancellationToken ct = default)
        => Task.FromResult(Allowed ? "STILSOFT-TEST" : null);

    /// <summary>Gönderilen sahte mesajlar (en yeni en sonda). Yalnızca test/teşhis içindir.</summary>
    public static IReadOnlyList<SentMessage> Outbox() => Sent.ToArray();
}
