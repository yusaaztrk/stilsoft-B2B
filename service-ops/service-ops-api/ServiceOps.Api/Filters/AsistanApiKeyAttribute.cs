using System.Security.Cryptography;
using System.Text;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;

namespace ServiceOps.Api.Filters;

/// <summary>
/// WhatsApp asistanının (asistan.example.com) sunucudan sunucuya OKUMA çağrıları için anahtar:
/// <c>X-Asistan-Key</c> = <c>Asistan:InternalApiKey</c>.
///
/// Neden <see cref="InternalApiKeyOrUserAttribute"/> değil: o anahtar (B2B ile paylaşılan
/// <c>ServiceOps:InternalApiKey</c>) montaj kaydı açan/silen webhook'ları da açıyor. Asistan
/// yalnız okur; ona yazma uçlarını açan anahtarı vermemek için ayrı anahtar. Kullanıcı oturumu da
/// kabul EDİLMEZ — bu uçlar ekran için değil.
///
/// Anahtar tanımlı değilse KAPALI başarısız (503). <see cref="IAllowAnonymous"/>: sınıf düzeyindeki
/// çerçeve yetkilendirmesi token'sız isteği filtreye varmadan 401'e düşürmesin (bkz. InternalApiKeyOrUser).
/// </summary>
[AttributeUsage(AttributeTargets.Method | AttributeTargets.Class)]
public sealed class AsistanApiKeyAttribute : Attribute, IAsyncAuthorizationFilter, IAllowAnonymous
{
    public const string HeaderName = "X-Asistan-Key";

    public Task OnAuthorizationAsync(AuthorizationFilterContext context)
    {
        var configured = context.HttpContext.RequestServices.GetService<IConfiguration>()?["Asistan:InternalApiKey"];
        if (string.IsNullOrWhiteSpace(configured))
        {
            context.Result = new ObjectResult(new { success = false, message = "Asistan anahtarı yapılandırılmamış." })
            {
                StatusCode = StatusCodes.Status503ServiceUnavailable
            };
            return Task.CompletedTask;
        }

        var provided = context.HttpContext.Request.Headers[HeaderName].FirstOrDefault();
        if (string.IsNullOrEmpty(provided) || !FixedTimeEquals(provided, configured))
        {
            context.Result = new UnauthorizedObjectResult(new { success = false, message = "Geçersiz asistan anahtarı." });
        }
        return Task.CompletedTask;
    }

    private static bool FixedTimeEquals(string a, string b)
    {
        var ba = Encoding.UTF8.GetBytes(a);
        var bb = Encoding.UTF8.GetBytes(b);
        return ba.Length == bb.Length && CryptographicOperations.FixedTimeEquals(ba, bb);
    }
}
