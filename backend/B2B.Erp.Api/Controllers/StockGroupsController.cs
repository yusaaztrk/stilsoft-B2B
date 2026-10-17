using B2B.Erp.Api.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace B2B.Erp.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
[Authorize]
public sealed class StockGroupsController : ControllerBase
{
    private readonly AppDbContext _dbContext;

    public StockGroupsController(AppDbContext dbContext)
    {
        _dbContext = dbContext;
    }

    [HttpGet]
    public async Task<IActionResult> GetAll(
        [FromQuery] bool onlyB2BOrder = true,
        CancellationToken cancellationToken = default)
    {
        var query = _dbContext.StockGroups.AsNoTracking().AsQueryable();

        if (onlyB2BOrder)
        {
            query = query.Where(x => x.B2BOrder);
        }

        var items = await query
            .OrderBy(x => x.GroupType)
            .ThenBy(x => x.GroupCode)
            .Select(x => new
            {
                id = x.Id,
                groupCode = x.GroupCode,
                groupType = x.GroupType,
                description = x.Description,
                b2bOrder = x.B2BOrder
            })
            .ToListAsync(cancellationToken);

        return Ok(new { success = true, data = new { items } });
    }
}
