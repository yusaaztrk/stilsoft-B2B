using System.Security.Cryptography;
using System.Text;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;

namespace ServiceOps.Api.Filters;

/// <summary>
/// Sunucudan sunucuya (B2B → ServiceOps) çağrılan uçlar için kimlik doğrulaması.
///
/// Bu uçlar `[AllowAnonymous]` ile açılmıştı çünkü B2B webhook'ları kullanıcı token'ı taşımıyor.
/// Ama "token yok" ile "kimlik yok" aynı şey değil: sonuç olarak ağdan API'ye ulaşabilen herkes
/// montaj kaydı oluşturabiliyor, **fatura numarasına göre montaj kayıtlarını silebiliyor** ve
/// yedek parça siparişlerini okuyup tamamlayabiliyordu.
///
/// Artık paylaşılan bir anahtar isteniyor: `X-ServiceOps-Key`. Anahtar yapılandırmada
/// (`ServiceOps:InternalApiKey`) ve B2B tarafında aynı değerle durur.
///
/// KULLANICI OTURUMU DA KABUL EDİLİR: bu uçların bir kısmını (yedek parça isteği listesi/oluşturma)
/// servis ekranı da çağırıyor. Yani kural "geçerli anahtar VEYA giriş yapmış kullanıcı".
///
/// Karşılaştırma sabit zamanlı: uzunluk/erken çıkış farkı anahtarı karakter karakter tahmin
/// etmeye yarayan bir zamanlama kanalı açar.
///
/// <para>
/// <b><see cref="IAllowAnonymous"/> neden uygulanıyor:</b> bu öznitelik taşıyan uçların
/// controller'ında sınıf düzeyinde <c>[Authorize]</c> var. Çerçevenin yetkilendirme ara katmanı
/// MVC filtrelerinden ÖNCE çalışır; token taşımayan webhook o yüzden buradaki anahtar kontrolüne
/// hiç ulaşamadan boş gövdeli 401 yiyordu. <c>IAllowAnonymous</c> yalnızca çerçevenin varsayılan
/// kontrolünü atlatır — kimlik doğrulama yine çalışır (yani "geçerli kullanıcı" dalı bozulmaz) ve
/// asıl kararı aşağıdaki <see cref="OnAuthorizationAsync"/> verir. Uç yine de açık değildir.
/// </para>
/// <para>
/// Bunu her kullanım yerine <c>[AllowAnonymous]</c> eklemek yerine özniteliğin kendisine
/// koymak bilinçli: aksi halde yeni bir webhook ucu eklerken ikizini yazmayı unutmak
/// ucu sessizce 401'e düşürür.
/// </para>
/// </summary>
[AttributeUsage(AttributeTargets.Method | AttributeTargets.Class)]
public sealed class InternalApiKeyOrUserAttribute : Attribute, IAsyncAuthorizationFilter, IAllowAnonymous
{
    public const string HeaderName = "X-ServiceOps-Key";

    /// <summary>
    /// Bu istek sunucu-sunucu anahtarıyla geçtiyse işaretlenir. Yazma kapısı
    /// (<see cref="ServiceOpsWriteAuthorizationFilter"/>) bunu görünce sayfa yetkisi aramaz:
    /// webhook'un arkasında bir kullanıcı oturumu yok, aranacak sayfa yetkisi de yok.
    /// </summary>
    public const string InternalCallItemKey = "ServiceOps.InternalApiCall";

    public async Task OnAuthorizationAsync(AuthorizationFilterContext context)
    {
        await Task.CompletedTask;

        // 1) Giriş yapmış kullanıcı: normal yetki hattı devam etsin.
        if (context.HttpContext.User?.Identity?.IsAuthenticated == true)
        {
            return;
        }

        // 2) Sunucu-sunucu anahtarı.
        var configured = context.HttpContext.RequestServices
            .GetService<IConfiguration>()?["ServiceOps:InternalApiKey"];

        if (string.IsNullOrWhiteSpace(configured))
        {
            // Anahtar tanımlı değilse KAPALI başarısız olunur. Aksi halde yapılandırmayı
            // unutmak, ucu eskisi gibi herkese açık bırakırdı.
            context.Result = new ObjectResult(new
            {
                success = false,
                message = "Sunucu içi çağrı anahtarı yapılandırılmamış."
            })
            { StatusCode = StatusCodes.Status503ServiceUnavailable };
            return;
        }

        var provided = context.HttpContext.Request.Headers[HeaderName].FirstOrDefault();
        if (string.IsNullOrEmpty(provided) || !FixedTimeEquals(provided, configured))
        {
            context.Result = new UnauthorizedObjectResult(new
            {
                success = false,
                message = "Bu uç yalnızca kimlik doğrulanmış çağrılara açıktır."
            });
            return;
        }

        context.HttpContext.Items[InternalCallItemKey] = true;
    }

    private static bool FixedTimeEquals(string a, string b)
    {
        var ba = Encoding.UTF8.GetBytes(a);
        var bb = Encoding.UTF8.GetBytes(b);
        return ba.Length == bb.Length && CryptographicOperations.FixedTimeEquals(ba, bb);
    }
}
