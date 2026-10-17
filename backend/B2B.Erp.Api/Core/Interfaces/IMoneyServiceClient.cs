namespace B2B.Erp.Api.Core.Interfaces;

public interface IMoneyServiceClient
{
    Task<decimal> GetLatestTryRateAsync(string currencyCode, CancellationToken cancellationToken);
}
