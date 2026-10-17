using System.Text;
using System.Text.Json;
using B2B.Erp.Api.Core.Activity;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.AspNetCore.Mvc.Infrastructure;

namespace B2B.Erp.Api.Core.Http;

/// <summary>
/// İşlemin SONUÇLARINI yanıt başlığına koyar, ekran onları kullanıcıya gösterir.
///
/// <para>
/// <b>Neden gövdeye değil başlığa?</b> Uçların yanıt gövdeleri birbirinden bağımsız isimsiz
/// nesneler; her birine alan eklemek yüzlerce uca dokunmak ve mevcut istemci kodunu kırma
/// riski demekti. Başlık her yanıtta aynı yerde durur, hiçbir gövde şeması değişmez ve
/// başlığı okumayan eski istemciler aynen çalışmaya devam eder.
/// </para>
///
/// <para>
/// <b>Neden Base64?</b> HTTP başlıkları ASCII taşır; "Stok: ABC +1 adet (arttı)" gibi Türkçe
/// bir metin doğrudan konsaydı vekil sunucularda bozulur ya da isteği düşürürdü.
/// </para>
///
/// <para>
/// <b>Yalnız başarılı yazma isteklerinde.</b> GET'te değişen bir şey yoktur; hata dönen
/// istekte ise <see cref="AtomicRequestAttribute"/> zaten geri almıştır — sonuç göstermek
/// olmamış bir işi olmuş gibi anlatmak olurdu.
/// </para>
/// </summary>
public sealed class OperationEffectsFilter : IAsyncResultFilter
{
    /// <summary>Yanıt başlığının adı. Tarayıcının okuyabilmesi için CORS'ta açığa çıkarılır.</summary>
    public const string HeaderName = "X-Operation-Effects";

    public async Task OnResultExecutionAsync(ResultExecutingContext context, ResultExecutionDelegate next)
    {
        TryWriteHeader(context);
        await next();
    }

    private static void TryWriteHeader(ResultExecutingContext context)
    {
        try
        {
            var request = context.HttpContext.Request;
            if (HttpMethods.IsGet(request.Method) || HttpMethods.IsHead(request.Method) || HttpMethods.IsOptions(request.Method))
            {
                return;
            }

            if (context.Result is IStatusCodeActionResult status && status.StatusCode is >= 400)
            {
                return;
            }

            var collector = context.HttpContext.RequestServices.GetService<RequestEffectCollector>();
            if (collector is null || !collector.HasAnything) return;

            var payload = JsonSerializer.Serialize(new
            {
                actions = collector.Actions,
                effects = collector.Effects,
                overflow = collector.OverflowCount
            });

            context.HttpContext.Response.Headers[HeaderName] =
                Convert.ToBase64String(Encoding.UTF8.GetBytes(payload));
        }
        catch
        {
            // GERİ BİLDİRİM İŞİ, İŞİN KENDİSİNİ DÜŞÜREMEZ. Başlık yazılamazsa kullanıcı
            // sonuçları göremez — kabul edilebilir; ama kaydedilmiş bir faturayı hata
            // ekranına çevirmek kabul edilemez.
        }
    }
}
