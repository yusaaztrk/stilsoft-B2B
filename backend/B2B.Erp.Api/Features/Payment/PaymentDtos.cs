using System;

namespace B2B.Erp.Api.Features.Payment;

public sealed class PaymentCalculationRequest
{
    public decimal DebtAmount { get; set; }
    public int DebtCurrencyTypeId { get; set; } = 1; // 1: TRY, 2: EUR, 3: USD, 4: GBP

    /// <summary>
    /// Borcun para biriminin TL kuru (1 DebtCurrency = X TRY). Verilmezse
    /// <see cref="ExchangeRate"/> kullanılır — borç ve ödeme aynı paradaysa ikisi zaten eşittir.
    ///
    /// <para>
    /// <b>Bu alan neden var:</b> istek ÜÇ para birimi taşıyordu (borç · ödeme · para üstü) ama
    /// yalnızca İKİ kur (<c>ExchangeRate</c>, <c>ChangeExchangeRate</c>). Borcun kendi kuru
    /// yoktu, motor da ödeme kurunu borç için de kullanıyordu. Borç ile ödeme aynı paradayken
    /// ya da biri TL iken sonuç doğru çıkıyordu, ama <b>çapraz dövizde sessizce yanlıştı</b>:
    /// 100 EUR borç (kur 40), 100 USD ile (kur 38) ödendiğinde motor 3.800 ₺'yi 38'e bölüp
    /// "100 EUR tahsil edildi" diyor ve borcu KAPATIYORDU — doğrusu 3.800/40 = 95 EUR.
    /// </para>
    /// </summary>
    public decimal DebtExchangeRate { get; set; } = 0m;

    public decimal ReceivedAmount { get; set; }
    public int PaymentCurrencyTypeId { get; set; } = 1;
    public decimal ExchangeRate { get; set; } = 1m; // 1 PaymentCurrency = X TRY

    public int ChangeCurrencyTypeId { get; set; } = 1;
    public decimal ChangeExchangeRate { get; set; } = 1m; // 1 ChangeCurrency = X TRY
}

public sealed class PaymentCalculationResult
{
    public decimal DebtAmount { get; set; }
    public int DebtCurrencyTypeId { get; set; }

    public decimal ReceivedAmount { get; set; }
    public int PaymentCurrencyTypeId { get; set; }
    public decimal ExchangeRate { get; set; }

    public decimal ReceivedAmountInDebtCurrency { get; set; }
    public decimal ReceivedAmountInTry { get; set; }

    public decimal AppliedToDebtAmount { get; set; } // Capped to DebtAmount in Debt Currency
    public decimal AppliedToDebtAmountInTry { get; set; }

    public decimal OverpaymentAmountInDebtCurrency { get; set; }
    public decimal OverpaymentAmountInTry { get; set; }

    public decimal ChangeAmount { get; set; } // Amount in ChangeCurrencyTypeId
    public int ChangeCurrencyTypeId { get; set; }
    public decimal ChangeExchangeRate { get; set; }
    public decimal ChangeAmountInTry { get; set; }

    public bool IsFullPayment { get; set; }
    public decimal RemainingDebtAmount { get; set; }

    // Snapshot Info
    public DateTime RateDate { get; set; } = DateTime.UtcNow;
    public string RateSource { get; set; } = "TCMB / User";
    public bool IsManualRate { get; set; }
}

public sealed class ProcessInvoicePaymentRequest
{
    public int InvoiceId { get; set; }
    public string PaymentMethod { get; set; } = "Cash"; // Cash, Bank
    public int AccountId { get; set; } // CashAccountId or BankAccountDefinitionId

    public decimal ReceivedAmount { get; set; }
    public decimal ExchangeRate { get; set; } = 1m;

    public int? ChangeAccountId { get; set; } // CashAccountId or BankAccountDefinitionId for Change
    public string? ChangeAccountType { get; set; } = "Cash"; // Cash, Bank
    public decimal ChangeExchangeRate { get; set; } = 1m;

    public string? ClientTransactionId { get; set; } // IdempotencyKey
    public string? Description { get; set; }
}

public sealed class ProcessPaymentResult
{
    public bool Success { get; set; }
    public string Message { get; set; } = string.Empty;
    public string? ClientTransactionId { get; set; }
    public PaymentCalculationResult? Calculation { get; set; }
    public int? CashTransactionInId { get; set; }
    public int? CashTransactionOutId { get; set; }
    public int? BankTransactionInId { get; set; }
    public int? BankTransactionOutId { get; set; }
    public int? CustomerLedgerEntryId { get; set; }
}
