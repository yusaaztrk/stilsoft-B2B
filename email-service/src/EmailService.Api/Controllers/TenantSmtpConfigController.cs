using System;
using System.Threading.Tasks;
using EmailService.Application.Features.TenantSmtpConfigs;
using MediatR;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;

namespace EmailService.Api.Controllers;

public class TenantSmtpConfigController : ApiControllerBase
{
    private readonly IMediator _mediator;

    public TenantSmtpConfigController(IMediator mediator)
    {
        _mediator = mediator;
    }

    [HttpPost]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<IActionResult> SaveConfig([FromBody] SaveTenantSmtpConfigCommand command)
    {
        var id = await _mediator.Send(command);
        return Ok(new { ConfigId = id });
    }

    [HttpGet("{tenantId}")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> GetConfig(string tenantId)
    {
        var result = await _mediator.Send(new GetTenantSmtpConfigQuery(tenantId));
        if (result == null)
        {
            return NotFound($"SMTP configuration not found for tenant '{tenantId}'.");
        }
        return Ok(result);
    }
}
