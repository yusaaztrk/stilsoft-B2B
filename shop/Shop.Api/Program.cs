using System.Text.Json;
using System.Text.Json.Serialization;
using Shop.Api.Cart;
using Shop.Api.Catalog;
using Shop.Api.Erp;
using Shop.Api.Infrastructure;
using Shop.Api.Members;
using Shop.Api.Orders;
using Shop.Api.Payments;
using Shop.Api.Storefront;

var builder = WebApplication.CreateBuilder(args);

// Bkz. B2B tarafı: servis anahtarı git'e alınmayan yerel dosyadan gelir.
builder.Configuration.AddJsonFile("appsettings.Local.json", optional: true, reloadOnChange: true);

/*
 * LOKAL TEST KAPISI — GELİŞTİRMEDE DIŞ POSTA SUNUCUSU KULLANILAMAZ.
 *
 * Neden kod içinde, ayar dosyasında değil: `appsettings.Local.json` yapılandırmaya EN SON
 * ekleniyor (yukarıdaki satır), yani `appsettings.Development.json`'daki güvenli değeri
 * eziyor. Bu makinedeki Local dosyası gerçek `mail.example.com` kullanıcı adı ve
 * şifresini taşıyor; lokalde "şifremi unuttum" ya da sipariş bildirimi denemek CANLI posta
 * sunucusundan gerçek bir e-posta gönderirdi.
 *
 * Bu blok, Development ortamında posta sunucusu yerel değilse onu localhost:1025'e
 * (Mailpit/MailHog varsayılanı) çeviriyor ve kimlik bilgilerini siliyor. Kapı KAPALI
 * BAŞARISIZ: Mailpit ayakta değilse bağlantı reddedilir ve posta hiç gitmez — sessizce
 * canlıya gitmesindense lokalde patlaması doğru.
 *
 * Üretimde ASPNETCORE_ENVIRONMENT=Production olduğu için bu blok hiç çalışmaz.
 */
if (builder.Environment.IsDevelopment())
{
    var smtpHost = (builder.Configuration["SmtpSettings:Host"] ?? string.Empty).Trim();
    var isLocalSmtp = smtpHost.Length == 0
        || smtpHost.Equals("localhost", StringComparison.OrdinalIgnoreCase)
        || smtpHost.StartsWith("127.", StringComparison.Ordinal)
        || smtpHost.Equals("::1", StringComparison.Ordinal)
        || smtpHost.Equals("mailpit", StringComparison.OrdinalIgnoreCase)
        || smtpHost.Equals("mailhog", StringComparison.OrdinalIgnoreCase);

    if (!isLocalSmtp)
    {
        Console.WriteLine(
            $"[LOKAL KAPI] SMTP sunucusu '{smtpHost}' yerel değil. Geliştirmede dış posta " +
            "sunucusuna bağlanılmaz; localhost:1025 (Mailpit) kullanılacak.");

        builder.Configuration.AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["SmtpSettings:Host"] = "localhost",
            ["SmtpSettings:Port"] = "1025",
            ["SmtpSettings:EnableSsl"] = "false",
            ["SmtpSettings:Username"] = string.Empty,
            ["SmtpSettings:Password"] = string.Empty,
        });
    }
}

builder.Services.AddControllers().AddJsonOptions(options =>
{
    options.JsonSerializerOptions.PropertyNamingPolicy = JsonNamingPolicy.CamelCase;
    options.JsonSerializerOptions.Converters.Add(new JsonStringEnumConverter());
});

builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();
builder.Services.AddHttpContextAccessor();
builder.Services.AddHttpClient();

builder.Services.AddScoped<TenantResolver>();
builder.Services.AddSingleton<Shop.Api.Catalog.CampaignPricing>();
builder.Services.AddScoped<CatalogQueries>();
builder.Services.AddScoped<Shop.Api.Catalog.SearchLogService>();
builder.Services.AddScoped<Shop.Api.Catalog.StockAlertService>();
// "Sizi arayalım" talepleri (2026-09-21) — SMS'e bağlı olmayan tek lead kanalı.
builder.Services.AddScoped<Shop.Api.Catalog.CallbackService>();
// Ziyaret hunisi (2026-09-21) — "kaç kişi girdi, nerede takıldı".
builder.Services.AddScoped<Shop.Api.Catalog.VisitAnalyticsService>();
builder.Services.AddScoped<ShopSchema>();
builder.Services.AddScoped<MemberStore>();
builder.Services.AddScoped<ErpWriteClient>();
builder.Services.AddScoped<StorefrontStore>();
builder.Services.AddScoped<StorefrontMediaStore>();
builder.Services.AddScoped<EcommerceCatalogStore>();
builder.Services.AddScoped<ContentPageStore>();
builder.Services.AddScoped<CartService>();
builder.Services.AddScoped<OrderService>();
builder.Services.AddScoped<PaymentService>();
builder.Services.AddScoped<Shop.Api.Payments.BankTransferService>();
builder.Services.AddScoped<ServiceOpsClient>();
builder.Services.AddScoped<AccountDataService>();
builder.Services.AddScoped<OrderEventLog>();
builder.Services.AddScoped<ShopEmailService>();

// SMS. 2026-10-11: sağlayıcı KKTCELL TMessage'a taşındı. `TMessage:ApiUN/ApiPP` girilmişse TMessage,
// girilmemişse eski PostaGüvercini (geçiş günü kesinti olmasın; TMessage bilgileri yazılınca kendiliğinden
// geçer). `AddHttpClient` ile: kendi bağlantı havuzu ve zaman aşımı. Kredentials yoksa servis kendini
// KAPALI sayar (`IsConfigured`) ve SMS uçları "kapalı" cevabı döner — site normal çalışır.
if (TMessageSmsService.HasCredentials(builder.Configuration))
{
    builder.Services.AddHttpClient<ISmsService, TMessageSmsService>();
    Console.WriteLine("[SMS] Sağlayıcı: KKTCELL TMessage");
}
else
{
    builder.Services.AddHttpClient<ISmsService, SmsService>();
}

/*
 * SAHTE SMS — KONTEYNERE YALNIZCA LOKAL GELİŞTİRMEDE GİRER.
 *
 * İki koşul birden: ortam Development VE `PostaGuvercini:EnableFakeProvider` açık. Üretimde
 * ikisi de sağlanmadığı için kayıt hiç yapılmaz ve gerçek `SmsService` devrede kalır.
 *
 * Kayıt yukarıdaki `AddHttpClient`ten SONRA: son kayıt kazanır, yani sahte sağlayıcı açıkken
 * `ISmsService` isteyen herkes onu alır. Sınıfın kendisi de her metodunda aynı koşulu tekrar
 * kontrol ediyor (bkz. FakeSmsService) — buradaki `if`in bir gün silinmesi tek satırlık bir
 * hata, bedeli ise doğrulama kodu hiç gitmediği hâlde "gitti" sayılmasıdır.
 */
if (Shop.Api.Infrastructure.FakeSmsService.IsEnabled(builder.Environment, builder.Configuration))
{
    builder.Services.AddScoped<ISmsService, Shop.Api.Infrastructure.FakeSmsService>();
    Console.WriteLine("[UYARI] SAHTE SMS ETKİN — bu ortamda mesajlar gerçekten gönderilmiyor, günlüğe yazılıyor.");
}

// WhatsApp doğrulama kodu (2026-10-12): `WhatsAppOtp` bölümü doluysa kod SMS ile AYNI ANDA WhatsApp'tan da gider.
builder.Services.Configure<Shop.Api.Infrastructure.WhatsAppOtpOptions>(builder.Configuration.GetSection("WhatsAppOtp"));
builder.Services.AddHttpClient<Shop.Api.Infrastructure.WhatsAppOtpSender>();
builder.Services.AddScoped<SmsVerificationStore>();

// Pazarlama (2026-09-20): sepet hatırlatma SMS'i (arka plan) + üyelere toplu kampanya SMS'i.
builder.Services.AddSingleton<Shop.Api.Marketing.CampaignSmsService>();
builder.Services.AddSingleton<Shop.Api.Marketing.CartReminderWorker>();
builder.Services.AddHostedService(sp => sp.GetRequiredService<Shop.Api.Marketing.CartReminderWorker>());
// Havale bakımı: süresi dolanları kapatır + hatırlatma SMS'i. Eskiden yalnız bayi paneli
// açtığında çalışıyordu; kimse açmazsa sipariş hiç kapanmıyordu.
builder.Services.AddHostedService<Shop.Api.Payments.BankTransferWorker>();
// "Gelince haber ver": stok dönünce bekleyenlere SMS.
builder.Services.AddHostedService<Shop.Api.Catalog.StockAlertWorker>();

builder.Services.AddSingleton<ClientAddress>();

// Hız sınırı. Hangi uçlara neden konduğu RateLimitPolicies içinde yazıyor.
builder.Services.AddRateLimiter(RateLimitPolicies.Configure);

/*
 * CORS.
 *
 * Vitrin sunucu tarafında render edildiği için sayfaların çoğu bu API'yi sunucudan çağırır ve
 * CORS'a hiç takılmaz. Tarayıcıdan yapılan çağrılar (arama, sepet) için yalnızca yapılandırmada
 * yazılı kaynaklara izin veriliyor; "herkese açık" bir politika, kullanıcının tarayıcısındaki
 * başka bir sekmenin bu API'ye onun adına istek atabilmesi demek olurdu.
 */
builder.Services.AddCors(options =>
{
    var configured = builder.Configuration.GetSection("Cors:AllowedOrigins").Get<string[]>() ?? Array.Empty<string>();

    options.AddPolicy("Storefront", policy =>
    {
        policy.AllowAnyHeader().AllowAnyMethod();

        if (configured.Length > 0)
        {
            policy.WithOrigins(configured);
            return;
        }

        policy.SetIsOriginAllowed(origin =>
            Uri.TryCreate(origin, UriKind.Absolute, out var uri) &&
            (uri.IsLoopback || string.Equals(uri.Host, "localhost", StringComparison.OrdinalIgnoreCase)));
    });
});

var app = builder.Build();

if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}

app.UseCors("Storefront");

// CORS'tan SONRA: sınıra takılan isteğin 429'u da tarayıcıya ulaşabilmeli, yoksa müşteri
// "bir şey olmadı" görür.
app.UseRateLimiter();

app.MapControllers();

app.MapGet("/health", () => Results.Ok(new { status = "ok" }));

app.Run();
