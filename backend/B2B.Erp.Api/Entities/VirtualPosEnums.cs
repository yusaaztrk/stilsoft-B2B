using System;

namespace B2B.Erp.Api.Entities;

public enum VirtualPosProviderType
{
    NestPay = 1,
    Garanti = 2,
    Creditwest = 3,
    Koopbank = 4,

    /// <summary>
    /// SAHTE POS — yalnızca lokal test. Hiçbir bankaya bağlanmaz.
    ///
    /// Numarası bilerek yüksek ve aralıklı: gerçek sağlayıcılar 1'den sıralanıyor, bu
    /// değerin araya karışması ya da bir gün gerçek bir sağlayıcıyla çakışması istenmiyor.
    /// Sağlayıcı sınıfı üretimde konteynere hiç girmiyor (bkz. FakePosProvider).
    /// </summary>
    Fake = 99
}

public enum VirtualPosBankCode
{
    Ziraat = 10,
    Halkbank = 12,
    Garanti = 62,
    IsBankasi = 64,
    Koopbank = 120,
    Creditwest = 136,

    /// <summary>Sahte POS'un banka kodu — gerçek hiçbir bankanın kodu değil (lokal test).</summary>
    FakeTest = 999
}

/// <summary>
/// Existing numbers are persisted in VirtualPosTransactions.Status and must never be
/// renumbered; new states are appended.
///
/// The distinctions that matter:
///   ThreeDVerified       != Authorized  — 3D succeeded, the money has not moved yet
///   AuthorizationPending != Failed      — we do not know the outcome; do not retry
///   Authorized           != AccountingPosted — paid, ledger not yet written
/// </summary>
public enum VirtualPosPaymentStatus
{
    Created = 0,
    RedirectPrepared = 1,
    Redirected = 2,
    ThreeDSecurePending = 3,
    Authorized = 4,
    Failed = 5,
    Cancelled = 6,
    Refunded = 7,
    PartiallyRefunded = 8,
    Unknown = 9,

    /// <summary>3D authentication verified. For banks needing a second authorization this is not a payment.</summary>
    ThreeDVerified = 10,

    /// <summary>
    /// A second authorization is in flight, or its outcome is unknown (timeout). The bank may
    /// or may not have captured the money, so this is neither success nor failure and must
    /// never be resolved by blindly retrying.
    /// </summary>
    AuthorizationPending = 11,

    /// <summary>The provider answered something we cannot trust: unreadable or mismatched.</summary>
    ProviderError = 12,

    /// <summary>Paid, ledger entries not written yet. Reserved for accounting finalization.</summary>
    AccountingPending = 13,

    /// <summary>Paid and posted to the ledger. Reserved for accounting finalization.</summary>
    AccountingPosted = 14
}
