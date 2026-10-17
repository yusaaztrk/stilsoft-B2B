using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Ecommerce.Api.Controllers;

[ApiController]
[Route("api/admin/ai")]
[Authorize(Policy = "perm:products")]
public sealed class AdminAiController : ControllerBase
{
    private readonly string _groqApiKey;
    private readonly IHttpClientFactory _httpClientFactory;

    public AdminAiController(IConfiguration config, IHttpClientFactory httpClientFactory)
    {
        _groqApiKey = config["Ai:GroqApiKey"] ?? string.Empty;
        _httpClientFactory = httpClientFactory;
    }

    public sealed class AiGenerateRequest
    {
        public string Action { get; set; } = string.Empty;
        public string ProductName { get; set; } = string.Empty;
        public string? Description { get; set; }
        public string? TechnicalSpecsJson { get; set; }
        public string Language { get; set; } = "tr";
    }

    public sealed class AiGenerateResponse
    {
        public bool Success { get; set; }
        public string? Output { get; set; }
        public string? SeoTitle { get; set; }
        public string? SeoDescription { get; set; }
        public string? ErrorMessage { get; set; }
    }

    [HttpPost("generate")]
    public async Task<IActionResult> Generate([FromBody] AiGenerateRequest request, CancellationToken cancellationToken)
    {
        if (request == null)
            return BadRequest("Invalid request body.");

        if (string.IsNullOrWhiteSpace(request.ProductName))
            return BadRequest("Product name is required.");

        var action = request.Action.ToLowerInvariant();
        var isEn = request.Language.ToLowerInvariant() == "en";

        // If no Groq API Key is configured, use structured mockup fallback
        if (string.IsNullOrWhiteSpace(_groqApiKey))
        {
            return Ok(GenerateMockResponse(action, request.ProductName, request.Description, request.TechnicalSpecsJson, isEn));
        }

        try
        {
            var systemPrompt = BuildSystemPrompt(action, isEn);
            var userPrompt = BuildUserPrompt(action, request.ProductName, request.Description, request.TechnicalSpecsJson, isEn);

            var client = _httpClientFactory.CreateClient();
            client.DefaultRequestHeaders.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", _groqApiKey);

            var requestBody = new
            {
                model = "llama-3.3-70b-versatile",
                messages = new[]
                {
                    new { role = "system", content = systemPrompt },
                    new { role = "user", content = userPrompt }
                },
                temperature = 0.7,
                max_tokens = 1000
            };

            var response = await client.PostAsync(
                "https://api.groq.com/openai/v1/chat/completions",
                new StringContent(JsonSerializer.Serialize(requestBody), Encoding.UTF8, "application/json"),
                cancellationToken
            );

            if (!response.IsSuccessStatusCode)
            {
                var errContent = await response.Content.ReadAsStringAsync(cancellationToken);
                return Ok(new AiGenerateResponse
                {
                    Success = false,
                    ErrorMessage = $"Groq API returned status {response.StatusCode}: {errContent}. Falling back to preview content.",
                    Output = GenerateMockResponse(action, request.ProductName, request.Description, request.TechnicalSpecsJson, isEn).Output,
                    SeoTitle = GenerateMockResponse(action, request.ProductName, request.Description, request.TechnicalSpecsJson, isEn).SeoTitle,
                    SeoDescription = GenerateMockResponse(action, request.ProductName, request.Description, request.TechnicalSpecsJson, isEn).SeoDescription
                });
            }

            var json = await response.Content.ReadAsStringAsync(cancellationToken);
            using var doc = JsonDocument.Parse(json);
            var text = doc.RootElement
                .GetProperty("choices")[0]
                .GetProperty("message")
                .GetProperty("content")
                .GetString() ?? string.Empty;

            text = text.Trim();

            if (action == "generate_seo")
            {
                // Parse SEO JSON from completion
                string seoTitle = string.Empty;
                string seoDesc = string.Empty;

                try
                {
                    // Clean codeblock markers if present
                    var cleanText = text;
                    if (cleanText.StartsWith("```"))
                    {
                        var firstLineEnd = cleanText.IndexOf('\n');
                        var lastBackticks = cleanText.LastIndexOf("```");
                        if (firstLineEnd > 0 && lastBackticks > firstLineEnd)
                        {
                            cleanText = cleanText.Substring(firstLineEnd + 1, lastBackticks - firstLineEnd - 1).Trim();
                        }
                    }

                    using var seoDoc = JsonDocument.Parse(cleanText);
                    if (seoDoc.RootElement.TryGetProperty("seoTitle", out var titleProp))
                        seoTitle = titleProp.GetString() ?? string.Empty;
                    if (seoDoc.RootElement.TryGetProperty("seoDescription", out var descProp))
                        seoDesc = descProp.GetString() ?? string.Empty;
                }
                catch
                {
                    // Regex/String fallback parsing if JSON parsing fails
                    seoTitle = ParseTag(text, "seoTitle") ?? $"{request.ProductName} - Stilsoft KKTC";
                    seoDesc = ParseTag(text, "seoDescription") ?? $"{request.ProductName} teknik özellikleri, fiyatı ve ödeme seçenekleri Stilsoft KKTC'de.";
                }

                return Ok(new AiGenerateResponse
                {
                    Success = true,
                    SeoTitle = seoTitle.Trim(),
                    SeoDescription = seoDesc.Trim()
                });
            }

            return Ok(new AiGenerateResponse
            {
                Success = true,
                Output = text
            });
        }
        catch (Exception ex)
        {
            return Ok(new AiGenerateResponse
            {
                Success = false,
                ErrorMessage = $"Error during AI generation: {ex.Message}. Falling back to default preview.",
                Output = GenerateMockResponse(action, request.ProductName, request.Description, request.TechnicalSpecsJson, isEn).Output,
                SeoTitle = GenerateMockResponse(action, request.ProductName, request.Description, request.TechnicalSpecsJson, isEn).SeoTitle,
                SeoDescription = GenerateMockResponse(action, request.ProductName, request.Description, request.TechnicalSpecsJson, isEn).SeoDescription
            });
        }
    }

    private static string ParseTag(string text, string tagName)
    {
        var searchStr = $"\"{tagName}\":";
        var idx = text.IndexOf(searchStr);
        if (idx < 0) return string.Empty;

        var start = text.IndexOf('"', idx + searchStr.Length);
        if (start < 0) return string.Empty;

        var end = text.IndexOf('"', start + 1);
        if (end < 0) return string.Empty;

        return text.Substring(start + 1, end - start - 1);
    }

    private static string BuildSystemPrompt(string action, bool isEn)
    {
        if (action == "generate_seo")
        {
            return isEn
                ? "You are an expert e-commerce SEO specialist. Return ONLY a valid JSON object matching this structure: { \"seoTitle\": \"Max 60 chars title\", \"seoDescription\": \"Max 160 chars descriptive, engaging, keyword-rich meta description\" }. Do not output any markdown formatting, prefix, or suffix other than the JSON object."
                : "Sen uzman bir e-ticaret SEO uzmanısın. YALNIZCA şu yapıda geçerli bir JSON objesi dön: { \"seoTitle\": \"Maks 60 karakter başlık\", \"seoDescription\": \"Maks 160 karakter etkileyici, anahtar kelime zengini meta açıklama\" }. JSON dışında hiçbir açıklama, kod bloğu veya metin yazma.";
        }

        if (action == "fix_description")
        {
            return isEn
                ? "You are a professional copywriter for Stilsoft KKTC, a premium technology and home appliances brand. Rewrite the provided draft product description to sound premium, fluent, marketing-oriented, and highly readable. Maintain all technical truths. Output only the rewritten text."
                : "Sen KKTC'nin lider teknoloji ve ev aletleri markası Stilsoft KKTC için çalışan profesyonel bir metin yazarısın. Sana verilen taslak ürün açıklamasını daha kurumsal, akıcı, satış odaklı ve profesyonel bir dile çevir. Teknik detayları doğru koru. Yalnızca düzeltilmiş metni yaz.";
        }

        if (action == "generate_short")
        {
            return isEn
                ? "You are a conversion rate optimization specialist. Write a short, bulleted or 2-line summary highlight of the product. Focus on its key unique selling points. Output only the short description."
                : "Sen dönüşüm oranı uzmanısın. Bu ürün için 2 satırlık veya kısa maddelerden oluşan, ürünü hemen satın aldırmaya teşvik edecek çarpıcı bir kısa açıklama yaz. Yalnızca bu kısa açıklamayı dön.";
        }

        if (action == "specs_to_desc")
        {
            return isEn
                ? "You are a technical copywriter. Convert the list of technical specifications into a beautifully structured, readable marketing description highlighting features and parameters. Output only the written description."
                : "Sen teknik bir metin yazarısın. Verilen teknik özellik listesini, akıcı ve güzel yapılandırılmış, özelliklerin faydalarını öne çıkaran bir pazarlama açıklamasına dönüştür. Yalnızca bu açıklamayı dön.";
        }

        return "You are an AI assistant.";
    }

    private static string BuildUserPrompt(string action, string productName, string? description, string? specsJson, bool isEn)
    {
        var sb = new StringBuilder();
        sb.AppendLine($"Product Name: {productName}");
        if (!string.IsNullOrWhiteSpace(description))
        {
            sb.AppendLine($"Current Description: {description}");
        }
        if (!string.IsNullOrWhiteSpace(specsJson))
        {
            sb.AppendLine($"Technical Specs: {specsJson}");
        }
        return sb.ToString();
    }

    private static AiGenerateResponse GenerateMockResponse(string action, string productName, string? currentDesc, string? specsJson, bool isEn)
    {
        var brand = "Stilsoft";
        var store = isEn ? "Stilsoft KKTC" : "Stilsoft KKTC";

        if (action == "generate_seo")
        {
            var title = isEn
                ? $"{productName} | Buy Online - {store}"
                : $"{productName} Fiyatı ve Özellikleri - {store}";

            var desc = isEn
                ? $"Explore the features and best prices of {productName} at {store}. Fast delivery and official warranty across Cyprus."
                : $"{productName} ev aletleri kategorisindeki en yeni teknolojisiyle {store}'ta! Uygun taksit seçenekleri ve hızlı teslimat avantajıyla hemen satın alın.";

            return new AiGenerateResponse
            {
                Success = true,
                SeoTitle = title,
                SeoDescription = desc
            };
        }

        if (action == "generate_short")
        {
            var summary = isEn
                ? $"Experience high performance and modern design with the {productName}. Specially crafted by {brand} to make your everyday tasks easier, cleaner, and faster."
                : $"Modern tasarımı ve yüksek çalışma performansı ile {productName}, evinizdeki en büyük yardımcınız olmaya aday. {brand} kalitesiyle uzun ömürlü kullanım sunar.";

            return new AiGenerateResponse
            {
                Success = true,
                Output = summary
            };
        }

        if (action == "specs_to_desc")
        {
            var sb = new StringBuilder();
            if (isEn)
            {
                sb.AppendLine($"The new {productName} brings efficiency and style to your home. Designed by {brand}, this product meets all modern technical requirements:");
            }
            else
            {
                sb.AppendLine($"Yeni {productName}, evinizde yüksek performans ve şıklığı bir araya getiriyor. {brand} mühendisliğiyle geliştirilen bu ürün, modern ev aletleri standartlarını baştan tanımlıyor:");
            }

            if (!string.IsNullOrWhiteSpace(specsJson))
            {
                try
                {
                    var dict = JsonSerializer.Deserialize<Dictionary<string, string>>(specsJson);
                    if (dict != null)
                    {
                        foreach (var kvp in dict)
                        {
                            sb.AppendLine($"- **{kvp.Key}**: {kvp.Value}");
                        }
                    }
                }
                catch
                {
                    sb.AppendLine(specsJson);
                }
            }

            return new AiGenerateResponse
            {
                Success = true,
                Output = sb.ToString()
            };
        }

        // default is fix_description
        var result = currentDesc;
        if (string.IsNullOrWhiteSpace(result))
        {
            result = isEn
                ? $"Introducing the premium {productName} from {brand}. Combining exceptional durability with smart controls, it delivers outstanding results. Shop now with confidence at {store}."
                : $"Karşınızda {brand} kalitesiyle üretilen premium {productName}. Üstün dayanıklılığı akıllı çalışma modları ile birleştiren bu ürün, ev işlerinizde maksimum konfor sağlar. {store} güvencesiyle hemen sipariş verin.";
        }
        else
        {
            result = isEn
                ? $"[Optimized] {result} - Brought to you with the quality assurance of {store}."
                : $"[Optimize Edildi] {result} - {store} güvencesi ve kalitesi ile evinize ulaşıyor.";
        }

        return new AiGenerateResponse
        {
            Success = true,
            Output = result
        };
    }
}
