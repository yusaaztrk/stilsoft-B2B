using System;
using System.Threading;
using System.Threading.Tasks;
using B2B.Erp.Api.Features.Currency;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace B2B.Erp.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
[Route("api/fx")]
[AllowAnonymous]
// Kimlik istemeyen uç: IP başına geniş bir sınır olmadan dışarıdan sınırsız çağrılabiliyordu.
[Microsoft.AspNetCore.RateLimiting.EnableRateLimiting("public")]
public sealed class CurrencyController : ControllerBase
{
    private readonly ICurrencyRateService _currencyService;
    private readonly ILogger<CurrencyController> _logger;

    public CurrencyController(ICurrencyRateService currencyService, ILogger<CurrencyController> logger)
    {
        _currencyService = currencyService;
        _logger = logger;
    }

    [HttpGet("rates")]
    public async Task<IActionResult> GetRates(CancellationToken cancellationToken)
    {
        var rates = await _currencyService.GetLatestRatesAsync(cancellationToken);
        return Ok(new { success = true, data = rates });
    }

    [HttpGet("rates/{currencyCode}")]
    public async Task<IActionResult> GetRateByCode(string currencyCode, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(currencyCode))
        {
            return BadRequest(new { success = false, message = "Para birimi zorunludur" });
        }

        var rate = await _currencyService.GetRateAsync(currencyCode, null, cancellationToken);
        if (rate == null)
        {
            return NotFound(new { success = false, message = $"'{currencyCode}' için kur bilgisi bulunamadı." });
        }

        return Ok(new { success = true, data = rate });
    }

    [HttpGet("latest")]
    public async Task<IActionResult> GetLatest([FromQuery] string currencyCode, CancellationToken cancellationToken)
    {
        var code = (currencyCode ?? string.Empty).Trim().ToUpperInvariant();
        if (string.IsNullOrWhiteSpace(code))
        {
            return BadRequest(new { success = false, message = "Para birimi zorunludur" });
        }

        if (code is "TRY" or "TL")
        {
            return Ok(new { success = true, data = new { currencyCode = "TRY", rate = 1.0m } });
        }

        var rate = await _currencyService.GetLatestTryRateAsync(code, cancellationToken);
        if (rate <= 0m)
        {
            return NotFound(new { success = false, message = $"'{code}' için kur bilgisi bulunamadı." });
        }

        return Ok(new { success = true, data = new { currencyCode = code, rate } });
    }

    [HttpGet("cross-rate")]
    public async Task<IActionResult> GetCrossRate([FromQuery] string source, [FromQuery] string target, CancellationToken cancellationToken)
    {
        var srcCode = (source ?? "TRY").Trim().ToUpperInvariant();
        var tgtCode = (target ?? "TRY").Trim().ToUpperInvariant();

        var crossRate = await _currencyService.GetCrossRateAsync(srcCode, tgtCode, null, cancellationToken);
        var srcRate = srcCode is "TRY" or "TL" ? 1.0m : await _currencyService.GetLatestTryRateAsync(srcCode, cancellationToken);
        var tgtRate = tgtCode is "TRY" or "TL" ? 1.0m : await _currencyService.GetLatestTryRateAsync(tgtCode, cancellationToken);

        return Ok(new
        {
            success = true,
            data = new
            {
                sourceCurrency = srcCode,
                targetCurrency = tgtCode,
                crossRate,
                sourceTryRate = srcRate,
                targetTryRate = tgtRate
            }
        });
    }

    [HttpPost("convert")]
    public async Task<IActionResult> ConvertCurrency([FromBody] ConvertCurrencyRequest request, CancellationToken cancellationToken)
    {
        if (request == null || request.Amount < 0)
        {
            return BadRequest(new { success = false, message = "Geçerli bir miktar girilmelidir." });
        }

        var result = await _currencyService.ConvertAsync(request, cancellationToken);
        return Ok(new { success = true, data = result });
    }
}
