using System;
using System.Threading.Tasks;
using EmailService.Application.DTOs;
using EmailService.Application.Features.Emails;
using MediatR;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;

namespace EmailService.Api.Controllers;

public class EmailController : ApiControllerBase
{
    private readonly IMediator _mediator;

    public EmailController(IMediator mediator)
    {
        _mediator = mediator;
    }

    [HttpPost("send")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<IActionResult> Send([FromBody] SendEmailRequest request)
    {
        var command = new QueueEmailCommand(
            request.TenantId,
            request.Recipient,
            request.Subject,
            request.Body,
            TemplateName: null,
            TemplateData: null,
            request.Attachments,
            request.ScheduledFor
        );

        var id = await _mediator.Send(command);
        return Ok(new { EmailMessageId = id });
    }

    [HttpPost("send-templated")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<IActionResult> SendTemplated([FromBody] SendTemplatedEmailRequest request)
    {
        var command = new QueueEmailCommand(
            request.TenantId,
            request.Recipient,
            Subject: string.Empty,
            Body: string.Empty,
            request.TemplateName,
            request.TemplateData,
            request.Attachments,
            request.ScheduledFor
        );

        var id = await _mediator.Send(command);
        return Ok(new { EmailMessageId = id });
    }
}
