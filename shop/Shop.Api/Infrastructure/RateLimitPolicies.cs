using System.Threading.RateLimiting;
using Microsoft.AspNetCore.RateLimiting;

namespace Shop.Api.Infrastructure;

/// <summary>
/// Hız sınırı.
///
/// NEDEN GENEL (global) SINIR YOK: katalog sayfaları vitrin sunucusundan okunuyor ve o sunucu
/// tek bir istemci gibi görünüyor. Her şeyi kapsayan bir sınır, siteye giren müşteri sayısı
/// arttıkça vitrinin kendi okumalarını boğardı. Bu yüzden sınır YALNIZCA kötüye kullanımın
/// gerçekten karşılığı olan uçlara konuyor: giriş, kayıt, ödeme ve sepet/sipariş yazmaları.
/// Katalog okuması zaten önbellekli ve yazma yapmıyor.
///
/// Kovalar <see cref="ClientAddress.ResolveKey"/> ile ayrılıyor (oturum anahtarı, yoksa
/// vitrinin ilettiği gerçek istemci adresi) — sebebi orada yazıyor.
///
/// Pencere KAYAN (sliding): sabit pencerede saldırgan pencerenin sonunda ve başında art arda
/// iki tam kota harcayıp sınırın iki katını geçebiliyor.
/// </summary>
public static class RateLimitPolicies
{
    /// <summary>Giriş ve kayıt. Şifre denemesi burada yavaşlıyor.</summary>
    public const string Auth = "auth";

    /// <summary>Ödeme başlatma. Kart denemesi (BIN taraması, çalıntı kart doğrulama) burada yavaşlıyor.</summary>
    public const string Payment = "payment";

    /// <summary>Sepet ve sipariş yazmaları. İnsan hızının çok üstünde ama sonsuz değil.</summary>
    public const string Write = "write";

    /// <summary>
    /// İletişim formu mesajları.
    ///
    /// <para><b>Neden `Auth` yetmedi (2026-09-09 kullanıcı isteği: "mesaj göndermelere rate
    /// limit koy"):</b> form `Auth` politikasını kullanıyordu — 5 dakikada 10 istek. O sınır
    /// şifre denemesini yavaşlatmak için ayarlanmış; mesaj formu için fazlasıyla gevşek.
    /// Formu doldurmak bir kullanıcı için dakikalar sürer, oysa bir betik aynı sürede
    /// 10 e-posta ürettirebilirdi ve bunların hepsi destek kutusuna düşerdi.</para>
    ///
    /// <para>Ayrı bir kova olması da önemli: aynı kovayı paylaşsalardı, form spam'i giriş
    /// kotasını tüketip gerçek kullanıcının siteye girmesini engellerdi.</para>
    /// </summary>
    public const string Contact = "contact";

    public static void Configure(RateLimiterOptions options)
    {
        options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;

        options.OnRejected = async (context, ct) =>
        {
            if (context.Lease.TryGetMetadata(MetadataName.RetryAfter, out var retryAfter))
            {
                context.HttpContext.Response.Headers.RetryAfter = ((int)retryAfter.TotalSeconds).ToString();
            }

            context.HttpContext.Response.ContentType = "application/json";
            await context.HttpContext.Response.WriteAsync(
                "{\"message\":\"Çok fazla deneme yaptınız. Lütfen biraz bekleyip tekrar deneyin.\"}", ct);
        };

        AddSliding(options, Auth, permit: 10, window: TimeSpan.FromMinutes(5));
        AddSliding(options, Payment, permit: 8, window: TimeSpan.FromMinutes(10));
        AddSliding(options, Write, permit: 120, window: TimeSpan.FromMinutes(1));

        // 10 dakikada 3 mesaj: gerçek bir ziyaretçi için fazlasıyla yeterli (yazım hatası
        // düzeltip yeniden göndermeye bile yeter), toplu gönderim için işe yaramaz.
        AddSliding(options, Contact, permit: 3, window: TimeSpan.FromMinutes(10));
    }

    private static void AddSliding(RateLimiterOptions options, string policy, int permit, TimeSpan window)
    {
        options.AddPolicy(policy, context =>
        {
            var resolver = context.RequestServices.GetRequiredService<ClientAddress>();

            return RateLimitPartition.GetSlidingWindowLimiter(
                partitionKey: policy + "|" + resolver.ResolveKey(context),
                factory: _ => new SlidingWindowRateLimiterOptions
                {
                    PermitLimit = permit,
                    Window = window,
                    SegmentsPerWindow = 5,

                    // Kuyruk YOK: sınıra takılan istek beklemek yerine hemen 429 almalı.
                    // Kuyruk, saldırganın sunucuda iş parçacığı tutmasına yarardı.
                    QueueLimit = 0,
                    QueueProcessingOrder = QueueProcessingOrder.OldestFirst
                });
        });
    }
}
