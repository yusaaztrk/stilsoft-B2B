using B2B.Erp.Api.Core.Options;
using B2B.Erp.Api.DTOs.Assistant;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;
using System.Text;
using System.Text.Json;

namespace B2B.Erp.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
[Authorize]
public sealed class AssistantController : ControllerBase
{
    private readonly GroqSettings _settings;
    private readonly IHttpClientFactory _httpClientFactory;

    public AssistantController(IOptions<GroqSettings> settings, IHttpClientFactory httpClientFactory)
    {
        _settings = settings.Value;
        _httpClientFactory = httpClientFactory;
    }

    [HttpPost("chat")]
    public async Task<IActionResult> Chat([FromBody] AssistantChatRequest request, CancellationToken cancellationToken)
    {
        var apiKey = (_settings.ApiKey ?? string.Empty).Trim();
        if (string.IsNullOrWhiteSpace(apiKey))
        {
            return StatusCode(500, new AssistantChatResponse
            {
                Success = false,
                Answer = string.Empty,
                Error = "Groq API key is not configured on the server."
            });
        }

        var model = string.IsNullOrWhiteSpace(_settings.Model)
            ? "llama-3.3-70b-versatile"
            : _settings.Model.Trim();

        var pageKey = (request.PageKey ?? string.Empty).Trim();
        var pageTitle = (request.PageTitle ?? string.Empty).Trim();
        var pageDescription = (request.PageDescription ?? string.Empty).Trim();

        var userQuestion = (request.Question ?? string.Empty).Trim();
        if (string.IsNullOrWhiteSpace(userQuestion))
        {
            userQuestion = "Bu sayfayı, programı hiç bilmeyen bir kullanıcıya öğretici şekilde açıkla.";
        }

        var systemPrompt =
            "Sen B2B-ERP uygulamasının öğretici asistanısın. " +
            "Kullanıcı programı hiç bilmiyor. Yanıtın tek paragraf, anlaşılır ve pratik olmalı. " +
            "Eğer bilgi bankasında yeterli bilgi yoksa, net olmayan noktaları varsayma; kullanıcıya ek soru sor veya genel yönlendirme yap.";

        var kb = new StringBuilder();
        if (!string.IsNullOrWhiteSpace(pageKey)) kb.AppendLine($"Sayfa anahtarı: {pageKey}");
        if (!string.IsNullOrWhiteSpace(pageTitle)) kb.AppendLine($"Sayfa adı: {pageTitle}");
        if (!string.IsNullOrWhiteSpace(pageDescription)) kb.AppendLine($"Bilgi bankası paragrafı: {pageDescription}");

        var payload = new
        {
            model,
            temperature = 0.2,
            max_tokens = 450,
            messages = new object[]
            {
                new { role = "system", content = systemPrompt },
                new { role = "system", content = "Aşağıdaki bilgi bankasını kaynak kabul et:\n" + kb.ToString().Trim() },
                new { role = "user", content = userQuestion }
            }
        };

        var http = _httpClientFactory.CreateClient("Groq");
        http.DefaultRequestHeaders.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", apiKey);

        var json = JsonSerializer.Serialize(payload);
        using var content = new StringContent(json, Encoding.UTF8, "application/json");

        HttpResponseMessage resp;
        try
        {
            resp = await http.PostAsync("chat/completions", content, cancellationToken);
        }
        catch (Exception ex)
        {
            return StatusCode(502, new AssistantChatResponse
            {
                Success = false,
                Answer = string.Empty,
                Error = ex.Message
            });
        }

        var body = await resp.Content.ReadAsStringAsync(cancellationToken);
        if (!resp.IsSuccessStatusCode)
        {
            return StatusCode((int)resp.StatusCode, new AssistantChatResponse
            {
                Success = false,
                Answer = string.Empty,
                Error = body
            });
        }

        try
        {
            using var doc = JsonDocument.Parse(body);
            var root = doc.RootElement;

            var answer = root
                .GetProperty("choices")[0]
                .GetProperty("message")
                .GetProperty("content")
                .GetString();

            return Ok(new AssistantChatResponse
            {
                Success = true,
                Answer = (answer ?? string.Empty).Trim(),
                Error = null
            });
        }
        catch (Exception ex)
        {
            return StatusCode(502, new AssistantChatResponse
            {
                Success = false,
                Answer = string.Empty,
                Error = "Failed to parse Groq response: " + ex.Message
            });
        }
    }
}
