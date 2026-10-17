using System.Threading;
using System.Threading.Tasks;
using B2B.Erp.Api.Entities;
using B2B.Erp.Api.Features.VirtualPos.Core;

namespace B2B.Erp.Api.Features.VirtualPos.Providers;

/// <summary>
/// Koopbank (bank code 120) — NOT IMPLEMENTED.
///
/// The previous version of this provider posted to a guessed endpoint with invented field
/// names. No verified Koopbank protocol, gateway URL or test vector exists for this build,
/// and guessing a payment protocol produces silent failures or — worse — a callback the
/// ERP reports as paid while the bank never captured anything.
///
/// Every method therefore fails closed. Koopbank cards remain chargeable:
/// <see cref="VirtualPosRouting.UnsupportedProcessingBankCodes"/> routes them to the
/// default POS during payment initiation. Once a verified integration exists, drop 120
/// from that list and implement the methods below — no other code has to change.
/// </summary>
public sealed class KoopbankProvider : IVirtualPosProvider
{
    private const string NotImplementedMessage =
        "Koopbank sanal POS entegrasyonu tanımlı değil. Ödeme varsayılan POS üzerinden alınmalıdır.";

    public VirtualPosProviderType ProviderType => VirtualPosProviderType.Koopbank;

    public Task<VirtualPosStartResult> StartPaymentAsync(
        VirtualPosPaymentRequest request,
        VirtualPosConfiguration configuration,
        string merchantOrderId,
        CancellationToken cancellationToken = default)
        => Task.FromResult(new VirtualPosStartResult
        {
            Success = false,
            Status = VirtualPosPaymentStatus.Failed,
            MerchantOrderId = merchantOrderId,
            Message = NotImplementedMessage
        });

    public Task<VirtualPosCallbackResult> ProcessCallbackAsync(
        VirtualPosCallbackRequest request,
        VirtualPosConfiguration configuration,
        CancellationToken cancellationToken = default)
        => Task.FromResult(new VirtualPosCallbackResult
        {
            IsSuccess = false,
            // Yorumlayamadığımız bir yanıt "red" değildir. Başlatma tarafı Failed kalır
            // (oradan banka hiç aranmadı, para hareketi yok); burada ise banka konuşmuş
            // olabilir ve ne dediğini çözemiyoruz.
            Status = VirtualPosPaymentStatus.ProviderError,
            ErrorCode = "PROVIDER_NOT_IMPLEMENTED",
            ErrorDescription = NotImplementedMessage
        });

    public Task<VirtualPosOperationResult> RefundAsync(
        VirtualPosRefundRequest request,
        VirtualPosConfiguration configuration,
        CancellationToken cancellationToken = default)
        => Task.FromResult(new VirtualPosOperationResult { Success = false, Message = NotImplementedMessage });

    public Task<VirtualPosOperationResult> CancelAsync(
        VirtualPosCancelRequest request,
        VirtualPosConfiguration configuration,
        CancellationToken cancellationToken = default)
        => Task.FromResult(new VirtualPosOperationResult { Success = false, Message = NotImplementedMessage });
}
