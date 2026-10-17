using System.Collections.Generic;
using B2B.Erp.Api.Entities;

namespace B2B.Erp.Api.Features.VirtualPos.Core;

/// <summary>
/// Routing policy for virtual POS.
///
/// There are two distinct decisions and they must never be conflated:
///
/// * <b>Payment initiation</b> — the issuing bank of the card does not have to be a bank
///   we hold a POS contract with, so anything without its own POS falls back to the
///   default POS. This fallback is a business requirement.
///
/// * <b>Callback</b> — the processing bank was already decided and stored on the
///   transaction. Resolution there is exact; a callback that cannot be tied to the exact
///   configured provider is rejected, never routed to the default.
/// </summary>
public static class VirtualPosRouting
{
    /// <summary>Bank that processes every card without a dedicated POS contract.</summary>
    public const int DefaultPaymentBankCode = 10; // ZİRAAT

    /// <summary>
    /// Banks whose provider protocol is not verified, so they cannot process a payment.
    /// Cards issued by them are routed to <see cref="DefaultPaymentBankCode"/> instead —
    /// the cardholder can still pay, we simply do not use that bank's POS.
    /// Removing a code here is all it takes to hand the bank back to its own provider.
    /// </summary>
    public static readonly int[] UnsupportedProcessingBankCodes = { 120 }; // KOOPBANK

    public static bool CanProcessPayments(int bankCode)
        => System.Array.IndexOf(UnsupportedProcessingBankCodes, bankCode) < 0;

    /// <summary>
    /// Banks that need a second, provider-specific authorization after the 3D step.
    /// A successful 3D callback for these is NOT a completed payment.
    /// </summary>
    public static bool RequiresPostThreeDCompletion(int bankCode) => bankCode == 136; // CREDITWEST / CARDPLUS

    /// <summary>
    /// The banks a card may be charged through, best first.
    ///
    /// The card's issuing bank leads: a Ziraat card is charged through the Ziraat POS, a
    /// Garanti card through Garanti's, whenever that POS is configured and active. Everything
    /// we hold no POS for falls to <see cref="DefaultPaymentBankCode"/>.
    ///
    /// <see cref="VirtualPosBin.InstallmentBankCode"/> is deliberately NOT consulted. It is the
    /// BIN table's installment-agreement redirect and names Garanti for 832 of 999 BINs, so
    /// using it as a routing step sent 571 foreign-issuer cards through Garanti's merchant
    /// account instead of the default POS.
    ///
    /// An explicitly requested bank still wins: the caller has already been told which POS it
    /// is paying through, and silently charging a different one would contradict that.
    /// </summary>
    public static List<int> BuildBankCandidates(int requestedBankCode, int issuerBankCode)
    {
        var candidates = new List<int>();

        if (requestedBankCode > 0) candidates.Add(requestedBankCode);
        if (issuerBankCode > 0) candidates.Add(issuerBankCode);

        candidates.Add(DefaultPaymentBankCode);

        return candidates;
    }

    /// <summary>
    /// Maps the stored POS type onto a provider. Driven by the value configured on the
    /// definition rather than by a bank-code switch, so adding a bank is a data change.
    /// Returns null when the POS type is unknown — the caller must then fail closed.
    /// </summary>
    public static VirtualPosProviderType? ResolveProviderType(string? posType) =>
        (posType ?? string.Empty).Trim().ToUpperInvariant() switch
        {
            "NESTPAY" or "EST" or "PAYTEN" => VirtualPosProviderType.NestPay,
            "GARANTI" or "GARANTİ" => VirtualPosProviderType.Garanti,
            "KOOP" or "KOOPBANK" => VirtualPosProviderType.Koopbank,
            "CREDITWEST" or "CARDPLUS" => VirtualPosProviderType.Creditwest,
            _ => null
        };
}
