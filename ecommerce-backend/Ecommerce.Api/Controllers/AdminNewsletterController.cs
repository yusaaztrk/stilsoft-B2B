using Ecommerce.Api.Infrastructure.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Ecommerce.Api.Controllers;

[ApiController]
[Route("api/admin/newsletter")]
[Authorize(Roles = "Owner,Admin")]
public sealed class AdminNewsletterController : ControllerBase
{
    private readonly NewsletterRepository _repo;

    public AdminNewsletterController(NewsletterRepository repo)
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

    [HttpDelete("{id:guid}")]
    public async Task<IActionResult> Delete(Guid id, CancellationToken cancellationToken)
    {
        try
        {
            await _repo.DeleteAsync(id, cancellationToken);
            return Ok(new { success = true, message = "Abone başarıyla silindi." });
        }
        catch (Exception ex)
        {
            return StatusCode(500, new { success = false, message = ex.Message });
        }
    }
}
