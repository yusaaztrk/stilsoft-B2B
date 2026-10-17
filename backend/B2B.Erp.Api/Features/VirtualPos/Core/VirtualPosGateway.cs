using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using B2B.Erp.Api.Entities;

namespace B2B.Erp.Api.Features.VirtualPos.Core;

public sealed class VirtualPosGateway : IVirtualPosGateway
{
    private readonly IDictionary<VirtualPosProviderType, IVirtualPosProvider> _providers;

    public VirtualPosGateway(IEnumerable<IVirtualPosProvider> providers)
    {
        _providers = providers.ToDictionary(p => p.ProviderType, p => p);
    }

    public Task<VirtualPosStartResult> StartPaymentAsync(
        VirtualPosPaymentRequest request,
        VirtualPosConfiguration configuration,
        string merchantOrderId,
        CancellationToken cancellationToken = default)
    {
        var provider = GetProvider(configuration.ProviderType);
        return provider.StartPaymentAsync(request, configuration, merchantOrderId, cancellationToken);
    }

    public Task<VirtualPosCallbackResult> ProcessCallbackAsync(
        VirtualPosCallbackRequest request,
        VirtualPosConfiguration configuration,
        CancellationToken cancellationToken = default)
    {
        var provider = GetProvider(configuration.ProviderType);
        return provider.ProcessCallbackAsync(request, configuration, cancellationToken);
    }

    public Task<VirtualPosOperationResult> RefundAsync(
        VirtualPosRefundRequest request,
        VirtualPosConfiguration configuration,
        CancellationToken cancellationToken = default)
    {
        var provider = GetProvider(configuration.ProviderType);
        return provider.RefundAsync(request, configuration, cancellationToken);
    }

    public Task<VirtualPosOperationResult> CancelAsync(
        VirtualPosCancelRequest request,
        VirtualPosConfiguration configuration,
        CancellationToken cancellationToken = default)
    {
        var provider = GetProvider(configuration.ProviderType);
        return provider.CancelAsync(request, configuration, cancellationToken);
    }

    private IVirtualPosProvider GetProvider(VirtualPosProviderType providerType)
    {
        if (_providers.TryGetValue(providerType, out var provider))
        {
            return provider;
        }

        // Deliberately no fallback. Silently substituting NestPay meant a callback from one
        // bank could be evaluated by another bank's parser, and an unconfigured provider
        // looked like a working one. Fail closed instead.
        throw new InvalidOperationException($"Virtual POS Provider for '{providerType}' is not registered.");
    }
}
