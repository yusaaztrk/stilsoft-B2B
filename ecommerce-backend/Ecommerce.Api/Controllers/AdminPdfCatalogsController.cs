using Ecommerce.Api.Infrastructure.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Ecommerce.Api.Controllers;

[ApiController]
[Route("api/admin/pdf-catalogs")]
[Authorize(Roles = "Owner,Admin")]
public sealed class AdminPdfCatalogsController : ControllerBase
{
    private readonly PdfCatalogRepository _repo;

    public AdminPdfCatalogsController(PdfCatalogRepository repo)
    {
        _repo = repo;
    }

    [HttpGet]
    public async Task<IActionResult> List(CancellationToken cancellationToken)
    {
        try
        {
            var data = await _repo.ListAllAsync(cancellationToken);
            return Ok(new { success = true, data });
        }
        catch (Exception ex)
        {
            return StatusCode(500, new { success = false, message = ex.Message });
        }
    }

    [HttpPut]
    public async Task<IActionResult> Upsert([FromBody] PdfCatalogItemEntity item, CancellationToken cancellationToken)
    {
        try
        {
            if (string.IsNullOrWhiteSpace(item.Name) || string.IsNullOrWhiteSpace(item.PdfUrl))
            {
                return BadRequest(new { success = false, message = "Ad ve PDF linki alanları zorunludur." });
            }

            if (item.Id == Guid.Empty)
            {
                item.Id = Guid.NewGuid();
            }

            await _repo.UpsertAsync(item, cancellationToken);
            return Ok(new { success = true, data = item });
        }
        catch (Exception ex)
        {
            return StatusCode(500, new { success = false, message = ex.Message });
        }
    }

    [HttpDelete("{id:guid}")]
    public async Task<IActionResult> Delete(Guid id, CancellationToken cancellationToken)
    {
        try
        {
            await _repo.DeleteAsync(id, cancellationToken);
            return Ok(new { success = true, message = "Katalog başarıyla silindi." });
        }
        catch (Exception ex)
        {
            return StatusCode(500, new { success = false, message = ex.Message });
        }
    }
}
