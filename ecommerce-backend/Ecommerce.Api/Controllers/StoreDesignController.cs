using Ecommerce.Api.Infrastructure.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Ecommerce.Api.Controllers;

[ApiController]
[Route("api/store-design")]
public sealed class StoreDesignController : ControllerBase
{
    private readonly StoreDesignRepository _repo;

    public StoreDesignController(StoreDesignRepository repo)
    {
        _repo = repo;
    }

    [HttpGet]
    public async Task<IActionResult> Get(CancellationToken cancellationToken)
    {
        return Ok(new { success = true, data = await _repo.GetAsync(cancellationToken) });
    }

    [Authorize(Policy = "perm:design")]
    [HttpPut]
    public async Task<IActionResult> Put([FromBody] StoreDesign design, CancellationToken cancellationToken)
    {
        await _repo.UpsertAsync(design, cancellationToken);
        return Ok(new { success = true, data = design });
    }
}
