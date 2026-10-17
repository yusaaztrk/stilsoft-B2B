using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace B2B.Erp.Api.Controllers;

[ApiController]
[Route("api/ecommerce")]
[Authorize]
public sealed class EcommerceController : ControllerBase
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    private readonly IHttpClientFactory _httpClientFactory;
    private readonly IConfiguration _config;
    private readonly ILogger<EcommerceController> _logger;

    public EcommerceController(IHttpClientFactory httpClientFactory, IConfiguration config, ILogger<EcommerceController> logger)
    {
        _httpClientFactory = httpClientFactory;
        _config = config;
        _logger = logger;
    }

    public sealed class ImportProduct
    {
        public Guid ErpProductId { get; set; }
        public string? StockCode { get; set; }
        public string? Name { get; set; }
        public decimal? UnitPrice { get; set; }
        public string? Currency { get; set; }
        public int? Stock { get; set; }
        public bool? IsActive { get; set; }
        public string? ImageUrl { get; set; }
        public List<string>? ImageUrls { get; set; }
    }

    public sealed class ImportProductsRequest
    {
        public List<ImportProduct> Items { get; set; } = new();
    }

    [HttpPost("import-products")]
    public async Task<IActionResult> ImportProducts([FromBody] ImportProductsRequest request, CancellationToken cancellationToken)
    {
        // Firma kodu ÖNCE başlıktan, yoksa JETONDAN okunur. Yalnız başlığa bakılıyordu:
        // başlığı göndermeyen (ama geçerli jetonla gelen) entegrasyon çağrıları 400 alıyordu,
        // oysa firma bilgisi jetonun içinde zaten var. Jeton bu alanı iki yazımla taşıyabiliyor.
        var tenantCode = Request.Headers.TryGetValue("X-Tenant-Code", out var t)
            ? t.ToString().Trim().ToUpperInvariant()
            : string.Empty;

        if (string.IsNullOrWhiteSpace(tenantCode))
        {
            tenantCode = (User.FindFirst("TenantCode")?.Value
                          ?? User.FindFirst("tenantCode")?.Value
                          ?? string.Empty).Trim().ToUpperInvariant();
        }

        if (string.IsNullOrWhiteSpace(tenantCode))
        {
            return BadRequest(new { success = false, message = "X-Tenant-Code header is required" });
        }

        var baseUrl = (_config["EcommerceIntegration:BaseUrl"] ?? string.Empty).Trim();
        var secret = (_config["EcommerceIntegration:ImportSecret"] ?? string.Empty).Trim();

        if (string.IsNullOrWhiteSpace(baseUrl) || string.IsNullOrWhiteSpace(secret))
        {
            return StatusCode(StatusCodes.Status500InternalServerError, new { success = false, message = "EcommerceIntegration config missing" });
        }

        var items = request?.Items ?? new List<ImportProduct>();
        items = items.Where(x => x.ErpProductId != Guid.Empty).ToList();
        if (items.Count == 0)
        {
            return BadRequest(new { success = false, message = "items is required" });
        }

        if (!baseUrl.EndsWith("/")) baseUrl += "/";
        var url = baseUrl + "internal/import/products";

        try
        {
            var http = _httpClientFactory.CreateClient();

            using var req = new HttpRequestMessage(HttpMethod.Post, url);
            req.Headers.TryAddWithoutValidation("X-Internal-Secret", secret);
            req.Headers.TryAddWithoutValidation("X-Tenant-Code", tenantCode);

            var payload = new
            {
                items = items.Select(x => new
                {
                    erpProductId = x.ErpProductId,
                    stockCode = x.StockCode,
                    name = x.Name,
                    unitPrice = x.UnitPrice,
                    currency = x.Currency,
                    stock = x.Stock,
                    isActive = x.IsActive,
                    imageUrl = x.ImageUrl,
                    imageUrls = x.ImageUrls
                }).ToList()
            };

            req.Content = new StringContent(JsonSerializer.Serialize(payload, JsonOptions), Encoding.UTF8, "application/json");

            using var res = await http.SendAsync(req, cancellationToken);
            var body = await res.Content.ReadAsStringAsync(cancellationToken);
            if (!res.IsSuccessStatusCode)
            {
                _logger.LogWarning(
                    "Ecommerce import failed. status={StatusCode} tenant={TenantCode} body={Body}",
                    (int)res.StatusCode,
                    tenantCode,
                    body);

                return StatusCode(StatusCodes.Status502BadGateway, new
                {
                    success = false,
                    message = "E-commerce import failed",
                    status = (int)res.StatusCode,
                    details = body
                });
            }

            object? parsed;
            try
            {
                parsed = JsonSerializer.Deserialize<object>(body, JsonOptions);
            }
            catch
            {
                parsed = null;
            }

            return Ok(new { success = true, data = parsed });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Ecommerce import threw exception. tenant={TenantCode}", tenantCode);
            return StatusCode(StatusCodes.Status500InternalServerError, new { success = false, message = ex.Message });
        }
    }
}
