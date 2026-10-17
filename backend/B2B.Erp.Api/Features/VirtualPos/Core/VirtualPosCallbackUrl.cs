using System;
using Microsoft.Extensions.Configuration;

namespace B2B.Erp.Api.Features.VirtualPos.Core;

/// <summary>
/// Bankaya "sonucu buraya gönder" diye verilen adres.
///
/// Tek yerde duruyor çünkü bu adres ödemenin sonucunun nereye teslim edileceğine karar veriyor:
/// bayi panelinden başlayan ödeme ile mağazadan başlayan ödeme aynı kuralı kullanmalı. İki
/// ayrı kopya, birinin düzeltilip diğerinin unutulduğu gün ödemenin kaybolması demek.
///
/// İsteğin kendi şeması güvenilir bir cevap değil: Ziraat'in NestPay ağ geçidi https olmayan
/// bir okUrl'i reddediyor ("'okurl' için geçersiz protokol"), TLS'i sonlandıran bir vekilin
/// arkasında ise istek Kestrel'e düz http olarak ulaşıyor. Bu yüzden
/// <c>VirtualPos:CallbackBaseUrl</c> yapılandırıldığında kazanır. Sunucu yapılandırması —
/// çağıranın etkileyebileceği bir değer ASLA olmamalı.
/// </summary>
public static class VirtualPosCallbackUrl
{
    /// <summary>
    /// Firma kodunu içeren tam callback adresi. Firma URL'in içinde taşınıyor: banka geri
    /// dönerken ne başlık ne token gönderiyor, dolayısıyla ödemenin hangi veritabanında
    /// olduğu başka türlü bilinemiyor.
    /// </summary>
    public static string Build(IConfiguration configuration, string requestOrigin, string tenantCode)
        => $"{ResolveBaseUrl(configuration, requestOrigin)}/api/virtual-pos/callback-3d/{Uri.EscapeDataString(tenantCode)}";

    public static string ResolveBaseUrl(IConfiguration configuration, string requestOrigin)
    {
        var configured = (configuration["VirtualPos:CallbackBaseUrl"] ?? string.Empty).Trim().TrimEnd('/');

        if (configured.Length > 0
            && Uri.TryCreate(configured, UriKind.Absolute, out var parsed)
            && (parsed.Scheme == Uri.UriSchemeHttps || parsed.Scheme == Uri.UriSchemeHttp))
        {
            return configured;
        }

        if (configured.Length > 0)
        {
            // Sessizce geri düşmek, bankaya kimsenin seçmediği bir adres göndermek olurdu.
            Console.WriteLine(
                $"[VirtualPos] VirtualPos:CallbackBaseUrl ('{configured}') mutlak bir http(s) adresi değil; " +
                "istek adresine geri dönülüyor.");
        }

        return requestOrigin;
    }
}
