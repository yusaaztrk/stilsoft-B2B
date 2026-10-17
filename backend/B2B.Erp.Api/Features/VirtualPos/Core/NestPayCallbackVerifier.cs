using System.Collections.Generic;

namespace B2B.Erp.Api.Features.VirtualPos.Core;

/// <summary>
/// Answers one question only: was this callback produced by NestPay and left unmodified?
/// Whether the bank approved the payment is evaluated separately.
///
/// Uses the generic Version 3 construction over every returned parameter. The legacy
/// HASHPARAMS / HASHPARAMSVAL mechanism belongs to Hash Version 1/2 and is NOT consulted:
/// if the gateway still echoes those fields for backward compatibility they are ordinary
/// parameters that take part in the digest like any other, never a field list to follow.
/// </summary>
public static class NestPayCallbackVerifier
{
    public static CallbackIntegrityResult Verify(
        IEnumerable<KeyValuePair<string, string>> callbackParameters,
        string? storeKey)
    {
        var parameters = new List<KeyValuePair<string, string>>(callbackParameters);

        string receivedHash = string.Empty;
        foreach (var p in parameters)
        {
            if (string.Equals(p.Key, "hash", System.StringComparison.OrdinalIgnoreCase))
            {
                receivedHash = p.Value ?? string.Empty;
                break;
            }
        }

        if (string.IsNullOrWhiteSpace(receivedHash))
        {
            return CallbackIntegrityResult.Fail(CallbackIntegrityStatus.MissingHash, "Callback imzası bulunamadı.");
        }

        if (string.IsNullOrWhiteSpace(storeKey))
        {
            return CallbackIntegrityResult.Fail(CallbackIntegrityStatus.MissingStoreKey, "POS imza anahtarı tanımlı değil.");
        }

        // The store key is never read from the callback — it comes from server-side config
        var expected = NestPayVer3Hash.Compute(parameters, storeKey!);

        return NestPayVer3Hash.DigestsMatch(expected, receivedHash)
            ? CallbackIntegrityResult.Ok()
            : CallbackIntegrityResult.Fail(CallbackIntegrityStatus.Mismatch, "Callback imzası doğrulanamadı.");
    }
}
