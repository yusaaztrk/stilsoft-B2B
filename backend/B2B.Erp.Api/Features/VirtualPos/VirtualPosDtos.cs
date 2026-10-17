using System;
using System.Collections.Generic;

namespace B2B.Erp.Api.Features.VirtualPos;

public sealed class VirtualPosPaymentRequest
{
    public string CustomerCode { get; set; } = string.Empty;

    public decimal Amount { get; set; }

    public string CurrencyCode { get; set; } = "TRY";

    public string CardHolderName { get; set; } = string.Empty;

    public string CardNumber { get; set; } = string.Empty;

    public string ExpMonth { get; set; } = string.Empty; // MM

    public string ExpYear { get; set; } = string.Empty; // YY or YYYY

    public string Cvc { get; set; } = string.Empty;

    public int InstallmentCount { get; set; } = 0; // 0 or 1 = Tek Çekim

    public int BankCode { get; set; } = 0; // 0 = Auto detect by BIN

    public string CallbackUrl { get; set; } = string.Empty;

    public string Email { get; set; } = string.Empty;

    public string Phone { get; set; } = string.Empty;
}

public sealed class VirtualPos3DHtmlResponse
{
    public bool Success { get; set; }

    public string Message { get; set; } = string.Empty;

    public string HtmlForm { get; set; } = string.Empty; // Complete 3D auto-post HTML form

    public string GatewayUrl { get; set; } = string.Empty;

    public string OrderNo { get; set; } = string.Empty;
}

public sealed class BinLookupResponse
{
    public bool Success { get; set; }

    public string BinNo { get; set; } = string.Empty;

    public int BankCode { get; set; }

    public string BankName { get; set; } = string.Empty;

    public string CardType1 { get; set; } = string.Empty; // VISA / MASTER

    public string CardType2 { get; set; } = string.Empty; // KREDİ / DEBİT

    public List<InstallmentOptionDto> Installments { get; set; } = new();
}

public sealed class InstallmentOptionDto
{
    public int MerchantInstallment { get; set; }

    public int BankInstallment { get; set; }

    public string InstallmentText { get; set; } = string.Empty;

    public decimal MinAmount { get; set; }

    public decimal TotalAmount { get; set; }

    public decimal MonthlyAmount { get; set; }

    public string Description { get; set; } = string.Empty;
}

public sealed class VirtualPosTransactionDto
{
    public Guid Id { get; set; }

    /// <summary>
    /// İşlemin para birimi (<c>VirtualPosTransaction.CurrencyCode</c>). Rapor ekranı sabit
    /// "TL" yazıyordu: dolarla çekilen bir POS işlemi listede 1.500,00 TL görünüyordu.
    /// Muhasebe tarafı zaten doğru para birimiyle yazıyor (VirtualPosAccountingService).
    /// </summary>
    public string CurrencyCode { get; set; } = "TRY";

    public string OrderNo { get; set; } = string.Empty;

    public string BankDocumentNo { get; set; } = string.Empty;

    public string CustomerCode { get; set; } = string.Empty;

    public int BankCode { get; set; }

    public string BankName { get; set; } = string.Empty;

    public int InstallmentCount { get; set; }

    public decimal Amount { get; set; }

    public DateTime TransactionDate { get; set; }

    public bool IsSuccess { get; set; }

    public string AuthCode { get; set; } = string.Empty;

    public string ErrorCode { get; set; } = string.Empty;

    public string ErrorDescription { get; set; } = string.Empty;

    public bool Is3D { get; set; }

    public string CardHolderName { get; set; } = string.Empty;

    public string MaskedCardNumber { get; set; } = string.Empty;

    public string Email { get; set; } = string.Empty;

    public string Phone { get; set; } = string.Empty;

    public int Status { get; set; }

    /// <summary>Accounting receipt number, empty until someone enters one.</summary>
    public string ReceiptNo { get; set; } = string.Empty;

    /// <summary>Resolved for display; the transaction stores only the customer code.</summary>
    public string CustomerName { get; set; } = string.Empty;
}
