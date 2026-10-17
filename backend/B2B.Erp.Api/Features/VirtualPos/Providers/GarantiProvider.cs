using System;
using System.Collections.Generic;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using B2B.Erp.Api.Entities;
using B2B.Erp.Api.Features.VirtualPos.Core;

namespace B2B.Erp.Api.Features.VirtualPos.Providers;

public sealed class GarantiProvider : IVirtualPosProvider
{
    public VirtualPosProviderType ProviderType => VirtualPosProviderType.Garanti;

    /// <summary>Fallback currency when the request does not name one (TRY).</summary>
    private const string DefaultCurrencyCode = "949";

    private const string RefundNotImplementedMessage =
        "Garanti iade/iptal işlemi henüz bankaya bağlanmadı. İşlem BANKAYA İLETİLMEDİ; " +
        "iade veya iptali banka ekranından yapın.";

    /// <summary>3D Pay: the bank authorizes in the same flow the cardholder authenticates in.</summary>
    private const string SecurityLevel = "3D_PAY";

    /// <summary>
    /// The API version decides which digest Garanti expects, and it is not a free choice:
    /// "v0.01" means SHA-1, "512" means SHA-512. Sending "v0.01" alongside a SHA-512
    /// secure3dhash is what made the bank answer "Guvenlik Kodu hatali" with mdStatus=7 —
    /// a hash rejection, despite the wording, not a CVV problem. "512" is the version that
    /// matches <see cref="GarantiCallbackVerifier"/>, which validates the response as SHA-512.
    /// </summary>
    private const string ApiVersion = "512";

    public Task<VirtualPosStartResult> StartPaymentAsync(
        VirtualPosPaymentRequest request,
        VirtualPosConfiguration configuration,
        string merchantOrderId,
        CancellationToken cancellationToken = default)
    {
        // The gateway address comes from the stored definition only. A hardcoded fallback
        // would send a live card to an address the definition never named.
        var gatewayUrl = (configuration.GatewayUrl ?? string.Empty).Trim();
        if (gatewayUrl.Length == 0)
        {
            return Task.FromResult(new VirtualPosStartResult
            {
                Success = false,
                Status = VirtualPosPaymentStatus.Failed,
                MerchantOrderId = merchantOrderId,
                Message = "Sanal POS gateway adresi yapılandırılmamış."
            });
        }

        // Garanti refuses an unsigned request outright, so a missing secret has to stop the
        // payment here rather than produce a form that can only ever come back declined.
        var storeKey = (configuration.StoreKeyEncrypted ?? string.Empty).Trim();
        var provisionPassword = (configuration.ProvisionPasswordEncrypted ?? string.Empty).Trim();
        if (storeKey.Length == 0 || provisionPassword.Length == 0)
        {
            return Task.FromResult(new VirtualPosStartResult
            {
                Success = false,
                Status = VirtualPosPaymentStatus.Failed,
                MerchantOrderId = merchantOrderId,
                Message = "Garanti POS imza anahtarı veya provizyon şifresi tanımlı değil."
            });
        }

        var terminalId = (configuration.TerminalId ?? string.Empty).Trim();
        var amountInMinorUnits = ((long)Math.Round(request.Amount * 100m, MidpointRounding.AwayFromZero))
            .ToString(System.Globalization.CultureInfo.InvariantCulture);

        // Garanti expects the installment field empty for a single charge — "1" is a
        // one-instalment plan and is not the same thing to the bank, and the value has to be
        // identical in the form and in the signature.
        var installment = request.InstallmentCount > 1
            ? request.InstallmentCount.ToString(System.Globalization.CultureInfo.InvariantCulture)
            : string.Empty;

        var callbackUrl = (request.CallbackUrl ?? string.Empty).Trim();
        var month = request.ExpMonth.Trim().PadLeft(2, '0');
        var year = request.ExpYear.Trim().Substring(Math.Max(0, request.ExpYear.Trim().Length - 2));

        // İşlem hangi para biriminde başlatıldıysa bankaya o gitmeli. Sabit 949 gönderilirken
        // EUR başlatılan bir işlemde kart TL ile çekiliyor, muhasebe ise cariye EUR alacak
        // yazıyordu (VirtualPosAccountingService işlemin dövizini kullanıyor) — aradaki fark
        // doğrudan zarar. TRY işlemde değer birebir eskisiyle aynı ("949"), imza da değişmez.
        var currencyCode = Core.VirtualPosCallbackData.ToNumericCurrencyCode(request.CurrencyCode)
                           ?? DefaultCurrencyCode;

        var secure3DHash = ComputeRequestHash(
            terminalId, merchantOrderId, amountInMinorUnits, currencyCode, callbackUrl,
            installment, storeKey, provisionPassword);

        var fields = new List<KeyValuePair<string, string>>
        {
            new("mode", "PROD"),
            new("apiversion", ApiVersion),
            new("terminalprovuserid", "PROVAUT"),
            // The login user the bank knows the merchant by — distinct from the merchant id.
            new("terminaluserid", (configuration.ApiUsernameEncrypted ?? string.Empty).Trim()),
            new("terminalmerchantid", (configuration.MerchantId ?? string.Empty).Trim()),
            new("terminalid", terminalId),
            new("orderid", merchantOrderId),
            new("txntype", "sales"),
            new("txnamount", amountInMinorUnits),
            new("txncurrencycode", currencyCode),
            new("txninstallmentcount", installment),
            new("successurl", callbackUrl),
            new("errorurl", callbackUrl),
            new("customeremailaddress", (request.Email ?? string.Empty).Trim()),
            new("customeripaddress", "127.0.0.1"),
            new("secure3dsecuritylevel", SecurityLevel),
            new("secure3dhash", secure3DHash),
            new("cardnumber", request.CardNumber.Replace(" ", "").Trim()),
            new("cardexpiredatemonth", month),
            new("cardexpiredateyear", year),
            new("cardcvv2", request.Cvc.Trim())
        };

        var sb = new System.Text.StringBuilder();
        sb.AppendLine($"<form id=\"garanti_form\" method=\"POST\" action=\"{gatewayUrl}\">");
        foreach (var field in fields)
        {
            sb.AppendLine($"<input type=\"hidden\" name=\"{field.Key}\" value=\"{System.Net.WebUtility.HtmlEncode(field.Value)}\" />");
        }
        sb.AppendLine("</form>");
        sb.AppendLine("<script>document.getElementById('garanti_form').submit();</script>");

        return Task.FromResult(new VirtualPosStartResult
        {
            Success = true,
            HtmlForm = sb.ToString(),
            GatewayUrl = gatewayUrl,
            MerchantOrderId = merchantOrderId,
            Status = VirtualPosPaymentStatus.RedirectPrepared
        });
    }

    /// <summary>
    /// Garanti's secure3dhash, in two stages:
    ///
    ///   securityData = SHA1(provisionPassword + terminalId left-padded to 9 with '0'), upper hex
    ///   secure3dhash = SHA512(terminalId + orderId + amount + currency + successUrl +
    ///                         errorUrl + txnType + installment + storeKey + securityData), upper hex
    ///
    /// The provision password is never sent in the clear and never appears in the form; only
    /// the digest derived from it travels. The field order below is the bank's and is not
    /// interchangeable — a correct set of values in the wrong order signs nothing.
    /// </summary>
    private static string ComputeRequestHash(
        string terminalId,
        string orderId,
        string amountInMinorUnits,
        string currencyCode,
        string callbackUrl,
        string installment,
        string storeKey,
        string provisionPassword)
    {
        var securityData = Convert.ToHexString(
            SHA1.HashData(Encoding.UTF8.GetBytes(provisionPassword + terminalId.PadLeft(9, '0'))));

        var digestSource = string.Concat(
            terminalId, orderId, amountInMinorUnits, currencyCode,
            callbackUrl, callbackUrl, "sales", installment, storeKey, securityData);

        return Convert.ToHexString(SHA512.HashData(Encoding.UTF8.GetBytes(digestSource)));
    }

    /// <summary>
    /// Two independent gates, kept separate on purpose:
    /// integrity answers "did this really come from the bank, unmodified", business
    /// evaluation answers "did the bank approve the payment". Collapsing them into a single
    /// boolean is how a forged callback ends up looking like an approval.
    /// </summary>
    public Task<VirtualPosCallbackResult> ProcessCallbackAsync(
        VirtualPosCallbackRequest request,
        VirtualPosConfiguration configuration,
        CancellationToken cancellationToken = default)
    {
        var callback = new VirtualPosCallbackData(request.FormData);
        var oid = callback.Get("orderid", "oid");

        // --- Gate 1: cryptographic integrity -----------------------------------------
        var integrity = GarantiCallbackVerifier.Verify(callback, configuration.StoreKeyEncrypted);
        if (!integrity.IsValid)
        {
            // ProviderError, Failed DEĞİL — doğrulanamayan bir callback ödemeyi onaylayamaz
            // ama reddettiğini de söyleyemez. Garanti kendi reddettiği isteği zaten
            // imzalamıyor; o durumda bankanın metni açıklamada taşınıyor (aşağıda).
            return Task.FromResult(new VirtualPosCallbackResult
            {
                IsSuccess = false,
                Status = VirtualPosPaymentStatus.ProviderError,
                MerchantOrderId = oid,
                ErrorCode = "INTEGRITY_" + integrity.Status.ToString().ToUpperInvariant(),
                ErrorDescription = DescribeUnverifiedCallback(callback, integrity.Reason)
            });
        }

        // --- Gate 2: what the bank actually decided -----------------------------------
        return Task.FromResult(EvaluatePaymentResult(callback, oid));
    }

    /// <summary>
    /// Garanti does not sign the response when it rejects the request itself — a bad
    /// secure3dhash or a missing mandatory field comes back with an error message and no
    /// <c>hash</c> at all. Reporting only "Callback imzası bulunamadı" threw the bank's own
    /// reason away and left those failures undiagnosable from the screen or the record.
    ///
    /// The payment still fails: an unverified callback can never approve anything, and this
    /// method is only ever reached on the rejection path. So the bank's text is reported
    /// beside the rejection, explicitly labelled as unverified, never in place of it.
    /// </summary>
    private static string DescribeUnverifiedCallback(VirtualPosCallbackData callback, string integrityReason)
    {
        var bankMessage = callback.Get("errmsg", "mderrormessage", "mderrmsg", "hostmsg");
        if (string.IsNullOrWhiteSpace(bankMessage))
        {
            return integrityReason;
        }

        var mdStatus = callback.Get("mdstatus");
        var mdSuffix = string.IsNullOrWhiteSpace(mdStatus) ? string.Empty : $" (mdStatus: {mdStatus})";

        return $"{integrityReason} Bankanın bildirdiği hata (doğrulanmamış): {bankMessage}{mdSuffix}";
    }

    private static VirtualPosCallbackResult EvaluatePaymentResult(VirtualPosCallbackData callback, string oid)
    {
        var procReturnCode = callback.Get("procreturncode");
        var response = callback.Get("response");
        var mdStatus = callback.Get("mdstatus");
        var authCode = callback.Get("authcode");
        var transId = callback.Get("transid");
        var hostRefNum = callback.Get("hostrefnum");
        var errMsg = callback.Get("errmsg", "mderrormessage", "hostmsg");

        // Only "00" is an approval. "Approved" alone was previously enough, which let a
        // callback carrying a success word but a declining code through.
        var codeApproved = procReturnCode == "00";
        var responseApproved = string.Equals(response, "Approved", StringComparison.OrdinalIgnoreCase);

        // 1 = full 3D authentication; 2/3/4 mean the card or issuer is not enrolled, which
        // the bank still authorizes but without a liability shift.
        var threeDAccepted = mdStatus is "1" or "2" or "3" or "4";

        var isApproved = codeApproved && responseApproved && threeDAccepted;

        string errorDescription;
        if (isApproved) errorDescription = "Başarılı Tahsilat";
        else if (!threeDAccepted) errorDescription = $"3D doğrulaması başarısız (mdStatus: {mdStatus}).";
        else errorDescription = string.IsNullOrWhiteSpace(errMsg) ? "Garanti 3D ödeme reddedildi." : errMsg;

        return new VirtualPosCallbackResult
        {
            IsSuccess = isApproved,
            Status = isApproved ? VirtualPosPaymentStatus.Authorized : VirtualPosPaymentStatus.Failed,
            MerchantOrderId = oid,
            BankTransactionId = transId,
            AuthorizationCode = authCode,
            HostReferenceNumber = hostRefNum,
            ErrorCode = string.IsNullOrWhiteSpace(procReturnCode) ? response : procReturnCode,
            ErrorDescription = errorDescription
        };
    }

    /// <summary>
    /// İade HENÜZ UYGULANMADI ve bilerek BAŞARISIZ dönüyor (2026-08-23). Önceki hâli
    /// bankaya hiç istek atmadan "talep alındı" + <c>Success = true</c> diyordu; "alındı"
    /// kelimesi doğru gibi görünse de çağıran taraf bunu yapılmış iade sayıyordu. Gerçek
    /// Garanti iade/iptal isteği (GVPS <c>refund</c>/<c>void</c>, provizyon parolasıyla
    /// imzalı) yazılıp bankada sınanana kadar kapı kapalı.
    /// </summary>
    public Task<VirtualPosOperationResult> RefundAsync(VirtualPosRefundRequest request, VirtualPosConfiguration configuration, CancellationToken cancellationToken = default)
    {
        return Task.FromResult(new VirtualPosOperationResult { Success = false, Message = RefundNotImplementedMessage, TransactionId = request.BankTransactionId });
    }

    /// <summary>İptal HENÜZ UYGULANMADI. Gerekçe için bkz. <see cref="RefundAsync"/>.</summary>
    public Task<VirtualPosOperationResult> CancelAsync(VirtualPosCancelRequest request, VirtualPosConfiguration configuration, CancellationToken cancellationToken = default)
    {
        return Task.FromResult(new VirtualPosOperationResult { Success = false, Message = RefundNotImplementedMessage, TransactionId = request.BankTransactionId });
    }
}
