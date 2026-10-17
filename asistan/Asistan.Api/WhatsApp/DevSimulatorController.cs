using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;

namespace Asistan.Api.WhatsApp;

/// <summary>
/// YALNIZ DEVELOPMENT: "müşteri yazdı" / "mesaj iletildi" bildirimlerini Meta olmadan üretir.
///
/// Gövde Meta'nın gerçek webhook biçiminde kurulur ve AYNI işleyiciden (WebhookProcessor)
/// geçer; denemede çalışan akış canlıda da çalışır. Üretimde her iki uç da ilk satırda 404 döner.
/// </summary>
[ApiController]
[Route("dev/whatsapp")]
public sealed class DevSimulatorController : ControllerBase
{
    private readonly WebhookProcessor _processor;
    private readonly WhatsAppOptions _options;
    private readonly IWebHostEnvironment _env;

    public DevSimulatorController(WebhookProcessor processor, IOptions<WhatsAppOptions> options, IWebHostEnvironment env)
    {
        _processor = processor;
        _options = options.Value;
        _env = env;
    }

    public sealed class InboundRequest
    {
        public string? PhoneNumberId { get; set; }
        public string From { get; set; } = "905331112233";
        public string? Name { get; set; }
        public string? Text { get; set; }
        public string Type { get; set; } = "text";
        /// <summary>Aynı kimlikle iki kez gönderilirse tekrar elemesi denenir.</summary>
        public string? Wamid { get; set; }
        /// <summary>Saniye cinsinden geçmişe kaydırma (24 saat penceresini denemek için).</summary>
        public long AgoSeconds { get; set; }
    }

    [HttpPost("inbound")]
    public async Task<IActionResult> Inbound([FromBody] InboundRequest r, CancellationToken ct)
    {
        if (!_env.IsDevelopment()) return NotFound();

        var pn = r.PhoneNumberId ?? _options.Numbers.Keys.FirstOrDefault();
        if (pn is null) return BadRequest(new { message = "WhatsApp:Numbers boş — appsettings.Local.json'a bir deneme numarası ekleyin." });

        var wamid = r.Wamid ?? "wamid.DEV." + Guid.NewGuid().ToString("N");
        var ts = DateTimeOffset.UtcNow.AddSeconds(-r.AgoSeconds).ToUnixTimeSeconds().ToString();

        object message = r.Type switch
        {
            "image" => new { from = r.From, id = wamid, timestamp = ts, type = "image", image = new { id = "MEDIA.DEV.1", mime_type = "image/jpeg", caption = r.Text } },
            "location" => new { from = r.From, id = wamid, timestamp = ts, type = "location", location = new { latitude = 35.1856, longitude = 33.3823, name = "Lefkoşa" } },
            _ => new { from = r.From, id = wamid, timestamp = ts, type = "text", text = new { body = r.Text ?? "Merhaba" } }
        };

        var payload = new
        {
            @object = "whatsapp_business_account",
            entry = new[]
            {
                new
                {
                    id = "WABA.DEV",
                    changes = new[]
                    {
                        new
                        {
                            field = "messages",
                            value = new
                            {
                                messaging_product = "whatsapp",
                                metadata = new { display_phone_number = "905330000000", phone_number_id = pn },
                                contacts = new[] { new { profile = new { name = r.Name ?? "Deneme Müşteri" }, wa_id = r.From } },
                                messages = new[] { message }
                            }
                        }
                    }
                }
            }
        };

        var result = await _processor.ProcessAsync(JsonSerializer.Serialize(payload), ct);
        return Ok(new { wamid, result });
    }

    public sealed class StatusRequest
    {
        public string? PhoneNumberId { get; set; }
        public string Wamid { get; set; } = string.Empty;
        public string Status { get; set; } = "delivered";
        public string? Error { get; set; }
    }

    [HttpPost("status")]
    public async Task<IActionResult> Status([FromBody] StatusRequest r, CancellationToken ct)
    {
        if (!_env.IsDevelopment()) return NotFound();

        var pn = r.PhoneNumberId ?? _options.Numbers.Keys.FirstOrDefault();
        var status = new Dictionary<string, object?>
        {
            ["id"] = r.Wamid,
            ["status"] = r.Status,
            ["timestamp"] = DateTimeOffset.UtcNow.ToUnixTimeSeconds().ToString(),
            ["recipient_id"] = "905331112233"
        };
        if (r.Error is not null) status["errors"] = new[] { new { code = 131047, title = r.Error } };

        var payload = new
        {
            @object = "whatsapp_business_account",
            entry = new[] { new { id = "WABA.DEV", changes = new[] { new { field = "messages", value = new
            {
                messaging_product = "whatsapp",
                metadata = new { display_phone_number = "905330000000", phone_number_id = pn },
                statuses = new[] { status }
            } } } } }
        };

        var result = await _processor.ProcessAsync(JsonSerializer.Serialize(payload), ct);
        return Ok(new { result });
    }
}
