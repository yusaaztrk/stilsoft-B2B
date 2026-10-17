using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Extensions.Options;

namespace Asistan.Api.Ai;

/// <summary>
/// SAĞLAYICI: OpenAI (Ai:Provider = "openai"). 2026-10-09 kullanıcı kararı: mesaj, ileride canlı arama
/// (gpt-realtime), görsel yorumlama ve Instagram/Facebook DM tek sağlayıcıda toplansın → OpenAI.
/// Başlangıç modeli gpt-5.6-luna (ucuz: $0,20 / $1,20 1M token); yetmezse yalnız Ai:Model değişir
/// (ör. gpt-5.6-terra).
///
/// SDK değil doğrudan REST (POST /v1/responses): SDK'nın sürüm değişikliklerine bağlı kalmamak için.
///  - Çıktı JSON şemasına bağlı (text.format json_schema, strict) — AiPrompt.Schema, Claude ile aynı şema.
///  - Araç döngüsü: model kayıt isterse (function_call) araç sunucuda çalışır, sonuç geri verilir.
///  - store = false: müşteri yazışması OpenAI'de saklanmaz. Bu yüzden döngüde önceki çıktı öğeleri
///    (düşünme öğeleri şifreli içerikleriyle) her turda geri gönderilir; previous_response_id kullanılmaz.
///
/// Her çağrı ÜCRETLİDİR; yalnız yeni müşteri mesajında ya da "yeniden yaz"da çağrılır.
/// </summary>
public sealed class OpenAiClassifier : IAiClassifier
{
    public const string DefaultModel = "gpt-5.6-luna";
    private const string Endpoint = "https://api.openai.com/v1/responses";
    private const int MaxRounds = 5;

    private readonly IHttpClientFactory _http;
    private readonly AiOptions _options;
    private readonly TimeZoneInfo _tz;
    private readonly string _model;

    public OpenAiClassifier(IHttpClientFactory http, IOptions<AiOptions> options)
    {
        _http = http;
        _options = options.Value;
        _tz = AiTime.Zone(_options.TimeZone);
        // Ayar dosyasında model yazılmamışsa varsayılan Claude adı OpenAI'ye gitmesin.
        var m = (_options.Model ?? string.Empty).Trim();
        _model = m.Length == 0 || m.StartsWith("claude", StringComparison.OrdinalIgnoreCase) ? DefaultModel : m;
    }

    public string? Provider => "openai";
    public string Model => _model;

    public async Task<AiDecision> ClassifyAsync(AiInput input, CancellationToken ct)
    {
        var tools = input.Tools?.Definitions ?? Array.Empty<Tools.AiToolDef>();

        // Konuşma girdisi; araç turlarında modelin çıktı öğeleri ve araç sonuçları eklenir.
        var conversation = new JsonArray
        {
            new JsonObject
            {
                ["role"] = "user",
                ["content"] = AiPrompt.User(input, _tz)
            }
        };

        long inTok = 0, outTok = 0;
        for (var round = 1; ; round++)
        {
            var body = new JsonObject
            {
                ["model"] = _model,
                ["instructions"] = AiPrompt.System(input.Departments, input.Settings, tools.Count > 0),
                ["input"] = conversation.DeepClone(),
                ["store"] = false,
                ["include"] = new JsonArray("reasoning.encrypted_content"),
                ["max_output_tokens"] = 8000,
                ["reasoning"] = new JsonObject { ["effort"] = Effort(_options.Effort) },
                ["text"] = new JsonObject
                {
                    ["format"] = new JsonObject
                    {
                        ["type"] = "json_schema",
                        ["name"] = "asistan_karari",
                        ["strict"] = true,
                        ["schema"] = JsonSerializer.SerializeToNode(AiPrompt.Schema(input.Departments))
                    }
                }
            };
            if (tools.Count > 0)
            {
                var arr = new JsonArray();
                foreach (var t in tools)
                {
                    var props = new JsonObject();
                    foreach (var kv in t.Properties) props[kv.Key] = JsonNode.Parse(kv.Value.GetRawText());
                    arr.Add(new JsonObject
                    {
                        ["type"] = "function",
                        ["name"] = t.Name,
                        ["description"] = t.Description,
                        // Araç girdileri isteğe bağlı (belge no); strict mod "hepsi zorunlu" ister, kapalı tutulur.
                        ["strict"] = false,
                        ["parameters"] = new JsonObject
                        {
                            ["type"] = "object",
                            ["properties"] = props,
                            ["additionalProperties"] = false
                        }
                    });
                }
                body["tools"] = arr;
            }

            using var doc = await SendAsync(body, ct);
            var root = doc.RootElement;

            if (root.TryGetProperty("usage", out var usage))
            {
                inTok += usage.TryGetProperty("input_tokens", out var it) ? it.GetInt64() : 0;
                outTok += usage.TryGetProperty("output_tokens", out var ot) ? ot.GetInt64() : 0;
            }

            var status = root.TryGetProperty("status", out var st) ? st.GetString() : null;
            if (status == "incomplete")
            {
                var reason = root.TryGetProperty("incomplete_details", out var det) && det.ValueKind == JsonValueKind.Object
                             && det.TryGetProperty("reason", out var r) ? r.GetString() : null;
                throw new AiException(reason == "max_output_tokens"
                    ? "Asistanın cevabı yarıda kesildi (uzunluk sınırı)."
                    : "Asistan cevabı tamamlanmadı" + (reason is null ? "." : $" ({reason})."));
            }
            if (status is not null and not "completed")
                throw new AiException($"Yapay zekâ hizmeti beklenmeyen durum döndü: {status}.");

            if (!root.TryGetProperty("output", out var output) || output.ValueKind != JsonValueKind.Array)
                throw new AiException("Asistan boş cevap döndü.");

            var calls = new List<(string CallId, string Name, string Args)>();
            var text = new StringBuilder();
            foreach (var item in output.EnumerateArray())
            {
                var type = item.TryGetProperty("type", out var ty) ? ty.GetString() : null;
                if (type == "function_call")
                {
                    calls.Add((
                        item.GetProperty("call_id").GetString()!,
                        item.GetProperty("name").GetString()!,
                        item.TryGetProperty("arguments", out var a) ? a.GetString() ?? "{}" : "{}"));
                }
                else if (type == "message" && item.TryGetProperty("content", out var content) && content.ValueKind == JsonValueKind.Array)
                {
                    foreach (var c in content.EnumerateArray())
                    {
                        var ctype = c.TryGetProperty("type", out var cty) ? cty.GetString() : null;
                        if (ctype == "refusal")
                            throw new AiException("Asistan bu konuşma için taslak üretmedi (güvenlik reddi). Personel kendisi cevaplamalı.");
                        if (ctype == "output_text" && c.TryGetProperty("text", out var tx)) text.Append(tx.GetString());
                    }
                }
            }

            if (calls.Count > 0 && input.Tools is not null)
            {
                if (round >= MaxRounds)
                    throw new AiException("Asistan kayıtlara bakarken tur sınırını aştı; personel kendisi cevaplamalı.");

                // Modelin bu turdaki bütün çıktı öğeleri (düşünme + araç çağrısı) aynen geri verilir,
                // ardından her çağrı için bir sonuç.
                foreach (var item in output.EnumerateArray()) conversation.Add(JsonNode.Parse(item.GetRawText()));
                foreach (var (callId, name, args) in calls)
                {
                    JsonElement argEl;
                    try { argEl = JsonDocument.Parse(string.IsNullOrWhiteSpace(args) ? "{}" : args).RootElement.Clone(); }
                    catch (JsonException) { argEl = JsonDocument.Parse("{}").RootElement.Clone(); }
                    var result = await input.Tools.ExecuteAsync(name, argEl, ct);
                    conversation.Add(new JsonObject
                    {
                        ["type"] = "function_call_output",
                        ["call_id"] = callId,
                        ["output"] = result.IsError ? "HATA: " + result.Content : result.Content
                    });
                }
                continue;
            }

            var json = text.ToString();
            if (string.IsNullOrWhiteSpace(json)) throw new AiException("Asistan boş cevap döndü.");
            var model = root.TryGetProperty("model", out var mo) ? mo.GetString() ?? _model : _model;
            try
            {
                return AiPrompt.Parse(json, input.Departments, model, (int)inTok, (int)outTok) with
                {
                    ToolCalls = input.Tools?.Calls.ToList() ?? new List<Tools.AiToolCall>()
                };
            }
            catch (JsonException ex)
            {
                throw new AiException("Asistanın cevabı okunamadı.", ex);
            }
        }
    }

    private async Task<JsonDocument> SendAsync(JsonObject body, CancellationToken ct)
    {
        var client = _http.CreateClient("openai");
        using var req = new HttpRequestMessage(HttpMethod.Post, Endpoint)
        {
            Content = new StringContent(body.ToJsonString(), Encoding.UTF8, "application/json")
        };
        req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", _options.ApiKey);

        HttpResponseMessage resp;
        try
        {
            resp = await client.SendAsync(req, ct);
        }
        catch (HttpRequestException ex)
        {
            throw new AiException("Yapay zekâ hizmetine ulaşılamadı.", ex);
        }

        using (resp)
        {
            var raw = await resp.Content.ReadAsStringAsync(ct);
            if (resp.IsSuccessStatusCode) return JsonDocument.Parse(raw);

            // Hata gövdesindeki mesaj gösterilir; anahtar ya da istek içeriği günlüğe/ekrana yazılmaz.
            string? apiMessage = null;
            try
            {
                using var err = JsonDocument.Parse(raw);
                if (err.RootElement.TryGetProperty("error", out var e) && e.TryGetProperty("message", out var m)) apiMessage = m.GetString();
            }
            catch (JsonException) { }

            throw resp.StatusCode switch
            {
                HttpStatusCode.Unauthorized => new AiException("Yapay zekâ anahtarı geçersiz (Ai:ApiKey)."),
                HttpStatusCode.TooManyRequests => new AiException("Yapay zekâ hizmeti şu an yoğun ya da bakiye bitti (429). " + apiMessage),
                _ => new AiException($"Yapay zekâ hizmeti hata verdi ({(int)resp.StatusCode}): {apiMessage}")
            };
        }
    }

    private static string Effort(string? effort) => (effort ?? "low").Trim().ToLowerInvariant() switch
    {
        "none" => "none",
        "medium" => "medium",
        "high" => "high",
        _ => "low"
    };
}
