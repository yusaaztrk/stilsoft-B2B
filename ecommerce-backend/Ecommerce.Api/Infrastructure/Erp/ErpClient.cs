using System.Net.Http.Headers;
using System.Net;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Options;

namespace Ecommerce.Api.Infrastructure.Erp;

public sealed class ErpClient
{
    public const string HttpClientName = "erp";

    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    private readonly HttpClient _http;
    private readonly ErpTenantGuard _tenantGuard;
    private readonly IOptions<ErpOptions> _options;
    private readonly ErpTokenCache _tokenCache;

    public ErpClient(
        IHttpClientFactory httpClientFactory,
        ErpTenantGuard tenantGuard,
        IOptions<ErpOptions> options,
        ErpTokenCache tokenCache)
    {
        _http = httpClientFactory.CreateClient(HttpClientName);
        _tenantGuard = tenantGuard;
        _options = options;
        _tokenCache = tokenCache;
    }

    public async Task<JsonElement> LoginAsync(string username, string password, CancellationToken cancellationToken)
    {
        username = (username ?? string.Empty).Trim();
        if (string.IsNullOrWhiteSpace(username) || string.IsNullOrWhiteSpace(password))
            throw new InvalidOperationException("ERP login requires username and password.");

        var tenantCode = _tenantGuard.GetTenantCode();

        using var req = new HttpRequestMessage(HttpMethod.Post, "api/auth/login");
        req.Headers.TryAddWithoutValidation("X-Tenant-Code", tenantCode);

        var payload = new
        {
            username,
            password,
            tenantCode
        };

        req.Content = new StringContent(JsonSerializer.Serialize(payload, JsonOptions), Encoding.UTF8, "application/json");

        using var res = await _http.SendAsync(req, cancellationToken);
        var body = await res.Content.ReadAsStringAsync(cancellationToken);
        if (!res.IsSuccessStatusCode)
        {
            throw BuildErpException((HttpStatusCode)res.StatusCode, "ERP login failed", body);
        }

        using var doc = JsonDocument.Parse(body);
        return doc.RootElement.Clone();
    }

    public async Task<string> GetServiceAccessTokenAsync(CancellationToken cancellationToken)
    {
        if (_tokenCache.TryGet(out var existing))
        {
            return existing;
        }

        var opt = _options.Value;
        if (string.IsNullOrWhiteSpace(opt.ServiceUsername) || string.IsNullOrWhiteSpace(opt.ServicePassword))
            throw new InvalidOperationException("Erp:ServiceUsername and Erp:ServicePassword must be configured.");

        var root = await LoginAsync(opt.ServiceUsername, opt.ServicePassword, cancellationToken);
        var data = root.TryGetProperty("data", out var d) ? d : default;
        var token = data.ValueKind != JsonValueKind.Undefined && data.TryGetProperty("accessToken", out var t)
            ? t.GetString()
            : null;

        if (string.IsNullOrWhiteSpace(token))
            throw new InvalidOperationException("ERP login succeeded but accessToken not found.");

        // ERP token lifetime is not known here; cache with a safe default.
        _tokenCache.Set(token!, DateTimeOffset.UtcNow.AddHours(1));

        return token!;
    }

    private async Task<HttpRequestMessage> CreateAuthedRequestAsync(HttpMethod method, string relativeUrl, CancellationToken cancellationToken)
    {
        var tenantCode = _tenantGuard.GetTenantCode();
        var token = await GetServiceAccessTokenAsync(cancellationToken);

        var req = new HttpRequestMessage(method, relativeUrl);
        req.Headers.TryAddWithoutValidation("X-Tenant-Code", tenantCode);
        req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return req;
    }

    public async Task<JsonElement> GetJsonAsync(string relativeUrl, CancellationToken cancellationToken)
    {
        using var req = await CreateAuthedRequestAsync(HttpMethod.Get, relativeUrl, cancellationToken);
        using var res = await _http.SendAsync(req, cancellationToken);
        var body = await res.Content.ReadAsStringAsync(cancellationToken);
        if (!res.IsSuccessStatusCode)
            throw BuildErpException((HttpStatusCode)res.StatusCode, $"ERP GET {relativeUrl} failed", body);

        using var doc = JsonDocument.Parse(body);
        return doc.RootElement.Clone();
    }

    public async Task<JsonElement> PostJsonAsync(string relativeUrl, object payload, CancellationToken cancellationToken)
    {
        using var req = await CreateAuthedRequestAsync(HttpMethod.Post, relativeUrl, cancellationToken);
        req.Content = new StringContent(JsonSerializer.Serialize(payload, JsonOptions), Encoding.UTF8, "application/json");

        using var res = await _http.SendAsync(req, cancellationToken);
        var body = await res.Content.ReadAsStringAsync(cancellationToken);
        if (!res.IsSuccessStatusCode)
            throw BuildErpException((HttpStatusCode)res.StatusCode, $"ERP POST {relativeUrl} failed", body);

        using var doc = JsonDocument.Parse(body);
        return doc.RootElement.Clone();
    }

    private static ErpRequestException BuildErpException(HttpStatusCode statusCode, string fallbackMessage, string body)
    {
        try
        {
            using var doc = JsonDocument.Parse(body);
            var root = doc.RootElement;
            var msg = root.TryGetProperty("message", out var m) ? m.GetString() : null;
            var err = root.TryGetProperty("error", out var e) ? e.GetString() : null;
            var combined = string.Join(" - ", new[] { msg, err }.Where(x => !string.IsNullOrWhiteSpace(x)));
            if (string.IsNullOrWhiteSpace(combined)) combined = fallbackMessage;
            return new ErpRequestException(statusCode, combined, body);
        }
        catch
        {
            return new ErpRequestException(statusCode, fallbackMessage, body);
        }
    }
}
