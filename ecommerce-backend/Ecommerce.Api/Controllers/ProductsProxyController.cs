using Ecommerce.Api.Infrastructure.Erp;
using Microsoft.AspNetCore.Mvc;

namespace Ecommerce.Api.Controllers;

[ApiController]
[Route("api/products")]
public sealed class ProductsProxyController : ControllerBase
{
    private readonly ErpClient _erp;

    public ProductsProxyController(ErpClient erp)
    {
        _erp = erp;
    }

    [HttpGet]
    public async Task<IActionResult> GetAll([FromQuery] string? main, [FromQuery] string? sub, CancellationToken cancellationToken)
    {
        var qs = new List<string>();
        if (!string.IsNullOrWhiteSpace(main)) qs.Add($"main={Uri.EscapeDataString(main)}");
        if (!string.IsNullOrWhiteSpace(sub)) qs.Add($"sub={Uri.EscapeDataString(sub)}");
        var url = qs.Count == 0 ? "api/products" : $"api/products?{string.Join("&", qs)}";

        try
        {
            var json = await _erp.GetJsonAsync(url, cancellationToken);
            return Ok(json);
        }
        catch (ErpRequestException ex)
        {
            var status = ex.StatusCode == System.Net.HttpStatusCode.Unauthorized
                ? StatusCodes.Status502BadGateway
                : StatusCodes.Status502BadGateway;
            return StatusCode(status, new { success = false, message = ex.Message });
        }
    }

    [HttpGet("{id:guid}")]
    public async Task<IActionResult> GetById(Guid id, CancellationToken cancellationToken)
    {
        try
        {
            var json = await _erp.GetJsonAsync($"api/products/{id}", cancellationToken);
            return Ok(json);
        }
        catch (ErpRequestException ex)
        {
            return StatusCode(StatusCodes.Status502BadGateway, new { success = false, message = ex.Message });
        }
    }
}
