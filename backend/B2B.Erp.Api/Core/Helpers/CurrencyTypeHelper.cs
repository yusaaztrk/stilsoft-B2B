namespace B2B.Erp.Api.Core.Helpers;

/// <summary>
/// Single source of truth for the CurrencyTypeId convention used across the ERP.
///
///   0 -> TRY (legacy / unset)
///   1 -> TRY
///   2 -> EUR
///   3 -> USD
///   4 -> GBP
///
/// Both 0 and 1 mean Turkish Lira: older records were written with 0, the account
/// definition screens write 1. Any code that treats "== 0" as "is TRY" silently
/// misclassifies every account stored with 1 — use <see cref="IsTry"/> instead.
/// </summary>
public static class CurrencyTypeHelper
{
    public const int Try = 1;
    public const int Eur = 2;
    public const int Usd = 3;
    public const int Gbp = 4;

    /// <summary>True when the id represents Turkish Lira (0 and 1 are both TRY).</summary>
    public static bool IsTry(int currencyTypeId) => currencyTypeId == 0 || currencyTypeId == Try;

    /// <summary>Collapses the legacy 0 onto 1 so TRY does not split into two buckets.</summary>
    public static int Normalize(int currencyTypeId) => currencyTypeId == 0 ? Try : currencyTypeId;

    /// <summary>ISO code, or null when the id is not a known currency.</summary>
    public static string? ToCode(int currencyTypeId) => Normalize(currencyTypeId) switch
    {
        Try => "TRY",
        Eur => "EUR",
        Usd => "USD",
        Gbp => "GBP",
        _ => null
    };

    /// <summary>ISO code with TRY as the fallback, for display purposes.</summary>
    public static string ToCodeOrTry(int currencyTypeId) => ToCode(currencyTypeId) ?? "TRY";

    /// <summary>True when two ids refer to the same currency (0 and 1 both being TRY).</summary>
    public static bool SameCurrency(int a, int b) => Normalize(a) == Normalize(b);

    public static bool IsKnown(int currencyTypeId) => ToCode(currencyTypeId) is not null;
}
