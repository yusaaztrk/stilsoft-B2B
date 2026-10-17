using System;
using System.Security.Cryptography;
using System.Text;

namespace B2B.Erp.Api.Features.VirtualPos.Core;

public enum CallbackIntegrityStatus
{
    Valid = 0,
    MissingHash = 1,
    MissingHashParams = 2,
    MissingStoreKey = 3,
    Mismatch = 4
}

public readonly record struct CallbackIntegrityResult(CallbackIntegrityStatus Status, string Reason)
{
    public bool IsValid => Status == CallbackIntegrityStatus.Valid;

    public static CallbackIntegrityResult Ok() => new(CallbackIntegrityStatus.Valid, string.Empty);
    public static CallbackIntegrityResult Fail(CallbackIntegrityStatus status, string reason) => new(status, reason);
}

/// <summary>
/// Garanti BBVA 3D callback signature verification, per the bank's response validation rule:
///
///   1. split <c>hashparams</c> on ':'
///   2. read each named field back from the callback form, in that order
///   3. concatenate the values with no separator — <c>hashparamsval</c> is NOT the source
///   4. append the 3D store key
///   5. encode ISO-8859-9, SHA-512, uppercase hex
///   6. compare against the callback's <c>hash</c> in constant time
///
/// The bank's own <c>hashparamsval</c> is deliberately ignored: it arrives from the same
/// untrusted request as the hash, so trusting it would let a caller supply both halves of
/// the comparison. Rebuilding the digest source from the individual fields is what actually
/// binds the signature to the values we then act on.
/// </summary>
public static class GarantiCallbackVerifier
{
    /// <summary>ISO-8859-9 (Latin-5). Registered via CodePagesEncodingProvider at startup.</summary>
    private const int Iso88599CodePage = 28599;

    public static CallbackIntegrityResult Verify(VirtualPosCallbackData callback, string? storeKey)
    {
        var hash = callback.Get("hash", "HASH");
        if (string.IsNullOrWhiteSpace(hash))
        {
            return CallbackIntegrityResult.Fail(CallbackIntegrityStatus.MissingHash, "Callback imzası bulunamadı.");
        }

        var hashParams = callback.Get("hashparams", "HASHPARAMS");
        if (string.IsNullOrWhiteSpace(hashParams))
        {
            // Without the field list there is nothing to rebuild the digest from, and an
            // empty list would hash the store key alone — trivially forgeable.
            return CallbackIntegrityResult.Fail(CallbackIntegrityStatus.MissingHashParams, "Callback imza alan listesi bulunamadı.");
        }

        if (string.IsNullOrWhiteSpace(storeKey))
        {
            return CallbackIntegrityResult.Fail(CallbackIntegrityStatus.MissingStoreKey, "POS imza anahtarı tanımlı değil.");
        }

        var digestSource = BuildDigestSource(callback, hashParams, storeKey!);
        var expected = ComputeSha512UpperHex(digestSource);

        return FixedTimeEquals(expected, hash.Trim())
            ? CallbackIntegrityResult.Ok()
            : CallbackIntegrityResult.Fail(CallbackIntegrityStatus.Mismatch, "Callback imzası doğrulanamadı.");
    }

    /// <summary>
    /// Rebuilds the signed string from the callback's own fields. A field named in
    /// hashparams but absent from the form contributes an empty string, which is what the
    /// bank does too — and any tampering with a listed field changes the digest.
    /// </summary>
    private static string BuildDigestSource(VirtualPosCallbackData callback, string hashParams, string storeKey)
    {
        var builder = new StringBuilder();

        foreach (var fieldName in hashParams.Split(':', StringSplitOptions.RemoveEmptyEntries))
        {
            var name = fieldName.Trim();
            if (name.Length == 0) continue;
            builder.Append(callback.Get(name));
        }

        builder.Append(storeKey);
        return builder.ToString();
    }

    private static string ComputeSha512UpperHex(string source)
    {
        var encoding = GetIso88599();
        var bytes = encoding.GetBytes(source);
        var digest = SHA512.HashData(bytes);
        return Convert.ToHexString(digest); // already uppercase
    }

    private static Encoding GetIso88599()
    {
        try
        {
            return Encoding.GetEncoding(Iso88599CodePage);
        }
        catch (NotSupportedException)
        {
            // Falling back silently would change the digest for Turkish characters and turn
            // a valid callback into a rejected one, so surface it instead.
            throw new InvalidOperationException(
                "ISO-8859-9 encoding is unavailable. Register CodePagesEncodingProvider at startup.");
        }
    }

    /// <summary>
    /// Constant-time comparison so a caller cannot learn the expected digest by measuring
    /// how long a rejection takes.
    /// </summary>
    private static bool FixedTimeEquals(string expected, string actual)
    {
        var a = Encoding.ASCII.GetBytes(expected.ToUpperInvariant());
        var b = Encoding.ASCII.GetBytes(actual.ToUpperInvariant());
        return a.Length == b.Length && CryptographicOperations.FixedTimeEquals(a, b);
    }
}
