using System.Security.Claims;
using Microsoft.AspNetCore.Mvc;
using Shop.Api.Admin;

namespace Shop.Api.Storefront;

/// <summary>
/// İçerik sayfaları: vitrinin okuduğu uçlar herkese açık, bayinin yazdıkları bayi oturumu ister.
///
/// Vitrin yalnızca YAYINDAKİ sayfaları görebiliyor. Taslak bir sayfanın adresini bilen birinin
/// onu okuyabilmesi, "yayına almadım" demenin karşılığının olmaması demek olurdu.
/// </summary>
[ApiController]
[Route("api")]
public sealed class ContentPagesController : ControllerBase
{
    private readonly ContentPageStore _pages;

    public ContentPagesController(ContentPageStore pages)
    {
        _pages = pages;
    }

    private string CurrentUser =>
        (HttpContext.Items[B2BAdminAuthAttribute.PrincipalItemKey] as ClaimsPrincipal)?
            .FindFirst(ClaimTypes.Name)?.Value ?? "bayi";

    // ---------- vitrinin okuduğu ----------

    /// <summary>Yayındaki sayfalar — vitrin menüsü ve site haritası için.</summary>
    [HttpGet("pages")]
    public async Task<IActionResult> Published(CancellationToken ct)
    {
        var pages = await _pages.ListAsync(onlyPublished: true, ct);

        // Liste ucu GÖVDE DÖNDÜRMÜYOR: menü ve site haritası için ad ve adres yeterli, her
        // sayfanın tam metnini taşımak listeyi gereksiz büyütürdü.
        return Ok(pages.Select(p => new
        {
            p.Slug,
            p.Title,
            p.Summary,
            p.ShowInFooter,
            p.SortOrder,
            p.UpdatedAt
        }));
    }

    [HttpGet("pages/{slug}")]
    public async Task<IActionResult> Get(string slug, CancellationToken ct)
    {
        var page = await _pages.GetBySlugAsync(slug, onlyPublished: true, ct);
        if (page is null) return NotFound(new { message = "Sayfa bulunamadı." });

        return Ok(new { page.Slug, page.Title, page.Summary, page.Body, page.UpdatedAt });
    }

    // ---------- bayinin yönettiği ----------

    [HttpGet("admin/pages")]
    [B2BAdminAuth]
    public async Task<IActionResult> AdminList(CancellationToken ct)
        => Ok(new { success = true, data = await _pages.ListAsync(onlyPublished: false, ct) });

    public sealed class SaveRequest
    {
        public Guid Id { get; set; }
        public string Slug { get; set; } = string.Empty;
        public string Title { get; set; } = string.Empty;
        public string? Summary { get; set; }
        public string Body { get; set; } = string.Empty;
        public bool IsPublished { get; set; }
        public bool ShowInFooter { get; set; }
        public int SortOrder { get; set; }
    }

    [HttpPost("admin/pages")]
    [B2BAdminAuth]
    public async Task<IActionResult> Save([FromBody] SaveRequest request, CancellationToken ct)
    {
        if (request is null) return BadRequest(new { message = "İçerik boş olamaz." });

        var page = new ContentPage
        {
            Id = request.Id,
            Slug = request.Slug,
            Title = request.Title,
            Summary = request.Summary,
            Body = request.Body,
            IsPublished = request.IsPublished,
            ShowInFooter = request.ShowInFooter,
            SortOrder = request.SortOrder
        };

        var error = await _pages.SaveAsync(page, CurrentUser, ct);
        if (error is not null) return BadRequest(new { message = error });

        return Ok(new { success = true, id = page.Id, slug = page.Slug });
    }

    [HttpDelete("admin/pages/{id:guid}")]
    [B2BAdminAuth]
    public async Task<IActionResult> Delete(Guid id, CancellationToken ct)
    {
        var removed = await _pages.DeleteAsync(id, ct);
        if (!removed) return NotFound(new { message = "Sayfa bulunamadı." });

        return Ok(new { success = true });
    }
}
