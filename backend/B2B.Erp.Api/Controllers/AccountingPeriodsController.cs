using B2B.Erp.Api.Core.Authorization;
using B2B.Erp.Api.Core.Services;
using B2B.Erp.Api.DTOs.AccountingPeriods;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

using B2B.Erp.Api.Data;
using Microsoft.EntityFrameworkCore;

namespace B2B.Erp.Api.Controllers;

[ApiController]
[Route("api/accounting-periods")]
[Authorize]
public sealed class AccountingPeriodsController : ControllerBase
{
    private readonly IAccountingPeriodService _periodService;

    public AccountingPeriodsController(IAccountingPeriodService periodService)
    {
        _periodService = periodService;
    }



    [HttpGet]
    public async Task<IActionResult> List(CancellationToken cancellationToken = default)
    {
        var periods = await _periodService.ListPeriodsAsync(cancellationToken);
        return Ok(new { success = true, data = periods });
    }

    [HttpGet("active")]
    public async Task<IActionResult> GetActive(CancellationToken cancellationToken = default)
    {
        var period = await _periodService.GetActivePeriodAsync(cancellationToken);
        return Ok(new { success = true, data = period });
    }

    [HttpPost]
    [AuthorizePage("users", "maliDonemler")]
    public async Task<IActionResult> Create([FromBody] CreateAccountingPeriodDto dto, CancellationToken cancellationToken = default)
    {
        var userId = User.Identity?.Name ?? "Admin";
        var result = await _periodService.CreatePeriodAsync(dto, userId, cancellationToken);
        return Ok(new { success = true, data = result, message = "Mali dönem başarıyla oluşturuldu." });
    }

    [HttpPost("{id:int}/validate-close")]
    [AuthorizePage("users", "maliDonemler")]
    public async Task<IActionResult> ValidateClose(int id, CancellationToken cancellationToken = default)
    {
        var report = await _periodService.ValidateClosePeriodAsync(id, cancellationToken);
        return Ok(new { success = true, data = report });
    }

    [HttpPost("{id:int}/close")]
    [AuthorizePage("users", "maliDonemler")]
    public async Task<IActionResult> Close(int id, [FromBody] CloseAccountingPeriodRequestDto? dto = null, CancellationToken cancellationToken = default)
    {
        var userId = User.Identity?.Name ?? "Admin";
        var result = await _periodService.ClosePeriodAndTransferBalancesAsync(id, userId, dto?.CustomTransferName, cancellationToken);
        return Ok(new { success = true, data = result });
    }

    [HttpPost("{id:int}/reopen")]
    [AuthorizePage("users", "maliDonemler")]
    public async Task<IActionResult> Reopen(int id, CancellationToken cancellationToken = default)
    {
        var userId = User.Identity?.Name ?? "Admin";
        var success = await _periodService.ReopenPeriodAsync(id, userId, cancellationToken);
        return Ok(new { success, message = success ? "Mali dönem yeniden açıldı." : "Mali dönem açılamadı." });
    }

    [HttpDelete("{id:int}")]
    [AuthorizePage("users", "maliDonemler")]
    public async Task<IActionResult> Delete(int id, CancellationToken cancellationToken = default)
    {
        var success = await _periodService.DeletePeriodAsync(id, cancellationToken);
        return Ok(new { success, message = success ? "Mali dönem ve ilişkili devir kayıtları silindi." : "Mali dönem bulunamadı." });
    }
}
