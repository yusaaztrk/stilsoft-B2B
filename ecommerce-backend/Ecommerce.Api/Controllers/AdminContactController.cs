using Ecommerce.Api.Infrastructure.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Ecommerce.Api.Controllers;

[ApiController]
[Route("api/admin/contact-messages")]
[Authorize(Roles = "Owner,Admin")]
public sealed class AdminContactController : ControllerBase
{
    private readonly ContactMessagesRepository _repo;

    public AdminContactController(ContactMessagesRepository repo)
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

    [HttpPost("{id:guid}/read")]
    public async Task<IActionResult> MarkAsRead(Guid id, CancellationToken cancellationToken)
    {
        try
        {
            await _repo.MarkAsReadAsync(id, cancellationToken);
            return Ok(new { success = true, message = "Mesaj okundu olarak işaretlendi." });
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
            return Ok(new { success = true, message = "Mesaj başarıyla silindi." });
        }
        catch (Exception ex)
        {
            return StatusCode(500, new { success = false, message = ex.Message });
        }
    }
}
