using System.Net;

namespace Shop.Api.Infrastructure;

/// <summary>
/// Hız sınırının "kim" sorusunu cevaplayan yer.
///
/// BURADAKİ ASIL SORUN: vitrin sunucu tarafında render ediliyor ve tarayıcıdan gelen istekler
/// Next.js'in rota köprülerinden geçiyor. Yani mağaza API'sinin gördüğü uzak adres HER ZAMAN
/// vitrin sunucusunun adresi. Doğrudan <c>RemoteIpAddress</c> üzerinden sınır koymak bütün
/// müşterileri tek bir kovaya doldurup birbirinin hakkını yemesine yol açardı — kötü niyetli
/// tek kullanıcı siteyi herkese kapatabilirdi.
///
/// Çözüm iki katmanlı:
///  1. Oturum anahtarı varsa kova ONA göre ayrılır. Giriş yapmış müşteri zaten tekildir ve
///     anahtar tahmin edilemez.
///  2. Oturum yoksa (giriş/kayıt) vitrinin ilettiği gerçek istemci adresi kullanılır.
///
/// İLETİLEN ADRESE HER ZAMAN GÜVENİLMEZ: başlık istemci tarafından uydurulabilir, o zaman da
/// sınır her istekte farklı bir kovaya düşer ve hiç işlemez. Bu yüzden başlık yalnızca
/// <c>Security:TrustedProxies</c> listesindeki adreslerden gelirse dikkate alınıyor;
/// varsayılan olarak sadece yerel adresler (vitrin ile API aynı makinede duruyor).
/// </summary>
public sealed class ClientAddress
{
    public const string ForwardedHeader = "X-Client-Ip";
    public const string SessionHeader = "X-Shop-Session";

    private readonly IReadOnlyList<IPAddress> _trusted;

    public ClientAddress(IConfiguration configuration)
    {
        _trusted = (configuration.GetSection("Security:TrustedProxies").Get<string[]>() ?? Array.Empty<string>())
            .Select(x => IPAddress.TryParse(x.Trim(), out var ip) ? ip : null)
            .Where(x => x is not null)
            .Select(x => x!)
            .ToList();
    }

    /// <summary>Hız sınırının kovasını belirleyen anahtar.</summary>
    public string ResolveKey(HttpContext context)
    {
        var session = context.Request.Headers[SessionHeader].ToString();
        if (!string.IsNullOrWhiteSpace(session))
        {
            // Anahtarın kendisi kovaya yazılmıyor: hız sınırı istatistikleri ve hata mesajları
            // oturum anahtarını taşımamalı. Kısaltılmış özet ayırt etmeye yeter.
            return "s:" + Convert.ToHexString(
                System.Security.Cryptography.SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(session)))[..16];
        }

        return "ip:" + ResolveIp(context);
    }

    /// <summary>Günlüğe yazılabilir istemci adresi. Çözülemezse boş döner.</summary>
    public string ResolveIp(HttpContext context)
    {
        var remote = context.Connection.RemoteIpAddress;

        if (remote is not null && IsTrusted(remote))
        {
            var forwarded = context.Request.Headers[ForwardedHeader].ToString();
            if (!string.IsNullOrWhiteSpace(forwarded))
            {
                // Zincirdeki ilk adres istemcinin kendisidir; gerisi ara sunucular.
                var first = forwarded.Split(',')[0].Trim();
                if (IPAddress.TryParse(first, out var parsed)) return parsed.ToString();
            }
        }

        return remote?.ToString() ?? string.Empty;
    }

    private bool IsTrusted(IPAddress address)
    {
        if (IPAddress.IsLoopback(address)) return true;
        return _trusted.Any(x => x.Equals(address));
    }
}
