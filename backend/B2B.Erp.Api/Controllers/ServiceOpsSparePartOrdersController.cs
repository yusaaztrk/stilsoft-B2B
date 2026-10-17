using System.Net.Http.Headers;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace B2B.Erp.Api.Controllers;

[ApiController]
[Route("api/service-ops/spare-part-order-requests")]
[Authorize]
public sealed class ServiceOpsSparePartOrdersController : ControllerBase
{
    private readonly IHttpClientFactory _httpClientFactory;
    private readonly IConfiguration _configuration;

    public ServiceOpsSparePartOrdersController(IHttpClientFactory httpClientFactory, IConfiguration configuration)
    {
        _httpClientFactory = httpClientFactory;
        _configuration = configuration;
    }

    [HttpGet]
    public async Task<IActionResult> Get([FromQuery] string? status, CancellationToken cancellationToken)
    {
        var baseUrl = (_configuration["ServiceOps:BaseUrl"] ?? "http://localhost:5137").Trim();
        if (!baseUrl.EndsWith("/", StringComparison.Ordinal)) baseUrl += "/";

        var tenantCode = Request.Headers["X-Tenant-Code"].FirstOrDefault()
            ?? User.FindFirst("TenantCode")?.Value
            ?? User.FindFirst("tenantCode")?.Value;

        if (string.IsNullOrWhiteSpace(tenantCode))
        {
            return Unauthorized(new { success = false, message = "tenantCode bulunamadı" });
        }

        var qs = string.IsNullOrWhiteSpace(status) ? string.Empty : $"?status={Uri.EscapeDataString(status.Trim())}";
        var url = $"api/SparePartOrderRequests{qs}";

        var client = _httpClientFactory.CreateClient();
        // Sunucu-sunucu kimligi: ServiceOps tarafinda bu uclar artik anahtar istiyor.
        var soKey = _configuration["ServiceOps:InternalApiKey"];
        if (!string.IsNullOrWhiteSpace(soKey)) client.DefaultRequestHeaders.Add("X-ServiceOps-Key", soKey);
        client.BaseAddress = new Uri(baseUrl);

        var authHeader = Request.Headers["Authorization"].FirstOrDefault();
        if (!string.IsNullOrWhiteSpace(authHeader))
        {
            client.DefaultRequestHeaders.TryAddWithoutValidation("Authorization", authHeader);
        }
        client.DefaultRequestHeaders.Remove("X-Tenant-Code");
        client.DefaultRequestHeaders.Add("X-Tenant-Code", tenantCode);

        using var req = new HttpRequestMessage(HttpMethod.Get, url);
        var res = await client.SendAsync(req, cancellationToken);
        var body = await res.Content.ReadAsStringAsync(cancellationToken);

        if (!res.IsSuccessStatusCode)
        {
            return StatusCode((int)res.StatusCode, body);
        }

        return Content(body, "application/json");
    }

    [HttpPost("{id:guid}/complete")]
    public async Task<IActionResult> Complete(Guid id, CancellationToken cancellationToken)
    {
        var baseUrl = (_configuration["ServiceOps:BaseUrl"] ?? "http://localhost:5137").Trim();
        if (!baseUrl.EndsWith("/", StringComparison.Ordinal)) baseUrl += "/";

        var tenantCode = Request.Headers["X-Tenant-Code"].FirstOrDefault()
            ?? User.FindFirst("TenantCode")?.Value
            ?? User.FindFirst("tenantCode")?.Value;

        if (string.IsNullOrWhiteSpace(tenantCode))
        {
            return Unauthorized(new { success = false, message = "tenantCode bulunamadı" });
        }

        var client = _httpClientFactory.CreateClient();
        // Sunucu-sunucu kimligi: ServiceOps tarafinda bu uclar artik anahtar istiyor.
        var soKey = _configuration["ServiceOps:InternalApiKey"];
        if (!string.IsNullOrWhiteSpace(soKey)) client.DefaultRequestHeaders.Add("X-ServiceOps-Key", soKey);
        client.BaseAddress = new Uri(baseUrl);

        var authHeader = Request.Headers["Authorization"].FirstOrDefault();
        if (!string.IsNullOrWhiteSpace(authHeader))
        {
            client.DefaultRequestHeaders.TryAddWithoutValidation("Authorization", authHeader);
        }
        client.DefaultRequestHeaders.Remove("X-Tenant-Code");
        client.DefaultRequestHeaders.Add("X-Tenant-Code", tenantCode);

        using var req = new HttpRequestMessage(HttpMethod.Post, $"api/SparePartOrderRequests/{id}/complete");
        req.Content = new StringContent("{}", System.Text.Encoding.UTF8, "application/json");

        var res = await client.SendAsync(req, cancellationToken);
        var body = await res.Content.ReadAsStringAsync(cancellationToken);

        if (!res.IsSuccessStatusCode)
        {
            return StatusCode((int)res.StatusCode, body);
        }

        return Content(body, "application/json");
    }
}
