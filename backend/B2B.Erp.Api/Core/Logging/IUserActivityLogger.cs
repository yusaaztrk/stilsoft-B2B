using System.Threading;
using System.Threading.Tasks;

namespace B2B.Erp.Api.Core.Logging;

public interface IUserActivityLogger
{
    Task LogAsync(
        string moduleKey,
        string pageKey,
        string actionType,
        string description,
        string? recordId = null,
        object? details = null,
        CancellationToken cancellationToken = default);
}
