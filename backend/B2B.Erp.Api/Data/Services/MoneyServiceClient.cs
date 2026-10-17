using System.Threading;
using System.Threading.Tasks;
using B2B.Erp.Api.Core.Interfaces;
using B2B.Erp.Api.Features.Currency;

namespace B2B.Erp.Api.Data.Services;

public sealed class MoneyServiceClient : IMoneyServiceClient
{
    private readonly ICurrencyRateService _currencyRateService;

    public MoneyServiceClient(ICurrencyRateService currencyRateService)
    {
        _currencyRateService = currencyRateService;
    }

    public Task<decimal> GetLatestTryRateAsync(string currencyCode, CancellationToken cancellationToken)
    {
        return _currencyRateService.GetLatestTryRateAsync(currencyCode, cancellationToken);
    }
}
