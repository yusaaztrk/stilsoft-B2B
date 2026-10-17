using Ecommerce.Api.Infrastructure.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.StaticFiles;

namespace Ecommerce.Api.Controllers;

[ApiController]
[Route("api/admin/products/{productId:guid}/images")]
[Authorize(Roles = "Owner,Admin")]
public sealed class AdminProductImagesController : ControllerBase
{
    private readonly ProductsRepository _products;
    private readonly IWebHostEnvironment _env;

    public AdminProductImagesController(ProductsRepository products, IWebHostEnvironment env)
    {
        _products = products;
        _env = env;
    }

    [HttpGet]
    public async Task<IActionResult> List([FromRoute] Guid productId, [FromQuery] string productTenantCode, CancellationToken cancellationToken)
    {
        var tenant = (productTenantCode ?? string.Empty).Trim().ToUpperInvariant();
        if (string.IsNullOrWhiteSpace(tenant))
            return BadRequest(new { success = false, message = "productTenantCode zorunlu" });
        if (productId == Guid.Empty)
            return BadRequest(new { success = false, message = "productId zorunlu" });

        var p = await _products.GetAsync(tenant, productId, cancellationToken);
        if (p is null)
            return NotFound(new { success = false, message = "Ürün bulunamadı" });

        return Ok(new
        {
            success = true,
            data = new
            {
                imageUrl = p.ImageUrl,
                imageUrls = p.ImageUrls ?? new List<string>()
            }
        });
    }

    [HttpPost]
    [RequestSizeLimit(15_000_000)]
    public async Task<IActionResult> Upload([FromRoute] Guid productId, [FromQuery] string productTenantCode, [FromForm] IFormFile file, CancellationToken cancellationToken)
    {
        var tenant = (productTenantCode ?? string.Empty).Trim().ToUpperInvariant();
        if (string.IsNullOrWhiteSpace(tenant))
            return BadRequest(new { success = false, message = "productTenantCode zorunlu" });
        if (productId == Guid.Empty)
            return BadRequest(new { success = false, message = "productId zorunlu" });
        if (file is null || file.Length == 0)
            return BadRequest(new { success = false, message = "file zorunlu" });

        var p = await _products.GetAsync(tenant, productId, cancellationToken);
        if (p is null)
            return NotFound(new { success = false, message = "Ürün bulunamadı" });

        var uploadsRoot = Path.Combine(_env.ContentRootPath, "wwwroot", "uploads", "ecommerce", "products");
        Directory.CreateDirectory(uploadsRoot);

        var ext = Path.GetExtension(file.FileName);
        if (string.IsNullOrWhiteSpace(ext))
        {
            var provider = new FileExtensionContentTypeProvider();
            if (!provider.TryGetContentType(file.FileName, out _))
                ext = ".bin";
        }

        var safeName = $"{productId:N}-{Guid.NewGuid():N}{ext}";
        var absPath = Path.Combine(uploadsRoot, safeName);

        await using (var fs = System.IO.File.Create(absPath))
        {
            await file.CopyToAsync(fs, cancellationToken);
        }

        var publicUrl = $"/uploads/ecommerce/products/{safeName}";

        var urls = (p.ImageUrls ?? new List<string>()).Select(x => (x ?? string.Empty).Trim()).Where(x => x.Length > 0).ToList();
        if (!urls.Contains(publicUrl, StringComparer.Ordinal))
            urls.Insert(0, publicUrl);

        var cover = string.IsNullOrWhiteSpace(p.ImageUrl) ? publicUrl : p.ImageUrl;
        await _products.SetImagesAsync(tenant, productId, cover, urls, cancellationToken);

        return Ok(new { success = true, data = new { imageUrl = cover, imageUrls = urls } });
    }

    public sealed class SetCoverRequest
    {
        public string ProductTenantCode { get; set; } = string.Empty;
        public string ImageUrl { get; set; } = string.Empty;
    }

    [HttpPut("cover")]
    public async Task<IActionResult> SetCover([FromRoute] Guid productId, [FromBody] SetCoverRequest request, CancellationToken cancellationToken)
    {
        var tenant = (request.ProductTenantCode ?? string.Empty).Trim().ToUpperInvariant();
        if (string.IsNullOrWhiteSpace(tenant))
            return BadRequest(new { success = false, message = "productTenantCode zorunlu" });
        if (productId == Guid.Empty)
            return BadRequest(new { success = false, message = "productId zorunlu" });

        var imageUrl = (request.ImageUrl ?? string.Empty).Trim();
        if (string.IsNullOrWhiteSpace(imageUrl))
            return BadRequest(new { success = false, message = "imageUrl zorunlu" });

        var p = await _products.GetAsync(tenant, productId, cancellationToken);
        if (p is null)
            return NotFound(new { success = false, message = "Ürün bulunamadı" });

        var urls = (p.ImageUrls ?? new List<string>()).Select(x => (x ?? string.Empty).Trim()).Where(x => x.Length > 0).ToList();
        if (!urls.Contains(imageUrl, StringComparer.Ordinal))
            urls.Insert(0, imageUrl);

        await _products.SetImagesAsync(tenant, productId, imageUrl, urls, cancellationToken);
        return Ok(new { success = true, data = new { imageUrl, imageUrls = urls } });
    }

    public sealed class AddUrlRequest
    {
        public string ProductTenantCode { get; set; } = string.Empty;
        public string ImageUrl { get; set; } = string.Empty;
    }

    [HttpPost("add-url")]
    public async Task<IActionResult> AddUrl([FromRoute] Guid productId, [FromBody] AddUrlRequest request, CancellationToken cancellationToken)
    {
        var tenant = (request.ProductTenantCode ?? string.Empty).Trim().ToUpperInvariant();
        if (string.IsNullOrWhiteSpace(tenant))
            return BadRequest(new { success = false, message = "productTenantCode zorunlu" });
        if (productId == Guid.Empty)
            return BadRequest(new { success = false, message = "productId zorunlu" });

        var imageUrl = (request.ImageUrl ?? string.Empty).Trim();
        if (string.IsNullOrWhiteSpace(imageUrl))
            return BadRequest(new { success = false, message = "imageUrl zorunlu" });

        var p = await _products.GetAsync(tenant, productId, cancellationToken);
        if (p is null)
            return NotFound(new { success = false, message = "Ürün bulunamadı" });

        var urls = (p.ImageUrls ?? new List<string>()).Select(x => (x ?? string.Empty).Trim()).Where(x => x.Length > 0).ToList();
        if (!urls.Contains(imageUrl, StringComparer.Ordinal))
            urls.Add(imageUrl);

        var cover = string.IsNullOrWhiteSpace(p.ImageUrl) ? imageUrl : p.ImageUrl;
        if (string.IsNullOrWhiteSpace(cover) && urls.Count > 0)
            cover = urls[0];

        await _products.SetImagesAsync(tenant, productId, cover, urls, cancellationToken);
        return Ok(new { success = true, data = new { imageUrl = cover, imageUrls = urls } });
    }

    [HttpDelete("remove-url")]
    public async Task<IActionResult> RemoveUrl([FromRoute] Guid productId, [FromQuery] string productTenantCode, [FromQuery] string imageUrl, CancellationToken cancellationToken)
    {
        var tenant = (productTenantCode ?? string.Empty).Trim().ToUpperInvariant();
        if (string.IsNullOrWhiteSpace(tenant))
            return BadRequest(new { success = false, message = "productTenantCode zorunlu" });
        if (productId == Guid.Empty)
            return BadRequest(new { success = false, message = "productId zorunlu" });

        var targetUrl = (imageUrl ?? string.Empty).Trim();
        if (string.IsNullOrWhiteSpace(targetUrl))
            return BadRequest(new { success = false, message = "imageUrl zorunlu" });

        var p = await _products.GetAsync(tenant, productId, cancellationToken);
        if (p is null)
            return NotFound(new { success = false, message = "Ürün bulunamadı" });

        var urls = (p.ImageUrls ?? new List<string>())
            .Select(x => (x ?? string.Empty).Trim())
            .Where(x => x.Length > 0 && !x.Equals(targetUrl, StringComparison.Ordinal))
            .ToList();

        string? cover = p.ImageUrl;
        if (cover != null && cover.Trim().Equals(targetUrl, StringComparison.Ordinal))
        {
            cover = urls.Count > 0 ? urls[0] : null;
        }

        await _products.SetImagesAsync(tenant, productId, cover, urls, cancellationToken);
        return Ok(new { success = true, data = new { imageUrl = cover, imageUrls = urls } });
    }

    public sealed class ReorderRequest
    {
        public string ProductTenantCode { get; set; } = string.Empty;
        public List<string> ImageUrls { get; set; } = new();
    }

    [HttpPut("reorder")]
    public async Task<IActionResult> Reorder([FromRoute] Guid productId, [FromBody] ReorderRequest request, CancellationToken cancellationToken)
    {
        var tenant = (request.ProductTenantCode ?? string.Empty).Trim().ToUpperInvariant();
        if (string.IsNullOrWhiteSpace(tenant))
            return BadRequest(new { success = false, message = "productTenantCode zorunlu" });
        if (productId == Guid.Empty)
            return BadRequest(new { success = false, message = "productId zorunlu" });

        var p = await _products.GetAsync(tenant, productId, cancellationToken);
        if (p is null)
            return NotFound(new { success = false, message = "Ürün bulunamadı" });

        var newUrls = request.ImageUrls ?? new List<string>();
        string? cover = p.ImageUrl;
        if (string.IsNullOrWhiteSpace(cover) || !newUrls.Contains(cover, StringComparer.Ordinal))
        {
            cover = newUrls.Count > 0 ? newUrls[0] : null;
        }

        await _products.SetImagesAsync(tenant, productId, cover, newUrls, cancellationToken);
        return Ok(new { success = true, data = new { imageUrl = cover, imageUrls = newUrls } });
    }
}
