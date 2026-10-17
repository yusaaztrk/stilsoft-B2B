using System.Security.Cryptography;
using System.Text;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;

namespace Asistan.Api.WhatsApp;

/// <summary>
/// Meta'nın çağırdığı webhook. Adres herkese açık; güvenlik İMZADA (bkz. WebhookSignature).
///
/// GET  /webhook/whatsapp  — kurulum doğrulaması (hub.challenge geri döner)
/// POST /webhook/whatsapp  — mesaj ve durum bildirimleri
///
/// Cevap hızlı olmalı: Meta birkaç saniyede cevap alamazsa aynı bildirimi tekrar gönderir
/// (tekrarı mesaj kimliği eler). İşleme hatasında 500 dönülür ki Meta YENİDEN denesin —
/// 200 dönüp mesajı kaybetmektense tekrar gelmesi iyidir.
/// </summary>
[ApiController]
[Route("webhook/whatsapp")]
public sealed class WebhookController : ControllerBase
{
    private const int MaxBodyBytes = 2 * 1024 * 1024;

    private readonly WhatsAppOptions _options;
    private readonly WebhookProcessor _processor;
    private readonly IWebHostEnvironment _env;
    private readonly ILogger<WebhookController> _log;

    public WebhookController(IOptions<WhatsAppOptions> options, WebhookProcessor processor, IWebHostEnvironment env, ILogger<WebhookController> log)
    {
        _options = options.Value;
        _processor = processor;
        _env = env;
        _log = log;
    }

    [HttpGet]
    public IActionResult Verify(
        [FromQuery(Name = "hub.mode")] string? mode,
        [FromQuery(Name = "hub.verify_token")] string? token,
        [FromQuery(Name = "hub.challenge")] string? challenge)
    {
        if (string.IsNullOrWhiteSpace(_options.VerifyToken))
        {
            return StatusCode(StatusCodes.Status503ServiceUnavailable, "VerifyToken yapılandırılmamış.");
        }

        var ok = mode == "subscribe"
                 && token is not null
                 && CryptographicOperations.FixedTimeEquals(Encoding.UTF8.GetBytes(token), Encoding.UTF8.GetBytes(_options.VerifyToken));

        return ok ? Content(challenge ?? string.Empty, "text/plain") : StatusCode(StatusCodes.Status403Forbidden);
    }

    [HttpPost]
    public async Task<IActionResult> Receive(CancellationToken ct)
    {
        // Gövde HAM okunur: imza ham baytlar üzerinden.
        using var ms = new MemoryStream();
        var buffer = new byte[16 * 1024];
        int read;
        while ((read = await Request.Body.ReadAsync(buffer, ct)) > 0)
        {
            ms.Write(buffer, 0, read);
            if (ms.Length > MaxBodyBytes) return StatusCode(StatusCodes.Status413PayloadTooLarge);
        }
        var body = ms.ToArray();

        if (string.IsNullOrWhiteSpace(_options.AppSecret))
        {
            // Üretimde imzasız kabul YOK. Lokal geliştirmede sırrı olmayan makinede deneme yapılabilsin.
            if (!_env.IsDevelopment())
            {
                _log.LogError("WhatsApp webhook: AppSecret yapılandırılmamış, istek reddedildi");
                return StatusCode(StatusCodes.Status503ServiceUnavailable);
            }
            _log.LogWarning("WhatsApp webhook: AppSecret yok — imza DOĞRULANMADAN işleniyor (yalnız Development)");
        }
        else if (!WebhookSignature.IsValid(body, Request.Headers["X-Hub-Signature-256"], _options.AppSecret))
        {
            _log.LogWarning("WhatsApp webhook: imza geçersiz, istek reddedildi ({Ip})", HttpContext.Connection.RemoteIpAddress);
            return Unauthorized();
        }

        /*
          İLK MESAJ KAYBI (2026-10-11, kullanıcı: "bazen ilk mesaj gelmiyor, 2. atınca geliyor").
          İşlem eskiden İSTEĞİN iptal belirtecine (RequestAborted) bağlıydı. Site uykudan (IIS boşta
          kapatma) ilk mesajla uyanınca açılış + şema + ERP eşleşmesi birkaç saniye sürüyor; Meta
          beklemeyi bırakıp bağlantıyı kesince belirteç iptal oluyor ve kayıt YARIDA kalıyordu — mesaj
          ancak Meta'nın saatler sonraki yeniden denemesinde geliyordu. Artık işlem bağlantıdan
          bağımsız (en fazla 60 sn) tamamlanır; Meta aynı mesajı yeniden yollarsa wamid tekilliği eler.
        */
        using var work = new CancellationTokenSource(TimeSpan.FromSeconds(60));
        var sw = System.Diagnostics.Stopwatch.StartNew();
        try
        {
            var result = await _processor.ProcessAsync(Encoding.UTF8.GetString(body), work.Token);
            _log.LogInformation("WhatsApp webhook: {Messages} mesaj ({New} yeni), {Statuses} durum, {Ms} ms{Aborted}",
                result.Messages, result.NewMessages, result.Statuses, sw.ElapsedMilliseconds,
                ct.IsCancellationRequested ? " — Meta bağlantıyı bu sırada kesmişti, kayıt yine tamamlandı" : "");
            return Ok();
        }
        catch (System.Text.Json.JsonException)
        {
            // Bozuk gövde tekrar gönderilse de düzelmez; 400 ile bırakılır.
            return BadRequest();
        }
        catch (Exception ex)
        {
            _log.LogError(ex, "WhatsApp webhook işlenemedi — Meta tekrar gönderecek");
            return StatusCode(StatusCodes.Status500InternalServerError);
        }
    }
}
