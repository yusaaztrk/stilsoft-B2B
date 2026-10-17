using B2B.Erp.Api.Core.Helpers;
using B2B.Erp.Api.Entities;

namespace B2B.Erp.Api.Features.VirtualPos.Core;

public enum AccountingEligibility
{
    /// <summary>Everything resolved; the financial records can be written.</summary>
    Ready = 0,
    /// <summary>The bank never captured this money. Never post accounting.</summary>
    PaymentNotAuthorized = 1,
    /// <summary>Already posted. Repeating is a no-op, not an error.</summary>
    AlreadyPosted = 2,
    /// <summary>Authorized, but something the ERP needs is missing. Retry later.</summary>
    Deferred = 3
}

public sealed record AccountingDecision(
    AccountingEligibility Eligibility,
    string Reason,
    string Reference = "",
    int CurrencyTypeId = 0);

/// <summary>
/// Decides whether a virtual POS payment may be posted to the ledger, and derives the
/// values the posting needs. Kept free of any database dependency so the rules can be
/// tested exhaustively; the service performs the writes.
///
/// The guiding rule: money that the bank captured is never un-captured by an ERP problem.
/// Anything the ERP cannot resolve produces <see cref="AccountingEligibility.Deferred"/>,
/// never a payment failure.
/// </summary>
public static class VirtualPosAccountingPlanner
{
    private const string ReferencePrefix = "VP-";

    /// <summary>
    /// DocumentNo is varchar(30) on both CustomerLedgerEntries and BankAccountTransactions,
    /// so the reference has to fit. A merchant order id is "SP" plus a 32 character GUID,
    /// which with the prefix would be 37 characters and fail with a truncation error.
    /// </summary>
    public const int MaxReferenceLength = 30;

    /// <summary>
    /// Deterministic, so a retry produces the same reference and cannot create a second set
    /// of records. A random value here would defeat idempotency entirely.
    ///
    /// When the order id is too long the TAIL is kept: the merchant order id ends in the
    /// random GUID, so the last characters carry the entropy while the leading "SP" is
    /// constant. 27 hex characters still leave over 100 bits.
    /// </summary>
    public static string BuildReference(string merchantOrderId)
    {
        var id = (merchantOrderId ?? string.Empty).Trim();
        var budget = MaxReferenceLength - ReferencePrefix.Length;

        if (id.Length > budget)
        {
            id = id.Substring(id.Length - budget);
        }

        return ReferencePrefix + id;
    }

    /// <summary>Marks the ledger rows this feature owns, so idempotency can be scoped to them.</summary>
    public const string TransactionTypeTag = "Sanal POS Tahsilat";

    public static AccountingDecision Decide(VirtualPosTransaction tx, BankAccountDefinition? posAccount)
    {
        if (tx == null) return new AccountingDecision(AccountingEligibility.PaymentNotAuthorized, "İşlem bulunamadı.");

        var status = (VirtualPosPaymentStatus)tx.Status;

        if (status == VirtualPosPaymentStatus.AccountingPosted)
        {
            return new AccountingDecision(AccountingEligibility.AlreadyPosted, "Muhasebe kaydı zaten oluşturulmuş.");
        }

        // Only a genuinely captured payment qualifies. ThreeDVerified, AuthorizationPending,
        // ProviderError, Failed and everything else are excluded — for bank 136 this is what
        // keeps a successful 3D step from producing accounting before CardPlus authorizes.
        var authorized = tx.IsSuccess
                         && status is VirtualPosPaymentStatus.Authorized
                             or VirtualPosPaymentStatus.AccountingPending;

        if (!authorized)
        {
            return new AccountingDecision(AccountingEligibility.PaymentNotAuthorized,
                $"Ödeme banka tarafından onaylanmadığı için muhasebe kaydı oluşturulmaz (durum: {status}).");
        }

        if (string.IsNullOrWhiteSpace(tx.CustomerCode))
        {
            return new AccountingDecision(AccountingEligibility.Deferred, "İşlemde cari kodu yok.");
        }

        if (tx.Amount <= 0m)
        {
            return new AccountingDecision(AccountingEligibility.Deferred, "İşlem tutarı geçersiz.");
        }

        // The POS account is resolved from the bank that actually processed the payment.
        // There is deliberately no fallback: writing the collection to another bank's account
        // would be worse than leaving it unposted.
        if (posAccount == null)
        {
            return new AccountingDecision(AccountingEligibility.Deferred,
                $"{tx.BankCode} numaralı banka için POS hesap tanımı bulunamadı.");
        }

        // Hesap satırı var ama banka hesap numarası hâlâ kurulum yer tutucusu.
        //
        // Bu, hesabın hiç olmamasından daha sinsi: tanım bulunduğu için tahsilat işlenir ve
        // ekstrede bankada karşılığı OLMAYAN bir hesaba para girmiş görünür. Ziraat aynı
        // zamanda POS'umuz olmayan her kartın düştüğü varsayılan yol (VirtualPosRouting), yani
        // eksik kalan tek satır ilk canlı ödemede sessizce yanlış kayıt üretirdi.
        //
        // Ödeme DÜŞÜRÜLMEZ — para bankada zaten çekilmiş olur; kayıt beklemeye alınır ve
        // hesap numarası girilince VirtualPosAccountingRetryService kendiliğinden işler.
        if (IsPlaceholderAccountNo(posAccount.AccountNo))
        {
            return new AccountingDecision(AccountingEligibility.Deferred,
                $"'{posAccount.AccountName}' POS hesabının banka hesap numarası tanımlı değil; " +
                "tahsilat, numara girilene kadar muhasebeleştirilmiyor.");
        }

        var currencyTypeId = ResolveCurrencyTypeId(tx.CurrencyCode);
        if (currencyTypeId == null)
        {
            return new AccountingDecision(AccountingEligibility.Deferred,
                $"'{tx.CurrencyCode}' para birimi ERP karşılığına eşlenemedi.");
        }

        return new AccountingDecision(
            AccountingEligibility.Ready,
            "Muhasebe kaydı oluşturulabilir.",
            BuildReference(tx.OrderNo),
            currencyTypeId.Value);
    }

    /// <summary>
    /// Kurulumda bırakılmış yer tutucu hesap numaraları.
    ///
    /// Liste kısa ve açık tutuldu: "sayı içermiyorsa yer tutucudur" gibi bir kural, gerçek ama
    /// harf içeren bir hesap kodunu da eler ve tahsilatı sebepsiz bekletirdi.
    /// </summary>
    private static readonly string[] PlaceholderAccountNumbers =
    {
        "TANIMLANACAK",
        "TANIMLANMADI",
        "BELIRLENECEK",
        "TBD",
        "-"
    };

    public static bool IsPlaceholderAccountNo(string? accountNo)
    {
        var value = (accountNo ?? string.Empty).Trim();
        if (value.Length == 0) return true;

        return PlaceholderAccountNumbers.Any(p => string.Equals(p, value, StringComparison.OrdinalIgnoreCase));
    }

    /// <summary>
    /// Maps the payment's currency onto the ERP currency type. Reuses the shared helper so
    /// the virtual POS module does not invent a second mapping. Unknown returns null, and
    /// the caller defers rather than guessing.
    /// </summary>
    public static int? ResolveCurrencyTypeId(string? currencyCode)
    {
        var code = (currencyCode ?? string.Empty).Trim().ToUpperInvariant();
        return code switch
        {
            "" or "TRY" or "TL" => CurrencyTypeHelper.Try,
            "EUR" => CurrencyTypeHelper.Eur,
            "USD" => CurrencyTypeHelper.Usd,
            "GBP" => CurrencyTypeHelper.Gbp,
            _ => null
        };
    }

    /// <summary>
    /// Non-sensitive description. Never carries PAN, CVV, 3D authentication values or
    /// hashes; the auth code and host reference live in their own columns.
    ///
    /// The bank name is derived from the code rather than read off the transaction: the name
    /// is not a stored column, so on the accounting path — which always works from a freshly
    /// loaded transaction — the property is empty and the description used to read
    /// "Sanal POS Tahsilatı -  - SP…". <paramref name="bankName"/> lets the caller supply the
    /// authoritative name from the POS definition; without one the code's own name is used.
    /// </summary>
    public static string BuildDescription(VirtualPosTransaction tx, string? bankName = null)
    {
        var name = (bankName ?? string.Empty).Trim();

        if (name.Length == 0) name = (tx.BankName ?? string.Empty).Trim();
        if (name.Length == 0) name = ResolveBankName(tx.BankCode);

        return $"Sanal POS Tahsilatı - {name} - {tx.OrderNo}";
    }

    /// <summary>
    /// Last-resort display name for a processing bank. Only the banks this ERP has a POS
    /// definition for are listed; anything else falls back to the code itself rather than
    /// inventing a name.
    /// </summary>
    public static string ResolveBankName(int bankCode) => bankCode switch
    {
        10 => "ZİRAAT BANKASI",
        12 => "HALKBANK",
        62 => "GARANTİ BBVA",
        64 => "İŞ BANKASI",
        120 => "KOOPBANK",
        136 => "CREDITWEST",
        _ => $"BANKA {bankCode}"
    };
}
