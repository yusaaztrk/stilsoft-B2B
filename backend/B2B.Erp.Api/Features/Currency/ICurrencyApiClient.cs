using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;

namespace B2B.Erp.Api.Features.Currency;

public interface ICurrencyApiClient
{
    Task<IReadOnlyList<CurrencyRateDto>> GetLatestRatesAsync(CancellationToken cancellationToken);
}
