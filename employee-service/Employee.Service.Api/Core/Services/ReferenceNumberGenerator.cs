using B2B.Erp.Api.Data;
using B2B.Erp.Api.Entities;
using Microsoft.EntityFrameworkCore;

namespace B2B.Erp.Api.Core.Services;

public static class ReferenceNumberGenerator
{
    public static async Task<string> NextAsync(
        AppDbContext dbContext,
        string prefix,
        string? period = null,
        CancellationToken cancellationToken = default)
    {
        var targetPeriod = string.IsNullOrWhiteSpace(period)
            ? DateTime.UtcNow.ToString("yyyy-MM")
            : period;

        var seriesKey = $"{prefix.ToUpperInvariant()}-{targetPeriod}";

        var series = await dbContext.NumberSeries
            .FirstOrDefaultAsync(x => x.Key == seriesKey, cancellationToken);

        if (series == null)
        {
            series = new NumberSeries
            {
                Key = seriesKey,
                LastValue = 1
            };
            dbContext.NumberSeries.Add(series);
        }
        else
        {
            series.LastValue += 1;
        }

        await dbContext.SaveChangesAsync(cancellationToken);

        return $"{prefix.ToUpperInvariant()}-{targetPeriod}-{series.LastValue:D6}";
    }
}
