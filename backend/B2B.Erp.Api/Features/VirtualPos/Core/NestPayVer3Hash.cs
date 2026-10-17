using System;
using System.Collections.Generic;
using System.Linq;
using System.Security.Cryptography;
using System.Text;

namespace B2B.Erp.Api.Features.VirtualPos.Core;

/// <summary>
/// NestPay Hash Version 3 (Payten Teknoloji A.Ş., doc v2.1 — 06.02.2024).
///
/// The same construction signs an outgoing request and validates an incoming callback:
/// every parameter except <c>encoding</c>, <c>hash</c> and <c>countdown</c> is sorted by
/// name, the VALUES are escaped and joined with '|', the store key is appended, and the
/// result is SHA-512 hashed and Base64 encoded.
///
/// Deliberately separate from <see cref="GarantiCallbackVerifier"/>: Garanti signs a
/// hashparams-driven field list over ISO-8859-9 and compares uppercase hex. Merging the
/// two would break both.
/// </summary>
public static class NestPayVer3Hash
{
    public const string HashAlgorithmValue = "ver3";

    /// <summary>Excluded from the digest, matched case-insensitively per the document.</summary>
    private static readonly HashSet<string> ExcludedParameters =
        new(StringComparer.OrdinalIgnoreCase) { "encoding", "hash", "countdown" };

    public static bool IsExcluded(string parameterName) => ExcludedParameters.Contains(parameterName);

    /// <summary>
    /// Escapes a single value: backslash first, then pipe. Order matters — escaping the
    /// pipe first would let the backslash pass turn "\|" into "\\|" and change the digest.
    /// </summary>
    public static string EscapeHashValue(string? value)
        => (value ?? string.Empty).Replace("\\", "\\\\").Replace("|", "\\|");

    /// <summary>
    /// Builds the Version 3 plaintext. A parameter sent with an empty value still takes
    /// part as an empty segment, so the segment count itself is covered by the signature.
    /// </summary>
    public static string BuildPlaintext(IEnumerable<KeyValuePair<string, string>> parameters, string storeKey)
    {
        var escapedValues = parameters
            .Where(p => !IsExcluded(p.Key))
            .OrderBy(p => p.Key, StringComparer.OrdinalIgnoreCase)
            .Select(p => EscapeHashValue(p.Value));

        return string.Join("|", escapedValues) + "|" + EscapeHashValue(storeKey);
    }

    /// <summary>SHA-512 over UTF-8, Base64 encoded — as the verified request handler does.</summary>
    public static string Compute(IEnumerable<KeyValuePair<string, string>> parameters, string storeKey)
    {
        var plaintext = BuildPlaintext(parameters, storeKey);
        var digest = SHA512.HashData(Encoding.UTF8.GetBytes(plaintext));
        return Convert.ToBase64String(digest);
    }

    /// <summary>
    /// Constant-time comparison of two Base64 digests. Decoding first means an equivalent
    /// encoding difference (padding, whitespace) does not cause a false rejection, while a
    /// malformed value is treated as a failure rather than silently compared as text.
    /// </summary>
    public static bool DigestsMatch(string expectedBase64, string receivedBase64)
    {
        if (string.IsNullOrWhiteSpace(receivedBase64)) return false;

        byte[] expected;
        byte[] received;
        try
        {
            expected = Convert.FromBase64String(expectedBase64);
            received = Convert.FromBase64String(receivedBase64.Trim());
        }
        catch (FormatException)
        {
            return false;
        }

        return expected.Length == received.Length
               && CryptographicOperations.FixedTimeEquals(expected, received);
    }
}
