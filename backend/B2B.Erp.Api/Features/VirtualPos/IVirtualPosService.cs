using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;

namespace B2B.Erp.Api.Features.VirtualPos;

public interface IVirtualPosService
{
    Task<BinLookupResponse> LookupBinAsync(string binNumber, decimal amount, CancellationToken cancellationToken = default);

    Task<List<InstallmentOptionDto>> GetInstallmentOptionsAsync(int bankCode, decimal amount, CancellationToken cancellationToken = default);

    /// <summary>
    /// 3D ödemeyi başlatır. <paramref name="presetMerchantOrderId"/> verilirse banka sipariş
    /// numarası üretilmez, verilen kullanılır: mağaza tarafı sipariş ↔ ödeme bağını bankaya
    /// gitmeden önce yazabilsin diye. Verilen numara daha önce kullanılmışsa istek reddedilir.
    /// </summary>
    Task<VirtualPos3DHtmlResponse> Initiate3DPaymentAsync(VirtualPosPaymentRequest request, string callbackUrl, CancellationToken cancellationToken = default, string? presetMerchantOrderId = null);

    Task<VirtualPosTransactionDto> Process3DCallbackAsync(IFormCollection form, CancellationToken cancellationToken = default);

    Task<List<VirtualPosTransactionDto>> GetTransactionsAsync(string? customerCode = null, bool? needsAttentionOnly = null, List<string>? allowedCustomerCodes = null, CancellationToken cancellationToken = default);

    Task<List<VirtualPosDefinitionDto>> GetPosDefinitionsAsync(CancellationToken cancellationToken = default);
}

public sealed class VirtualPosDefinitionDto
{
    public Guid Id { get; set; }

    public int BankCode { get; set; }

    public string BankName { get; set; } = string.Empty;

    public string PosType { get; set; } = string.Empty;

    public string ClientId { get; set; } = string.Empty;

    public string TerminalId { get; set; } = string.Empty;

    public bool IsDefault { get; set; }

    public bool IsActive { get; set; }
}
