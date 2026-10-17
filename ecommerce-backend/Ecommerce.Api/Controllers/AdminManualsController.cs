using Ecommerce.Api.Infrastructure.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Ecommerce.Api.Controllers;

[ApiController]
[Route("api/admin/manuals")]
[Authorize(Roles = "Owner,Admin")]
public sealed class AdminManualsController : ControllerBase
{
    private readonly ProductManualRepository _repo;

    public AdminManualsController(ProductManualRepository repo)
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
    public async Task<IActionResult> Upsert([FromBody] ProductManualItemEntity item, CancellationToken cancellationToken)
    {
        try
        {
            if (string.IsNullOrWhiteSpace(item.Title) || string.IsNullOrWhiteSpace(item.PdfUrl))
            {
                return BadRequest(new { success = false, message = "Kılavuz Başlığı ve PDF linki alanları zorunludur." });
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
            return Ok(new { success = true, message = "Kullanım kılavuzu başarıyla silindi." });
        }
        catch (Exception ex)
        {
            return StatusCode(500, new { success = false, message = ex.Message });
        }
    }
}
