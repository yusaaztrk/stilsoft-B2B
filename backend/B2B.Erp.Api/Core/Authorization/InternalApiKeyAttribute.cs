using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;

namespace B2B.Erp.Api.Core.Authorization;

/// <summary>
/// Sunucu-sunucu çağrıları için paylaşılan anahtar.
///
/// Mağaza (e-ticaret) ERP'ye bir KULLANICI olarak değil, bir SERVİS olarak bağlanır: arkasında
/// oturum açmış bir insan yok, dolayısıyla aranacak sayfa yetkisi de yok. Alternatif, mağazaya
/// kullanıcı adı/şifreli bir hesap açmaktı — o hesabın parolası yapılandırma dosyalarında
/// dolaşır, rol yetkileri zamanla genişler ve kimin yaptığı belirsizleşirdi.
///
/// Aynı desen ServiceOps tarafında da kullanılıyor (X-ServiceOps-Key).
///
/// Anahtar tanımlı değilse KAPALI başarısız olur: yapılandırmayı unutmak, ucu herkese açık
/// bırakmaktan iyidir.
/// </summary>
[AttributeUsage(AttributeTargets.Method | AttributeTargets.Class)]
public sealed class InternalApiKeyAttribute : Attribute, IAsyncAuthorizationFilter, IAllowAnonymous
{
    public const string HeaderName = "X-Internal-Key";

    /// <summary>Yapılandırmadaki anahtarın yolu; farklı servisler farklı anahtar kullanabilsin diye.</summary>
    public string ConfigurationKey { get; }

    public InternalApiKeyAttribute(string configurationKey = "Ecommerce:InternalApiKey")
    {
        ConfigurationKey = configurationKey;
    }

    public Task OnAuthorizationAsync(AuthorizationFilterContext context)
    {
        var configured = context.HttpContext.RequestServices
            .GetService<IConfiguration>()?[ConfigurationKey];

        if (string.IsNullOrWhiteSpace(configured))
        {
            context.Result = new ObjectResult(new
            {
                success = false,
                message = "Servis anahtarı yapılandırılmamış."
            })
            {
                StatusCode = StatusCodes.Status503ServiceUnavailable
            };
            return Task.CompletedTask;
        }

        var provided = context.HttpContext.Request.Headers[HeaderName].ToString();

        // Sabit zamanlı karşılaştırma: doğru anahtarın kaç karakterinin tuttuğu yanıt
        // süresinden anlaşılmasın.
        if (string.IsNullOrEmpty(provided) || !FixedTimeEquals(provided, configured))
        {
            context.Result = new UnauthorizedResult();
        }

        return Task.CompletedTask;
    }

    private static bool FixedTimeEquals(string a, string b)
    {
        var bytesA = System.Text.Encoding.UTF8.GetBytes(a);
        var bytesB = System.Text.Encoding.UTF8.GetBytes(b);
        return System.Security.Cryptography.CryptographicOperations.FixedTimeEquals(bytesA, bytesB);
    }
}
