using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Options;

namespace Asistan.Api.WhatsApp;

public sealed record SendResult(bool Ok, string? Wamid, string? Error);

public interface IWhatsAppClient
{
    /// <summary>Sahte sağlayıcı mı (lokal geliştirme)? Panel bunu ekranda uyarı olarak gösterir.</summary>
    bool IsFake { get; }
    bool IsConfigured { get; }
    Task<SendResult> SendTextAsync(string phoneNumberId, string to, string text, CancellationToken ct);
    Task MarkReadAsync(string phoneNumberId, string wamid, CancellationToken ct);
    Task<(Stream Content, string ContentType)?> DownloadMediaAsync(string mediaId, CancellationToken ct);
}

/// <summary>
/// WhatsApp Cloud API (graph.facebook.com) istemcisi.
///
/// Hata metni Meta'nın kendi açıklamasıyla geri döner ve mesaja yazılır: "24 saat penceresi
/// kapandı", "numara WhatsApp kullanmıyor" gibi sebepleri personel ekranda görmeli.
/// </summary>
public sealed class WhatsAppClient : IWhatsAppClient
{
    private readonly HttpClient _http;
    private readonly WhatsAppOptions _options;
    private readonly ILogger<WhatsAppClient> _log;

    public WhatsAppClient(HttpClient http, IOptions<WhatsAppOptions> options, ILogger<WhatsAppClient> log)
    {
        _http = http;
        _options = options.Value;
        _log = log;
        _http.Timeout = TimeSpan.FromSeconds(20);
    }

    public bool IsFake => false;
    public bool IsConfigured => _options.CanSend;

    private string Url(string path) => $"https://graph.facebook.com/{_options.GraphApiVersion}/{path}";

    private HttpRequestMessage Request(HttpMethod method, string url, object? body = null)
    {
        var req = new HttpRequestMessage(method, url);
        req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", _options.AccessToken);
        if (body is not null)
        {
            req.Content = new StringContent(JsonSerializer.Serialize(body), Encoding.UTF8, "application/json");
        }
        return req;
    }

    public async Task<SendResult> SendTextAsync(string phoneNumberId, string to, string text, CancellationToken ct)
    {
        if (!IsConfigured) return new SendResult(false, null, "WhatsApp gönderimi yapılandırılmamış (AccessToken yok).");

        var payload = new
        {
            messaging_product = "whatsapp",
            recipient_type = "individual",
            to,
            type = "text",
            text = new { preview_url = false, body = text }
        };

        try
        {
            using var resp = await _http.SendAsync(Request(HttpMethod.Post, Url($"{phoneNumberId}/messages"), payload), ct);
            var json = await resp.Content.ReadAsStringAsync(ct);
            if (!resp.IsSuccessStatusCode)
            {
                var err = GraphError(json) ?? $"HTTP {(int)resp.StatusCode}";
                _log.LogWarning("WhatsApp gönderimi başarısız: {Error}", err);
                return new SendResult(false, null, err);
            }

            using var doc = JsonDocument.Parse(json);
            var wamid = doc.RootElement.TryGetProperty("messages", out var ms) && ms.ValueKind == JsonValueKind.Array && ms.GetArrayLength() > 0
                ? ms[0].GetProperty("id").GetString()
                : null;
            return new SendResult(wamid is not null, wamid, wamid is null ? "Meta mesaj kimliği döndürmedi." : null);
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException)
        {
            _log.LogWarning(ex, "WhatsApp'a ulaşılamadı");
            return new SendResult(false, null, "WhatsApp'a ulaşılamadı: " + ex.Message);
        }
    }

    public async Task MarkReadAsync(string phoneNumberId, string wamid, CancellationToken ct)
    {
        if (!IsConfigured) return;
        try
        {
            using var resp = await _http.SendAsync(Request(HttpMethod.Post, Url($"{phoneNumberId}/messages"),
                new { messaging_product = "whatsapp", status = "read", message_id = wamid }), ct);
            // Okundu bildirimi süs; başarısızlığı mesaj akışını durdurmaz.
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException)
        {
            _log.LogDebug(ex, "Okundu bildirimi gönderilemedi");
        }
    }

    public async Task<(Stream Content, string ContentType)?> DownloadMediaAsync(string mediaId, CancellationToken ct)
    {
        if (!IsConfigured) return null;

        // 1) medya kimliği → geçici indirme adresi (birkaç dakika geçerli)
        using var meta = await _http.SendAsync(Request(HttpMethod.Get, Url(mediaId)), ct);
        if (!meta.IsSuccessStatusCode) return null;
        using var doc = JsonDocument.Parse(await meta.Content.ReadAsStringAsync(ct));
        var url = doc.RootElement.TryGetProperty("url", out var u) ? u.GetString() : null;
        if (string.IsNullOrWhiteSpace(url)) return null;

        // 2) adres de token ister; tarayıcıya doğrudan verilemez, bu yüzden servis aracılık ediyor.
        var resp = await _http.SendAsync(Request(HttpMethod.Get, url), HttpCompletionOption.ResponseHeadersRead, ct);
        if (!resp.IsSuccessStatusCode)
        {
            resp.Dispose();
            return null;
        }
        var type = resp.Content.Headers.ContentType?.ToString() ?? "application/octet-stream";
        return (await resp.Content.ReadAsStreamAsync(ct), type);
    }

    private static string? GraphError(string json)
    {
        try
        {
            using var doc = JsonDocument.Parse(json);
            if (!doc.RootElement.TryGetProperty("error", out var e)) return null;
            var msg = e.TryGetProperty("message", out var m) ? m.GetString() : null;
            var code = e.TryGetProperty("code", out var c) ? c.GetRawText() : null;
            var details = e.TryGetProperty("error_data", out var d) && d.TryGetProperty("details", out var dd) ? dd.GetString() : null;
            return $"({code}) {msg}{(details is null ? "" : " — " + details)}";
        }
        catch (JsonException)
        {
            return null;
        }
    }
}

/// <summary>
/// SAHTE SAĞLAYICI — yalnız Development ortamında VE AccessToken boşken devreye girer.
/// Gönderilen mesaj günlüğe yazılır, sahte bir kimlik döner; durum webhook'u gelmez,
/// mesaj 'sent' kalır. Gerçek Meta hesabı gelmeden paneli ve akışı denemek için.
/// </summary>
public sealed class FakeWhatsAppClient : IWhatsAppClient
{
    private readonly ILogger<FakeWhatsAppClient> _log;

    public FakeWhatsAppClient(ILogger<FakeWhatsAppClient> log)
    {
        _log = log;
    }

    public bool IsFake => true;
    public bool IsConfigured => true;

    public Task<SendResult> SendTextAsync(string phoneNumberId, string to, string text, CancellationToken ct)
    {
        _log.LogWarning("[SAHTE WHATSAPP] {From} → {To}: {Text}", phoneNumberId, to, text);
        return Task.FromResult(new SendResult(true, "wamid.FAKE." + Guid.NewGuid().ToString("N"), null));
    }

    public Task MarkReadAsync(string phoneNumberId, string wamid, CancellationToken ct) => Task.CompletedTask;

    /// <summary>
    /// Deneme fotoğrafı: ekranda büyütme/döndürme/indirme denensin diye 800x600 renkli bir PNG üretir
    /// (yalnız sahte istemci — canlıda gerçek medya Meta'dan iner).
    /// </summary>
    public Task<(Stream Content, string ContentType)?> DownloadMediaAsync(string mediaId, CancellationToken ct) =>
        Task.FromResult<(Stream, string)?>((new MemoryStream(SamplePng(800, 600)), "image/png"));

    private static byte[] SamplePng(int w, int h)
    {
        // Ham satırlar: her satır başında filtre baytı 0, sonra RGB.
        var raw = new byte[h * (w * 3 + 1)];
        for (var y = 0; y < h; y++)
        {
            var row = y * (w * 3 + 1);
            for (var x = 0; x < w; x++)
            {
                var i = row + 1 + x * 3;
                var grid = (x / 50 + y / 50) % 2 == 0;
                raw[i] = (byte)(grid ? 20 + x * 200 / w : 230);
                raw[i + 1] = (byte)(grid ? 120 + y * 100 / h : 230);
                raw[i + 2] = (byte)(grid ? 60 : 240);
            }
        }
        using var png = new MemoryStream();
        png.Write(new byte[] { 137, 80, 78, 71, 13, 10, 26, 10 });
        void Chunk(string type, byte[] data)
        {
            var len = BitConverter.GetBytes(data.Length); Array.Reverse(len); png.Write(len);
            var t = System.Text.Encoding.ASCII.GetBytes(type);
            png.Write(t); png.Write(data);
            var crcInput = t.Concat(data).ToArray();
            var crc = BitConverter.GetBytes(Crc32(crcInput)); Array.Reverse(crc); png.Write(crc);
        }
        var ihdr = new byte[13];
        var bw = BitConverter.GetBytes(w); Array.Reverse(bw); bw.CopyTo(ihdr, 0);
        var bh = BitConverter.GetBytes(h); Array.Reverse(bh); bh.CopyTo(ihdr, 4);
        ihdr[8] = 8; ihdr[9] = 2; // 8 bit, RGB
        Chunk("IHDR", ihdr);
        using (var z = new MemoryStream())
        {
            using (var zs = new System.IO.Compression.ZLibStream(z, System.IO.Compression.CompressionLevel.Fastest, leaveOpen: true)) zs.Write(raw);
            Chunk("IDAT", z.ToArray());
        }
        Chunk("IEND", Array.Empty<byte>());
        return png.ToArray();
    }

    private static uint Crc32(byte[] data)
    {
        var crc = 0xFFFFFFFFu;
        foreach (var b in data)
        {
            crc ^= b;
            for (var k = 0; k < 8; k++) crc = (crc & 1) != 0 ? 0xEDB88320u ^ (crc >> 1) : crc >> 1;
        }
        return ~crc;
    }
}
