using Microsoft.AspNetCore.Mvc;

namespace Shop.Api.Media;

/// <summary>
/// Ürün görsellerini vitrine servis eder.
///
/// Görseller ERP'nin statik klasöründe duruyor (wwwroot/uploads/products) ama ERP'nin kendisi
/// internete açılmayacak — mimarinin temel kararı bu. Vitrin de tarayıcıya ERP adresini veremez.
/// Bu uç aradaki köprü: dışarıya yalnızca mağaza API'si görünür, dosya ERP'den okunur.
///
/// Yalnızca <c>uploads/</c> altındaki yollar geçer. Aksi halde adres satırına yazılan bir yol
/// ERP'nin başka dosyalarını dışarı açardı — vekil uçların klasik açığı budur.
/// </summary>
[ApiController]
[Route("api/media")]
public sealed class MediaController : ControllerBase
{
    private readonly IHttpClientFactory _httpClientFactory;
    private readonly IConfiguration _configuration;

    public MediaController(IHttpClientFactory httpClientFactory, IConfiguration configuration)
    {
        _httpClientFactory = httpClientFactory;
        _configuration = configuration;
    }

    private static readonly Dictionary<string, string> ContentTypes = new(StringComparer.OrdinalIgnoreCase)
    {
        [".webp"] = "image/webp",
        [".jpg"] = "image/jpeg",
        [".jpeg"] = "image/jpeg",
        [".png"] = "image/png",
        [".gif"] = "image/gif",
        [".svg"] = "image/svg+xml",
    };

    private static readonly System.Collections.Concurrent.ConcurrentDictionary<string, (byte[] bytes, string contentType)> Cache = new(StringComparer.OrdinalIgnoreCase);

    [HttpGet("{**path}")]
    public async Task<IActionResult> Get(string path, CancellationToken cancellationToken)
    {
        var normalized = (path ?? string.Empty).Replace('\\', '/').TrimStart('/');

        // Üst dizine çıkma denemeleri ve beklenmeyen uzantılar burada durur.
        if (normalized.Contains("..", StringComparison.Ordinal) ||
            !normalized.StartsWith("uploads/", StringComparison.OrdinalIgnoreCase))
        {
            return NotFound();
        }

        var extension = Path.GetExtension(normalized);
        if (!ContentTypes.TryGetValue(extension, out var contentType))
        {
            return NotFound();
        }

        if (Cache.TryGetValue(normalized, out var cached))
        {
            Response.Headers.CacheControl = "public, max-age=31536000, immutable";
            return File(cached.bytes, cached.contentType);
        }

        var erpBaseUrl = (_configuration["Erp:BaseUrl"] ?? "http://localhost:5200").TrimEnd('/');

        var client = _httpClientFactory.CreateClient();
        client.Timeout = TimeSpan.FromSeconds(15);

        try
        {
            var response = await client.GetAsync($"{erpBaseUrl}/{normalized}", cancellationToken);
            if (!response.IsSuccessStatusCode) return NotFound();

            var bytes = await response.Content.ReadAsByteArrayAsync(cancellationToken);

            Cache[normalized] = (bytes, contentType);

            Response.Headers.CacheControl = "public, max-age=31536000, immutable";
            return File(bytes, contentType);
        }
        catch (Exception)
        {
            return NotFound();
        }
    }
}
