using Anthropic;
using Anthropic.Exceptions;
using Anthropic.Models.Beta.Messages;
using Microsoft.Extensions.Options;

namespace Asistan.Api.Ai;

/// <summary>
/// SAĞLAYICI SEÇENEKLERİNDEN BİRİ (Ai:Provider = "claude"). Model kararı henüz verilmedi (2026-10-08:
/// "ileride aramada da kullanacağız, ChatGPT de olabilir"); asistanın geri kalanı IAiClassifier
/// arayüzünü bilir, hangi şirketin modeli olduğunu bilmez. Başka sağlayıcı = bu dosyanın bir eşi.
///
/// Claude API (Anthropic resmi .NET SDK'sı).
///
///  - Model ayardan (varsayılan claude-opus-5-5). Düşünme bu modelde hep açık; derinlik Effort ile.
///  - Çıktı JSON şemasına bağlı (yapılandırılmış çıktı) — serbest metin ayrıştırılmaz.
///  - Sistem metni önbelleğe işaretli: ayar değişmedikçe her mesajda aynı.
///  - Güvenlik sınıflandırıcısı isteği reddederse sunucu tarafı yedek model devreye girer
///    (fallbacks: "default"). Yine de reddedilirse taslak üretilmez, ekranda nedeni görünür.
///  - 3. aşama: ERP/Servis araçları tanımlıysa model müşterinin kaydına bakabilir (araç döngüsü).
///
/// Her çağrı ÜCRETLİDİR. Çağrı yalnız müşteriden YENİ mesaj geldiğinde ya da personel "yeniden dene"
/// dediğinde yapılır; geçmiş konuşmalar toplu taranmaz.
/// </summary>
public sealed class ClaudeClassifier : IAiClassifier
{
    private readonly AnthropicClient _client;
    private readonly AiOptions _options;
    private readonly TimeZoneInfo _tz;

    public ClaudeClassifier(IOptions<AiOptions> options)
    {
        _options = options.Value;
        _client = new AnthropicClient { ApiKey = _options.ApiKey };
        _tz = AiTime.Zone(_options.TimeZone);
    }

    public string? Provider => "claude";
    // Ortak Ai:Model artık OpenAI adını taşıyor (2026-10-09); Claude seçilirse ona ait olmayan ad gönderilmez.
    public string Model => _options.Model is { } m && m.StartsWith("claude", StringComparison.OrdinalIgnoreCase)
        ? m
        : "claude-sonnet-5-5";

    /// <summary>Araç turu sınırı: model en fazla bu kadar kez kayıt isteyip sonra karar vermek zorunda.</summary>
    private const int MaxRounds = 5;

    public async Task<AiDecision> ClassifyAsync(AiInput input, CancellationToken ct)
    {
        var tools = input.Tools?.Definitions ?? Array.Empty<Tools.AiToolDef>();
        var messages = new List<BetaMessageParam>
        {
            new() { Role = Role.User, Content = AiPrompt.User(input, _tz) }
        };
        long inTok = 0, outTok = 0;

        // ARAÇ DÖNGÜSÜ (3. aşama): model kayıt isterse (stop_reason = tool_use) araç sunucuda çalışır,
        // sonuç geri verilir; model karar verene (end_turn) kadar. Kimin kaydına bakılacağını
        // araç oturumu bilir, model değil (bkz. AiToolbox).
        for (var round = 1; ; round++)
        {
            var parameters = new MessageCreateParams
            {
                Model = Model,
                MaxTokens = 8000,
                Betas = ["server-side-fallback-2026-07-01"],
                Fallbacks = new Default(),
                System = new List<BetaTextBlockParam>
                {
                    new() { Text = AiPrompt.System(input.Departments, input.Settings, tools.Count > 0), CacheControl = new BetaCacheControlEphemeral() }
                },
                OutputConfig = new BetaOutputConfig
                {
                    Effort = _options.Effort.ToLowerInvariant() switch
                    {
                        "medium" => Effort.Medium,
                        "high" => Effort.High,
                        _ => Effort.Low
                    },
                    Format = new BetaJsonOutputFormat { Schema = AiPrompt.Schema(input.Departments) }
                },
                Messages = messages
            };
            if (tools.Count > 0)
            {
                parameters = parameters with
                {
                    Tools = tools.Select(t => (BetaToolUnion)new BetaTool
                    {
                        Name = t.Name,
                        Description = t.Description,
                        InputSchema = new() { Properties = t.Properties.ToDictionary(kv => kv.Key, kv => kv.Value) }
                    }).ToList()
                };
            }

            BetaMessage response;
            try
            {
                response = await _client.Beta.Messages.Create(parameters, ct);
            }
            catch (AnthropicRateLimitException ex)
            {
                throw new AiException("Yapay zekâ hizmeti şu an yoğun (istek sınırı). Biraz sonra yeniden deneyin.", ex);
            }
            catch (AnthropicApiException ex)
            {
                throw new AiException("Yapay zekâ hizmeti hata verdi: " + ex.Message, ex);
            }
            inTok += response.Usage.InputTokens;
            outTok += response.Usage.OutputTokens;

            if (response.StopReason == "refusal")
                throw new AiException("Asistan bu konuşma için taslak üretmedi (güvenlik reddi). Personel kendisi cevaplamalı.");
            if (response.StopReason == "max_tokens")
                throw new AiException("Asistanın cevabı yarıda kesildi (uzunluk sınırı).");

            if (response.StopReason == "tool_use" && input.Tools is not null)
            {
                if (round >= MaxRounds)
                    throw new AiException("Asistan kayıtlara bakarken tur sınırını aştı; personel kendisi cevaplamalı.");

                // Asistanın cevabı aynen geri verilir (düşünme blokları imzasıyla — değiştirilirse API reddeder).
                // fallback bloğu yalnız iz işaretidir, geri verilmez.
                var echo = new List<BetaContentBlockParam>();
                var results = new List<BetaContentBlockParam>();
                foreach (var block in response.Content)
                {
                    if (block.TryPickText(out var text))
                    {
                        echo.Add(new BetaTextBlockParam { Text = text.Text });
                    }
                    else if (block.TryPickThinking(out var thinking))
                    {
                        echo.Add(new BetaThinkingBlockParam { Thinking = thinking.Thinking, Signature = thinking.Signature });
                    }
                    else if (block.TryPickRedactedThinking(out var redacted))
                    {
                        echo.Add(new BetaRedactedThinkingBlockParam { Data = redacted.Data });
                    }
                    else if (block.TryPickToolUse(out var use))
                    {
                        echo.Add(new BetaToolUseBlockParam { ID = use.ID, Name = use.Name, Input = use.Input });
                        var inputJson = System.Text.Json.JsonSerializer.SerializeToElement(use.Input);
                        var result = await input.Tools.ExecuteAsync(use.Name, inputJson, ct);
                        results.Add(new BetaToolResultBlockParam { ToolUseID = use.ID, Content = result.Content, IsError = result.IsError });
                    }
                }
                messages.Add(new BetaMessageParam { Role = Role.Assistant, Content = echo });
                messages.Add(new BetaMessageParam { Role = Role.User, Content = results });
                continue;
            }

            var json = string.Concat(response.Content.Select(b => b.TryPickText(out var t) ? t.Text : string.Empty));
            if (string.IsNullOrWhiteSpace(json)) throw new AiException("Asistan boş cevap döndü.");

            try
            {
                return AiPrompt.Parse(json, input.Departments, response.Model, (int)inTok, (int)outTok) with
                {
                    ToolCalls = input.Tools?.Calls.ToList() ?? new List<Tools.AiToolCall>()
                };
            }
            catch (System.Text.Json.JsonException ex)
            {
                throw new AiException("Asistanın cevabı okunamadı.", ex);
            }
        }
    }
}

public static class AiTime
{
    public static TimeZoneInfo Zone(string id)
    {
        try { return TimeZoneInfo.FindSystemTimeZoneById(id); }
        catch (TimeZoneNotFoundException) { return TimeZoneInfo.CreateCustomTimeZone("TR", TimeSpan.FromHours(3), "TR", "TR"); }
    }
}
