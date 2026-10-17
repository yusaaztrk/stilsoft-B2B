using Ecommerce.Api.Infrastructure.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Ecommerce.Api.Controllers;

[ApiController]
[Route("api/admin/logs")]
[Authorize(Policy = "perm:dashboard")]
public sealed class AdminLogsController : ControllerBase
{
    private readonly AdminLogsRepository _logsRepo;

    public AdminLogsController(AdminLogsRepository logsRepo)
    {
        _logsRepo = logsRepo;
    }

    [HttpGet]
    public async Task<IActionResult> GetLogs([FromQuery] int limit = 100, CancellationToken cancellationToken = default)
    {
        var logs = await _logsRepo.ListAllAsync(limit, cancellationToken);
        return Ok(logs);
    }
}
