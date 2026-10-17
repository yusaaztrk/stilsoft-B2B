using System.Security.Claims;
using Microsoft.AspNetCore.Mvc;
using Shop.Api.Admin;

namespace Shop.Api.Storefront;

/// <summary>
/// Vitrin ana sayfasındaki "Kataloglarımız" bölümü. PDF'in ham baytları
/// <see cref="StorefrontMediaStore"/>'da (banner görselleriyle aynı depo), kayıt burada.
/// </summary>
[ApiController]
[Route("api")]
public sealed class EcommerceCatalogsController : ControllerBase
{
    private readonly EcommerceCatalogStore _catalogs;
    private readonly StorefrontMediaStore _media;

    public EcommerceCatalogsController(EcommerceCatalogStore catalogs, StorefrontMediaStore media)
    {
        _catalogs = catalogs;
        _media = media;
    }

    private string CurrentUser =>
        (HttpContext.Items[B2BAdminAuthAttribute.PrincipalItemKey] as ClaimsPrincipal)?
            .FindFirst(ClaimTypes.Name)?.Value ?? "bayi";

    public sealed class CatalogView
    {
        public Guid Id { get; set; }
        public string Title { get; set; } = string.Empty;
        public string PdfUrl { get; set; } = string.Empty;
        public string? CoverImageUrl { get; set; }
        public int SortOrder { get; set; }
        public bool IsActive { get; set; }
    }

    private static CatalogView ToView(EcommerceCatalogDto c) => new()
    {
        Id = c.Id,
        Title = c.Title,
        PdfUrl = $"/api/storefront/media/{c.FileName}",
        CoverImageUrl = string.IsNullOrWhiteSpace(c.CoverFileName) ? null : $"/api/storefront/media/{c.CoverFileName}",
        SortOrder = c.SortOrder,
        IsActive = c.IsActive
    };

    // ---------- vitrinin okuduğu ----------

    /// <summary>Ana sayfadaki "Kataloglarımız" bölümü buradan okur — herkese açık.</summary>
    [HttpGet("catalogs")]
    public async Task<IActionResult> PublicList(CancellationToken ct)
    {
        var items = await _catalogs.ListActiveAsync(ct);
        return Ok(items.Select(ToView));
    }

    // ---------- bayinin yönettiği ----------

    [HttpGet("admin/catalogs")]
    [B2BAdminAuth]
    public async Task<IActionResult> List(CancellationToken ct)
    {
        var items = await _catalogs.ListAllAsync(ct);
        return Ok(items.Select(ToView));
    }

    public sealed class UpsertCatalogRequest
    {
        public string Title { get; set; } = string.Empty;
        public string FileName { get; set; } = string.Empty;
        public string? CoverFileName { get; set; }
        public int SortOrder { get; set; }
        public bool IsActive { get; set; } = true;
    }

    [HttpPost("admin/catalogs")]
    [B2BAdminAuth]
    public async Task<IActionResult> Create([FromBody] UpsertCatalogRequest request, CancellationToken ct)
    {
        var title = (request.Title ?? string.Empty).Trim();
        var fileName = (request.FileName ?? string.Empty).Trim();
        if (title.Length == 0) return BadRequest(new { message = "Başlık zorunludur." });
        if (fileName.Length == 0) return BadRequest(new { message = "Önce PDF yüklenmelidir." });

        var created = await _catalogs.CreateAsync(
            title, fileName,
            string.IsNullOrWhiteSpace(request.CoverFileName) ? null : request.CoverFileName.Trim(),
            request.SortOrder, request.IsActive, CurrentUser, ct);

        return Ok(ToView(created));
    }

    [HttpPut("admin/catalogs/{id:guid}")]
    [B2BAdminAuth]
    public async Task<IActionResult> Update(Guid id, [FromBody] UpsertCatalogRequest request, CancellationToken ct)
    {
        var title = (request.Title ?? string.Empty).Trim();
        var fileName = (request.FileName ?? string.Empty).Trim();
        if (title.Length == 0) return BadRequest(new { message = "Başlık zorunludur." });
        if (fileName.Length == 0) return BadRequest(new { message = "PDF zorunludur." });

        var ok = await _catalogs.UpdateAsync(
            id, title, fileName,
            string.IsNullOrWhiteSpace(request.CoverFileName) ? null : request.CoverFileName.Trim(),
            request.SortOrder, request.IsActive, CurrentUser, ct);

        if (!ok) return NotFound(new { message = "Katalog bulunamadı." });
        return Ok(new { success = true });
    }

    [HttpDelete("admin/catalogs/{id:guid}")]
    [B2BAdminAuth]
    public async Task<IActionResult> Delete(Guid id, CancellationToken ct)
    {
        var ok = await _catalogs.DeleteAsync(id, ct);
        if (!ok) return NotFound(new { message = "Katalog bulunamadı." });
        return Ok(new { success = true });
    }

    /// <summary>
    /// Katalog PDF yüklemesi. Uzantı/ContentType beyaz listesi <see cref="StorefrontMediaStore"/>'da;
    /// burada ayrıca dosyanın ilk baytları (%PDF imzası) doğrulanır — yalnız ContentType başlığına
    /// güvenilmez, o istemcinin beyanıdır.
    /// </summary>
    [HttpPost("admin/catalogs/pdf")]
    [B2BAdminAuth]
    [RequestSizeLimit(StorefrontMediaStore.MaxPdfBytes + 1024)]
    public async Task<IActionResult> UploadPdf(IFormFile file, CancellationToken ct)
    {
        if (file is null || file.Length == 0)
        {
            return BadRequest(new { message = "Dosya seçilmedi." });
        }

        if (file.Length > StorefrontMediaStore.MaxPdfBytes)
        {
            return BadRequest(new { message = "PDF en fazla 30 MB olabilir." });
        }

        if (!string.Equals(Path.GetExtension(file.FileName), ".pdf", StringComparison.OrdinalIgnoreCase))
        {
            return BadRequest(new { message = "Yalnızca PDF dosyası yükleyebilirsiniz." });
        }

        await using var stream = new MemoryStream();
        await file.CopyToAsync(stream, ct);
        var bytes = stream.ToArray();

        var isPdf = bytes.Length >= 4 && bytes[0] == 0x25 && bytes[1] == 0x50 && bytes[2] == 0x44 && bytes[3] == 0x46; // %PDF
        if (!isPdf)
        {
            return BadRequest(new { message = "Dosya içeriği PDF değil." });
        }

        var fileName = await _media.SaveAsync(bytes, "application/pdf", CurrentUser, ct);
        return Ok(new { fileName, url = $"/api/storefront/media/{fileName}" });
    }
}
