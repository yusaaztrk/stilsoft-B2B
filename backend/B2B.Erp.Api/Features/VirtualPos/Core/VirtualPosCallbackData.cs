using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using B2B.Erp.Api.Entities;

namespace B2B.Erp.Api.Features.VirtualPos.Core;

/// <summary>
/// Case-insensitive view over a 3D callback form.
///
/// Banks are inconsistent about casing — NestPay posts <c>ProcReturnCode</c> while Garanti
/// posts <c>procreturncode</c>. The callback form used to be copied into an ordinal
/// dictionary, so a lookup with the wrong casing silently returned nothing and the
/// corresponding security check evaluated as "field absent" instead of failing.
/// </summary>
public sealed class VirtualPosCallbackData
{
    private readonly IReadOnlyDictionary<string, string> _fields;

    public VirtualPosCallbackData(IEnumerable<KeyValuePair<string, string>> fields)
    {
        var map = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var kv in fields)
        {
            // First value wins; duplicate keys differing only by case are the same field
            if (!map.ContainsKey(kv.Key)) map[kv.Key] = kv.Value ?? string.Empty;
        }
        _fields = map;
    }

    /// <summary>Returns the first field present from <paramref name="names"/>, or empty.</summary>
    public string Get(params string[] names)
    {
        foreach (var name in names)
        {
            if (_fields.TryGetValue(name, out var value) && !string.IsNullOrWhiteSpace(value))
            {
                return value.Trim();
            }
        }
        return string.Empty;
    }

    public bool Has(string name) => _fields.ContainsKey(name);

    /// <summary>
    /// Fields that may be persisted or traced. Everything outside this list — card data,
    /// hashes and the 3D authentication values (cavv / xid / eci / md) that could be
    /// replayed — never reaches the database or the log. An allow-list is used so that a
    /// field a bank adds later cannot leak by default.
    /// </summary>
    private static readonly string[] StorableFields =
    {
        "oid", "orderid", "OrderId",
        "Response", "ProcReturnCode", "mdStatus", "txnstatus",
        "AuthCode", "TransId", "HostRefNum",
        "ErrMsg", "errmsg", "mdErrorMsg", "mderrormessage", "hostmsg",
        "amount", "txnamount", "currency", "txncurrencycode",
        "clientid", "terminalid", "txninstallmentcount"
    };

    /// <summary>
    /// Builds the diagnostic payload that is safe to store against the transaction.
    /// Error messages are length-capped because banks sometimes echo input back.
    /// </summary>
    public string BuildStorablePayload()
    {
        var parts = new List<string>();
        foreach (var name in StorableFields)
        {
            if (!_fields.TryGetValue(name, out var value) || string.IsNullOrWhiteSpace(value)) continue;
            if (parts.Any(p => p.StartsWith(name + "=", StringComparison.OrdinalIgnoreCase))) continue;

            var sanitized = value.Length > 200 ? value.Substring(0, 200) : value;
            sanitized = sanitized.Replace('\r', ' ').Replace('\n', ' ');
            parts.Add($"{name}={sanitized}");
        }
        return string.Join("; ", parts);
    }

    /// <summary>
    /// Parses a bank amount without depending on the current culture.
    /// Handles "1000.00", "1.000,00" and "1000,00".
    ///
    /// A separator-less value is ambiguous and only the provider can resolve it: Garanti
    /// states <c>txnamount</c> in minor units (1,00 TL arrives as "100"), which is why the
    /// request form multiplies by 100 before signing — reading it back as 100,00 TL made the
    /// amount check reject every Garanti callback. NestPay posts major units, so its
    /// separator-less values are taken at face value.
    ///
    /// Returns null when the value cannot be interpreted unambiguously.
    /// </summary>
    public static decimal? ParseBankAmount(string? raw, VirtualPosProviderType providerType)
    {
        var s = (raw ?? string.Empty).Trim();
        if (s.Length == 0) return null;

        var hasDot = s.Contains('.');
        var hasComma = s.Contains(',');

        if (hasDot && hasComma)
        {
            // The rightmost separator is the decimal one
            s = s.LastIndexOf(',') > s.LastIndexOf('.')
                ? s.Replace(".", string.Empty).Replace(',', '.')
                : s.Replace(",", string.Empty);
        }
        else if (hasComma)
        {
            s = s.Replace(',', '.');
        }

        if (!decimal.TryParse(s, NumberStyles.Number, CultureInfo.InvariantCulture, out var value))
        {
            return null;
        }

        var isMinorUnits = providerType == VirtualPosProviderType.Garanti && !hasDot && !hasComma;
        return isMinorUnits ? value / 100m : value;
    }

    /// <summary>Compares two amounts at 2-decimal precision, avoiding float drift.</summary>
    public static bool AmountsMatch(decimal expected, decimal actual)
        => Math.Round(expected, 2, MidpointRounding.AwayFromZero)
           == Math.Round(actual, 2, MidpointRounding.AwayFromZero);

    /// <summary>
    /// Maps an ERP currency code onto the numeric code banks use (ISO 4217).
    /// Only the currencies the ERP actually supports are listed; an unknown code returns
    /// null so the caller fails closed rather than skipping the comparison.
    /// </summary>
    public static string? ToNumericCurrencyCode(string? currencyCode) =>
        (currencyCode ?? string.Empty).Trim().ToUpperInvariant() switch
        {
            "" or "TRY" or "TL" => "949",
            "EUR" => "978",
            "USD" => "840",
            "GBP" => "826",
            _ => null
        };
}
