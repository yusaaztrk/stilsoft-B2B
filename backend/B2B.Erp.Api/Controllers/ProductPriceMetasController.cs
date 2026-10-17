using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace B2B.Erp.Api.Controllers;

[ApiController]
[Route("api/product-price-metas")]
[Authorize]
public sealed class ProductPriceMetasController : ControllerBase
{
    [HttpGet("by-products")]
    public IActionResult GetByProducts([FromQuery] string productIds, CancellationToken cancellationToken)
    {
        return StatusCode(StatusCodes.Status410Gone);
    }

    [HttpPost("upsert")]
    public IActionResult Upsert(CancellationToken cancellationToken)
    {
        return StatusCode(StatusCodes.Status410Gone);
    }
}
