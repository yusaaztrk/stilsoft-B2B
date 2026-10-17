using B2B.Erp.Api.Data;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.AspNetCore.Mvc.Infrastructure;
using Microsoft.EntityFrameworkCore;

namespace B2B.Erp.Api.Core.Http;

/// <summary>
/// UÇ BOYUNCA TEK VERİTABANI İŞLEMİ — YARIM KALAN İŞ OLMAZ (2026-08-20).
///
/// <para>
/// <b>Sorun.</b> PostgreSQL ACID'dir: tek bir <c>SaveChanges</c> elektrik kesilse bile ya
/// tümüyle yazılır ya hiç yazılmaz. Yarım kalma YALNIZCA aynı uçta arka arkaya birden çok
/// <c>SaveChanges</c> varken mümkün — ilki işlenir, kesinti olur, ikincisi hiç çalışmaz.
/// Örneği kodda vardı: depo transferi önce BELGEYİ, sonra iki stok hareketini ayrı ayrı
/// kaydediyordu. Arada kesinti olunca belge "mal taşındı" diyor, iki depo da hiçbir şey
/// görmüyordu. Kıbrıs'ta elektrik ve internet kesintileri olağan olduğu için bu, teorik
/// değil günlük bir risk.
/// </para>
///
/// <para>
/// <b>Çözüm.</b> Uç bir işlemle sarılır: içindeki bütün kayıtlar ya birlikte kalıcı olur ya
/// hiçbiri olmaz. Yarım bir belgeden, hiç olmamış bir belge iyidir — kullanıcı ikincisini
/// görür ve tekrar dener; birincisi sessizce yanlış veri bırakır.
/// </para>
///
/// <para>
/// <b>Neden gövdeyi elle sarmak yerine öznitelik?</b> Bu uçlar erken <c>return BadRequest</c>
/// yollarıyla dolu; her birine elle <c>Commit</c>/<c>Rollback</c> eklemek, bir dalı atlayıp
/// sessizce açık işlem bırakmaya davetiye. Öznitelik bütün çıkış yollarını — istisna, hata
/// durumu, erken dönüş — aynı kuralla kapatır.
/// </para>
///
/// <para>
/// <b>Kendi işlemini açan uçlara KONULMAZ.</b> EF'de zaten işlem varken yenisini açmak
/// istisna atar. Bu yüzden filtre önce ortamda işlem var mı diye bakar ve varsa hiç
/// karışmaz — yanlışlıkla iki yere birden konsa bile uygulama çökmez.
/// </para>
///
/// <para>
/// <b>Dış sistem çağrısı olan uçlarda dikkat.</b> ServiceOps'a HTTP giden uçlarda işlem o
/// çağrı boyunca açık kalır. Kısa zaman aşımlarıyla bu kabul edilebilir; ama dış çağrı
/// yapılıp sonra işlem geri alınırsa karşı taraf olmamış bir şeyi duymuş olur. Böyle uçlarda
/// doğru sıra "önce işle, sonra haber ver"dir ve bu öznitelik onu ZORLAMAZ.
/// </para>
/// </summary>
[AttributeUsage(AttributeTargets.Method | AttributeTargets.Class)]
public sealed class AtomicRequestAttribute : Attribute, IFilterFactory
{
    public bool IsReusable => false;

    public IFilterMetadata CreateInstance(IServiceProvider serviceProvider)
        => new AtomicRequestFilter();
}

internal sealed class AtomicRequestFilter : IAsyncActionFilter
{
    public async Task OnActionExecutionAsync(ActionExecutingContext context, ActionExecutionDelegate next)
    {
        var dbContext = context.HttpContext.RequestServices.GetService<AppDbContext>();

        // Veritabanı yoksa ya da uç kendi işlemini açtıysa hiç karışma.
        if (dbContext is null || dbContext.Database.CurrentTransaction is not null)
        {
            await next();
            return;
        }

        var cancellationToken = context.HttpContext.RequestAborted;

        await using var transaction = await dbContext.Database.BeginTransactionAsync(cancellationToken);

        var executed = await next();

        // İstisna: `await using` geri alır. Burada commit ETMEMEK yeterli.
        if (executed.Exception is not null && !executed.ExceptionHandled)
        {
            return;
        }

        // HATA DURUM KODU DA GERİ ALIR. Doğrulama `BadRequest` ile dönen bir uç, o noktaya
        // kadar yazdıklarını bırakmamalı: kullanıcı "işlem yapılamadı" mesajı görüp yarısı
        // yazılmış bir belgeyle kalmasın.
        if (IsFailure(executed.Result))
        {
            return;
        }

        await transaction.CommitAsync(cancellationToken);
    }

    private static bool IsFailure(IActionResult? result) => result switch
    {
        null => false,
        IStatusCodeActionResult status => status.StatusCode is >= 400,
        _ => false
    };
}
