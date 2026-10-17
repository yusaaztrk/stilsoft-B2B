using EmailService.Api.Filters;
using Microsoft.AspNetCore.Mvc;

namespace EmailService.Api.Controllers;

[ApiController]
[ApiKey]
[Route("api/[controller]")]
public abstract class ApiControllerBase : ControllerBase
{
}
