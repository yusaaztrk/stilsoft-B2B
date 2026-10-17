using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Controllers;
using Microsoft.AspNetCore.Mvc.Filters;
using ServiceOps.Api.Services;

namespace ServiceOps.Api.Filters;

/// <summary>
/// Bu action'ın yazma kapısından muaf olduğunu bildirir.
///
/// Muafiyet GEREKÇESİ zorunlu: "neden açık" sorusunun cevabı kodda dursun, bir sonraki okuyan
/// unutulmuş bir açıkla mı yoksa bilinçli bir kararla mı karşılaştığını bilsin.
/// </summary>
[AttributeUsage(AttributeTargets.Method | AttributeTargets.Class)]
public sealed class AllowWriteWithoutPageScopeAttribute : Attribute
{
    public string Reason { get; }
    public AllowWriteWithoutPageScopeAttribute(string reason) => Reason = reason;
}

/// <summary>
/// Bir action'ın hangi sayfa yetkisine bağlı olduğunu bildirir; controller varsayılanını ezer.
/// </summary>
[AttributeUsage(AttributeTargets.Method | AttributeTargets.Class)]
public sealed class RequirePageScopeAttribute : Attribute
{
    public string[] PageKeys { get; }
    public RequirePageScopeAttribute(params string[] pageKeys) => PageKeys = pageKeys;
}

/// <summary>
/// YAZMA İŞLEMLERİ İÇİN VARSAYILAN-REDDET KAPISI.
///
/// 2026-08-07 denetiminde 27 yazma ucunun gövdesinde hiçbir yetki kontrolü olmadığı görüldü:
/// stok güncelleme, cari oluşturma/silme, iş emri silme, montaj planlama, kargo durumu, bölge
/// ekleme... Hepsinde tek engel `[Authorize]` idi, yani oturum açmış HERKES — hiçbir sayfa
/// yetkisi olmayan bir kullanıcı dahi — bu işlemleri yapabiliyordu.
///
/// Uçları tek tek düzeltmek yerine kapı merkezî: eklenen her yeni yazma ucu otomatik olarak
/// kapsanır. Yeni bir uç yazan kişinin "yetki eklemeyi unutması" artık açık üretmiyor.
///
/// KURAL: yazma isteği, controller'ın bağlı olduğu sayfaya EN AZ ERİŞİM yetkisi ister.
/// Okuma tarafı zaten aynı yetkiyi arıyor; yani meşru kullanıcı için davranış değişmiyor,
/// yalnızca "hiç yetkisi olmayan" durum kapanıyor. Daha dar kurallar (kendi kaydı mı, tüm
/// kayıtlar mı) action'ların kendi içinde duruyor — bu kapı onların yerine geçmez, altına serilir.
/// </summary>
public sealed class ServiceOpsWriteAuthorizationFilter : IAsyncActionFilter
{
    private readonly IServiceOpsPermissionService _permissions;

    public ServiceOpsWriteAuthorizationFilter(IServiceOpsPermissionService permissions)
    {
        _permissions = permissions;
    }

    /// <summary>
    /// Controller → sayfa anahtarı. Bir controller birden çok sayfaya hizmet ediyorsa hepsi
    /// yazılır ve HERHANGİ BİRİ yeterlidir (OR).
    /// </summary>
    private static readonly Dictionary<string, string[]> ControllerPageKeys = new(StringComparer.OrdinalIgnoreCase)
    {
        ["Customers"] = new[] { "musterilerBayiler" },
        ["Inventory"] = new[] { "stok" },
        ["SpareParts"] = new[] { "stok" },
        ["SparePartOrderRequests"] = new[] { "stok" },
        ["ServiceProducts"] = new[] { "stok" },
        ["Stock"] = new[] { "stok" },
        ["Regions"] = new[] { "ayarlar", "teknisyenler" },
        ["Routes"] = new[] { "rota" },
        ["Montaj"] = new[] { "montajYonetimi", "montajKabul" },
        ["CargoTracking"] = new[] { "kargoTakibi", "kargoPlanlama" },
        ["Technicians"] = new[] { "teknisyenler" },
        ["WorkLogs"] = new[] { "buyukUrun", "atolyeAriza", "montajYonetimi" },
        ["WorkOrders"] = new[] { "buyukUrun", "atolyeAriza", "montajYonetimi" },
        ["Installations"] = new[] { "montajYonetimi", "buyukUrun" },
        ["ServiceRecords"] = new[] { "buyukUrun", "atolyeAriza", "montajYonetimi", "buyukEvAletleriKabul", "kucukUrunKabul" },
        ["Earnings"] = new[] { "hakedis" },
        ["Planning"] = new[] { "montajYonetimi", "buyukUrun", "atolyeAriza" },
        ["Erp"] = new[] { "buyukUrun", "atolyeAriza", "montajYonetimi", "stok", "aracDepolari", "musterilerBayiler" },
        ["Notifications"] = new[] { "bildirimler" },
        ["InvoiceTracking"] = new[] { "faturaTakip" },
    };

    private static readonly HashSet<string> WriteMethods =
        new(StringComparer.OrdinalIgnoreCase) { "POST", "PUT", "PATCH", "DELETE" };

    public async Task OnActionExecutionAsync(ActionExecutingContext context, ActionExecutionDelegate next)
    {
        if (!WriteMethods.Contains(context.HttpContext.Request.Method))
        {
            await next();
            return;
        }

        if (context.ActionDescriptor is not ControllerActionDescriptor descriptor)
        {
            await next();
            return;
        }

        var endpoint = context.HttpContext.GetEndpoint();

        // Anonim uçlar (giriş, token takası) bu kapının konusu değil.
        if (endpoint?.Metadata.GetMetadata<IAllowAnonymous>() is not null)
        {
            await next();
            return;
        }

        // Sunucu-sunucu çağrısı (B2B webhook'u, paylaşılan anahtarla doğrulanmış): arkasında
        // kullanıcı oturumu yok, dolayısıyla aranacak sayfa yetkisi de yok. Kapı bunu ararsa
        // B2B'den gelen montaj kayıtları 403 ile sessizce düşer — fatura kesilir, montaj hiç
        // oluşmazdı. Kimlik doğrulaması zaten [InternalApiKeyOrUser] içinde yapıldı.
        if (context.HttpContext.Items.TryGetValue(InternalApiKeyOrUserAttribute.InternalCallItemKey, out var internalCall)
            && internalCall is true)
        {
            await next();
            return;
        }

        var exempt = descriptor.MethodInfo.GetCustomAttributes(typeof(AllowWriteWithoutPageScopeAttribute), true).Length > 0
            || descriptor.ControllerTypeInfo.GetCustomAttributes(typeof(AllowWriteWithoutPageScopeAttribute), true).Length > 0;
        if (exempt)
        {
            await next();
            return;
        }

        var overrideAttr = descriptor.MethodInfo
            .GetCustomAttributes(typeof(RequirePageScopeAttribute), true)
            .Cast<RequirePageScopeAttribute>()
            .FirstOrDefault();

        var controllerName = descriptor.ControllerName;
        var pageKeys = overrideAttr?.PageKeys
            ?? (ControllerPageKeys.TryGetValue(controllerName, out var mapped) ? mapped : null);

        // Haritada olmayan controller KAPSANMAZ. Bilerek: burada varsayılan olarak reddetmek,
        // haritaya eklenmemiş bir controller'ı sessizce çalışmaz hale getirirdi. Kapsam dışı
        // controller'lar denetim listesinde görünür (aşağıdaki teste bakın).
        if (pageKeys is null || pageKeys.Length == 0)
        {
            await next();
            return;
        }

        // Kapı SAYFA YETKİSİNE bakar, kayıt kapsamına değil.
        //
        // Eskiden `GetScopeAsync(...).CanAccess` soruluyordu. O metot iki soruyu birleştiriyor:
        // "sayfa açık mı" ve "hangi kayıtlar görünür". Sayfası açık ama kayıt kapsamı boş olan
        // bir kullanıcıda (yönetici; "tümünü görme" verilmemiş, teknisyen de değil, tek bir
        // cariye de bağlı değil) CanAccess false dönüyor ve kapı YAZMAYI reddediyordu.
        //
        // Somut arıza: Müdür rolündeki kullanıcı yeni cari ekleyemiyordu — "Bu işlem için sayfa
        // yetkiniz yok". Oysa yeni cari eklemek için başkalarının işlerini görebiliyor olmak
        // gerekmez. (Doğrulandı 2026-08-10.)
        //
        // Kapının kendi belgesindeki kural da zaten buydu: "yazma isteği, controller'ın bağlı
        // olduğu sayfaya EN AZ ERİŞİM yetkisi ister." Kayıt bazlı daraltma action'ların kendi
        // içinde duruyor ve değişmedi.
        foreach (var key in pageKeys)
        {
            if (await _permissions.HasPageAsync(context.HttpContext.User, key, context.HttpContext.RequestAborted))
            {
                await next();
                return;
            }
        }

        context.Result = new ObjectResult(new
        {
            success = false,
            message = "Bu işlem için sayfa yetkiniz yok."
        })
        {
            StatusCode = StatusCodes.Status403Forbidden
        };
    }
}
