using System;
using System.Threading.Tasks;
using EmailService.Application.Features.EmailTemplates;
using MediatR;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;

namespace EmailService.Api.Controllers;

public class EmailTemplateController : ApiControllerBase
{
    private readonly IMediator _mediator;

    public EmailTemplateController(IMediator mediator)
    {
        _mediator = mediator;
    }

    [HttpPost]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<IActionResult> SaveTemplate([FromBody] SaveEmailTemplateCommand command)
    {
        var id = await _mediator.Send(command);
        return Ok(new { TemplateId = id });
    }

    [HttpGet("{tenantId}/{templateName}")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> GetTemplate(string tenantId, string templateName)
    {
        var result = await _mediator.Send(new GetEmailTemplateQuery(tenantId, templateName));
        if (result == null)
        {
            return NotFound($"Template '{templateName}' not found for tenant '{tenantId}'.");
        }
        return Ok(result);
    }
}
