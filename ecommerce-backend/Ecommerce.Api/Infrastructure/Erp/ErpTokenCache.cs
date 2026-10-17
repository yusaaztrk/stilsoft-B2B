namespace Ecommerce.Api.Infrastructure.Erp;

public sealed class ErpTokenCache
{
    private readonly object _lock = new();
    private string? _token;
    private DateTimeOffset _expiresAt;

    public bool TryGet(out string token)
    {
        lock (_lock)
        {
            if (string.IsNullOrWhiteSpace(_token))
            {
                token = string.Empty;
                return false;
            }

            // Small safety window
            if (_expiresAt <= DateTimeOffset.UtcNow.AddMinutes(1))
            {
                token = string.Empty;
                return false;
            }

            token = _token;
            return true;
        }
    }

    public void Set(string token, DateTimeOffset expiresAt)
    {
        lock (_lock)
        {
            _token = token;
            _expiresAt = expiresAt;
        }
    }
}
