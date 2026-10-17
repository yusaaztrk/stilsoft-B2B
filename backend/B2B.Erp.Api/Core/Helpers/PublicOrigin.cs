using Microsoft.AspNetCore.Http;

namespace B2B.Erp.Api.Core.Helpers;

/// <summary>
/// İsteğin DIŞARIDAN görünen şeması ve adresi.
///
/// Ters vekil (Nginx, Cloudflare) TLS'i kendisi sonlandırdığında uygulamaya gelen istek düz
/// http oluyor ve <c>Request.Scheme</c> "http" kalıyor. Bu değerle üretilen mutlak adresler
/// iki yerde bozuluyor:
///   • dosya/logo adresleri — HTTPS sayfada tarayıcı karma içerik kuralıyla engelliyor,
///   • banka 3D callback adresi — NestPay http adresi kabul etmiyor, ödeme dönüşü kayboluyor.
///
/// Vekilin bildirdiği asıl şema varsa o kullanılır. Projede <c>X-Forwarded-For</c> zaten elle
/// okunuyor (AuthController, GlobalExceptionMiddleware); aynı yaklaşım burada da izleniyor,
/// böylece global bir <c>ForwardedHeaders</c> ara katmanının tüm boru hattına etkisi olmuyor.
/// </summary>
public static class PublicOrigin
{
    public static string SchemeOf(HttpRequest request)
    {
        if (request.Headers.TryGetValue("X-Forwarded-Proto", out var proto))
        {
            var first = proto.ToString().Split(',')[0].Trim().ToLowerInvariant();
            if (first == "https" || first == "http") return first;
        }

        return request.Scheme;
    }

    /// <summary>"https://host[:port]" — sondaki eğik çizgi olmadan.</summary>
    public static string Of(HttpRequest request) => $"{SchemeOf(request)}://{request.Host.Value}";
}
