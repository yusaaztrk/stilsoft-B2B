using System.Threading;
using System.Threading.Tasks;
using B2B.Erp.Api.Entities;

namespace B2B.Erp.Api.Features.VirtualPos.Core;

public interface IVirtualPosProvider
{
    VirtualPosProviderType ProviderType { get; }

    Task<VirtualPosStartResult> StartPaymentAsync(
        VirtualPosPaymentRequest request,
        VirtualPosConfiguration configuration,
        string merchantOrderId,
        CancellationToken cancellationToken = default);

    Task<VirtualPosCallbackResult> ProcessCallbackAsync(
        VirtualPosCallbackRequest request,
        VirtualPosConfiguration configuration,
        CancellationToken cancellationToken = default);

    Task<VirtualPosOperationResult> RefundAsync(
        VirtualPosRefundRequest request,
        VirtualPosConfiguration configuration,
        CancellationToken cancellationToken = default);

    Task<VirtualPosOperationResult> CancelAsync(
        VirtualPosCancelRequest request,
        VirtualPosConfiguration configuration,
        CancellationToken cancellationToken = default);
}
