using System;
using Microsoft.Extensions.Caching.Memory;

namespace B2B.Erp.Api.Features.VirtualPos.Core;

/// <summary>Card data held only long enough to finish a server-to-server authorization.</summary>
public sealed record TransientCardData(string Pan, string ExpiryMonth, string ExpiryYear);

/// <summary>
/// Holds the card number for the short window between starting a 3D payment and completing
/// the follow-up authorization. Needed only by bank 136 (CreditWest / CardPlus), whose
/// authorization call happens after the 3D callback and requires the PAN.
///
/// Deliberately NOT a card vault:
/// no persistence, no logging, no CVV, one-time consume, short TTL.
/// The full PAN never reaches <c>VirtualPosTransaction</c> or any other table.
/// </summary>
public interface ITransientPaymentCardStore
{
    void Store(string merchantOrderId, TransientCardData card);

    /// <summary>Returns the card once and removes it; a second call yields null.</summary>
    TransientCardData? Consume(string merchantOrderId);

    void Remove(string merchantOrderId);
}

/// <summary>
/// In-memory implementation.
///
/// LIMITATION — deliberately visible: the entry lives in this process only. After a restart,
/// or on a second instance behind a load balancer, the card is gone. That must never be read
/// as "the payment failed": the 3D result stands on its own, so the caller leaves such a
/// payment in an authorization-pending state for manual review instead of declining it.
/// </summary>
public sealed class MemoryTransientPaymentCardStore : ITransientPaymentCardStore
{
    private readonly IMemoryCache _cache;

    /// <summary>Long enough for a cardholder to finish 3D, short enough to limit exposure.</summary>
    private static readonly TimeSpan Lifetime = TimeSpan.FromMinutes(15);

    private const string KeyPrefix = "vpos:card:";

    public MemoryTransientPaymentCardStore(IMemoryCache cache) => _cache = cache;

    private static string KeyFor(string merchantOrderId) => KeyPrefix + merchantOrderId;

    public void Store(string merchantOrderId, TransientCardData card)
    {
        if (string.IsNullOrWhiteSpace(merchantOrderId)) return;

        _cache.Set(KeyFor(merchantOrderId), card, new MemoryCacheEntryOptions
        {
            AbsoluteExpirationRelativeToNow = Lifetime,
            Size = 1
        });
    }

    public TransientCardData? Consume(string merchantOrderId)
    {
        if (string.IsNullOrWhiteSpace(merchantOrderId)) return null;

        var key = KeyFor(merchantOrderId);
        if (!_cache.TryGetValue<TransientCardData>(key, out var card)) return null;

        // One-time semantics: removing before returning means a duplicate callback cannot
        // obtain the card again and send a second authorization.
        _cache.Remove(key);
        return card;
    }

    public void Remove(string merchantOrderId)
    {
        if (string.IsNullOrWhiteSpace(merchantOrderId)) return;
        _cache.Remove(KeyFor(merchantOrderId));
    }
}
