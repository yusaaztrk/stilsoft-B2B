using Ecommerce.Api.Infrastructure.Erp;
using Microsoft.AspNetCore.Mvc;

namespace Ecommerce.Api.Controllers;

[ApiController]
[Route("api/erp-debug")]
public sealed class ErpDebugController : ControllerBase
{
    private readonly ErpClient _erp;

    public ErpDebugController(ErpClient erp)
    {
        _erp = erp;
    }

    [HttpGet("ping")]
    public async Task<IActionResult> Ping(CancellationToken cancellationToken)
    {
        try
        {
            var token = await _erp.GetServiceAccessTokenAsync(cancellationToken);
            return Ok(new { success = true, data = new { tokenLength = token?.Length ?? 0 } });
        }
        catch (Exception ex)
        {
            return Ok(new { success = false, error = ex.Message });
        }
    }

    [HttpGet("products-sample")]
    public async Task<IActionResult> ProductsSample(CancellationToken cancellationToken)
    {
        try
        {
            var json = await _erp.GetJsonAsync("api/products", cancellationToken);
            return Ok(new { success = true, data = json });
        }
        catch (Exception ex)
        {
            return Ok(new { success = false, error = ex.Message });
        }
    }
}
