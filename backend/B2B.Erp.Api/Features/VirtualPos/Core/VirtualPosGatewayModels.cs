using System;
using System.Collections.Generic;
using B2B.Erp.Api.Entities;

namespace B2B.Erp.Api.Features.VirtualPos.Core;

public sealed class VirtualPosStartResult
{
    public bool Success { get; set; }

    public string Message { get; set; } = string.Empty;

    public string MerchantOrderId { get; set; } = string.Empty;

    public string HtmlForm { get; set; } = string.Empty;

    public string GatewayUrl { get; set; } = string.Empty;

    public VirtualPosPaymentStatus Status { get; set; } = VirtualPosPaymentStatus.Created;
}

public sealed class VirtualPosCallbackRequest
{
    public IDictionary<string, string> FormData { get; set; } = new Dictionary<string, string>();
}

public sealed class VirtualPosCallbackResult
{
    public bool IsSuccess { get; set; }

    public VirtualPosPaymentStatus Status { get; set; } = VirtualPosPaymentStatus.Unknown;

    public string MerchantOrderId { get; set; } = string.Empty;

    public string BankTransactionId { get; set; } = string.Empty;

    public string AuthorizationCode { get; set; } = string.Empty;

    public string HostReferenceNumber { get; set; } = string.Empty;

    public string ErrorCode { get; set; } = string.Empty;

    public string ErrorDescription { get; set; } = string.Empty;
}

public sealed class VirtualPosRefundRequest
{
    public string BankTransactionId { get; set; } = string.Empty;

    public string MerchantOrderId { get; set; } = string.Empty;

    public decimal Amount { get; set; }

    public string CurrencyCode { get; set; } = "TRY";
}

public sealed class VirtualPosCancelRequest
{
    public string BankTransactionId { get; set; } = string.Empty;

    public string MerchantOrderId { get; set; } = string.Empty;
}

public sealed class VirtualPosOperationResult
{
    public bool Success { get; set; }

    public string Message { get; set; } = string.Empty;

    public string TransactionId { get; set; } = string.Empty;

    public string ErrorCode { get; set; } = string.Empty;
}
