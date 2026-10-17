using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Controllers;
using Microsoft.AspNetCore.Mvc.Filters;
using ServiceOps.Api.Services;

namespace ServiceOps.Api.Filters;

/// <summary>
/// Bu action'ın okuma kapısından muaf olduğunu bildirir. Muafiyet GEREKÇESİ zorunlu.
/// </summary>
[AttributeUsage(AttributeTargets.Method | AttributeTargets.Class)]
public sealed class AllowReadWithoutPageScopeAttribute : Attribute
{
    public string Reason { get; }
    public AllowReadWithoutPageScopeAttribute(string reason) => Reason = reason;
}

/// <summary>
/// OKUMA İŞLEMLERİ İÇİN SAYFA KAPISI.
///
/// Yazma tarafı <see cref="ServiceOpsWriteAuthorizationFilter"/> ile 2026-08-07'de kapatılmıştı;
/// OKUMA tarafı açıkta kalmıştı. 2026-08-11 denetiminde 11 controller'da toplam 51 ucun gövdesinde
/// hiçbir sayfa yetkisi kontrolü olmadığı görüldü — yazma uçları merkezî filtreyle korunuyordu ama
/// GET'ler yalnızca `[Authorize]` ile duruyordu. Yani oturum açmış herkes (kendisine hiç iş
/// atanmamış bir saha teknisyeni, yalnızca kabul ekranı verilmiş bir bayi kullanıcısı) müşteri
/// listesini ve iletişim bilgilerini, stok ve maliyet verisini, iş kayıtlarını okuyabiliyordu.
///
/// HARİTA YAZMA HARİTASINDAN DAHA GENİŞ, ve bu bilinçli. Bazı okumalar REFERANS VERİSİDİR: bir
/// ekranın kendi sayfasına ait olmasalar da formların doldurulması için gerekirler. Örneğin yedek
/// parça listesi "Stok" sayfasına aittir ama Saha/Atölye onarım formu onu okumak zorundadır. Dar
/// bir harita burada "teknisyen listesi boş" tipi regresyonlar üretirdi (bkz. MONTAJ-DEVIR: aynı
/// hata bir kez yapıldı ve montaj planlamasını çalışmaz hâle getirmişti).
///
/// KURAL: listedeki anahtarlardan HERHANGİ BİRİ yeterlidir (OR). Haritada olmayan controller
/// kapsanmaz — burada varsayılan olarak reddetmek, haritaya eklenmemiş bir controller'ı sessizce
/// çalışmaz hâle getirirdi.
/// </summary>
public sealed class ServiceOpsReadAuthorizationFilter : IAsyncActionFilter
{
    private readonly IServiceOpsPermissionService _permissions;

    public ServiceOpsReadAuthorizationFilter(IServiceOpsPermissionService permissions)
    {
        _permissions = permissions;
    }

    /// <summary>Onarım/montaj ekranları: yedek parça ve stok bunların formlarında da okunuyor.</summary>
    private static readonly string[] RepairPages =
    {
        "buyukUrun", "buyukUrun.planlama", "buyukUrun.sahaPlanlama", "buyukUrun.atolye",
        "buyukUrun.hazirTeslimat", "buyukUrun.teslimattakiler", "buyukUrun.yedekParca",
        "atolyeAriza", "atolyeAriza.atolye", "atolyeAriza.hazirTeslimat",
        "atolyeAriza.teslimattakiler", "atolyeAriza.yedekParca",
        "montajYonetimi", "montajYonetimi.planlama", "montajYonetimi.teslimat",
        "montajKabul", "buyukEvAletleriKabul", "kucukUrunKabul"
    };

    private static readonly Dictionary<string, string[]> ControllerPageKeys = new(StringComparer.OrdinalIgnoreCase)
    {
        // Müşteri PII'si: yalnızca Müşteriler/Bayiler ekranı ve kabul ekranları (cari seçimi orada).
        ["Customers"] = new[] { "musterilerBayiler", "montajKabul", "buyukEvAletleriKabul", "kucukUrunKabul" },

        // Stok ailesi: kendi sayfası + onarım/montaj formları.
        ["Stock"] = RepairPages.Concat(new[] { "stok", "aracDepolari" }).ToArray(),
        ["Inventory"] = RepairPages.Concat(new[] { "stok", "aracDepolari" }).ToArray(),
        ["SpareParts"] = RepairPages.Concat(new[] { "stok", "aracDepolari" }).ToArray(),
        ["SparePartOrderRequests"] = RepairPages.Concat(new[] { "stok", "aracDepolari" }).ToArray(),
        ["ServiceProducts"] = RepairPages.Concat(new[] { "stok", "ayarlar" }).ToArray(),

        ["WorkLogs"] = RepairPages,
        ["Analytics"] = new[] { "analiz", "raporlar" },
    };

    /*
     * BİLEREK KAPSAM DIŞI (silmeyin, sebebi burada dursun):
     *
     * - Regions      : referans veri. Bölge açılır listesi her kabul/planlama formunda var;
     *                  gate edilirse yetkisi dar olan kullanıcı formu dolduramaz.
     * - Technicians   : kendi kapsam kontrolü uçların içinde zaten var ve bu liste montaj/saha
     *                  planlamasının tek kaynağı. Dar bir kapı buraya konduğunda daha önce
     *                  "hiç teknisyen görünmüyor" regresyonu yaşandı (MONTAJ-DEVIR §"teknisyen
     *                  listesi boş").
     * - Notifications : kullanıcının KENDİ bildirimleri; sayfa yetkisiyle ilgisi yok.
     * - Erp           : cari/ürün arama; kabul, planlama, stok ve depo ekranlarının hepsi kullanıyor.
     *                  Uçların içinde firma (tenant) kapsamı zaten uygulanıyor.
     * - Reports       : kendi içinde sayfa anahtarı + kapsam kontrolü yapıyor (ReportsController).
     * - ServiceRecords / Installations / Montaj / CargoTracking / Routes / Planning / Earnings /
     *   Technicians   : bunlar kayıt kapsamını (kendi işi / cari / hepsi) uçların içinde
     *                  uyguluyor; buradaki kaba kapı onların yerine geçmez, altına serilirdi ve
     *                  bazı meşru akışları (teknisyenin kendi işini okuması) kırardı.
     */

    public async Task OnActionExecutionAsync(ActionExecutingContext context, ActionExecutionDelegate next)
    {
        if (!HttpMethods.IsGet(context.HttpContext.Request.Method))
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
        if (endpoint?.Metadata.GetMetadata<IAllowAnonymous>() is not null)
        {
            await next();
            return;
        }

        // Sunucu-sunucu çağrısı: arkasında kullanıcı oturumu yok, aranacak sayfa yetkisi de yok.
        if (context.HttpContext.Items.TryGetValue(InternalApiKeyOrUserAttribute.InternalCallItemKey, out var internalCall)
            && internalCall is true)
        {
            await next();
            return;
        }

        var exempt = descriptor.MethodInfo.GetCustomAttributes(typeof(AllowReadWithoutPageScopeAttribute), true).Length > 0
            || descriptor.ControllerTypeInfo.GetCustomAttributes(typeof(AllowReadWithoutPageScopeAttribute), true).Length > 0;
        if (exempt)
        {
            await next();
            return;
        }

        var overrideAttr = descriptor.MethodInfo
            .GetCustomAttributes(typeof(RequirePageScopeAttribute), true)
            .Cast<RequirePageScopeAttribute>()
            .FirstOrDefault();

        var pageKeys = overrideAttr?.PageKeys
            ?? (ControllerPageKeys.TryGetValue(descriptor.ControllerName, out var mapped) ? mapped : null);

        if (pageKeys is null || pageKeys.Length == 0)
        {
            await next();
            return;
        }

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
            message = "Bu veriyi görüntüleme yetkiniz yok."
        })
        {
            StatusCode = StatusCodes.Status403Forbidden
        };
    }
}
