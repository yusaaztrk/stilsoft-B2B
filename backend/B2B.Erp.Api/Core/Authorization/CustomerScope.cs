using System.Security.Claims;
using Microsoft.EntityFrameworkCore;

namespace B2B.Erp.Api.Core.Authorization;

/// <summary>
/// Reads a user's customer scope.
///
/// The scope lives in one place — Users.Carikodu, mirrored into the "Carikodu" claim — and is a
/// comma-separated list of customer codes. It used to hold a single code, so a stored value of
/// "120-01-000475" parses to a one-item list and behaves exactly as before; nothing that already
/// worked changes shape.
///
/// Every consumer goes through here instead of splitting the string itself, because the two
/// values that mean "no restriction" ('*' and empty) are easy to get subtly wrong, and getting
/// them wrong in the open direction hands a user every customer in the system.
/// </summary>
public static class CustomerScope
{
    public const string ClaimType = "Carikodu";

    /// <summary>The value that means "every customer".</summary>
    public const string All = "*";

    /// <summary>
    /// The codes an account is limited to. Empty means unrestricted — callers should test
    /// <see cref="IsUnrestricted"/> rather than checking for an empty list, so that the intent
    /// reads correctly at the call site.
    /// </summary>
    public static IReadOnlyList<string> Parse(string? raw)
    {
        if (IsUnrestricted(raw)) return Array.Empty<string>();

        return raw!
            .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Where(code => !string.Equals(code, All, StringComparison.Ordinal))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToArray();
    }

    /// <summary>
    /// Whether the value grants every customer. Blank counts: the API has always treated a
    /// missing code as unrestricted, and a list containing '*' means the same thing however
    /// many other codes sit beside it.
    /// </summary>
    public static bool IsUnrestricted(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return true;

        return raw
            .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Any(code => code == All || string.Equals(code, "ALL", StringComparison.OrdinalIgnoreCase));
    }

    /// <summary>Scope of the signed-in user, straight off the token.</summary>
    public static IReadOnlyList<string> Of(ClaimsPrincipal user)
        => Parse(user.FindFirst(ClaimType)?.Value);

    public static bool IsUnrestrictedFor(ClaimsPrincipal user)
        => IsUnrestricted(user.FindFirst(ClaimType)?.Value);

    /// <summary>
    /// The assigned codes plus every account that belongs to them.
    ///
    /// A customer is not one row. A dealer has branches, linked by ParentCustomerCode, and each
    /// customer also has -1/-2/-3 sub-accounts linked by MainCustomerCode — and it is those
    /// sub-accounts that invoices are actually booked against. Expanding only the branches meant
    /// assigning a customer showed none of their invoices, because every one of them sits under
    /// a code the scope had never heard of.
    /// </summary>
    public static async Task<List<string>> ExpandAsync(
        IQueryable<Entities.Customer> customers,
        IReadOnlyList<string> scopeCodes,
        CancellationToken cancellationToken = default)
    {
        var all = new List<string>(scopeCodes);
        if (scopeCodes.Count == 0) return all;

        var related = await customers
            .Where(x => (x.ParentCustomerCode != null && scopeCodes.Contains(x.ParentCustomerCode))
                        || (x.MainCustomerCode != null && scopeCodes.Contains(x.MainCustomerCode)))
            .Select(x => x.CustomerCode)
            .ToListAsync(cancellationToken);

        all.AddRange(related.Where(c => !string.IsNullOrWhiteSpace(c)));
        return all.Distinct(StringComparer.OrdinalIgnoreCase).ToList();
    }

    /// <summary>Stores a selection back. An empty selection is stored as unrestricted.</summary>
    public static string Format(IEnumerable<string>? codes)
    {
        var list = (codes ?? Array.Empty<string>())
            .Select(c => (c ?? string.Empty).Trim())
            .Where(c => c.Length > 0)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToArray();

        if (list.Length == 0 || list.Any(c => c == All)) return All;
        return string.Join(',', list);
    }
}
