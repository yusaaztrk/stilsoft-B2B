using Ecommerce.Api.Infrastructure.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Ecommerce.Api.Controllers;

[ApiController]
[Route("api/admin/brands")]
[Authorize(Roles = "Owner,Admin")]
public sealed class AdminBrandsController : ControllerBase
{
    private readonly BrandsRepository _repo;

    public AdminBrandsController(BrandsRepository repo)
    {
        _repo = repo;
    }

    [HttpGet]
    public async Task<IActionResult> List(CancellationToken cancellationToken)
    {
        var items = await _repo.ListAsync(cancellationToken);
        var data = items.Select(x => new
        {
            id = x.Id,
            name = x.Name,
            logoUrl = x.LogoUrl,
            description = x.Description,
            updatedAtUtc = x.UpdatedAtUtc
        }).ToList();

        return Ok(new { success = true, data });
    }

    public sealed class UpsertBrandRequest
    {
        public string Name { get; set; } = string.Empty;
        public string? LogoUrl { get; set; }
        public string? Description { get; set; }
    }

    [HttpPost]
    public async Task<IActionResult> Create([FromBody] UpsertBrandRequest request, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(request.Name))
            return BadRequest(new { success = false, message = "Marka adı boş olamaz." });

        var brand = new Brand
        {
            Id = Guid.NewGuid(),
            Name = request.Name.Trim(),
            LogoUrl = request.LogoUrl,
            Description = request.Description,
            UpdatedAtUtc = DateTimeOffset.UtcNow
        };

        try
        {
            await _repo.UpsertAsync(brand, cancellationToken);
            return Ok(new { success = true, data = brand });
        }
        catch (Exception ex)
        {
            return BadRequest(new { success = false, message = "Bu isimde bir marka zaten tanımlı olabilir." });
        }
    }

    [HttpPut("{id:guid}")]
    public async Task<IActionResult> Update([FromRoute] Guid id, [FromBody] UpsertBrandRequest request, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(request.Name))
            return BadRequest(new { success = false, message = "Marka adı boş olamaz." });

        var existing = await _repo.GetAsync(id, cancellationToken);
        if (existing == null)
            return NotFound(new { success = false, message = "Marka bulunamadı." });

        existing.Name = request.Name.Trim();
        existing.LogoUrl = request.LogoUrl;
        existing.Description = request.Description;
        existing.UpdatedAtUtc = DateTimeOffset.UtcNow;

        try
        {
            await _repo.UpsertAsync(existing, cancellationToken);
            return Ok(new { success = true, data = existing });
        }
        catch (Exception ex)
        {
            return BadRequest(new { success = false, message = "Marka güncellenemedi veya isim çakışması oluştu." });
        }
    }

    [HttpDelete("{id:guid}")]
    public async Task<IActionResult> Delete([FromRoute] Guid id, CancellationToken cancellationToken)
    {
        var existing = await _repo.GetAsync(id, cancellationToken);
        if (existing == null)
            return NotFound(new { success = false, message = "Marka bulunamadı." });

        await _repo.DeleteAsync(id, cancellationToken);
        return Ok(new { success = true, message = "Marka başarıyla silindi." });
    }
}
