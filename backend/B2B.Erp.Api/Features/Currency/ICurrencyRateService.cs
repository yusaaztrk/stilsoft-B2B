using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;

namespace B2B.Erp.Api.Features.Currency;

public interface ICurrencyRateService
{
    Task<IReadOnlyList<CurrencyRateDto>> GetLatestRatesAsync(CancellationToken cancellationToken = default);
    Task<CurrencyRateDto?> GetRateAsync(string currencyCode, DateTime? date = null, CancellationToken cancellationToken = default);
    Task<decimal> GetLatestTryRateAsync(string currencyCode, CancellationToken cancellationToken = default);
    Task<decimal> GetCrossRateAsync(string sourceCurrency, string targetCurrency, DateTime? date = null, CancellationToken cancellationToken = default);
    Task<ConvertCurrencyResponse> ConvertAsync(ConvertCurrencyRequest request, CancellationToken cancellationToken = default);
}
