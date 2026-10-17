using System;

namespace B2B.Erp.Api.Core.Helpers;

public static class SystemTime
{
    private static DateTime? _overrideTimeUtc;

    public static DateTime UtcNow
    {
        get
        {
            if (_overrideTimeUtc.HasValue)
            {
                return _overrideTimeUtc.Value;
            }
            return DateTime.UtcNow;
        }
    }

    public static DateTime Now => UtcNow.ToLocalTime();

    public static DateTime? OverrideTimeUtc => _overrideTimeUtc;

    public static void SetOverride(DateTime? overrideTimeUtc)
    {
        if (overrideTimeUtc.HasValue)
        {
            _overrideTimeUtc = DateTime.SpecifyKind(overrideTimeUtc.Value, DateTimeKind.Utc);
        }
        else
        {
            _overrideTimeUtc = null;
        }
    }
}
