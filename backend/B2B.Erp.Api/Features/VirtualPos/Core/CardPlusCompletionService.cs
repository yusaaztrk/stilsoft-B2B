using System;
using System.Threading;
using System.Threading.Tasks;
using B2B.Erp.Api.Entities;

namespace B2B.Erp.Api.Features.VirtualPos.Core;

public enum CardPlusCompletionOutcome
{
    /// <summary>The bank captured the payment.</summary>
    Paid = 0,
    /// <summary>The bank answered and refused.</summary>
    Declined = 1,
    /// <summary>Outcome unknown — timeout, or the card data needed to ask was gone.</summary>
    AuthorizationPending = 2,
    /// <summary>Untrusted or unusable provider answer.</summary>
    ProviderError = 3,
    /// <summary>Another callback already owns this authorization; nothing was sent.</summary>
    AlreadyInProgress = 4,
    /// <summary>Preconditions were not met; nothing was sent.</summary>
    NotEligible = 5
}

public sealed record CardPlusCompletionResult(CardPlusCompletionOutcome Outcome, string Message);

public interface ICardPlusCompletionService
{
    /// <summary>
    /// Completes a bank-136 payment after a verified NestPay 3D callback. Mutates the
    /// transaction's state; persisting it is the caller's job.
    /// </summary>
    Task<CardPlusCompletionResult> CompleteAsync(
        VirtualPosTransaction transaction,
        VirtualPosDefinition posDefinition,
        VirtualPosCallbackData callback,
        CancellationToken cancellationToken = default);
}

/// <summary>
/// Bank 136 (CreditWest / CardPlus) needs a server-to-server authorization once 3D has
/// succeeded. A successful 3D callback on its own is not a payment, so this step decides
/// whether the transaction becomes Paid.
///
/// Deliberately free of any DbContext dependency: the one operation that must be atomic is
/// behind <see cref="IPaymentAuthorizationClaim"/>, which keeps this logic unit testable
/// without a database.
/// </summary>
public sealed class CardPlusCompletionService : ICardPlusCompletionService
{
    private readonly ICardPlusClient _cardPlusClient;
    private readonly ITransientPaymentCardStore _cardStore;
    private readonly IPaymentAuthorizationClaim _authorizationClaim;

    public CardPlusCompletionService(
        ICardPlusClient cardPlusClient,
        ITransientPaymentCardStore cardStore,
        IPaymentAuthorizationClaim authorizationClaim)
    {
        _cardPlusClient = cardPlusClient;
        _cardStore = cardStore;
        _authorizationClaim = authorizationClaim;
    }

    public async Task<CardPlusCompletionResult> CompleteAsync(
        VirtualPosTransaction transaction,
        VirtualPosDefinition posDefinition,
        VirtualPosCallbackData callback,
        CancellationToken cancellationToken = default)
    {
        if (!VirtualPosRouting.RequiresPostThreeDCompletion(transaction.BankCode))
        {
            return NotEligible(transaction, "Bu banka için ek provizyon gerekmiyor.");
        }

        // The 3D authentication values are the whole point of the second call: without them
        // the bank cannot tie the authorization to the completed 3D session.
        var cavv = callback.Get("cavv");
        var xid = callback.Get("xid");
        var eci = callback.Get("eci");

        if (string.IsNullOrWhiteSpace(cavv) || string.IsNullOrWhiteSpace(xid) || string.IsNullOrWhiteSpace(eci))
        {
            return Fail(transaction, VirtualPosPaymentStatus.ProviderError, "CARDPLUS_MISSING_3D_DATA",
                "3D doğrulama verisi eksik olduğu için provizyon gönderilemedi.",
                CardPlusCompletionOutcome.ProviderError);
        }

        // Win the right to send exactly one authorization. A duplicate or parallel callback
        // loses here and returns without contacting the bank.
        if (!await _authorizationClaim.TryClaimAsync(transaction.Id, cancellationToken))
        {
            return new CardPlusCompletionResult(
                CardPlusCompletionOutcome.AlreadyInProgress,
                "Provizyon zaten işleniyor veya tamamlanmış.");
        }

        transaction.Status = (int)VirtualPosPaymentStatus.AuthorizationPending;
        transaction.IsSuccess = false;
        transaction.CompletedAtUtc = null;

        // One-time consume: a later callback cannot obtain the card again
        var card = _cardStore.Consume(transaction.OrderNo);
        if (card == null)
        {
            // Not a decline. The 3D result stands; the card simply is not available in this
            // process (restart, or another instance handled the start). Needs a human.
            return Fail(transaction, VirtualPosPaymentStatus.AuthorizationPending, "CARDPLUS_CARD_UNAVAILABLE",
                "Provizyon için kart verisi bulunamadı. İşlem manuel incelenmelidir.",
                CardPlusCompletionOutcome.AuthorizationPending);
        }

        CardPlusResult result;
        try
        {
            result = await _cardPlusClient.AuthorizeAsync(new CardPlusAuthorizationRequest(
                XmlUrl: posDefinition.XmlUrl,
                Name: posDefinition.UserCode,
                Password: posDefinition.Password,
                ClientId: posDefinition.ClientId,
                OrderId: transaction.OrderNo,
                Amount: transaction.Amount,
                InstallmentCount: transaction.InstallmentCount,
                Pan: card.Pan,
                ExpiryMonth: card.ExpiryMonth,
                ExpiryYear: card.ExpiryYear,
                Cavv: cavv,
                Xid: xid,
                Eci: eci,
                // İşlemin kendi para birimi bankaya gitmeli: başlatmada EUR seçilip bankaya 949
                // gönderilirse kart TL ile çekilir, muhasebe ise EUR alacak yazar.
                CurrencyNumericCode: VirtualPosCallbackData.ToNumericCurrencyCode(transaction.CurrencyCode) ?? "949"),
                cancellationToken);
        }
        finally
        {
            // Whatever happened, the card must not outlive the call
            _cardStore.Remove(transaction.OrderNo);
        }

        return Apply(transaction, result);
    }

    private static CardPlusCompletionResult Apply(VirtualPosTransaction tx, CardPlusResult result)
    {
        // Only these normalised fields are kept — never the raw XML
        if (!string.IsNullOrWhiteSpace(result.AuthorizationCode)) tx.AuthorizationCode = result.AuthorizationCode;
        if (!string.IsNullOrWhiteSpace(result.HostReferenceNumber)) tx.HostReferenceNumber = result.HostReferenceNumber;
        if (!string.IsNullOrWhiteSpace(result.BankTransactionId)) tx.BankTransactionId = result.BankTransactionId;

        switch (result.Outcome)
        {
            case CardPlusOutcome.Approved:
                tx.Status = (int)VirtualPosPaymentStatus.Authorized;
                tx.IsSuccess = true;
                tx.FailureCode = string.Empty;
                tx.FailureMessage = result.ErrorDescription;
                tx.CompletedAtUtc = B2B.Erp.Api.Core.Helpers.SystemTime.UtcNow;
                return new CardPlusCompletionResult(CardPlusCompletionOutcome.Paid, result.ErrorDescription);

            case CardPlusOutcome.Declined:
                return Fail(tx, VirtualPosPaymentStatus.Failed,
                    string.IsNullOrWhiteSpace(result.ProcReturnCode) ? "CARDPLUS_DECLINED" : result.ProcReturnCode,
                    result.ErrorDescription, CardPlusCompletionOutcome.Declined);

            case CardPlusOutcome.Unknown:
                // The bank may have captured the money. Neither paid nor failed, and no retry.
                return Fail(tx, VirtualPosPaymentStatus.AuthorizationPending, "CARDPLUS_UNKNOWN",
                    result.ErrorDescription, CardPlusCompletionOutcome.AuthorizationPending);

            default:
                return Fail(tx, VirtualPosPaymentStatus.ProviderError, "CARDPLUS_PROVIDER_ERROR",
                    result.ErrorDescription, CardPlusCompletionOutcome.ProviderError);
        }
    }

    private static CardPlusCompletionResult Fail(
        VirtualPosTransaction tx,
        VirtualPosPaymentStatus status,
        string code,
        string message,
        CardPlusCompletionOutcome outcome)
    {
        tx.Status = (int)status;
        tx.IsSuccess = false;
        tx.FailureCode = code;
        tx.FailureMessage = message;

        // An undecided payment has not completed; only a settled one gets a completion time
        tx.CompletedAtUtc = status == VirtualPosPaymentStatus.AuthorizationPending ? null : B2B.Erp.Api.Core.Helpers.SystemTime.UtcNow;

        return new CardPlusCompletionResult(outcome, message);
    }

    private static CardPlusCompletionResult NotEligible(VirtualPosTransaction tx, string message)
        => new(CardPlusCompletionOutcome.NotEligible, message);
}
