using System.Threading;
using System.Threading.Tasks;
using Ecommerce.Api.Infrastructure.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Ecommerce.Api.Controllers;

[ApiController]
[Route("api/info-pages")]
public sealed class InfoPagesController : ControllerBase
{
    private readonly InformationPagesRepository _repo;

    public InfoPagesController(InformationPagesRepository repo)
    {
        _repo = repo;
    }

    [HttpGet]
    public async Task<IActionResult> GetAll(CancellationToken cancellationToken)
    {
        var items = await _repo.GetAllAsync(cancellationToken);
        return Ok(new { success = true, data = items });
    }

    [HttpGet("{key}")]
    public async Task<IActionResult> GetByKey(string key, CancellationToken cancellationToken)
    {
        var item = await _repo.GetByKeyAsync(key, cancellationToken);
        if (item == null)
            return NotFound(new { success = false, message = "Sayfa bulunamadı." });
        return Ok(new { success = true, data = item });
    }

    public sealed class UpdatePageRequest
    {
        public string Title { get; set; } = string.Empty;
        public string ContentHtml { get; set; } = string.Empty;
    }

    [Authorize(Policy = "perm:design")]
    [HttpPut("{key}")]
    public async Task<IActionResult> Update(string key, [FromBody] UpdatePageRequest request, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(request.Title))
            return BadRequest(new { success = false, message = "Sayfa başlığı zorunludur." });

        await _repo.UpsertPageAsync(key, request.Title, request.ContentHtml ?? string.Empty, cancellationToken);
        return Ok(new { success = true, message = "Sayfa içeriği başarıyla güncellendi." });
    }
}
