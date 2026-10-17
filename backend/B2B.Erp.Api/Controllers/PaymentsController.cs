using System.Threading;
using System.Threading.Tasks;
using B2B.Erp.Api.Features.Payment;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace B2B.Erp.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
[Authorize]
public sealed class PaymentsController : ControllerBase
{
    private readonly IPaymentService _paymentService;

    public PaymentsController(IPaymentService paymentService)
    {
        _paymentService = paymentService;
    }

    [HttpPost("calculate")]
    // [AllowAnonymous] kaldırıldı: tahsilat hesaplama ucunun kimlik istememesi için bir sebep
    // yok — sınıf zaten [Authorize] ve bu ucun repoda anonim çağıranı bulunmuyor.
    public IActionResult Calculate([FromBody] PaymentCalculationRequest request)
    {
        if (request is null)
        {
            return BadRequest(new { success = false, message = "Geçersiz istek" });
        }

        var result = _paymentService.Calculate(request);
        return Ok(new { success = true, data = result });
    }

    [HttpPost("process-invoice")]
    public async Task<IActionResult> ProcessInvoicePayment(
        [FromBody] ProcessInvoicePaymentRequest request,
        CancellationToken cancellationToken)
    {
        if (request is null)
        {
            return BadRequest(new { success = false, message = "Geçersiz istek" });
        }

        var username = User.Identity?.Name ?? "system";
        var result = await _paymentService.ProcessInvoicePaymentAsync(request, username, cancellationToken);

        if (!result.Success)
        {
            return BadRequest(result);
        }

        return Ok(result);
    }

    [HttpPost("cancel-invoice/{invoiceId:int}")]
    public async Task<IActionResult> CancelInvoicePayment(
        [FromRoute] int invoiceId,
        CancellationToken cancellationToken)
    {
        var username = User.Identity?.Name ?? "system";
        var result = await _paymentService.CancelInvoicePaymentAsync(invoiceId, username, cancellationToken);

        if (!result.Success)
        {
            return BadRequest(result);
        }

        return Ok(result);
    }
}
