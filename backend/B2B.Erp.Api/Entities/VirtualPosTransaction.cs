using System;
using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace B2B.Erp.Api.Entities;

public sealed class VirtualPosTransaction
{
    // Mapped columns in PostgreSQL table "VirtualPosTransactions"
    public Guid Id { get; set; } = Guid.NewGuid();

    public string OrderNo { get; set; } = string.Empty;

    public string BankDocumentNo { get; set; } = string.Empty;

    public string CustomerCode { get; set; } = string.Empty;

    public int BankCode { get; set; }

    public int InstallmentCount { get; set; }

    public decimal Amount { get; set; }

    public DateTime CreateTime { get; set; } = DateTime.UtcNow;

    public bool IsSuccess { get; set; } = false;

    public string AuthCode { get; set; } = string.Empty;

    public string ErrorCode { get; set; } = string.Empty;

    public string ErrorDescription { get; set; } = string.Empty;

    public bool Is3D { get; set; } = true;

    public string CardHolderName { get; set; } = string.Empty;

    public string MaskedCardNumber { get; set; } = string.Empty;

    public string Email { get; set; } = string.Empty;

    public string Phone { get; set; } = string.Empty;

    public int Status { get; set; } = 0;

    public string RawResponse { get; set; } = string.Empty;

    /// <summary>
    /// The accounting receipt number entered by hand once the collection has been booked.
    /// A real column rather than a derived value: it is issued outside this system and there
    /// is nothing here it could be reconstructed from. Nullable because a payment exists long
    /// before anyone writes a receipt for it, and most rows never get one.
    /// </summary>
    [MaxLength(30)]
    public string? ReceiptNo { get; set; }

    /// <summary>
    /// The currency the payment was initiated in. Persisted because it is read back from a
    /// fresh context on paths that decide money: the callback compares it against the code
    /// the bank reports, and accounting maps it onto the ERP currency type. While it was
    /// [NotMapped] every reload silently produced "TRY", so a EUR/USD/GBP collection was
    /// booked as Turkish Lira and its callback currency check compared against 949.
    ///
    /// Three characters: every code this ERP accepts is ISO 4217 alphabetic (TRY, EUR, USD,
    /// GBP) plus the two-character legacy alias "TL". Anything longer is not a currency the
    /// system can resolve, and initiation refuses it before the bank is contacted.
    /// </summary>
    [MaxLength(3)]
    public string CurrencyCode { get; set; } = "TRY";

    /// <summary>
    /// The bank's own reference for the authorization. Bank-issued and impossible to
    /// reconstruct once lost, and it is the value a reconciliation against the bank's report
    /// is done on — so it has to survive the request that received it. Left as text because
    /// its format is decided by each bank, not by us.
    /// </summary>
    public string HostReferenceNumber { get; set; } = string.Empty;

    /// <summary>
    /// When the payment reached a settled outcome, or null while it is still undecided
    /// (AuthorizationPending). Not derivable from CreateTime: a CardPlus payment is created
    /// at redirect and only settles after the second authorization, and the null/not-null
    /// distinction is the record of whether the bank ever answered.
    /// </summary>
    public DateTime? CompletedAtUtc { get; set; }

    // Additional extended properties marked [NotMapped] to preserve 100% DB schema compatibility
    [NotMapped]
    public Guid? TenantId { get; set; }

    [NotMapped]
    public Guid? InvoiceId { get; set; }

    [NotMapped]
    public Guid? OrderId { get; set; }

    [NotMapped]
    public Guid? CustomerId { get; set; }

    [NotMapped]
    public Guid? VirtualPosConfigurationId { get; set; }

    /// <summary>
    /// Display name of the processing bank. Deliberately NOT a column: it is fully determined
    /// by <see cref="BankCode"/>, and the authoritative name already lives on the POS
    /// definition. Storing it again would let the two drift apart. Consumers that need the
    /// name after a reload resolve it from the code.
    /// </summary>
    [NotMapped]
    public string BankName { get; set; } = string.Empty;

    /// <summary>Set at initiation for the request payload only; never read back.</summary>
    [NotMapped]
    public string CardBrand { get; set; } = string.Empty;

    // Helper compatibility aliases (NotMapped)
    [NotMapped]
    public string MerchantOrderId { get => OrderNo; set => OrderNo = value; }

    [NotMapped]
    public string BankTransactionId { get => BankDocumentNo; set => BankDocumentNo = value; }

    [NotMapped]
    public string AuthorizationCode { get => AuthCode; set => AuthCode = value; }

    [NotMapped]
    public string FailureCode { get => ErrorCode; set => ErrorCode = value; }

    [NotMapped]
    public string FailureMessage { get => ErrorDescription; set => ErrorDescription = value; }

    [NotMapped]
    public string MaskedPan { get => MaskedCardNumber; set => MaskedCardNumber = value; }

    [NotMapped]
    public DateTime CreatedAtUtc { get => CreateTime; set => CreateTime = value; }

    [NotMapped]
    public VirtualPosPaymentStatus PaymentStatus { get => (VirtualPosPaymentStatus)Status; set => Status = (int)value; }

    [NotMapped]
    public string RequestPayloadMasked { get; set; } = string.Empty;

    [NotMapped]
    public string ResponsePayloadMasked { get => RawResponse; set => RawResponse = value; }
}
