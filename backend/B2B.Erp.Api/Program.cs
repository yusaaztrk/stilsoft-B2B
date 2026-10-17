using B2B.Erp.Api.Core.Interfaces;
using B2B.Erp.Api.Core.Services;
using B2B.Erp.Api.Data;
using B2B.Erp.Api.Data.Repositories;
using B2B.Erp.Api.Data.Services;
using B2B.Erp.Api.Entities;
using B2B.Erp.Api.Middleware;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using Microsoft.OpenApi.Models;
using Microsoft.Extensions.Options;
using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

AppDomain.CurrentDomain.UnhandledException += (_, e) =>
{
    try
    {
        Console.Error.WriteLine("[FATAL] UnhandledException: " + (e.ExceptionObject?.ToString() ?? "<null>"));
    }
    catch
    {
        // ignore
    }
};

TaskScheduler.UnobservedTaskException += (_, e) =>
{
    try
    {
        Console.Error.WriteLine("[FATAL] UnobservedTaskException: " + (e.Exception?.ToString() ?? "<null>"));
    }
    catch
    {
        // ignore
    }
};

/// <summary>
/// Taze veritabanında ürün para birimi göçünü "çalışmış" sayar.
///
/// <para>
/// <b>Kapatılan hata:</b> göç bloğu <c>MigrateAsync</c>'ten ÖNCE çalışır ve nöbetçi kaydı
/// <c>NumberSeries</c> tablosuna yazar. Bomboş bir veritabanında o tablo henüz YOKTUR, bu
/// yüzden göç atlanır ve <b>nöbetçi de yazılmaz</b>. Tablolar aynı açılışta oluşur, kullanıcı
/// yeni kodlamayla ürün girer (3 = USD) — ve <b>İKİNCİ açılışta</b> nöbetçi hâlâ eksik olduğu
/// için göç çalışır: <c>CASE 3 THEN 4</c> bütün DOLAR ürünleri sessizce STERLİNE çevirir.
/// </para>
///
/// <para>
/// "Tam olarak bir kez" garantisi, nöbetçinin yazılabildiği varsayımına dayanıyordu. Burada
/// ayrım gerçek ölçüte bağlanıyor: <b>ürün tablosu boşsa göç edecek eski veri yoktur</b>, o
/// hâlde nöbetçi hemen yazılır. Eski (dolu) veritabanları etkilenmez — onlarda göç zaten
/// açılış bloğunda çalışıp nöbetçisini yazar.
/// </para>
/// </summary>
static async Task SealProductCurrencyMigrationForFreshDatabaseAsync(B2B.Erp.Api.Data.AppDbContext db)
{
    try
    {
        await db.Database.ExecuteSqlRawAsync(@"
DO $$
BEGIN
  -- PLANLAYICI TUZAGI (2026-08-23). Bu information_schema kontrolleri KORUMA SANILIYORDU ama
  -- korumuyorlardi: PostgreSQL IF kosulunun TAMAMINI once PLANLAR, sonra calistirir. AND kisa
  -- devre yapsa bile asagidaki ""NumberSeries"" gondermesi plan asamasinda cozulmek zorunda;
  -- tablo yoksa 42P01 firlar. Yani kosul 'yanlis' diye atlanmaz, kosulun KENDISI patlar.
  -- 2026-08-21'de canli ERP'yi tamamen durduran zincirin koku buydu: acilis blogu burada olup
  -- kendisinden sonraki BUTUN DDL'leri atliyordu. Cozum: tablo varligi DIS IF'te sorulur,
  -- tabloya gonderme ancak IC IF'te - varligi bilindikten sonra - planlanir.
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='Products')
     AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='NumberSeries') THEN
    IF NOT EXISTS (SELECT 1 FROM ""NumberSeries"" WHERE ""Key"" = 'migration:productcurrency-v2')
       AND NOT EXISTS (SELECT 1 FROM ""Products"") THEN
      INSERT INTO ""NumberSeries"" (""Key"", ""LastValue"") VALUES ('migration:productcurrency-v2', 1);
    END IF;
  END IF;
END $$;");
    }
    catch
    {
        // Nöbetçi yazılamazsa açılışı düşürme: bu yalnızca ileride yanlış bir göçü önleyen
        // bir mühür. Bir sonraki açılışta tekrar denenir.
    }
}

static string NormalizeBankKey(string input)
{
    var s = (input ?? string.Empty).Trim().ToLowerInvariant();
    s = s.Normalize(NormalizationForm.FormD);

    var sb = new StringBuilder(s.Length);
    foreach (var ch in s)
    {
        var cat = CharUnicodeInfo.GetUnicodeCategory(ch);
        if (cat == UnicodeCategory.NonSpacingMark) continue;

        if (ch == '\u0131')
        {
            sb.Append('i');
            continue;
        }

        if (ch == '\u0130')
        {
            sb.Append('i');
            continue;
        }

        sb.Append(ch);
    }

    return sb
        .ToString()
        .Normalize(NormalizationForm.FormC)
        .Replace(".", string.Empty)
        .Replace(" ", string.Empty);
}
static Task<int> RunBinsImportAsync(IServiceProvider serviceProvider, string filePath)
{
    Console.Error.WriteLine("import-bins komutu bu projede artık devre dışı. Bu ortamda Banks/BankBins verisi Excel/CSV ile production şemasına import ediliyor.");
    Console.Error.WriteLine("Lütfen DB'ye veriyi dışarıdan yükleyin (CSV import) veya bu komutu yeni şemaya göre tekrar implement edelim.");
    return Task.FromResult(2);
}

/// <summary>
/// <c>dotnet run -- schema-check</c> — EF modeli ile gerçek şemayı karşılaştırır.
///
/// SALT OKUNUR: hiçbir şeyi değiştirmez, yalnızca eksikleri ve onları kapatacak SQL'i yazar.
/// Yeni bir firma veritabanı açıldıktan sonra çalıştırılmalı; bu projede şema migration'la
/// değil drift-fix bloklarıyla taşındığı için, bir varlığa eklenip drift bloğuna yazılmayan
/// kolon HİÇBİR yerde oluşmuyor ve hata ancak o varlık kaydedilirken ortaya çıkıyor.
/// </summary>
static async Task<int> RunSchemaCheckAsync(IServiceProvider serviceProvider)
{
    using var scope = serviceProvider.CreateScope();
    var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();

    var report = await B2B.Erp.Api.Data.Services.SchemaChecker.InspectAsync(db);

    Console.WriteLine($"Veritabani: {report.DatabaseName}");
    Console.WriteLine($"Eksik tablo : {report.MissingTables.Count}");
    Console.WriteLine($"Eksik kolon : {report.MissingColumns.Count}");
    Console.WriteLine();

    foreach (var t in report.MissingTables)
    {
        Console.WriteLine($"  [TABLO YOK] {t.Table}");
    }

    foreach (var c in report.MissingColumns)
    {
        Console.WriteLine($"  [KOLON YOK] {c.Table}.{c.Column} ({c.ColumnType}{(c.IsNullable ? ", null" : ", not null")})");
    }

    var script = B2B.Erp.Api.Data.Services.SchemaChecker.BuildFixScript(report);
    if (script.Length > 0)
    {
        Console.WriteLine();
        Console.WriteLine("---- DUZELTME SQL ----");
        Console.WriteLine(script);
    }

    // Eksik varsa sifir disi: surekli entegrasyonda kirilma sinyali olarak kullanilabilsin.
    return report.MissingTables.Count + report.MissingColumns.Count == 0 ? 0 : 1;
}

static async Task<int> RunBinsCountAsync(IServiceProvider serviceProvider)
{
    using var scope = serviceProvider.CreateScope();
    var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();


    var banksTotal = await db.Banks.CountAsync();
    var banksActive = await db.Banks.CountAsync(x => x.IsActive);
    var binsTotal = await db.BankBins.CountAsync();
    var binsDistinct = await db.BankBins.Select(x => x.Bin6).Distinct().CountAsync();

    Console.WriteLine($"Banks: total={banksTotal}, active={banksActive}");
    Console.WriteLine($"BankBins: total={binsTotal}, distinct_bin6={binsDistinct}");

    return 0;
}

// .NET Core ships only a handful of encodings. Garanti signs its 3D callback over an
// ISO-8859-9 (Latin-5) byte stream, so the digest is wrong for any Turkish character
// unless the code page provider is registered before the first verification runs.
System.Text.Encoding.RegisterProvider(System.Text.CodePagesEncodingProvider.Instance);

var builder = WebApplication.CreateBuilder(args);

// Servis anahtarları gibi yerel sırlar depoya girmesin diye ayrı, git'e alınmayan bir
// dosyadan okunur. Üretimde ortam değişkeni kullanılır; bu dosya yalnızca geliştirme içindir.
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

// Database Configuration
builder.Services.AddDbContext<MasterDbContext>(options =>
    options.UseNpgsql(builder.Configuration.GetConnectionString("MasterConnection")));

builder.Services.AddHttpContextAccessor();

builder.Services.AddScoped<TenantConnectionStringResolver>();
builder.Services.AddHttpClient();
builder.Services.AddDbContext<AppDbContext>((sp, options) =>
{
    var resolver = sp.GetRequiredService<TenantConnectionStringResolver>();
    var conn = resolver.Resolve();
    options.UseNpgsql(conn);
});

// JWT Configuration
var jwtSettings = builder.Configuration.GetSection("JwtSettings");
var secretKey = jwtSettings["SecretKey"]!;

builder.Services.AddAuthentication(options =>
{
    options.DefaultAuthenticateScheme = JwtBearerDefaults.AuthenticationScheme;
    options.DefaultChallengeScheme = JwtBearerDefaults.AuthenticationScheme;
})
.AddJwtBearer(options =>
{
    options.TokenValidationParameters = new TokenValidationParameters
    {
        ValidateIssuer = true,
        ValidateAudience = true,
        ValidateLifetime = true,
        ValidateIssuerSigningKey = true,
        ValidIssuer = jwtSettings["Issuer"],
        ValidAudience = jwtSettings["Audience"],
        IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(secretKey)),
        ClockSkew = TimeSpan.Zero
    };

    options.Events = new JwtBearerEvents
    {
        OnAuthenticationFailed = context =>
        {
            if (context.Exception.GetType() == typeof(SecurityTokenExpiredException))
            {
                context.Response.Headers["Token-Expired"] = "true";
            }
            return Task.CompletedTask;
        },

        // ServiceOps'tan (ya da başka bir cihazdan) yapılan çıkış bu token'ı da düşürür.
        OnTokenValidated = B2B.Erp.Api.Core.Sessions.SharedSessionRevocationGuard.RejectRevokedAsync
    };
});

builder.Services.AddAuthorization();

// Dependency Injection
builder.Services.AddScoped<ITokenService, TokenService>();
builder.Services.AddScoped<IAuthService, AuthService>();
// B2B ve ServiceOps'un ortak oturum defteri (süre, uzatma, çıkış tek kayıtta).
builder.Services.AddScoped<B2B.Erp.Api.Core.Sessions.ISharedSessionStore, B2B.Erp.Api.Core.Sessions.SharedSessionStore>();
builder.Services.AddHttpClient<IWhatsAppService, WhatsAppService>();
builder.Services.AddScoped<IUserRepository, UserRepository>();
builder.Services.AddScoped<IRefreshTokenRepository, RefreshTokenRepository>();
builder.Services.AddScoped<ICampaignService, CampaignService>();
builder.Services.AddScoped<ITenantProvisioningService, TenantProvisioningService>();
builder.Services.AddScoped<ICustomerExcelService, CustomerExcelService>();
builder.Services.AddScoped<IProductExcelService, ProductExcelService>();
builder.Services.AddScoped<InvoicePrintPdfService>();
builder.Services.AddScoped<IPriceGroupMappingService, PriceGroupMappingService>();
builder.Services.AddScoped<ICustomerAccountService, CustomerAccountService>();
builder.Services.AddScoped<B2B.Erp.Api.Core.Services.ICreditLimitService, B2B.Erp.Api.Core.Services.CreditLimitService>();
builder.Services.AddScoped<B2B.Erp.Api.Core.Services.IServiceOpsNotificationBridge, B2B.Erp.Api.Core.Services.ServiceOpsNotificationBridge>();

// Fatura Takip
builder.Services.AddScoped<B2B.Erp.Api.Features.FaturaTakip.InvoiceTrackingService>();
builder.Services.AddScoped<B2B.Erp.Api.Features.FaturaTakip.FieldTechnicianDirectory>();
builder.Services.AddSingleton<B2B.Erp.Api.Features.FaturaTakip.InvoiceTrackingPhotoStore>();
builder.Services.AddScoped<B2B.Erp.Api.Core.Services.IAccountingPeriodService, B2B.Erp.Api.Core.Services.AccountingPeriodService>();
builder.Services.AddScoped<IInvoiceSynchronizationService, InvoiceSynchronizationService>();
builder.Services.AddScoped<B2B.Erp.Api.Core.Logging.IUserActivityLogger, B2B.Erp.Api.Core.Logging.UserActivityLogger>();
builder.Services.AddScoped<B2B.Erp.Api.Features.VirtualPos.IVirtualPosService, B2B.Erp.Api.Features.VirtualPos.VirtualPosService>();

// Currency Services Integration (TCMB Rates & Conversions)
builder.Services.AddMemoryCache();
builder.Services.Configure<B2B.Erp.Api.Features.Currency.CurrencyOptions>(
    builder.Configuration.GetSection("CurrencyApi"));

builder.Services.AddHttpClient<B2B.Erp.Api.Features.Currency.ICurrencyApiClient, B2B.Erp.Api.Features.Currency.TcmbEvdsClient>((sp, client) =>
{
    var opts = sp.GetRequiredService<IOptions<B2B.Erp.Api.Features.Currency.CurrencyOptions>>().Value;
    var baseUrl = (opts.BaseUrl ?? "https://evds3.tcmb.gov.tr/igmevdsms-dis/").Trim();
    if (!baseUrl.EndsWith("/")) baseUrl += "/";
    client.BaseAddress = new Uri(baseUrl);
    client.Timeout = TimeSpan.FromSeconds(Math.Max(1, opts.TimeoutSeconds));
});

builder.Services.AddSingleton<B2B.Erp.Api.Features.Currency.ICurrencyRateService, B2B.Erp.Api.Features.Currency.CurrencyRateService>();

// FİRMANIN SAATİ (denetim md. D1). "Gün" UTC takvim gününden okunuyordu; KKTC gibi UTC+3
// bir yerde gece yarısından sonraki tahsilatlar bir ÖNCEKİ güne düşüyordu. Saat dilimi
// `Company:TimeZone` ile verilir; verilmezse sunucunun yereli kullanılır (bugünkü davranış).
builder.Services.AddSingleton<B2B.Erp.Api.Core.Helpers.CompanyClock>();
// Kur geçmişini düzenli doldurur: kur yalnızca biri istediğinde çekilirse tabloda gün
// delikleri kalır ve dönem sonu değerlemesi / geriye dönük fiş doğru kuru bulamaz.
builder.Services.AddHostedService<B2B.Erp.Api.Features.Currency.CurrencyRateSyncService>();
builder.Services.AddTransient<B2B.Erp.Api.Core.Interfaces.IMoneyServiceClient, B2B.Erp.Api.Data.Services.MoneyServiceClient>();
builder.Services.AddScoped<B2B.Erp.Api.Features.Payment.IPaymentService, B2B.Erp.Api.Features.Payment.PaymentService>();
// Faturanın muhasebe niteliğini (gelir/gider/iade) çözen TEK kapı. Type alanı tek başına
// yetmiyor: Type='H' hem servis geliri hem gider alışı olabiliyor, ayırt edici alan
// SourcePurchaseInvoiceId. Bkz. InvoiceClassifier.
builder.Services.AddScoped<B2B.Erp.Api.Core.Accounting.IInvoiceClassificationResolver,
                           B2B.Erp.Api.Core.Accounting.InvoiceClassificationResolver>();

// Virtual POS Gateway & Provider Registration
builder.Services.AddScoped<B2B.Erp.Api.Features.VirtualPos.Core.IVirtualPosProvider, B2B.Erp.Api.Features.VirtualPos.Providers.NestPayProvider>();
builder.Services.AddScoped<B2B.Erp.Api.Features.VirtualPos.Core.IVirtualPosProvider, B2B.Erp.Api.Features.VirtualPos.Providers.GarantiProvider>();
builder.Services.AddScoped<B2B.Erp.Api.Features.VirtualPos.Core.IVirtualPosProvider, B2B.Erp.Api.Features.VirtualPos.Providers.KoopbankProvider>();

/*
 * SAHTE SANAL POS — KONTEYNERE YALNIZCA LOKAL GELİŞTİRMEDE GİRER.
 *
 * İki koşul birden: ortam Development VE `VirtualPos:EnableFakeProvider` açık. Üretimde
 * ikisi de sağlanmadığı için sınıf hiç kaydedilmez; `VirtualPosGateway` sağlayıcıları
 * konteynerden topladığı için sahte sağlayıcıyı BULAMAZ ve o POS tipiyle gelen bir istek
 * "POS tipi tanımsız" ile reddedilir.
 *
 * Sınıfın kendisi de her metodunda aynı koşulu tekrar kontrol ediyor. İki kez kontrol
 * bilinçli: buradaki `if`in bir gün yanlışlıkla kaldırılması tek satırlık bir hata, ve o
 * hatanın bedeli üretimde sahte ödeme onayıdır.
 */
if (B2B.Erp.Api.Features.VirtualPos.Providers.FakePosProvider.IsEnabled(builder.Environment, builder.Configuration))
{
    builder.Services.AddScoped<B2B.Erp.Api.Features.VirtualPos.Core.IVirtualPosProvider, B2B.Erp.Api.Features.VirtualPos.Providers.FakePosProvider>();
    Console.WriteLine("[UYARI] SAHTE SANAL POS ETKİN — bu ortamda ödemeler gerçek değildir.");
}
builder.Services.AddScoped<B2B.Erp.Api.Features.VirtualPos.Core.IVirtualPosGateway, B2B.Erp.Api.Features.VirtualPos.Core.VirtualPosGateway>();
builder.Services.AddScoped<B2B.Erp.Api.Features.VirtualPos.IVirtualPosService, B2B.Erp.Api.Features.VirtualPos.VirtualPosService>();

// Mağaza siparişlerinin tahsilatı: sanal POS'un doğrulanmış yığınının üstünde, e-ticarete
// özgü üç kural (imza, tutar, tekillik). Bkz. EcommercePaymentService.
builder.Services.AddScoped<B2B.Erp.Api.Features.Ecommerce.EcommercePaymentService>();
builder.Services.AddScoped<B2B.Erp.Api.Features.Ecommerce.EcommerceFulfilmentService>();
builder.Services.AddScoped<B2B.Erp.Api.Features.Ecommerce.EcommerceBankTransferService>();
// Teslimat (kargo) kaydinin ServiceOps'a gonderilmesi. Iki cagirani var (odeme onayi ve
// fatura); tek yerde durmasi baslik/anahtar listesinin ayrismasini engelliyor.
builder.Services.AddScoped<B2B.Erp.Api.Features.Ecommerce.ServiceOpsCargoClient>();

// Bank 136 authorizes after the 3D step, so the card number has to survive from payment
// start until the callback. Held in memory only — never persisted, never logged.
builder.Services.AddSingleton<
    B2B.Erp.Api.Features.VirtualPos.Core.ITransientPaymentCardStore,
    B2B.Erp.Api.Features.VirtualPos.Core.MemoryTransientPaymentCardStore>();

builder.Services.AddScoped<
    B2B.Erp.Api.Features.VirtualPos.Core.IPaymentAuthorizationClaim,
    B2B.Erp.Api.Features.VirtualPos.Core.PaymentAuthorizationClaim>();
builder.Services.AddScoped<
    B2B.Erp.Api.Features.VirtualPos.Core.ICardPlusCompletionService,
    B2B.Erp.Api.Features.VirtualPos.Core.CardPlusCompletionService>();
builder.Services.AddScoped<
    B2B.Erp.Api.Features.VirtualPos.Core.IVirtualPosAccountingService,
    B2B.Erp.Api.Features.VirtualPos.Core.VirtualPosAccountingService>();
builder.Services.AddScoped<
    B2B.Erp.Api.Features.VirtualPos.Core.IVirtualPosAccountingRetryService,
    B2B.Erp.Api.Features.VirtualPos.Core.VirtualPosAccountingRetryService>();

// No automatic retry handler: a repeated authorization could charge the cardholder twice.
builder.Services.AddHttpClient<
    B2B.Erp.Api.Features.VirtualPos.Core.ICardPlusClient,
    B2B.Erp.Api.Features.VirtualPos.Core.CardPlusClient>(client =>
{
    client.Timeout = TimeSpan.FromSeconds(60);
}).ConfigurePrimaryHttpMessageHandler(() => new HttpClientHandler
{
    // Credentials travel in the body; a redirect would forward them to another host
    AllowAutoRedirect = false
});

// Email Service Registration
builder.Services.Configure<B2B.Erp.Api.Features.Email.SmtpSettings>(builder.Configuration.GetSection("SmtpSettings"));
builder.Services.AddScoped<B2B.Erp.Api.Features.Email.IEmailService, B2B.Erp.Api.Features.Email.EmailService>();

// Groq AI Assistant Settings
builder.Services.Configure<B2B.Erp.Api.Core.Options.GroqSettings>(
    builder.Configuration.GetSection("Groq"));

builder.Services.AddHttpClient("Groq", client =>
{
    var baseUrl = builder.Configuration["Groq:BaseUrl"] ?? "https://api.groq.com/openai/v1";
    if (!baseUrl.EndsWith("/")) baseUrl += "/";
    client.BaseAddress = new Uri(baseUrl);
});

builder.Services.AddHttpClient(nameof(B2B.Erp.Api.Data.Services.ReverseGeocode.NominatimClient));

// Face Recognition Service
builder.Services.AddHttpClient("FaceService", client =>
{
    var baseUrl = builder.Configuration["FaceService:BaseUrl"] ?? "http://localhost:5300";
    if (!baseUrl.EndsWith("/")) baseUrl += "/";
    client.BaseAddress = new Uri(baseUrl);
    var timeout = int.TryParse(builder.Configuration["FaceService:TimeoutSeconds"], out var t) ? t : 30;
    client.Timeout = TimeSpan.FromSeconds(Math.Max(1, timeout));
});

builder.Services.AddHostedService<B2B.Erp.Api.Data.Services.ReverseGeocode.EmployeeCheckInReverseGeocodeWorker>();

builder.Services.AddScoped<B2B.Erp.Api.Features.PosAccounts.PosAccountTransferService>();
builder.Services.AddHostedService<B2B.Erp.Api.Features.PosAccounts.PosAccountTransferWorker>();

// YETİM YÜKLEME DOSYALARI (denetim md. E5). Kayıttan çıkarılan ürün resmi diskte kalıyordu.
// Tarayıcı hem yönetim ucundan (rapor/temizlik) hem periyodik turdan kullanılır; periyodik
// tur `Uploads:OrphanCleanup:Enabled` açılmadan tek dosyaya dokunmaz.
builder.Services.AddScoped<B2B.Erp.Api.Features.Uploads.OrphanUploadScanner>();
builder.Services.AddHostedService<B2B.Erp.Api.Features.Uploads.OrphanUploadCleanupWorker>();

// KULLANICI HAREKETİ SAKLAMA SÜRESİ (2026-10-04 kullanıcı kararı: 1 ay, en az 30 gün; önceden 10).
// `UserActivityLogs` sınırsız büyüyordu. Budama silinen belgelerin yedeğine (`DeletionLogs`)
// DOKUNMAZ — geri yükleme hakkı kaybolmaz, yalnızca "kim ne zaman tıkladı" izi düşer.
builder.Services.AddHostedService<B2B.Erp.Api.Features.Activity.UserActivityRetentionWorker>();

// İŞLEM SONUÇLARININ KULLANICIYA GERİ BİLDİRİLMESİ (2026-08-20).
// Toplayıcı istek kapsamlı: bir istekteki bütün SaveChanges sonuçları burada birikir,
// `OperationEffectsFilter` yanıt başlığına koyar, ekran kullanıcıya gösterir.
builder.Services.AddScoped<B2B.Erp.Api.Core.Activity.RequestEffectCollector>();

builder.Services.Configure<HostOptions>(options =>
{
    options.BackgroundServiceExceptionBehavior = BackgroundServiceExceptionBehavior.Ignore;
});

// CORS Configuration
builder.Services.AddCors(options =>
{
    options.AddPolicy("AllowReactApp", policy =>
    {
        if (builder.Environment.IsDevelopment())
        {
            policy
                .SetIsOriginAllowed(origin =>
                {
                    if (string.IsNullOrWhiteSpace(origin)) return false;
                    if (!Uri.TryCreate(origin, UriKind.Absolute, out var uri)) return false;

                    var host = (uri.Host ?? string.Empty).Trim();
                    if (host == "localhost" || host == "127.0.0.1") return true;
                    if (host.StartsWith("10.")) return true;
                    if (host.StartsWith("192.168.")) return true;
                    if (host.StartsWith("172.")) return true;
                    if (host.EndsWith(".ngrok-free.app", StringComparison.OrdinalIgnoreCase)) return true;
                    if (host.EndsWith(".ngrok.io", StringComparison.OrdinalIgnoreCase)) return true;
                    if (host.EndsWith(".ngrok.app", StringComparison.OrdinalIgnoreCase)) return true;
                    if (host.EndsWith(".trycloudflare.com", StringComparison.OrdinalIgnoreCase)) return true;
                    return false;
                })
                .AllowAnyHeader()
                .AllowAnyMethod()
                .AllowCredentials()
                .WithExposedHeaders(B2B.Erp.Api.Core.Http.OperationEffectsFilter.HeaderName);
        }
        else
        {
            // Canlıda izinli kaynaklar YAPILANDIRMADAN okunur (`Cors:AllowedOrigins`). Liste
            // koda gömülüydü: içindeki geliştirme adresleri (localhost) ve ömrü dolmuş geçici
            // tünel adresleri canlıda da izinli kalıyordu ve kaldırmak için yeniden derleme
            // gerekiyordu. Yapılandırma boşsa davranış eskisiyle birebir aynı kalsın diye
            // mevcut liste varsayılan olarak duruyor.
            var configuredOrigins = builder.Configuration
                .GetSection("Cors:AllowedOrigins")
                .Get<string[]>();

            var allowedOrigins = configuredOrigins is { Length: > 0 }
                ? configuredOrigins
                : new[]
                {
                    "http://localhost:3000",
                    "http://localhost:5173",
                    "http://localhost:5174",
                    // Personel portali (employee-portal). Listede yoktu; ERP Production'da
                    // calisirken yuz kaydi ve firma bilgisi istekleri CORS'a takiliyordu.
                    "http://localhost:5175",
                    "http://localhost:8080",
                    "https://esnafrota.com",
                    "https://www.esnafrota.com",
                    "https://duck-provision-cutting-hosted.trycloudflare.com",
                    "https://treo-accessories-surround-construct.trycloudflare.com",
                    "https://combo-examinations-advertiser-females.trycloudflare.com",
                    "https://inside-remaining-sustainable-organizer.trycloudflare.com",
                    "https://females-creator-nuke-palestinian.trycloudflare.com"
                };

            policy.WithOrigins(allowedOrigins)
                  .AllowAnyHeader()
                  .AllowAnyMethod()
                  .AllowCredentials()
                  // AÇIĞA ÇIKARILMAZSA TARAYICI OKUYAMAZ. CORS'ta özel başlıklar öntanımlı
                  // olarak JavaScript'ten gizlidir; bu satır olmadan sunucu başlığı gönderir
                  // ama ekran hiçbir sonuç göremezdi.
                  .WithExposedHeaders(B2B.Erp.Api.Core.Http.OperationEffectsFilter.HeaderName);
        }
    });
});

/*
 * Kimlik uçlarında hız sınırı.
 *
 * Giriş, OTP ve QR uçlarında hiçbir sınır yoktu: bir parolayı ya da altı haneli bir OTP'yi
 * sınırsız denemek mümkündü.
 *
 * Sınır YALNIZCA bu uçlara uygulanıyor ("auth" politikası), geneli açık bırakılıyor — genel bir
 * sınır, toplu veri çeken rapor ekranlarını ya da mağaza entegrasyonunu sessizce kesebilirdi.
 *
 * Bölümleme IP bazında ve limit bilerek CÖMERT: sahadaki kullanıcılar tek bir ofis IP'sinin
 * arkasından geliyor, sabah aynı dakikada onlarca kişi giriş yapıyor. Dar bir limit gerçek
 * kullanımı kesip "sistem çalışmıyor" durumu yaratırdı. Buradaki amaç otomatik deneme trafiğini
 * kırmak; TEK BİR HESABA yönelik denemeyi durduran asıl kontrol hesap kilitlemedir ve bu ayrı
 * bir iş olarak duruyor.
 *
 * Limitler yapılandırmadan okunuyor, böylece kod değiştirmeden sıkılaştırılabilir.
 */
var authRateLimitPermits = builder.Configuration.GetValue<int?>("RateLimiting:AuthPermitsPerMinute") ?? 60;
var authRateLimitWindowSeconds = builder.Configuration.GetValue<int?>("RateLimiting:AuthWindowSeconds") ?? 60;

// Oturum İSTEMEYEN uçlar için ayrı ve geniş bir sınır (kur sorgulama: CurrencyController,
// FxController). Bu uçlar kimlik istemediği için dışarıdan sınırsız çağrılabiliyordu; yanıt
// çoğunlukla bellek önbelleğinden geldiği için TCMB kotası riski küçük ama sunucu tarafı
// tamamen korumasızdı. Sınır cömert tutuldu: aynı ofisin tüm kullanıcıları tek bir vekil
// IP'sine düşebilir, normal kullanımda takılmamalı.
var publicRateLimitPermits = builder.Configuration.GetValue<int?>("RateLimiting:PublicPermitsPerMinute") ?? 300;
var publicRateLimitWindowSeconds = builder.Configuration.GetValue<int?>("RateLimiting:PublicWindowSeconds") ?? 60;

builder.Services.AddRateLimiter(options =>
{
    options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;

    options.AddPolicy("auth", httpContext =>
    {
        // Ters vekil arkasındaysa gerçek istemci X-Forwarded-For'un ilk değeridir; yoksa hepsi
        // tek bir vekil IP'sine düşer ve sınır bütün kullanıcıları birlikte etkilerdi.
        var ip = httpContext.Request.Headers.TryGetValue("X-Forwarded-For", out var fwd)
            && !string.IsNullOrWhiteSpace(fwd.ToString())
                ? fwd.ToString().Split(',')[0].Trim()
                : httpContext.Connection.RemoteIpAddress?.ToString() ?? "unknown";

        return System.Threading.RateLimiting.RateLimitPartition.GetSlidingWindowLimiter(
            partitionKey: ip,
            factory: _ => new System.Threading.RateLimiting.SlidingWindowRateLimiterOptions
            {
                PermitLimit = authRateLimitPermits,
                Window = TimeSpan.FromSeconds(authRateLimitWindowSeconds),
                SegmentsPerWindow = 4,
                QueueLimit = 0,
                QueueProcessingOrder = System.Threading.RateLimiting.QueueProcessingOrder.OldestFirst
            });
    });

    /*
     * Yüz uçları için ayrı sınır.
     *
     * Yüz ile giriş ekranı kamera açılır açılmaz 1200 ms'de bir kare gönderiyor — dakikada
     * ~50 istek. `auth` politikasının sınırı bunun çok altında kaldığı için ekran açıldıktan
     * saniyeler sonra her istek 429 dönüyor ve kullanıcıya "yüz eşleşmedi" gibi görünüyordu.
     *
     * Sınır kaldırılmıyor: `check-in`/`check-out` anonim ve her istek yüz vektörü çıkardığı
     * için işlemci maliyeti yüksek. Sınır IP başına işliyor ve ofiste herkes aynı genel IP'den çıkıyor; 50 kişilik ekipte
     * vardiya başında onlarca telefon tek kotayı paylaşır. Dakikada 600, ~12 eşzamanlı
     * cihazın kesintisiz taramasına yeter.
     */
    options.AddPolicy("face", httpContext =>
    {
        var ip = httpContext.Request.Headers.TryGetValue("X-Forwarded-For", out var fwdFace)
            && !string.IsNullOrWhiteSpace(fwdFace.ToString())
                ? fwdFace.ToString().Split(',')[0].Trim()
                : httpContext.Connection.RemoteIpAddress?.ToString() ?? "unknown";

        return System.Threading.RateLimiting.RateLimitPartition.GetSlidingWindowLimiter(
            partitionKey: ip,
            factory: _ => new System.Threading.RateLimiting.SlidingWindowRateLimiterOptions
            {
                PermitLimit = 600,
                Window = TimeSpan.FromSeconds(60),
                SegmentsPerWindow = 4,
                QueueLimit = 0,
                QueueProcessingOrder = System.Threading.RateLimiting.QueueProcessingOrder.OldestFirst
            });
    });

    options.AddPolicy("public", httpContext =>
    {
        var ip = httpContext.Request.Headers.TryGetValue("X-Forwarded-For", out var fwd)
            && !string.IsNullOrWhiteSpace(fwd.ToString())
                ? fwd.ToString().Split(',')[0].Trim()
                : httpContext.Connection.RemoteIpAddress?.ToString() ?? "unknown";

        return System.Threading.RateLimiting.RateLimitPartition.GetSlidingWindowLimiter(
            partitionKey: ip,
            factory: _ => new System.Threading.RateLimiting.SlidingWindowRateLimiterOptions
            {
                PermitLimit = publicRateLimitPermits,
                Window = TimeSpan.FromSeconds(publicRateLimitWindowSeconds),
                SegmentsPerWindow = 4,
                QueueLimit = 0,
                QueueProcessingOrder = System.Threading.RateLimiting.QueueProcessingOrder.OldestFirst
            });
    });

    options.OnRejected = async (context, cancellationToken) =>
    {
        context.HttpContext.Response.Headers["Retry-After"] = authRateLimitWindowSeconds.ToString();
        context.HttpContext.Response.ContentType = "application/json";
        await context.HttpContext.Response.WriteAsync(
            "{\"success\":false,\"message\":\"Çok fazla deneme yapıldı. Lütfen biraz bekleyip tekrar deneyin.\"}",
            cancellationToken);
    };
});

builder.Services.AddControllers(options =>
{
    // İŞLEM SONUÇLARI HER YANITTA. Filtre küresel: uç başına eklenseydi yeni bir uç
    // yazıldığında unutulur ve o işlem sessizce geri bildirimsiz kalırdı.
    options.Filters.Add<B2B.Erp.Api.Core.Http.OperationEffectsFilter>();
}).AddJsonOptions(o =>
{
    o.JsonSerializerOptions.PropertyNamingPolicy = JsonNamingPolicy.CamelCase;
    o.JsonSerializerOptions.DictionaryKeyPolicy = JsonNamingPolicy.CamelCase;
    o.JsonSerializerOptions.Converters.Add(new System.Text.Json.Serialization.JsonStringEnumConverter());
});
builder.Services.AddEndpointsApiExplorer();

// Swagger Configuration with JWT
builder.Services.AddSwaggerGen(c =>
{
    c.SwaggerDoc("v1", new OpenApiInfo
    {
        Title = "B2B ERP API",
        Version = "v1",
        Description = "B2B ERP Authentication API"
    });

    c.AddSecurityDefinition("Bearer", new OpenApiSecurityScheme
    {
        Description = "JWT Authorization header using the Bearer scheme. Example: \"Bearer {token}\"",
        Name = "Authorization",
        In = ParameterLocation.Header,
        Type = SecuritySchemeType.ApiKey,
        Scheme = "Bearer"
    });

    c.AddSecurityRequirement(new OpenApiSecurityRequirement
    {
        {
            new OpenApiSecurityScheme
            {
                Reference = new OpenApiReference
                {
                    Type = ReferenceType.SecurityScheme,
                    Id = "Bearer"
                }
            },
            Array.Empty<string>()
        }
    });
});

var app = builder.Build();

// MASTER VERİTABANI ŞEMASI — AŞAĞIDAKİ BLOKTAN BAĞIMSIZ (2026-08-21).
//
// Bu DDL'ler eskiden aşağıdaki dev "schema ensure" try'ının EN SONUNDA duruyordu. O blok
// VARSAYILAN veritabanına (b2b_erp) karşı çalışıyor ve o veritabanının şeması kurulu değil:
// blok ilk eksik tabloda (`42P01: "NumberSeries" yok`) patlıyor, tek try olduğu için geri
// kalan HER ŞEY atlanıyordu — master DDL'leri dahil.
//
// Sonucu canlıda görüldü: `Tenants.SetupCompletedAt` kolonu hiç açılmadı, `GetPublicBranding`
// her istekte 500 verdi ve marka/giriş yolu kilitlendiği için sistem tamamen durdu. Log'da
// "[WARN] Startup schema ensure failed" satırı HER açılışta vardı ama kimse bakmıyordu.
//
// Master şeması artık kendi try'ında ve varsayılan veritabanının durumundan bağımsız.

/// <summary>
/// TAZE VERİTABANI KOLON TAMAMLAMA — <c>MigrateAsync</c>'TEN SONRA ÇALIŞIR.
///
/// <para>
/// <b>Kapatılan hata (2026-09-08):</b> bu projedeki şema, EF migration'larıyla değil
/// <c>Program.cs</c> içindeki idempotent drift-fix blokları ile taşınıyor. O blokların
/// tamamı <c>MigrateAsync</c>'ten ÖNCE çalışıyor ve her biri
/// <c>IF EXISTS (… table_name='X')</c> kapısıyla korunuyor. Var olan bir veritabanında bu
/// doğru çalışıyor; ama TAZE bir veritabanında tablolar o anda henüz YOK, dolayısıyla
/// bütün bloklar sessizce atlanıyor. Tabloları sonra <c>MigrateAsync</c> oluşturuyor —
/// ama migration'larda o kolonlar yok.
/// </para>
///
/// <para>
/// Sonuç: yeni açılan bir firmanın veritabanında <b>49 kolon eksik</b> kalıyordu
/// (2026-09-08 ölçümü: Products.SalesCurrencyCode, Invoices.CurrencyTypeId,
/// InvoiceLines.Nature, CustomerLedgerEntries.ExchangeCode, POS masraf kolonları…).
/// Mağazanın katalog sorgusu <c>column p.CategoryId does not exist</c> ile 500 veriyordu;
/// aynı eksiklik ERP'nin fatura ve ekstre ekranlarını da vururdu. Hata ancak firma
/// kullanılmaya başlandığında ortaya çıkıyordu.
/// </para>
///
/// <para>
/// Buradaki ifadelerin TAMAMI <c>ADD COLUMN IF NOT EXISTS</c>: var olan veritabanında
/// hiçbir etkisi yok, ikinci kez çalışması bedelsiz. Kendi try/catch'i var — kolon
/// tamamlama başarısız olsa bile uygulama açılmaya devam eder.
/// </para>
///
/// <para>
/// <b>Bakım notu:</b> liste yukarıdaki drift-fix bloklarından TÜRETİLDİ. Oraya yeni bir
/// kolon eklendiğinde buraya da eklenmeli; yoksa yeni firma o kolonsuz kalır.
/// </para>
/// </summary>

/// <summary>
/// MODEL İLE ŞEMAYI EŞİTLER — <c>MigrateAsync</c> ve drift tamamlamasından SONRA.
///
/// <para>
/// Drift tamamlaması yalnızca <c>Program.cs</c>'te ADI GEÇEN kolonları biliyor. Bir varlığa
/// yeni bir özellik eklenip ne migration ne drift bloğu yazılmadıysa kolon hiçbir yerde
/// oluşmuyor; kod derleniyor, uygulama açılıyor ve hata ancak o varlık kaydedilirken
/// <c>DbUpdateException</c> olarak çıkıyor. Canlı örnekler (2026-09-08, taze veritabanında
/// ölçüldü): <c>Customers.CategoryAccessMode</c> — e-ticaret üyeliği 503 veriyordu;
/// <c>UserActivityLogs.CorrelationId</c> — göç hattı testi bu yüzden kırılıyordu;
/// <c>ProductDetails</c> tablosu hiç yoktu — ürün detay sayfası açılamazdı.
/// </para>
///
/// <para>
/// Burada EF'in KENDİ MODELİ kaynak alınıyor: eksik tablo ve kolonlar modelden türetilip
/// ekleniyor. Yalnızca EKSİK olan ekleniyor — var olan hiçbir kolonun tipi, varsayılanı ya
/// da verisi değiştirilmiyor; işlemler <c>IF NOT EXISTS</c> korumalı.
/// </para>
///
/// <para>
/// Kapalı başarısız DEĞİL, bilerek: kendi try/catch'i var ve patlarsa uygulama yine açılır.
/// Eksik kolon yüzünden bir ekranın çalışmaması, bütün sistemin açılmamasından iyidir.
/// <c>Schema:AutoBackfill=false</c> ile kapatılabilir; kapatıldığında eksikler yalnızca
/// log'a yazılır, <c>dotnet run -- schema-check</c> ile tam liste alınabilir.
/// </para>
/// </summary>
async Task BackfillModelSchemaAsync(Microsoft.EntityFrameworkCore.DbContext target, string label)
{
    try
    {
        var report = await B2B.Erp.Api.Data.Services.SchemaChecker.InspectAsync(target);
        if (report.MissingTables.Count == 0 && report.MissingColumns.Count == 0) return;

        Console.WriteLine(
            $"[SEMA] {label}: modelde olup veritabaninda olmayan " +
            $"{report.MissingTables.Count} tablo, {report.MissingColumns.Count} kolon bulundu.");

        foreach (var t in report.MissingTables) Console.WriteLine($"[SEMA]   tablo: {t.Table}");
        foreach (var c in report.MissingColumns) Console.WriteLine($"[SEMA]   kolon: {c.Table}.{c.Column}");

        /*
         * VARSAYILAN KAPALI — CANLI ŞEMAYI KENDİLİĞİNDEN DEĞİŞTİRMEZ.
         *
         * Eksikleri yukarıda LİSTELER ama uygulamaz. Sebep: bu kod her açılışta, her firma
         * veritabanında çalışıyor ve `CREATE TABLE` / `ADD COLUMN` üretebiliyor. Çalışan bir
         * üretim sisteminde şemayı nöbetçisiz değiştirmek, düzeltmek istediği sorundan daha
         * büyük bir risk: eksik listesi önce İNSAN tarafından okunmalı.
         *
         * Açmak için `Schema:AutoBackfill=true`. Önce ne yapacağını görmek için:
         *     dotnet run -- schema-check
         *
         * Geliştirmede ise açık: lokal veritabanı sürekli sıfırdan kuruluyor ve her seferinde
         * elle SQL çalıştırmak testi imkânsız kılardı.
         */
        if (!builder.Configuration.GetValue("Schema:AutoBackfill", builder.Environment.IsDevelopment()))
        {
            Console.WriteLine(
                "[SEMA] Schema:AutoBackfill kapali - degisiklik YAPILMADI. " +
                "Uygulamak icin ayari acin ya da 'dotnet run -- schema-check' ciktisini elle calistirin.");
            return;
        }

        var script = B2B.Erp.Api.Data.Services.SchemaChecker.BuildFixScript(report);
        if (script.Length == 0) return;

        await target.Database.ExecuteSqlRawAsync(script);
        Console.WriteLine($"[SEMA] {label}: eksikler tamamlandi.");
    }
    catch (Exception ex)
    {
        Console.Error.WriteLine($"[UYARI] Model-sema esitlemesi basarisiz ({label}): {ex.Message}");
    }
}

async Task BackfillDriftColumnsAsync(Microsoft.EntityFrameworkCore.DbContext target, string label)
{
    try
    {
        await target.Database.ExecuteSqlRawAsync(@"
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='BankAccountDefinitions') THEN
    ALTER TABLE ""BankAccountDefinitions"" ADD COLUMN IF NOT EXISTS ""StatementDate"" date NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='DeletionLogs') THEN
    ALTER TABLE ""DeletionLogs"" ADD COLUMN IF NOT EXISTS ""Reason"" character varying(1000) NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='CampaignDiscounts') THEN
    ALTER TABLE ""CampaignDiscounts"" ADD COLUMN IF NOT EXISTS ""HedefFiyat"" numeric(18,4) NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='BankAccountTransactions') THEN
    ALTER TABLE ""BankAccountTransactions"" ADD COLUMN IF NOT EXISTS ""CurrencyTypeId"" integer NOT NULL DEFAULT 0;
    ALTER TABLE ""BankAccountTransactions"" ADD COLUMN IF NOT EXISTS ""TenderCurrencyTypeId"" integer NOT NULL DEFAULT 0;
    ALTER TABLE ""BankAccountTransactions"" ADD COLUMN IF NOT EXISTS ""TenderRate"" numeric(18,6) NOT NULL DEFAULT 0;
    ALTER TABLE ""BankAccountTransactions"" ADD COLUMN IF NOT EXISTS ""TenderAmount"" numeric(18,2) NOT NULL DEFAULT 0;
    ALTER TABLE ""BankAccountTransactions"" ADD COLUMN IF NOT EXISTS ""ExchangeCode"" character varying(30) NULL;
    ALTER TABLE ""BankAccountTransactions"" ADD COLUMN IF NOT EXISTS ""PosFeeBsmvRate"" numeric(18,4) NOT NULL DEFAULT 0;
    ALTER TABLE ""BankAccountTransactions"" ADD COLUMN IF NOT EXISTS ""PosFeeVatRate"" numeric(18,4) NOT NULL DEFAULT 0;
    ALTER TABLE ""BankAccountTransactions"" ADD COLUMN IF NOT EXISTS ""PosFeeBsmvAmount"" numeric(18,2) NOT NULL DEFAULT 0;
    ALTER TABLE ""BankAccountTransactions"" ADD COLUMN IF NOT EXISTS ""PosFeeVatAmount"" numeric(18,2) NOT NULL DEFAULT 0;
    ALTER TABLE ""BankAccountTransactions"" ADD COLUMN IF NOT EXISTS ""CheckId"" integer NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='Campaigns') THEN
    ALTER TABLE ""Campaigns"" ADD COLUMN IF NOT EXISTS ""KampanyaTipi"" integer NOT NULL DEFAULT 1;
    ALTER TABLE ""Campaigns"" ADD COLUMN IF NOT EXISTS ""SubeKodu"" character varying(50) NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='CariOfferLines') THEN
    ALTER TABLE ""CariOfferLines"" ADD COLUMN IF NOT EXISTS ""CurrencyTypeId"" integer NOT NULL DEFAULT 1;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='CariOffers') THEN
    ALTER TABLE ""CariOffers"" ADD COLUMN IF NOT EXISTS ""CurrencyTypeId"" integer NOT NULL DEFAULT 1;
    ALTER TABLE ""CariOffers"" ADD COLUMN IF NOT EXISTS ""ExchangeRate"" numeric(18,6) NOT NULL DEFAULT 1;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='CashAccountTransactions') THEN
    ALTER TABLE ""CashAccountTransactions"" ADD COLUMN IF NOT EXISTS ""DocumentNo"" character varying(30) NULL;
    ALTER TABLE ""CashAccountTransactions"" ADD COLUMN IF NOT EXISTS ""TenderCurrencyTypeId"" integer NOT NULL DEFAULT 0;
    ALTER TABLE ""CashAccountTransactions"" ADD COLUMN IF NOT EXISTS ""TenderRate"" numeric(18,6) NOT NULL DEFAULT 0;
    ALTER TABLE ""CashAccountTransactions"" ADD COLUMN IF NOT EXISTS ""TenderAmount"" numeric(18,2) NOT NULL DEFAULT 0;
    ALTER TABLE ""CashAccountTransactions"" ADD COLUMN IF NOT EXISTS ""ExchangeCode"" character varying(30) NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='CustomerLedgerEntries') THEN
    ALTER TABLE ""CustomerLedgerEntries"" ADD COLUMN IF NOT EXISTS ""Balance"" numeric NOT NULL DEFAULT 0;
    ALTER TABLE ""CustomerLedgerEntries"" ADD COLUMN IF NOT EXISTS ""ExchangeCode"" character varying(30) NULL;
    ALTER TABLE ""CustomerLedgerEntries"" ADD COLUMN IF NOT EXISTS ""TargetAccountCurrencyTypeId"" integer NOT NULL DEFAULT 0;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='CustomerOfferLines') THEN
    ALTER TABLE ""CustomerOfferLines"" ADD COLUMN IF NOT EXISTS ""CurrencyTypeId"" integer NOT NULL DEFAULT 1;
    -- Kampanya satiri kilidi (2026-09-20): dolu ise satir duzenlemede kilitli gelir.
    ALTER TABLE ""CustomerOfferLines"" ADD COLUMN IF NOT EXISTS ""CampaignName"" character varying(200) NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='CustomerOffers') THEN
    ALTER TABLE ""CustomerOffers"" ADD COLUMN IF NOT EXISTS ""CurrencyTypeId"" integer NOT NULL DEFAULT 1;
    ALTER TABLE ""CustomerOffers"" ADD COLUMN IF NOT EXISTS ""ExchangeRate"" numeric(18,6) NOT NULL DEFAULT 1;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='Customers') THEN
    ALTER TABLE ""Customers"" ADD COLUMN IF NOT EXISTS ""CreditLimitUsd"" numeric(18,2) NOT NULL DEFAULT 0;
    ALTER TABLE ""Customers"" ADD COLUMN IF NOT EXISTS ""CreditLimitEur"" numeric(18,2) NOT NULL DEFAULT 0;
    ALTER TABLE ""Customers"" ADD COLUMN IF NOT EXISTS ""CreditLimitGbp"" numeric(18,2) NOT NULL DEFAULT 0;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='Employees') THEN
    ALTER TABLE ""Employees"" ADD COLUMN IF NOT EXISTS ""WorkPermitRenewalFee"" numeric(18,2) NOT NULL DEFAULT 0;
    ALTER TABLE ""Employees"" ADD COLUMN IF NOT EXISTS ""WorkType"" character varying(80) NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='InvoiceLines') THEN
    ALTER TABLE ""InvoiceLines"" ADD COLUMN IF NOT EXISTS ""WarehouseCode"" integer NULL;
    ALTER TABLE ""InvoiceLines"" ADD COLUMN IF NOT EXISTS ""Nature"" integer NOT NULL DEFAULT 0;
  END IF;
  -- Alis faturasi satirinin MAL/HIZMET nitelIgi (2026-09-18). Hizmet satiri stok hareketi
  -- yazmaz ve hizmet harcama raporu bu kolondan gruplanir.
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='PurchaseInvoiceLines') THEN
    ALTER TABLE ""PurchaseInvoiceLines"" ADD COLUMN IF NOT EXISTS ""Nature"" integer NOT NULL DEFAULT 0;

    /*
      GERIYE DONUK DAMGA (2026-09-18 kullanici istegi: eski alis satirlarini da doldur).

      Kolon yeni; eski satirlarin hepsi 0 (Unspecified) kaldi ve hizmet harcama raporu
      onlari hic gormuyordu. Damga BIR KEZ atilir: asagisi yalnizca `Nature = 0` satirlara
      dokunur, ikinci acilista 0 satir gunceller.

      Kural, kesim anindaki damga ile AYNI (AppDbContext.StampPurchaseInvoiceLineNaturesAsync):
      urun karti ACIKCA hizmet tipindeyse (HIZMET/SERVIS) hizmet, gerisi mal. Alista
      'karti yok = hizmet' kurali UYGULANMAZ; kartsiz satir cogu zaman henuz acilmamis bir
      MAL kartidir, hepsini hizmet saymak raporu sisirirdi.

      Eslesme STOK KODU uzerinden (ProductId degil): eski satirlarda ProductId bos olabiliyor
      ama stok kodu yaziliyor. Buyuk/kucuk harf ayrimi yok, damgalama kodu da oyle.
    */
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='Products') THEN
      UPDATE ""PurchaseInvoiceLines"" l
         SET ""Nature"" = 2
        FROM ""Products"" p
       WHERE l.""Nature"" = 0
         AND p.""ProductType"" IS NOT NULL
         AND upper(btrim(p.""StockCode"")) = upper(btrim(l.""StockCode""))
         AND btrim(p.""ProductType"") ILIKE ANY (ARRAY['HIZMET', 'HİZMET', 'SERVIS', 'SERVİS']);
    END IF;

    -- Hizmet KATALOGUNDAN (HIZ-NAKLIYE, HIZ-ELEKTRIK...) gelen satirlar da hizmettir.
    -- Bu kodlarin Products'ta karsiligi yoktur; yukaridaki kural onlari yakalamaz.
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='ServiceCatalogItems') THEN
      UPDATE ""PurchaseInvoiceLines"" l
         SET ""Nature"" = 2
        FROM ""ServiceCatalogItems"" sc
       WHERE l.""Nature"" = 0
         AND upper(btrim(sc.""Code"")) = upper(btrim(l.""StockCode""));
    END IF;

    -- Geriye kalan her sey MAL.
    UPDATE ""PurchaseInvoiceLines"" SET ""Nature"" = 1 WHERE ""Nature"" = 0;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='Invoices') THEN
    ALTER TABLE ""Invoices"" ADD COLUMN IF NOT EXISTS ""IsManuallyPaid"" boolean NOT NULL DEFAULT false;
    ALTER TABLE ""Invoices"" ADD COLUMN IF NOT EXISTS ""CurrencyTypeId"" integer NOT NULL DEFAULT 0;
    ALTER TABLE ""Invoices"" ADD COLUMN IF NOT EXISTS ""ExchangeRate"" numeric(18,6) NOT NULL DEFAULT 1;
    ALTER TABLE ""Invoices"" ADD COLUMN IF NOT EXISTS ""RateSource"" character varying(40) NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='JwtSessionSettings') THEN
    ALTER TABLE ""JwtSessionSettings"" ADD COLUMN IF NOT EXISTS ""InvoiceDeleteLockDate"" timestamp with time zone NULL;
    ALTER TABLE ""JwtSessionSettings"" ADD COLUMN IF NOT EXISTS ""InvoiceTrackingStartDate"" timestamp with time zone NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='Products') THEN
    ALTER TABLE ""Products"" ADD COLUMN IF NOT EXISTS ""BsyMinStock"" integer NOT NULL DEFAULT 12;
    -- Vitrin adi (2026-09-20): e-ticarette okunur urun adi; bos = urun adi.
    ALTER TABLE ""Products"" ADD COLUMN IF NOT EXISTS ""DisplayName"" character varying(300) NULL;
    ALTER TABLE ""Products"" ADD COLUMN IF NOT EXISTS ""SalesCurrencyCode"" integer NOT NULL DEFAULT 1;
    ALTER TABLE ""Products"" ADD COLUMN IF NOT EXISTS ""MinStock"" integer NOT NULL DEFAULT 0;
    ALTER TABLE ""Products"" ADD COLUMN IF NOT EXISTS ""CategoryId"" uuid NULL;
    ALTER TABLE ""Products"" ADD COLUMN IF NOT EXISTS ""MainCategoryId"" uuid NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='PurchaseInvoiceLines') THEN
    ALTER TABLE ""PurchaseInvoiceLines"" ADD COLUMN IF NOT EXISTS ""CurrencyUnitPrice"" numeric(18,4) NOT NULL DEFAULT 0;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='PurchaseInvoices') THEN
    ALTER TABLE ""PurchaseInvoices"" ADD COLUMN IF NOT EXISTS ""CurrencyTypeId"" integer NOT NULL DEFAULT 0;
    ALTER TABLE ""PurchaseInvoices"" ADD COLUMN IF NOT EXISTS ""ExchangeRate"" numeric(18,6) NOT NULL DEFAULT 1;
    ALTER TABLE ""PurchaseInvoices"" ADD COLUMN IF NOT EXISTS ""RateSource"" character varying(20) NULL;
    ALTER TABLE ""PurchaseInvoices"" ADD COLUMN IF NOT EXISTS ""SplitFromPurchaseInvoiceId"" integer NULL;
    ALTER TABLE ""PurchaseInvoices"" ADD COLUMN IF NOT EXISTS ""TerminStatus"" integer NOT NULL DEFAULT 0;
    ALTER TABLE ""PurchaseInvoices"" ADD COLUMN IF NOT EXISTS ""CashAccountId"" integer NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='SalesOrderLines') THEN
    ALTER TABLE ""SalesOrderLines"" ADD COLUMN IF NOT EXISTS ""SourceWarehouseCode"" integer NULL;
    ALTER TABLE ""SalesOrderLines"" ADD COLUMN IF NOT EXISTS ""ServicePerformerName"" character varying(200) NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='SalesOrders') THEN
    ALTER TABLE ""SalesOrders"" ADD COLUMN IF NOT EXISTS ""DeliveryName"" character varying(200) NULL;
    ALTER TABLE ""SalesOrders"" ADD COLUMN IF NOT EXISTS ""DeliveryPhone"" character varying(40) NULL;
    ALTER TABLE ""SalesOrders"" ADD COLUMN IF NOT EXISTS ""DeliveryAddress"" character varying(500) NULL;
    ALTER TABLE ""SalesOrders"" ADD COLUMN IF NOT EXISTS ""DeliveryCity"" character varying(120) NULL;
    ALTER TABLE ""SalesOrders"" ADD COLUMN IF NOT EXISTS ""DeliveryDistrict"" character varying(120) NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='ServiceCatalogItems') THEN
    ALTER TABLE ""ServiceCatalogItems"" ADD COLUMN IF NOT EXISTS ""CurrencyTypeId"" integer NOT NULL DEFAULT 0;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='StockMovements') THEN
    ALTER TABLE ""StockMovements"" ADD COLUMN IF NOT EXISTS ""CurrencyTypeId"" integer NOT NULL DEFAULT 0;
    ALTER TABLE ""StockMovements"" ADD COLUMN IF NOT EXISTS ""CurrencyRate"" numeric(18,6) NOT NULL DEFAULT 1;
    ALTER TABLE ""StockMovements"" ADD COLUMN IF NOT EXISTS ""CurrencyUnitPrice"" numeric(18,4) NOT NULL DEFAULT 0;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='Tenants') THEN
    ALTER TABLE ""Tenants"" ADD COLUMN IF NOT EXISTS ""LogoPath"" character varying(512);
    ALTER TABLE ""Tenants"" ADD COLUMN IF NOT EXISTS ""HeaderGradientFrom"" character varying(32);
    ALTER TABLE ""Tenants"" ADD COLUMN IF NOT EXISTS ""HeaderGradientTo"" character varying(32);
    ALTER TABLE ""Tenants"" ADD COLUMN IF NOT EXISTS ""CampaignGradientFrom"" character varying(32);
    ALTER TABLE ""Tenants"" ADD COLUMN IF NOT EXISTS ""CampaignTextColor"" character varying(32);
    ALTER TABLE ""Tenants"" ADD COLUMN IF NOT EXISTS ""CampaignGradientTo"" character varying(32);
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='UserBasketItems') THEN
    ALTER TABLE ""UserBasketItems"" ADD COLUMN IF NOT EXISTS ""CampaignTitle"" text DEFAULT '';
    ALTER TABLE ""UserBasketItems"" ADD COLUMN IF NOT EXISTS ""DiscountAmount"" numeric DEFAULT 0;
    ALTER TABLE ""UserBasketItems"" ADD COLUMN IF NOT EXISTS ""DiscountRate"" numeric DEFAULT 0;
    ALTER TABLE ""UserBasketItems"" ADD COLUMN IF NOT EXISTS ""IsGift"" boolean DEFAULT FALSE;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='Users') THEN
    ALTER TABLE ""Users"" ADD COLUMN IF NOT EXISTS ""DefaultCashAccountId"" integer NULL;
    ALTER TABLE ""Users"" ADD COLUMN IF NOT EXISTS ""DefaultBankAccountId"" integer NULL;
    ALTER TABLE ""Users"" ADD COLUMN IF NOT EXISTS ""EmployeeAccess"" boolean NOT NULL DEFAULT FALSE;
    ALTER TABLE ""Users"" ADD COLUMN IF NOT EXISTS ""AsistanAccess"" boolean NOT NULL DEFAULT FALSE;
    ALTER TABLE ""Users"" ADD COLUMN IF NOT EXISTS ""CariEkstreTipleri"" character varying(200) NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='Virmans') THEN
    ALTER TABLE ""Virmans"" ADD COLUMN IF NOT EXISTS ""CurrencyTypeId"" integer NOT NULL DEFAULT 0;
    ALTER TABLE ""Virmans"" ADD COLUMN IF NOT EXISTS ""ExchangeRate"" numeric(18,6) NOT NULL DEFAULT 1;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='VirtualPosDefinitions') THEN
    ALTER TABLE ""VirtualPosDefinitions"" ADD COLUMN IF NOT EXISTS ""StoreType"" character varying(40) NOT NULL DEFAULT '3D_PAY_HOSTING';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='WarrantyRecords') THEN
    ALTER TABLE ""WarrantyRecords"" ADD COLUMN IF NOT EXISTS ""CurrencyTypeId"" integer NOT NULL DEFAULT 1;
    ALTER TABLE ""WarrantyRecords"" ADD COLUMN IF NOT EXISTS ""CurrencyRate"" numeric(18,6) NOT NULL DEFAULT 1;
  END IF;
END $$;
");
    }
    catch (Exception ex)
    {
        Console.Error.WriteLine($"[WARN] Kolon tamamlama basarisiz ({label}): {ex.Message}");
    }
}

async Task EnsureMasterSchemaAsync(MasterDbContext masterDb)
{
    await masterDb.Database.ExecuteSqlRawAsync(@"
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'Tenants'
  ) THEN
    ALTER TABLE ""Tenants"" ADD COLUMN IF NOT EXISTS ""LogoPath"" character varying(512);
    ALTER TABLE ""Tenants"" ADD COLUMN IF NOT EXISTS ""HeaderGradientFrom"" character varying(32);
    ALTER TABLE ""Tenants"" ADD COLUMN IF NOT EXISTS ""HeaderGradientTo"" character varying(32);
    ALTER TABLE ""Tenants"" ADD COLUMN IF NOT EXISTS ""CampaignGradientFrom"" character varying(32);
    ALTER TABLE ""Tenants"" ADD COLUMN IF NOT EXISTS ""CampaignTextColor"" character varying(32);
    ALTER TABLE ""Tenants"" ADD COLUMN IF NOT EXISTS ""CampaignGradientTo"" character varying(32);

    -- KURULUM DAMGASI — AÇILIŞTA DA EKLENİR (2026-08-20).
    --
    -- Bu kolon yalnızca YENİ FİRMA AÇILIRKEN (`TenantProvisioningService`) ekleniyordu.
    -- Kimse firma açmadığı sürece master veritabanına hiç gelmiyor, `Tenant` varlığı ise
    -- alanı okuyor: `/api/tenants/branding` her sayfa yüklemesinde
    -- ""column t.SetupCompletedAt does not exist"" ile 500 dönüyordu.
    --
    -- Geriye dönük damgalama YALNIZCA kolon ilk eklendiğinde çalışır: koşulsuz bir UPDATE,
    -- önceki denemeden kalan YARIM bir firmayı da ""tamamlandı"" sayardı.
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'Tenants' AND column_name = 'SetupCompletedAt'
    ) THEN
      ALTER TABLE ""Tenants"" ADD COLUMN ""SetupCompletedAt"" timestamp with time zone NULL;
      UPDATE ""Tenants"" SET ""SetupCompletedAt"" = now();
    END IF;
  END IF;
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public' AND lower(table_name) = 'customerledgerentries'
  ) THEN
    ALTER TABLE ""CustomerLedgerEntries"" ADD COLUMN IF NOT EXISTS ""Balance"" numeric NOT NULL DEFAULT 0;
  END IF;
END $$;
");

    // Master GlobalUsers identity/sequence drift fix (prevents PK_GlobalUsers duplicate errors)
    await masterDb.Database.ExecuteSqlRawAsync(@"
SELECT setval(
  pg_get_serial_sequence('""GlobalUsers""','Id'),
  COALESCE((SELECT MAX(""Id"") FROM ""GlobalUsers""), 0),
  true
);
");

    // Seed Super Super Admin only once (master DB)
    await masterDb.Database.ExecuteSqlRawAsync(@"
INSERT INTO ""GlobalUsers"" (""Username"", ""Mail"", ""PasswordHash"", ""IsSuperSuperAdmin"", ""IsActive"")
SELECT 'ssa', 'ssa@local', '123', TRUE, TRUE
WHERE NOT EXISTS (
  SELECT 1
  FROM ""GlobalUsers""
  WHERE lower(""Username"") = 'ssa'
);
" );

    /*
     * YENİ SAYFA + FIRMA "ETKİN SAYFA" LİSTESİ (2026-09-13).
     *
     * Bir firma TenantEnabledPages'te HERHANGİ bir kayda sahipse (kısıtlı moda geçmiş
     * demektir — PagesController.GetAll'daki hasAnyConfig), o listede olmayan HER sayfa
     * Rol Yetkileri ekranında hiç görünmez; Pages tablosunda + RolePagePermissions'ta doğru
     * olsa bile fark etmez. Yeni eklenen 701 (Sistem Denetimi) ve 702 (Kataloglar) kısıtlı
     * modda olan firmalarda bu yüzden hiç çıkmıyordu (DEMO_CANLI canlı kanıtı).
     *
     * Kısıtlı modda OLMAYAN firmalar zaten her şeyi görüyor, onlara dokunmaya gerek yok —
     * yalnızca zaten en az bir kaydı olan firmalara iki yeni sayfa da ekleniyor.
     */
    await masterDb.Database.ExecuteSqlRawAsync(@"
INSERT INTO ""TenantEnabledPages"" (""TenantId"", ""PageId"", ""IsEnabled"")
SELECT DISTINCT tep.""TenantId"", p.""Id"", TRUE
FROM ""TenantEnabledPages"" tep
CROSS JOIN (SELECT 701 AS ""Id"" UNION ALL SELECT 702) p
ON CONFLICT (""TenantId"", ""PageId"") DO UPDATE SET ""IsEnabled"" = TRUE;
");
}

// Ensure required schema pieces exist (handles DB drift across docker/local environments)
try
{
    using var scope = app.Services.CreateScope();
    var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
    var masterDb = scope.ServiceProvider.GetRequiredService<MasterDbContext>();
    var vposLogger = scope.ServiceProvider.GetRequiredService<ILoggerFactory>().CreateLogger("VirtualPosSeeder");
    await B2B.Erp.Api.Data.Services.VirtualPosSeeder.SeedPosDataAsync(db, vposLogger);


    // TARİHLİ KUR TABLOSU (2026-08-14).
    //
    // Kurlar firmaya özel DEĞİL — TCMB kuru herkes için aynı. Bu yüzden yalnızca VARSAYILAN
    // veritabanında tutulur, tenant döngüsüne eklenmez; `CurrencyRateService` de doğrudan
    // varsayılan bağlantıyı kullanır.
    //
    // İki sorunu birden kapatıyor:
    //  1) Kur önbelleği yalnızca BELLEKTEYDİ. TCMB'ye erişilemediğinde devreye giren
    //     `GetFallbackRates()` SABİT değerler döndürüyordu (USD 36,50 / EUR 38,20 / GBP 46,10)
    //     ve fatura o uydurma kurla kesilip kur KALICI olarak donuyordu.
    //  2) `GetRateAsync(code, date)` tarih parametresini yok sayıyordu; geriye dönük fiş,
    //     açılış fişi ve dönem sonu değerlemesi doğru kuru bulamıyordu.
    //
    // (CurrencyCode, RateDate) benzersiz: gün başına tek kur. Aynı gün tekrar çekilirse
    // satır güncellenir, çoğalmaz.
    await db.Database.ExecuteSqlRawAsync(@"
CREATE TABLE IF NOT EXISTS ""ExchangeRates"" (
  ""Id"" integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  ""CurrencyCode"" character varying(8) NOT NULL,
  ""RateDate"" date NOT NULL,
  ""BuyingRate"" numeric(18,6) NOT NULL DEFAULT 0,
  ""SellingRate"" numeric(18,6) NOT NULL DEFAULT 0,
  ""EffectiveBuyingRate"" numeric(18,6) NOT NULL DEFAULT 0,
  ""EffectiveSellingRate"" numeric(18,6) NOT NULL DEFAULT 0,
  ""Source"" character varying(40) NOT NULL DEFAULT 'TCMB',
  ""CreateTime"" timestamp with time zone NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ""IX_ExchangeRates_Code_Date""
  ON ""ExchangeRates"" (""CurrencyCode"", ""RateDate"");
");

    // ÜRÜNE GÖRE OTOMATİK SATIŞA KAPANMA EŞİĞİ (2026-09-05).
    //
    // Stok bu sayının ALTINA düşünce ürün bayi tarafında otomatik satışa kapanır (BSY kuralı,
    // bkz. `utils/productSaleStatus.ts`). Eşik eskiden kodda sabit 12'ydi; artık ürün başına
    // ayarlanabiliyor. Varsayılan 12: mevcut davranış korunur.
    //
    // `MinStock` İLE KARIŞTIRMA — o AYRI bir alandır: stok alarmı, "bitmek üzere, sipariş ver"
    // uyarısı. Satışı kapatmakla ilgisi yoktur ve bu kolona bağlanmamalıdır.
    await db.Database.ExecuteSqlRawAsync(@"
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='Products') THEN
    ALTER TABLE ""Products"" ADD COLUMN IF NOT EXISTS ""BsyMinStock"" integer NOT NULL DEFAULT 12;
    -- Vitrin adi (2026-09-20): e-ticarette okunur urun adi; bos = urun adi.
    ALTER TABLE ""Products"" ADD COLUMN IF NOT EXISTS ""DisplayName"" character varying(300) NULL;
  END IF;
END $$;
");

    // Drift fix: some environments may have EF migration history applied but missing columns.
    // Ensure BankAccountTransactions has CurrencyTypeId so bank transactions can be inserted.
    await db.Database.ExecuteSqlRawAsync(@"
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'BankAccountTransactions'
  ) THEN
    ALTER TABLE ""BankAccountTransactions"" ADD COLUMN IF NOT EXISTS ""CurrencyTypeId"" integer NOT NULL DEFAULT 0;
  END IF;
  -- HESAP KESIM TARIHI (2026-08-22). Sirket kredi karti hesaplari icin; saat tasimaz,
  -- `date` olarak durur ki firma saat dilimine gore bir gun kaymasin. Diger hesap
  -- turlerinde NULL kalir.
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'BankAccountDefinitions'
  ) THEN
    ALTER TABLE ""BankAccountDefinitions"" ADD COLUMN IF NOT EXISTS ""StatementDate"" date NULL;
  END IF;
  /*
   * SİPARİŞTE TESLİMAT ADRESİ ANLIK GÖRÜNTÜSÜ (2026-09-08).
   *
   * E-ticaret siparişinin teslimat bilgisi bugüne kadar hiçbir yerde saklanmıyordu; montaj
   * kaydı ve sipariş dökümü adresi CARİ KARTINDAN okuyordu. Müşteri profilinden adresini
   * değiştirdiği anda GEÇMİŞ siparişlerin adresi de değişiyordu — kargo çıkmış bir siparişin
   * nereye gittiği sistemde kaybolan bir bilgiydi.
   *
   * Kolonlar NULL: bayi siparişlerinde doldurulmuyor, yalnızca e-ticaret yolunda yazılıyor.
   * Boş olan eski siparişlerde okuyucular eskisi gibi cari kartına düşüyor.
   */
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'SalesOrders'
  ) THEN
    ALTER TABLE ""SalesOrders"" ADD COLUMN IF NOT EXISTS ""DeliveryName"" character varying(200) NULL;
    ALTER TABLE ""SalesOrders"" ADD COLUMN IF NOT EXISTS ""DeliveryPhone"" character varying(40) NULL;
    ALTER TABLE ""SalesOrders"" ADD COLUMN IF NOT EXISTS ""DeliveryAddress"" character varying(500) NULL;
    ALTER TABLE ""SalesOrders"" ADD COLUMN IF NOT EXISTS ""DeliveryCity"" character varying(120) NULL;
    ALTER TABLE ""SalesOrders"" ADD COLUMN IF NOT EXISTS ""DeliveryDistrict"" character varying(120) NULL;
  END IF;
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'StockMovements'
  ) THEN
    -- STOK HAREKETİNDE PARA BİRİMİ (2026-08-19). Tabloda para birimi hiç yoktu; `UnitPrice`
    -- TL çapasıydı ama ürün satış / stok raporları dolarlı satışı TL satıştan ayırt
    -- edemiyordu. 0 = TL (mevcut kolonlarla aynı kural).
    ALTER TABLE ""StockMovements"" ADD COLUMN IF NOT EXISTS ""CurrencyTypeId"" integer NOT NULL DEFAULT 0;
    ALTER TABLE ""StockMovements"" ADD COLUMN IF NOT EXISTS ""CurrencyRate"" numeric(18,6) NOT NULL DEFAULT 1;
    ALTER TABLE ""StockMovements"" ADD COLUMN IF NOT EXISTS ""CurrencyUnitPrice"" numeric(18,4) NOT NULL DEFAULT 0;

    -- DEPO BAZLI BAKIYE INDEKSI (denetim md. 236). Bir deponun bir stoktaki bakiyesi
    -- `StockCode + WarehouseCode` ile hesaplaniyor (sepet, fatura kesimi, depo transferi).
    -- Tek basina StockCode indeksi urunun BUTUN depolardaki hareketlerini okutuyordu.
    CREATE INDEX IF NOT EXISTS ""IX_StockMovements_StockCode_WarehouseCode"" ON ""StockMovements"" (""StockCode"", ""WarehouseCode"");

    -- GERIYE DONUK DAMGA. Kolonlar eklendi ama ESKI hareketler damgasiz kaldi: urun satis
    -- raporunda her satir TL / 0,00 gorunuyordu. Damga faturanin KALEMINDEN kopyalanir
    -- (fis no + stok kodu + satir no ile); kur hesaplanmaz, belgenin donmus kuru alinir.
    --
    -- IDEMPOTENS: kosul ""CurrencyUnitPrice"" = 0 uzerinden yurur. Guncellenen satirda bu
    -- alan doldugu icin ikinci calistirma hicbir seyi degistirmez. (TL kalemde
    -- ""CurrencyTypeId"" 0 kalabilir; 0 ile 1 bu sistemde ayni seydir.)
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'InvoiceLines'
    ) THEN
      UPDATE ""StockMovements"" sm
      SET ""CurrencyTypeId"" = il.""CurrencyTypeId"",
          ""CurrencyRate"" = CASE WHEN il.""CurrencyRate"" > 0 THEN il.""CurrencyRate"" ELSE 1 END,
          ""CurrencyUnitPrice"" = CASE WHEN il.""CurrencyUnitPrice"" > 0 THEN il.""CurrencyUnitPrice"" ELSE il.""UnitPrice"" END
      FROM ""InvoiceLines"" il
      JOIN ""Invoices"" i ON i.""Id"" = il.""InvoiceId""
      WHERE sm.""CurrencyUnitPrice"" = 0
        AND sm.""InvoiceNo"" = i.""InvoiceNo""
        AND sm.""StockCode"" = il.""StockCode""
        AND sm.""LineNo"" = il.""LineNo"";
    END IF;
  END IF;
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'Customers'
  ) THEN
    -- PARA BİRİMİ BAŞINA KREDİ LİMİTİ (2026-08-19, kullanıcı kuralı).
    -- Tek bir TL limiti vardı ve dövizli bir belge o limite TL karşılığıyla giriyordu; kur
    -- değiştikçe aynı dolar borcu farklı limit tüketiyor, ""47 kat"" hataları da doğrudan
    -- limite sızıyordu. Artık her para birimi KENDİ limitine yürür, çevrim yok.
    -- Mevcut ""CreditLimit"" kolonu TL limiti olarak yerinde kalır (veri kaybı yok).
    ALTER TABLE ""Customers"" ADD COLUMN IF NOT EXISTS ""CreditLimitUsd"" numeric(18,2) NOT NULL DEFAULT 0;
    ALTER TABLE ""Customers"" ADD COLUMN IF NOT EXISTS ""CreditLimitEur"" numeric(18,2) NOT NULL DEFAULT 0;
    ALTER TABLE ""Customers"" ADD COLUMN IF NOT EXISTS ""CreditLimitGbp"" numeric(18,2) NOT NULL DEFAULT 0;
  END IF;
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'Invoices'
  ) THEN
    ALTER TABLE ""Invoices"" ADD COLUMN IF NOT EXISTS ""IsManuallyPaid"" boolean NOT NULL DEFAULT false;
    -- FATURA BAŞLIĞINDA PARA BİRİMİ VE DONMUŞ KUR (2026-08-14).
    -- Önceden başlıkta para birimi YOKTU; faturanın dövizi her okumada kalemlerden yeniden
    -- çıkarılıyordu (karışık kalemli faturada ""yok"" sayılıyordu) ve kur hiç saklanmıyordu.
    -- Muhasebe fişi hem para birimini hem de FATURA ANINDAKİ kuru ister; sonradan güncel kurla
    -- yeniden hesaplamak yasak — yevmiye numarası kesintisiz olduğu için düzeltme ancak
    -- ters kayıtla olur. 0 = TL (mevcut kolonlarla aynı kural).
    ALTER TABLE ""Invoices"" ADD COLUMN IF NOT EXISTS ""CurrencyTypeId"" integer NOT NULL DEFAULT 0;
    ALTER TABLE ""Invoices"" ADD COLUMN IF NOT EXISTS ""ExchangeRate"" numeric(18,6) NOT NULL DEFAULT 1;
    ALTER TABLE ""Invoices"" ADD COLUMN IF NOT EXISTS ""RateSource"" character varying(40) NULL;
  END IF;
  -- KASA HAREKETİNDE BELGE NUMARASI (2026-08-14).
  -- BankAccountTransactions'ta zaten vardı, kasada yoktu. Yevmiye defterinde her satırın
  -- belge numarası olmak zorunda; veritabanı Id'si bunun yerine geçmez (kullanıcıya
  -- gösterilmez, seri/dönem taşımaz).
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='CashAccountTransactions') THEN
    ALTER TABLE ""CashAccountTransactions"" ADD COLUMN IF NOT EXISTS ""DocumentNo"" character varying(30) NULL;
  END IF;
  -- KASA/BANKADA DÖVİZ ÇEVRİMİ (2026-08-17).
  -- Gelen para ile onun işlendiği hesap ayrı para birimlerinde olabilir: müşteri 1.000 DOLAR
  -- getirir, TL kasaya günün kuruyla yazılır. Hareket eskiden yalnız hesabın para birimini
  -- taşıyordu, gelen paranın ne olduğu kayboluyordu. `Tender*` alanları gelen parayı saklar;
  -- TL çapası (`Amount`) daima tenderTutar × tenderKur'dur, hesap tutarı da o çapadan türer.
  -- `ExchangeCode` yalnız ÇEVRİM VARSA dolar ve iki ucu (kasa hareketi + cari ekstre satırı)
  -- birbirine bağlar; muhasebe kur farkını bu kodla ayıklar. 0 = çevrim yok (eski kayıtlar).
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='CashAccountTransactions') THEN
    ALTER TABLE ""CashAccountTransactions"" ADD COLUMN IF NOT EXISTS ""TenderCurrencyTypeId"" integer NOT NULL DEFAULT 0;
    ALTER TABLE ""CashAccountTransactions"" ADD COLUMN IF NOT EXISTS ""TenderRate"" numeric(18,6) NOT NULL DEFAULT 0;
    ALTER TABLE ""CashAccountTransactions"" ADD COLUMN IF NOT EXISTS ""TenderAmount"" numeric(18,2) NOT NULL DEFAULT 0;
    ALTER TABLE ""CashAccountTransactions"" ADD COLUMN IF NOT EXISTS ""ExchangeCode"" character varying(30) NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='BankAccountTransactions') THEN
    ALTER TABLE ""BankAccountTransactions"" ADD COLUMN IF NOT EXISTS ""TenderCurrencyTypeId"" integer NOT NULL DEFAULT 0;
    ALTER TABLE ""BankAccountTransactions"" ADD COLUMN IF NOT EXISTS ""TenderRate"" numeric(18,6) NOT NULL DEFAULT 0;
    ALTER TABLE ""BankAccountTransactions"" ADD COLUMN IF NOT EXISTS ""TenderAmount"" numeric(18,2) NOT NULL DEFAULT 0;
    ALTER TABLE ""BankAccountTransactions"" ADD COLUMN IF NOT EXISTS ""ExchangeCode"" character varying(30) NULL;
  END IF;
  -- POS MASRAFINDA VERGİ AYRIŞTIRMASI (2026-08-20, denetim md. A4).
  -- Komisyon tek kalem gider olarak yazılıyordu; BSMV/KDV bileşeni hiçbir yerde yoktu.
  -- Oranlar ELLE girilir, varsayılan 0 = ayrıştırma yok (eski kayıtlar böyle okunur).
  -- `Amount` (brüt) DEĞİŞMEZ; bu kolonlar yalnızca o tutarın içini açıklar.
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='BankAccountTransactions') THEN
    ALTER TABLE ""BankAccountTransactions"" ADD COLUMN IF NOT EXISTS ""PosFeeBsmvRate"" numeric(18,4) NOT NULL DEFAULT 0;
    ALTER TABLE ""BankAccountTransactions"" ADD COLUMN IF NOT EXISTS ""PosFeeVatRate"" numeric(18,4) NOT NULL DEFAULT 0;
    ALTER TABLE ""BankAccountTransactions"" ADD COLUMN IF NOT EXISTS ""PosFeeBsmvAmount"" numeric(18,2) NOT NULL DEFAULT 0;
    ALTER TABLE ""BankAccountTransactions"" ADD COLUMN IF NOT EXISTS ""PosFeeVatAmount"" numeric(18,2) NOT NULL DEFAULT 0;
    -- ÇEK BAĞI (2026-08-24). Bu hareket bir çekten doğduysa çekin kimliği; değilse NULL.
    -- Çek bir hesaptan ayrıldığında (portföye dönüş, tahsil, iade, karşılıksız, silme)
    -- satır SİLİNİR; silinecek satır açıklama metnine değil bu kimliğe göre bulunur.
    ALTER TABLE ""BankAccountTransactions"" ADD COLUMN IF NOT EXISTS ""CheckId"" integer NULL;
    CREATE INDEX IF NOT EXISTS ""IX_BankAccountTransactions_CheckId"" ON ""BankAccountTransactions"" (""CheckId"");
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND lower(table_name)='customerledgerentries') THEN
    ALTER TABLE ""CustomerLedgerEntries"" ADD COLUMN IF NOT EXISTS ""ExchangeCode"" character varying(30) NULL;
    -- PARANIN İŞLENDİĞİ CARİ DÖVİZ HESABI (2026-08-20).
    -- Kasa/bankada ""hangi cari hesabına yazılacağı"" ekrandan seçilir (varsayılan TL). Bu
    -- kolon yalnız HEDEF DAMGASIDIR; tutar çevrilmez — 1.500 £ tahsilat EUR hesabı seçilse
    -- de satırda 1.500 £ olarak durur. (Çapraz kurla çeviren eski davranış 1.500 £'yi
    -- 31,66 €'ya düşürüyordu; seçim geri geldi, çevrim gelmedi.)
    -- 0 = belirtilmemiş (eski satırlar).
    ALTER TABLE ""CustomerLedgerEntries"" ADD COLUMN IF NOT EXISTS ""TargetAccountCurrencyTypeId"" integer NOT NULL DEFAULT 0;
  END IF;
  -- TEKLİFTE PARA BİRİMİ (2026-08-17).
  -- Teklifler hiç para birimi taşımıyordu: basım sembolü CARİNİN kartındaki dövizden
  -- alınıyordu. O alan kaldırıldı (bir cariye her para biriminde satış yapılır), dolayısıyla
  -- teklif kendi para birimini taşımak zorunda. Para birimi kalemlerin SATIŞ dövizinden
  -- gelir, kur teklif anında dondurulur. 1 = TL (eski kayıtlar TL sayılır; bugüne kadar
  -- fiyatların tamamı TRY olduğu için bu geriye dönük doğru).
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='CustomerOffers') THEN
    ALTER TABLE ""CustomerOffers"" ADD COLUMN IF NOT EXISTS ""CurrencyTypeId"" integer NOT NULL DEFAULT 1;
    ALTER TABLE ""CustomerOffers"" ADD COLUMN IF NOT EXISTS ""ExchangeRate"" numeric(18,6) NOT NULL DEFAULT 1;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='CustomerOfferLines') THEN
    ALTER TABLE ""CustomerOfferLines"" ADD COLUMN IF NOT EXISTS ""CurrencyTypeId"" integer NOT NULL DEFAULT 1;
    -- Kampanya satiri kilidi (2026-09-20): dolu ise satir duzenlemede kilitli gelir.
    ALTER TABLE ""CustomerOfferLines"" ADD COLUMN IF NOT EXISTS ""CampaignName"" character varying(200) NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='CariOffers') THEN
    ALTER TABLE ""CariOffers"" ADD COLUMN IF NOT EXISTS ""CurrencyTypeId"" integer NOT NULL DEFAULT 1;
    ALTER TABLE ""CariOffers"" ADD COLUMN IF NOT EXISTS ""ExchangeRate"" numeric(18,6) NOT NULL DEFAULT 1;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='CariOfferLines') THEN
    ALTER TABLE ""CariOfferLines"" ADD COLUMN IF NOT EXISTS ""CurrencyTypeId"" integer NOT NULL DEFAULT 1;
  END IF;
  -- HİZMET TANIMINDA PARA BİRİMİ (2026-08-20).
  -- Hizmet kataloğunda para birimi YOKTU; gümrük masrafı gibi doğası gereği dövizli hizmetler
  -- faturaya TL düşüyor, kullanıcı her kalemde elle çeviriyordu. Para birimi hizmetin kendi
  -- özelliği; fatura kalemine ÖNTANIM olarak taşınır ve kalemde değiştirilebilir.
  -- 0 = TL (mevcut kolonlarla aynı kural; eski hizmetler aynen TL kalır).
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='ServiceCatalogItems') THEN
    ALTER TABLE ""ServiceCatalogItems"" ADD COLUMN IF NOT EXISTS ""CurrencyTypeId"" integer NOT NULL DEFAULT 0;
  END IF;
  -- PARA BİRİMİ KODLAMASI TEKİLLEŞTİRİLDİ (2026-08-14).
  --
  -- Sistemde iki kodlama vardı ve ÇAKIŞIYORLARDI: CurrencyTypeId'de 3 = USD iken
  -- Products.CurrencyCode'da 3 = GBP, 43 = USD, 0 = TL idi. Ürün kodu CurrencyTypeId
  -- beklenen bir yere geçtiğinde sterlin SESSİZCE dolara dönüyordu.
  --
  -- Artık tek kodlama: 1=TRY 2=EUR 3=USD 4=GBP.
  --
  -- TEK BİR UPDATE + CASE kullanılıyor: ayrı UPDATE'ler yazılsaydı 43→3 ardından 3→4
  -- çalışıp yeni USD satırlarını GBP yapardı. CASE eski değer üzerinden çalışır.
  -- Nöbetçi kayıt (NumberSeries) göçün TAM OLARAK BİR KEZ çalışmasını garanti eder.
  -- ÜRÜNÜN SATIŞ PARA BİRİMİ (2026-08-14).
  -- `CurrencyCode` ürünün ALIŞ dövizidir; satış dövizi yalnızca fiyat satırında (metin olarak)
  -- vardı ve toplu fiyat ekranı her yeni satıra sabit ""TRY"" yazdığı için arayüzden ürünü
  -- dövizle satmanın yolu yoktu. Varsayılan 1 = TRY: mevcut davranış korunur.
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='Products') THEN
    ALTER TABLE ""Products"" ADD COLUMN IF NOT EXISTS ""SalesCurrencyCode"" integer NOT NULL DEFAULT 1;
  END IF;
  -- ALIŞ FATURASI VE VİRMAN PARA BİRİMİ (2026-08-14).
  -- İkisinde de para birimi alanı hiç yoktu. Alış faturasının tedarikçi tarafında
  -- (cari yok, yalnızca SupplierCode) ve cariden cariye virmanda ekstre satırı zorunlu
  -- olarak TL yazılıyordu — bakiye döviz başına yürüdüğü için dövizli işlem imkânsızdı.
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='PurchaseInvoices') THEN
    ALTER TABLE ""PurchaseInvoices"" ADD COLUMN IF NOT EXISTS ""CurrencyTypeId"" integer NOT NULL DEFAULT 0;
    ALTER TABLE ""PurchaseInvoices"" ADD COLUMN IF NOT EXISTS ""ExchangeRate"" numeric(18,6) NOT NULL DEFAULT 1;
    -- KUR KAYNAGI (2026-08-29): TCMB ya da Manuel. Alis faturasinda kur artik elle
    -- girilebiliyor; hangi kurun nereden geldigi damgalanmazsa ay sonunda o kurun nereden
    -- ciktigi sorusunun cevabi olmaz. Satis faturasinda karsiligi zaten vardi.
    ALTER TABLE ""PurchaseInvoices"" ADD COLUMN IF NOT EXISTS ""RateSource"" character varying(20) NULL;
    -- TESLIMATIN HANGI SIPARISTEN BOLUNDUGU (2026-08-29). Once yalnizca aciklama
    -- metniyle bagliydi (Kismi Teslimat - X seklinde); metin degisince bag kopuyordu ve
    -- teslimat gecmisi gosterilemiyordu.
    ALTER TABLE ""PurchaseInvoices"" ADD COLUMN IF NOT EXISTS ""SplitFromPurchaseInvoiceId"" integer NULL;
  END IF;
  -- ALIS KALEMINDE BELGE PARA BIRIMI FIYATI (2026-08-29).
  -- `UnitPrice` TL capasidir; `CurrencyUnitPrice` kalemin BELGENIN kendi para birimindeki
  -- fiyatidir. Satis faturasinda bu ayrim vardi, aliste yoktu: dovizli alisin ORIJINAL
  -- tutari kayitta hic durmuyordu. Denetimdeki B3 bulgusu (Id 50) bundan cikiyordu.
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='PurchaseInvoiceLines') THEN
    ALTER TABLE ""PurchaseInvoiceLines"" ADD COLUMN IF NOT EXISTS ""CurrencyUnitPrice"" numeric(18,4) NOT NULL DEFAULT 0;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='Virmans') THEN
    ALTER TABLE ""Virmans"" ADD COLUMN IF NOT EXISTS ""CurrencyTypeId"" integer NOT NULL DEFAULT 0;
    ALTER TABLE ""Virmans"" ADD COLUMN IF NOT EXISTS ""ExchangeRate"" numeric(18,6) NOT NULL DEFAULT 1;
  END IF;
  -- GARANTİ KAYDI PARA BİRİMİ (2026-08-15).
  -- Tutarlar ürünün satış fiyatından geliyor ve o fiyat dolar olabiliyor; para birimi
  -- yazılmadığı için dolar bir garanti kaydı ekranda ₺ görünüyor ve KPI toplamına
  -- TL gibi giriyordu. Eski satırlar için varsayılan 1 (TL) — davranış değişmez.
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='WarrantyRecords') THEN
    ALTER TABLE ""WarrantyRecords"" ADD COLUMN IF NOT EXISTS ""CurrencyTypeId"" integer NOT NULL DEFAULT 1;
    ALTER TABLE ""WarrantyRecords"" ADD COLUMN IF NOT EXISTS ""CurrencyRate"" numeric(18,6) NOT NULL DEFAULT 1;
  END IF;
  -- PLANLAYICI TUZAGI (2026-08-23). Bu information_schema kontrolleri KORUMA SANILIYORDU ama
  -- korumuyorlardi: PostgreSQL IF kosulunun TAMAMINI once PLANLAR, sonra calistirir. AND kisa
  -- devre yapsa bile asagidaki ""NumberSeries"" gondermesi plan asamasinda cozulmek zorunda;
  -- tablo yoksa 42P01 firlar. Yani kosul 'yanlis' diye atlanmaz, kosulun KENDISI patlar.
  -- 2026-08-21'de canli ERP'yi tamamen durduran zincirin koku buydu: acilis blogu burada olup
  -- kendisinden sonraki BUTUN DDL'leri atliyordu. Cozum: tablo varligi DIS IF'te sorulur,
  -- tabloya gonderme ancak IC IF'te - varligi bilindikten sonra - planlanir.
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='Products')
     AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='NumberSeries') THEN
    IF NOT EXISTS (SELECT 1 FROM ""NumberSeries"" WHERE ""Key"" = 'migration:productcurrency-v2') THEN
      UPDATE ""Products"" SET ""CurrencyCode"" = CASE ""CurrencyCode""
        WHEN 43 THEN 3   -- USD
        WHEN 3  THEN 4   -- GBP
        WHEN 0  THEN 1   -- TL
        ELSE ""CurrencyCode""   -- 2 = EUR değişmiyor
      END;
      INSERT INTO ""NumberSeries"" (""Key"", ""LastValue"") VALUES ('migration:productcurrency-v2', 1);
    END IF;
  END IF;
  -- KALEM BAZLI ÇIKIŞ DEPOSU (kullanıcı kuralı, 2026-08-13).
  --
  -- Servisten gelen fatura kalemleri, işlemi yapan teknisyenin ARAÇ deposundan çıkmak zorunda;
  -- faturayı imzalayan kişinin deposundan değil. Fatura başlığındaki tek depo bunu ifade
  -- edemiyordu. `SalesOrderLines.SourceWarehouseCode` servisin damgaladığı öntanımlı depo,
  -- `InvoiceLines.WarehouseCode` ise stoğun fiilen düştüğü depo — fatura silinince iade de
  -- oradan okunuyor.
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='SalesOrderLines') THEN
    ALTER TABLE ""SalesOrderLines"" ADD COLUMN IF NOT EXISTS ""SourceWarehouseCode"" integer NULL;
    ALTER TABLE ""SalesOrderLines"" ADD COLUMN IF NOT EXISTS ""ServicePerformerName"" character varying(200) NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='InvoiceLines') THEN
    ALTER TABLE ""InvoiceLines"" ADD COLUMN IF NOT EXISTS ""WarehouseCode"" integer NULL;
  END IF;
  -- Rol bazlı kampanya anahtarı (2026-08-11). Varsayılan AÇIK: mevcut roller davranış
  -- değiştirmemeli. Kurumsal rolü kullanıcı isteğiyle kapalı başlatılıyor ve bu yalnızca
  -- sütun İLK kez oluşturulurken yapılır — sonradan elle açılırsa her açılışta geri kapanmasın.
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'Roles'
  ) THEN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'Roles' AND column_name = 'CampaignsEnabled'
    ) THEN
      ALTER TABLE ""Roles"" ADD COLUMN ""CampaignsEnabled"" boolean NOT NULL DEFAULT TRUE;
      UPDATE ""Roles"" SET ""CampaignsEnabled"" = FALSE WHERE lower(""Code"") = 'kurumsal';
    END IF;
    -- Limit aşımıyla sipariş onayı (2026-10-14): rol bazlı, varsayılan KAPALI.
    ALTER TABLE ""Roles"" ADD COLUMN IF NOT EXISTS ""OverLimitApprovalEnabled"" boolean NOT NULL DEFAULT FALSE;
  END IF;
  -- Kampanya e-ticaret anahtari (2026-09-19): B2B kampanyasi vitrine ancak bu acikken gider.
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='Campaigns') THEN
    ALTER TABLE ""Campaigns"" ADD COLUMN IF NOT EXISTS ""EcommerceEnabled"" boolean NOT NULL DEFAULT FALSE;
  END IF;
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = '__EFMigrationsHistory'
  ) THEN
    INSERT INTO ""__EFMigrationsHistory"" (""MigrationId"", ""ProductVersion"")
    VALUES ('20260627172222_AddInvoiceIsManuallyPaid', '8.0.0')
    ON CONFLICT (""MigrationId"") DO NOTHING;
  END IF;
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'PurchaseInvoices' AND column_name = 'CashAccountId'
  ) AND EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = '__EFMigrationsHistory'
  ) THEN
    INSERT INTO ""__EFMigrationsHistory"" (""MigrationId"", ""ProductVersion"")
    VALUES ('20260711225100_AddBankAccountTransactionIndexes', '8.0.0')
    ON CONFLICT (""MigrationId"") DO NOTHING;
  END IF;
END $$;
");

    // Drop the unique index temporarily to prevent unique key violations during auto-incremented seed reordering
    try
    {
        await db.Database.ExecuteSqlRawAsync(@"DROP INDEX IF EXISTS ""IX_Pages_ModuleKey_Key"";");
    }
    catch {}

    try
    {
        await db.Database.ExecuteSqlRawAsync(@"ALTER TABLE ""DeletionLogs"" ALTER COLUMN ""DetailsJson"" TYPE text;");
        await db.Database.ExecuteSqlRawAsync(@"ALTER TABLE ""UserActivityLogs"" ALTER COLUMN ""DetailsJson"" TYPE text;");
    }
    catch {}

    // Silme nedeni (2026-10-04). Ayrı try: yukarıdaki tip değişikliği düşse bile kolon eklensin.
    try
    {
        await db.Database.ExecuteSqlRawAsync(@"ALTER TABLE ""DeletionLogs"" ADD COLUMN IF NOT EXISTS ""Reason"" character varying(1000) NULL;");
    }
    catch {}

    // Ürüne özel kampanyalı fiyat (2026-10-07). Ayrı try: başka bir DDL düşse bile kolon eklensin.
    try
    {
        await db.Database.ExecuteSqlRawAsync(@"ALTER TABLE ""CampaignDiscounts"" ADD COLUMN IF NOT EXISTS ""HedefFiyat"" numeric(18,4) NULL;");
    }
    catch {}

    await db.Database.MigrateAsync();
    await BackfillDriftColumnsAsync(db, "varsayilan");
    await BackfillModelSchemaAsync(db, "varsayilan");


    await SealProductCurrencyMigrationForFreshDatabaseAsync(db);

    // Ensure PriceGroup Code 7 (Askeriye Tipi Fatura) exists in database
    try
    {
        var pg7 = await db.PriceGroups.FirstOrDefaultAsync(x => x.Code == 7);
        if (pg7 == null)
        {
            db.PriceGroups.Add(new PriceGroup
            {
                Id = new Guid("77777777-7777-7777-7777-777777777777"),
                Code = 7,
                Name = "Askeriye Tipi Fatura",
                Formula = "REMOVE_KDV(F4*(1-DISCOUNT/100))",
                InvoiceType = "ASKERIYE",
                SortOrder = 7,
                IsActive = true
            });
            await db.SaveChangesAsync();
        }
        else if (pg7.InvoiceType != "ASKERIYE")
        {
            pg7.InvoiceType = "ASKERIYE";
            await db.SaveChangesAsync();
        }

        try
        {
            await db.Database.ExecuteSqlRawAsync(@"
                -- ASKERIYE GERIYE DONUK YAZMA KALDIRILDI (2026-08-23).
                --
                -- Buradaki sekiz UPDATE her acilista kosulsuz calisiyordu ve iki ayri hata
                -- iceriyordu:
                --  1) Cari tipini ADINDAN turetiyordu (%TUGAY% %KOLORDU% %KOMUTAN%) ve fiyat
                --     grubu 7 uyeligini KDV muafiyeti sayiyordu. Adinda Tugay gecen bir bayi
                --     sessizce KDV siz sinifina duserdi. Cari tipi cari ekraninda atanir.
                --  2) KESILMIS faturayi geriye donuk yeniden yaziyordu: VatTotal=0,
                --     GrandTotal=NetTotal ve ekstre tutari. Fatura mali belgedir; kesildigi
                --     andaki degeriyle kalir.
                --
                -- Normal akis zaten dogru calisiyor: InvoicesController / SalesOrdersController
                -- fatura keserken Customers.InvoiceType degerine bakiyor. Bu blok tek seferlik
                -- bir geriye donuk doldurmaydi, nobetci kaydina baglanmadigi icin aylardir her
                -- acilista tekrar calisiyordu.
                --
                -- Asagidaki iki ifade KALDI: fiyat grubunun kendi tanimi ve grup 7 fiyat
                -- satirlarinin tohumlanmasi. Ikisi de vergiye dokunmuyor ve idempotent.
                UPDATE ""PriceGroups"" SET ""InvoiceType"" = 'ASKERIYE' WHERE ""Code"" = 7;
                -- ""ProductPrices"" tablosunda ""IsActive""/""CreateUser""/""CreateTime"" kolonlari YOK
                -- (2026-09-05 denetimi): asagidaki INSERT bu yuzden ""column does not exist"" ile
                -- HER ACILISTA sessizce patliyordu (dis try/catch yutuyordu) ve yeni urunler grup 7
                -- (ASKERIYE) fiyati hic almiyordu. Kolon listesi gercek semaya indirildi.
                INSERT INTO ""ProductPrices"" (""Id"", ""ProductId"", ""PriceGroupId"", ""Price"", ""Currency"")
                SELECT gen_random_uuid(), p.""Id"", (SELECT ""Id"" FROM ""PriceGroups"" WHERE ""Code"" = 7 LIMIT 1), COALESCE((SELECT pp.""Price"" FROM ""ProductPrices"" pp JOIN ""PriceGroups"" pg ON pp.""PriceGroupId"" = pg.""Id"" WHERE pp.""ProductId"" = p.""Id"" AND pg.""Code"" = 3 LIMIT 1), (SELECT pp.""Price"" FROM ""ProductPrices"" pp JOIN ""PriceGroups"" pg ON pp.""PriceGroupId"" = pg.""Id"" WHERE pp.""ProductId"" = p.""Id"" AND pg.""Code"" = 1 LIMIT 1), p.""PurchasePrice"", 0), COALESCE((SELECT pp.""Currency"" FROM ""ProductPrices"" pp JOIN ""PriceGroups"" pg ON pp.""PriceGroupId"" = pg.""Id"" WHERE pp.""ProductId"" = p.""Id"" AND pg.""Code"" = 3 LIMIT 1), 'TRY') FROM ""Products"" p WHERE (SELECT ""Id"" FROM ""PriceGroups"" WHERE ""Code"" = 7 LIMIT 1) IS NOT NULL AND NOT EXISTS (SELECT 1 FROM ""ProductPrices"" pp2 WHERE pp2.""ProductId"" = p.""Id"" AND pp2.""PriceGroupId"" = (SELECT ""Id"" FROM ""PriceGroups"" WHERE ""Code"" = 7 LIMIT 1));
            ");
        }
        catch {}
    }
    catch
    {
        // ignore
    }

    // Clean up duplicate pages automatically before recreating the unique index (safely resolving shifted auto-incremented IDs)
    try
    {
        var allPages = await db.Pages.ToListAsync();
        var duplicates = allPages
            .GroupBy(p => new { p.ModuleKey, p.Key })
            .Where(g => g.Count() > 1)
            .ToList();

        if (duplicates.Any())
        {
            var pagesToDelete = new List<Page>();
            foreach (var g in duplicates)
            {
                var pageIds = g.Select(p => p.Id).ToList();
                var permCounts = await db.RolePagePermissions
                    .Where(rp => pageIds.Contains(rp.PageId))
                    .GroupBy(rp => rp.PageId)
                    .Select(group => new { PageId = group.Key, Count = group.Count() })
                    .ToDictionaryAsync(x => x.PageId, x => x.Count);

                var sorted = g.OrderByDescending(p => permCounts.GetValueOrDefault(p.Id, 0))
                             .ThenBy(p => p.Id)
                             .ToList();

                // Keep the first one (most permissions, then lowest ID), delete the rest
                pagesToDelete.AddRange(sorted.Skip(1));
            }

            if (pagesToDelete.Any())
            {
                db.Pages.RemoveRange(pagesToDelete);
                await db.SaveChangesAsync();
            }
        }
    }
    catch (Exception ex)
    {
        Console.WriteLine($"[WARN] Error cleaning duplicate pages: {ex.Message}");
    }

    // Recreate the unique index once migration and seeding updates are complete
    try
    {
        await db.Database.ExecuteSqlRawAsync(@"CREATE UNIQUE INDEX IF NOT EXISTS ""IX_Pages_ModuleKey_Key"" ON ""Pages"" (""ModuleKey"", ""Key"");");
    }
    catch
    {
        // ignore
    }

    await db.Database.ExecuteSqlRawAsync(@"
DELETE FROM ""RolePagePermissions"" WHERE ""PageId"" IN (SELECT ""Id"" FROM ""Pages"" WHERE ""ModuleKey""='invoice' AND ""Key""='etiket');
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='TenantEnabledPages') THEN
    DELETE FROM ""TenantEnabledPages"" WHERE ""PageId"" IN (SELECT ""Id"" FROM ""Pages"" WHERE ""ModuleKey""='invoice' AND ""Key""='etiket');
  END IF;
END $$;
DELETE FROM ""Pages"" WHERE ""ModuleKey""='invoice' AND ""Key""='etiket';

INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 160, 'Etiket Basım (Fiyatlı)', TRUE, 'etiketFiyatli', 'invoice', 6
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""ModuleKey""='invoice' AND ""Key""='etiketFiyatli')
  AND NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id""=160);

INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 161, 'Etiket Basım (Fiyatsız)', TRUE, 'etiketFiyatsiz', 'invoice', 7
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""ModuleKey""='invoice' AND ""Key""='etiketFiyatsiz')
  AND NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id""=161);

INSERT INTO ""RolePagePermissions"" (""RoleId"", ""PageId"", ""CanAccess"")
SELECT r.""Id"", p.""Id"", TRUE
FROM ""Roles"" r
CROSS JOIN ""Pages"" p
WHERE p.""Key"" IN ('etiketFiyatli', 'etiketFiyatsiz')
AND NOT EXISTS (
    SELECT 1 FROM ""RolePagePermissions"" rpp WHERE rpp.""RoleId"" = r.""Id"" AND rpp.""PageId"" = p.""Id""
);

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='TenantEnabledPages') THEN
    INSERT INTO ""TenantEnabledPages"" (""TenantId"", ""PageId"", ""IsEnabled"")
    SELECT t.""Id"", p.""Id"", TRUE
    FROM ""Tenants"" t
    CROSS JOIN ""Pages"" p
    WHERE p.""Key"" IN ('etiketFiyatli', 'etiketFiyatsiz')
    AND NOT EXISTS (
        SELECT 1 FROM ""TenantEnabledPages"" tep WHERE tep.""TenantId"" = t.""Id"" AND tep.""PageId"" = p.""Id""
    );
  END IF;
END $$;
");

    // Drift fix: Ensure PurchaseInvoices has TerminStatus (added in AddTerminStatusToPurchaseInvoices migration).
    await db.Database.ExecuteSqlRawAsync(@"
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'PurchaseInvoices'
  ) THEN
    ALTER TABLE ""PurchaseInvoices"" ADD COLUMN IF NOT EXISTS ""TerminStatus"" integer NOT NULL DEFAULT 0;
    ALTER TABLE ""PurchaseInvoices"" ADD COLUMN IF NOT EXISTS ""CashAccountId"" integer NULL;
  END IF;
  -- Employees: ensure WorkPermitRenewalFee and WorkType exist
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'Employees'
  ) THEN
    ALTER TABLE ""Employees"" ADD COLUMN IF NOT EXISTS ""WorkPermitRenewalFee"" numeric(18,2) NOT NULL DEFAULT 0;
    ALTER TABLE ""Employees"" ADD COLUMN IF NOT EXISTS ""WorkType"" character varying(80) NULL;
  END IF;
  -- InvoiceLines: satirin MAL/HIZMET niteligi (denetim md. E3). 0 = damgalanmamis eski satir.
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'InvoiceLines'
  ) THEN
    ALTER TABLE ""InvoiceLines"" ADD COLUMN IF NOT EXISTS ""Nature"" integer NOT NULL DEFAULT 0;
  END IF;
  -- Alis faturasi satirinin MAL/HIZMET nitelIgi (2026-09-18). Hizmet satiri stok hareketi
  -- yazmaz ve hizmet harcama raporu bu kolondan gruplanir.
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='PurchaseInvoiceLines') THEN
    ALTER TABLE ""PurchaseInvoiceLines"" ADD COLUMN IF NOT EXISTS ""Nature"" integer NOT NULL DEFAULT 0;

    /*
      GERIYE DONUK DAMGA (2026-09-18 kullanici istegi: eski alis satirlarini da doldur).

      Kolon yeni; eski satirlarin hepsi 0 (Unspecified) kaldi ve hizmet harcama raporu
      onlari hic gormuyordu. Damga BIR KEZ atilir: asagisi yalnizca `Nature = 0` satirlara
      dokunur, ikinci acilista 0 satir gunceller.

      Kural, kesim anindaki damga ile AYNI (AppDbContext.StampPurchaseInvoiceLineNaturesAsync):
      urun karti ACIKCA hizmet tipindeyse (HIZMET/SERVIS) hizmet, gerisi mal. Alista
      'karti yok = hizmet' kurali UYGULANMAZ; kartsiz satir cogu zaman henuz acilmamis bir
      MAL kartidir, hepsini hizmet saymak raporu sisirirdi.

      Eslesme STOK KODU uzerinden (ProductId degil): eski satirlarda ProductId bos olabiliyor
      ama stok kodu yaziliyor. Buyuk/kucuk harf ayrimi yok, damgalama kodu da oyle.
    */
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='Products') THEN
      UPDATE ""PurchaseInvoiceLines"" l
         SET ""Nature"" = 2
        FROM ""Products"" p
       WHERE l.""Nature"" = 0
         AND p.""ProductType"" IS NOT NULL
         AND upper(btrim(p.""StockCode"")) = upper(btrim(l.""StockCode""))
         AND btrim(p.""ProductType"") ILIKE ANY (ARRAY['HIZMET', 'HİZMET', 'SERVIS', 'SERVİS']);
    END IF;

    -- Hizmet KATALOGUNDAN (HIZ-NAKLIYE, HIZ-ELEKTRIK...) gelen satirlar da hizmettir.
    -- Bu kodlarin Products'ta karsiligi yoktur; yukaridaki kural onlari yakalamaz.
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='ServiceCatalogItems') THEN
      UPDATE ""PurchaseInvoiceLines"" l
         SET ""Nature"" = 2
        FROM ""ServiceCatalogItems"" sc
       WHERE l.""Nature"" = 0
         AND upper(btrim(sc.""Code"")) = upper(btrim(l.""StockCode""));
    END IF;

    -- Geriye kalan her sey MAL.
    UPDATE ""PurchaseInvoiceLines"" SET ""Nature"" = 1 WHERE ""Nature"" = 0;
  END IF;
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'Users'
  ) THEN
    ALTER TABLE ""Users"" ADD COLUMN IF NOT EXISTS ""DefaultCashAccountId"" integer NULL;
    ALTER TABLE ""Users"" ADD COLUMN IF NOT EXISTS ""DefaultBankAccountId"" integer NULL;
    -- CALISAN YONETIMI ERISIMI (2026-08-23). ERP kullanicisinin personel portalina YONETICI
    -- olarak girmesini acar. ServiceOpsAccess'ten farki: super admin bypass'i YOK, bu kutu
    -- isaretlenmeden kimse giremez. Varsayilan FALSE = herkese kapali dogar.
    ALTER TABLE ""Users"" ADD COLUMN IF NOT EXISTS ""EmployeeAccess"" boolean NOT NULL DEFAULT FALSE;
    ALTER TABLE ""Users"" ADD COLUMN IF NOT EXISTS ""AsistanAccess"" boolean NOT NULL DEFAULT FALSE;
    ALTER TABLE ""Users"" ADD COLUMN IF NOT EXISTS ""CariEkstreTipleri"" character varying(200) NULL;
  END IF;
  -- NESTPAY MAGAZA TIPI (2026-08-23). `storetype` koda gomuluydu (3D_PAY_HOSTING).
  -- Creditwest CardPlus uye isyeri, isyeri kullanim tipi desteklenmiyor diye 18/18 reddetti;
  -- banka hangi modelde oldugunu soyledigi anda YENI DERLEME BEKLEMEDEN degisebilmeli.
  -- Varsayilan mevcut davranisin aynisi, yani hicbir POS'un davranisi degismez.
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'VirtualPosDefinitions'
  ) THEN
    ALTER TABLE ""VirtualPosDefinitions"" ADD COLUMN IF NOT EXISTS ""StoreType"" character varying(40) NOT NULL DEFAULT '3D_PAY_HOSTING';
  END IF;
  -- Kampanya indirimlerinin fiyat gruplari (2026-08-12).
  -- Eskiden CampaignDiscounts.IskontoFiyat1..6 diye SABIT ALTI KOLONDU; fiyat gruplari ise
  -- veritabanindan yonetiliyor ve 6'dan fazla olabiliyor (7 = Askeriye Tipi Fatura).
  -- Yedinci grup uclardaki 1..6 suzgecine takilip sessizce dusuyordu.
  --
  -- DIKKAT: bu blok MigrateAsync'ten ONCE calisir. Migration zinciri kirik tenant'larda
  -- MigrateAsync sonrasindaki drift-fix'lere hic ulasilmiyor; tabloyu oraya koyarsan
  -- o tenant'larda hic olusmaz. Ayrica bu blogun IKI KOPYASI var (ana DB + tenant
  -- dongusu pre-flight); birini guncelleyip digerini unutma.
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='CampaignDiscounts') THEN
    CREATE TABLE IF NOT EXISTS ""CampaignDiscountPriceGroups"" (
      ""Id"" uuid NOT NULL,
      ""CampaignDiscountId"" uuid NOT NULL,
      ""PriceGroupCode"" integer NOT NULL,
      ""Deger"" numeric(18,4) NOT NULL,
      ""IsDeleted"" boolean NOT NULL DEFAULT FALSE,
      ""CreateUser"" character varying(50) NOT NULL DEFAULT '',
      ""CreateTime"" timestamp with time zone NOT NULL DEFAULT now(),
      ""EditUser"" character varying(50) NULL,
      ""EditTime"" timestamp with time zone NULL,
      CONSTRAINT ""PK_CampaignDiscountPriceGroups"" PRIMARY KEY (""Id""),
      CONSTRAINT ""FK_CampaignDiscountPriceGroups_CampaignDiscounts"" FOREIGN KEY (""CampaignDiscountId"")
        REFERENCES ""CampaignDiscounts"" (""Id"") ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS ""IX_CampaignDiscountPriceGroups_CampaignDiscountId""
      ON ""CampaignDiscountPriceGroups"" (""CampaignDiscountId"");
    CREATE UNIQUE INDEX IF NOT EXISTS ""IX_CampaignDiscountPriceGroups_Discount_Code""
      ON ""CampaignDiscountPriceGroups"" (""CampaignDiscountId"", ""PriceGroupCode"");

    -- Mevcut kayitlari eski kolonlardan tasi. TEK SEFERLIK: yalnizca hic satiri olmayan
    -- indirimler icin calisir, yoksa ekrandan yapilan degisiklik her acilista geri alinirdi.
    INSERT INTO ""CampaignDiscountPriceGroups""
      (""Id"", ""CampaignDiscountId"", ""PriceGroupCode"", ""Deger"", ""IsDeleted"", ""CreateUser"", ""CreateTime"")
    SELECT gen_random_uuid(), d.""Id"", v.code, v.deger, FALSE, 'schema-migration', now()
    FROM ""CampaignDiscounts"" d
    CROSS JOIN LATERAL (VALUES
      (1, d.""IskontoFiyat1""), (2, d.""IskontoFiyat2""), (3, d.""IskontoFiyat3""),
      (4, d.""IskontoFiyat4""), (5, d.""IskontoFiyat5""), (6, d.""IskontoFiyat6"")
    ) AS v(code, deger)
    WHERE v.deger IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM ""CampaignDiscountPriceGroups"" x WHERE x.""CampaignDiscountId"" = d.""Id""
      );
  END IF;
  -- Toplu Fiyat Atama sayfasi (2026-08-12).
  -- PageConfiguration.HasData yalnizca MIGRATION ile isler; migration zinciri kirik
  -- tenant'larda sayfa hic olusmuyor. Bu yuzden burada da idempotent ekleniyor.
  -- Kimlik PageConfiguration'daki AddFixedId(700, ...) ile AYNI olmali, yoksa iki yol
  -- farkli kimlik uretir ve RolePagePermissions yanlis satira baglanir.
  -- Hicbir role acilmiyor: yalnizca SuperAdmin gorur (koddaki bypass sayesinde).
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='Pages') THEN
    INSERT INTO ""Pages"" (""Id"", ""ModuleKey"", ""Key"", ""DisplayName"", ""SortOrder"", ""IsActive"")
    SELECT 700, 'users', 'topluFiyatAtama', 'Toplu Fiyat Atama', 22, TRUE
    WHERE NOT EXISTS (
      SELECT 1 FROM ""Pages"" WHERE ""ModuleKey""='users' AND ""Key""='topluFiyatAtama'
    )
    AND NOT EXISTS (
      SELECT 1 FROM ""Pages"" WHERE ""Id""=700
    );

    -- Sistem Denetimi + Kataloglar (2026-09-13). Ayni kural: kimlik PageConfiguration'daki
    -- AddFixedId(701/702, ...) ile AYNI. Varsayilan HICBIR role acilmiyor; kullanici Rol
    -- Yetkileri'nden istedigi role sonradan acar. Yalniz SuperAdmin ROLUNE (IsSuperAdmin=true)
    -- ve SSA'ya (kod tarafinda ayri bypass, RolePagePermissions'a hic ihtiyaci yok) acik.
    INSERT INTO ""Pages"" (""Id"", ""ModuleKey"", ""Key"", ""DisplayName"", ""SortOrder"", ""IsActive"")
    SELECT 701, 'users', 'sistemDenetimi', 'Sistem Denetimi', 23, TRUE
    WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""ModuleKey""='users' AND ""Key""='sistemDenetimi')
      AND NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id""=701);

    INSERT INTO ""Pages"" (""Id"", ""ModuleKey"", ""Key"", ""DisplayName"", ""SortOrder"", ""IsActive"")
    SELECT 702, 'eticaret', 'kataloglar', 'Kataloglar', 7, TRUE
    WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""ModuleKey""='eticaret' AND ""Key""='kataloglar')
      AND NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id""=702);

    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='RolePagePermissions')
       AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='Roles' AND column_name='IsSuperAdmin')
    THEN
      -- E-TICARET SAYFALARI (2026-09-21): tek 'Vitrin Yonetimi' formu ayri sayfalara dagitildi.
      -- Kim 'vitrin'(5200) sayfasini gorebiliyorsa yeni sayfalari da gorur (kimse erisim kaybetmesin);
      -- kampanyalar/arama sekmeleri Pages'te HIC yoktu (yalniz SSA goruyordu) — artik rol yetkisinde.
      UPDATE ""Pages"" SET ""DisplayName"" = 'Anasayfa & Vitrin', ""SortOrder"" = 10 WHERE ""ModuleKey"" = 'eticaret' AND ""Key"" = 'vitrin' AND ""DisplayName"" = 'Vitrin Yönetimi';
      UPDATE ""Pages"" SET ""DisplayName"" = 'Ürün Yönetimi' WHERE ""ModuleKey"" = 'eticaret' AND ""Key"" = 'urunYayin' AND ""DisplayName"" = 'Ürün Yayını';

      INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
      SELECT 5207, 'Vitrin Kategorileri', TRUE, 'kategoriler', 'eticaret', 9
      WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id"" = 5207 OR (""ModuleKey"" = 'eticaret' AND ""Key"" = 'kategoriler'));

      INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
      SELECT 5208, 'Firma & İletişim', TRUE, 'firmaBilgileri', 'eticaret', 11
      WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id"" = 5208 OR (""ModuleKey"" = 'eticaret' AND ""Key"" = 'firmaBilgileri'));

      INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
      SELECT 5209, 'Ödeme & Havale', TRUE, 'odeme', 'eticaret', 12
      WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id"" = 5209 OR (""ModuleKey"" = 'eticaret' AND ""Key"" = 'odeme'));

      INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
      SELECT 5210, 'Pazarlama & Güven', TRUE, 'pazarlama', 'eticaret', 13
      WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id"" = 5210 OR (""ModuleKey"" = 'eticaret' AND ""Key"" = 'pazarlama'));

      INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
      SELECT 5211, 'E-Ticaret Kampanyaları', TRUE, 'kampanyalar', 'eticaret', 4
      WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id"" = 5211 OR (""ModuleKey"" = 'eticaret' AND ""Key"" = 'kampanyalar'));

      INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
      SELECT 5212, 'Talep Raporu', TRUE, 'arama', 'eticaret', 5
      WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id"" = 5212 OR (""ModuleKey"" = 'eticaret' AND ""Key"" = 'arama'));

      INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
      SELECT 5213, 'Ziyaret Analizi', TRUE, 'analitik', 'eticaret', 6
      WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id"" = 5213 OR (""ModuleKey"" = 'eticaret' AND ""Key"" = 'analitik'));

      INSERT INTO ""RolePagePermissions"" (""RoleId"", ""PageId"", ""CanAccess"")
      SELECT rp.""RoleId"", p.""Id"", TRUE
      FROM ""RolePagePermissions"" rp
      JOIN ""Pages"" v ON v.""Id"" = rp.""PageId"" AND v.""ModuleKey"" = 'eticaret' AND v.""Key"" = 'vitrin'
      CROSS JOIN ""Pages"" p
      WHERE rp.""CanAccess"" = TRUE AND p.""Id"" IN (5207,5208,5209,5210,5211,5212)
      ON CONFLICT (""RoleId"", ""PageId"") DO NOTHING;

      INSERT INTO ""RolePagePermissions"" (""RoleId"", ""PageId"", ""CanAccess"")
      SELECT r.""Id"", p.""Id"", TRUE
      FROM ""Roles"" r CROSS JOIN ""Pages"" p
      WHERE r.""IsSuperAdmin"" = TRUE AND p.""Id"" IN (5207,5208,5209,5210,5211,5212)
      ON CONFLICT (""RoleId"", ""PageId"") DO NOTHING;
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='RolePagePermissions')
       AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='Roles')
       AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='Roles' AND column_name='IsSuperAdmin')
    THEN
      INSERT INTO ""RolePagePermissions"" (""RoleId"", ""PageId"", ""CanAccess"")
      SELECT r.""Id"", p.""Id"", TRUE
      FROM ""Roles"" r
      CROSS JOIN ""Pages"" p
      WHERE r.""IsSuperAdmin"" = TRUE AND p.""Id"" IN (701, 702)
      ON CONFLICT (""RoleId"", ""PageId"") DO NOTHING;
    END IF;
  END IF;
  -- Urun fiyat gecmisi (2026-08-12). ProductPrices yalnizca GUNCEL fiyati tutuyor ve
  -- uzerine yaziliyor; gecmis hicbir yerde yoktu. Mevcut tabloya DOKUNULMADI.
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='Products') THEN
    CREATE TABLE IF NOT EXISTS ""ProductPriceHistories"" (
      ""Id"" uuid NOT NULL,
      ""ProductId"" uuid NOT NULL,
      ""StockCode"" character varying(50) NOT NULL,
      ""PriceGroupCode"" integer NOT NULL,
      ""OldPrice"" numeric(18,2) NOT NULL,
      ""NewPrice"" numeric(18,2) NOT NULL,
      ""ChangeRate"" numeric(18,6) NULL,
      ""ChangedAt"" timestamp with time zone NOT NULL DEFAULT now(),
      ""ChangedBy"" character varying(100) NOT NULL DEFAULT '',
      ""Source"" character varying(50) NOT NULL DEFAULT '',
      CONSTRAINT ""PK_ProductPriceHistories"" PRIMARY KEY (""Id"")
    );
    CREATE INDEX IF NOT EXISTS ""IX_ProductPriceHistories_Product_Group_Date""
      ON ""ProductPriceHistories"" (""ProductId"", ""PriceGroupCode"", ""ChangedAt"");
  END IF;
  CREATE TABLE IF NOT EXISTS ""UserCashAccounts"" (
    ""UserId"" integer NOT NULL,
    ""CashAccountId"" integer NOT NULL,
    PRIMARY KEY (""UserId"", ""CashAccountId"")
  );
  CREATE TABLE IF NOT EXISTS ""UserBankAccounts"" (
    ""UserId"" integer NOT NULL,
    ""BankAccountId"" integer NOT NULL,
    PRIMARY KEY (""UserId"", ""BankAccountId"")
  );
END $$;
");

    // E-ticaret siparişi ↔ sanal POS tahsilatı bağı. Firma veritabanlarına
    // TenantConnectionStringResolver kuruyor; burası varsayılan veritabanı için.
    await db.Database.ExecuteSqlRawAsync(B2B.Erp.Api.Data.Services.EcommerceSchema.EcommerceOrderPaymentsDdl);

    // Taksitli krediler — aynı şekilde: firma veritabanlarına resolver, burası varsayılan için.
    await db.Database.ExecuteSqlRawAsync(B2B.Erp.Api.Data.Services.LoanSchema.LoansDdl);

    // Garanti değişim (tablolar + 3 sayfa + rol yetkileri) — aynı şekilde.
    await db.Database.ExecuteSqlRawAsync(B2B.Erp.Api.Data.Services.WarrantyExchangeSchema.WarrantyExchangeDdl);

    // Fatura Takip (tablolar + sayfalar + superadmin yetkisi) — aynı şekilde.
    await db.Database.ExecuteSqlRawAsync(B2B.Erp.Api.Data.Services.InvoiceTrackingSchema.InvoiceTrackingDdl);

    // Silme Ayarları: kasa/banka/çek/depo/sipariş 24 saat düğmeleri (yalnız sayfa, yetki satırı yok).
    await db.Database.ExecuteSqlRawAsync(B2B.Erp.Api.Data.Services.DeleteRuleSchema.DeleteRuleDdl);

    // Sonradan eklenen sayfa yetkileri (yalnız sayfa, yetki satırı yok).
    await db.Database.ExecuteSqlRawAsync(B2B.Erp.Api.Data.Services.AddedPagesSchema.AddedPagesDdl);

    // Banka masrafları (masraf türü kolonu + sayfa + rol yetkileri) — aynı şekilde.
    await db.Database.ExecuteSqlRawAsync(B2B.Erp.Api.Data.Services.BankExpenseSchema.BankExpenseDdl);

    // superadmin sayfa yetkisi telafisi. Sonradan eklenen sayfalar Pages'e yazılıyor ama
    // hiçbir role yetki satırı açılmıyordu; superadmin'in sayfa kontrolünü atlayan bir
    // bypass'ı OLMADIĞI için o ekranlar ona da 403 "Yetkiniz yok" dönüyordu.
    // Yardımcı bir tohumlama açılışı düşürmemeli — hata log'a yazılıp geçiliyor.
    try
    {
        await db.Database.ExecuteSqlRawAsync(B2B.Erp.Api.Data.Services.SuperAdminPageAccessSchema.BackfillSql);
    }
    catch (Exception ex)
    {
        Console.WriteLine($"[SuperAdminPageAccess] varsayılan veritabanı telafisi atlandı: {ex.Message}");
    }
}
catch (Exception ex)
{
    Console.Error.WriteLine("[WARN] Startup schema ensure failed (varsayilan veritabani bolumu): " + ex);
}

// BLOK IKIYE AYRILDI (2026-08-23).
//
// Eskiden varsayilan veritabani DDL leri ile kiraci dongusu TEK bir try icindeydi. Varsayilan
// veritabani (b2b_erp) semasi kurulu olmadigi icin blok ilk eksik tabloda oluyor ve kendisinden
// sonraki HER SEYI atliyordu: kiraci dongusu 18+ acilis boyunca hic calismadi, canli kiraci
// migration ve drift-fix almadi, yeni sayfa yetkileri kendiliginden eklenmedi.
//
// Artik iki bolum bagimsiz: varsayilan veritabani ne durumda olursa olsun kiraci dongusu
// calisir. Ayrica hatalar ayri ayri log a duser, boylece bir acilista hepsi birden gorulur.
try
{
    using var tenantScope = app.Services.CreateScope();
    var masterDb = tenantScope.ServiceProvider.GetRequiredService<MasterDbContext>();
    var vposLogger = tenantScope.ServiceProvider.GetRequiredService<ILoggerFactory>().CreateLogger("VirtualPosSeeder");
    try
    {
        var baseConnStr = builder.Configuration.GetConnectionString("DefaultConnection") ?? string.Empty;
        if (!string.IsNullOrWhiteSpace(baseConnStr))
        {
            var keysToEnable = new List<(string ModuleKey, string Key)>
            {
                ("invoice", "etiketFiyatli"),
                ("invoice", "etiketFiyatsiz"),
                ("invoice", "irsaliyeQuantityEdit"),
                ("invoice", "irsaliyeShippedQuantityEdit"),
                ("invoice", "irsaliyeStatusOnaylandi"),
                ("invoice", "irsaliyeStatusSevkEdildi"),
                ("invoice", "bayiTeklifleri"),
                ("invoice", "cariTeklifleri"),
                ("invoice", "cariTeklifleriTumu"),
                ("invoice", "termin"),
                ("invoice", "bsyHHide"),
                ("invoice", "bsyHComingSoon"),
                ("invoice", "stokYokSiparis"),
                ("invoice", "musteriTeklifiSinirsizIndirim"),
                ("invoice", "satisFaturaDepoBakiyeGorsun"),
                ("invoice", "satisFaturaOdemeAl"),
                ("invoice", "satisFaturaProformaGorsun"),
                ("invoice", "satisFaturaSiparisGorsun"),
                ("invoice", "satisFaturaMagazaSiparisGorsun"),
                ("invoice", "satisFaturaServisGorsun"),
                ("invoice", "satisFaturaKonsinyeGorsun"),
                ("invoice", "faturaDokumUstBilgiGuncelle"),
                ("invoice", "proformaFaturaDokumeAktar"),
                ("invoice", "proformaBasim"),
                ("invoice", "proformaSil"),
                ("invoice", "alisUstBilgiGuncelle"),
                ("invoice", "faturaDokumOdemeAlindi"),
                ("invoice", "faturaDokumNakitMiktar"),
                ("invoice", "faturaDokumBarkod"),
                ("invoice", "faturaDokumBasim"),
                ("invoice", "faturaDokumSil"),
                ("invoice", "faturaDokumTipSatis"),
                ("invoice", "faturaDokumTipTamir"),
                ("invoice", "faturaDokumTipIade"),
                ("invoice", "faturaDokumTipAlis"),
                ("invoice", "faturaDokumTipHizmet"),
                ("invoice", "musteriTeklifiDuzenle"),
                ("invoice", "musteriTeklifiSil"),
                ("invoice", "musteriTeklifiProformaAktar"),
                ("invoice", "musteriTeklifiBasim"),
                ("invoice", "cariTeklifleriDuzenle"),
                ("invoice", "cariTeklifleriSil"),
                ("invoice", "cariTeklifleriProformaAktar"),
                ("invoice", "cariTeklifleriBasim"),
                ("invoice", "alisDuzenle"),
                ("invoice", "alisTermin"),
                ("invoice", "alisSil"),
                ("invoice", "terminDurumDegistir"),
                ("invoice", "alisTipAlis"),
                ("invoice", "alisTipHizmet"),
                ("invoice", "alisTipIade"),
                ("invoice", "garantiDegisim"),
                ("invoice", "garantiDegisimSil"),
                ("deleteRule", "deleteRule/faturaDokum"),
                ("deleteRule", "deleteRule/musteriTeklifi"),
                ("deleteRule", "deleteRule/proforma"),
                ("deleteRule", "deleteRule/alis"),
                ("deleteRule", "deleteRule/tumIslemleriSilebilsin"),
                ("users", "bildirimler"),
                ("users", "bildirimlerGelen"),
                ("users", "bildirimlerGonder"),
                ("reports", "aktifSepetRaporu"),
                ("reports", "muhasebeStokGirisCikisRaporu"),
                ("users", "kampanya"),
                ("reports", "accountingSalesReport"),
                ("reports", "garantiRaporlari"),
                ("cash", "virmanListesi"),
                ("reports", "yonetimEkstre")
            };

            var rawTenants = await masterDb.Tenants
                .AsNoTracking()
                .Select(x => new { x.DbName, x.Code })
                .ToListAsync();

            var tenantDbNamesFromMaster = rawTenants
                .Select(x => string.IsNullOrWhiteSpace(x.DbName) ? $"b2b_erp_tenant_{x.Code}" : x.DbName)
                .Where(x => !string.IsNullOrWhiteSpace(x))
                .ToList();

            // YAYIN KORUMASI (2026-08-21). Burası eskiden pg_database'i 'b2b_erp%' kalıbıyla tarayıp
            // BULDUĞU HER veritabanına migration + drift-fix uyguluyordu; master'daki kiracı kaydına
            // hiç bakmadan. Aynı PostgreSQL sunucusunda canlı personel portalının kiracı veritabanı
            // da durduğu için (b2b_erp_tenant_DEMO; Employees tablosu ERP ile İK servisi
            // arasında PAYLAŞILIYOR, bkz. [ortak-employees-tablosu]) ERP'nin o sunucudaki ilk açılışı
            // çalışan bir uygulamanın şemasını değiştiriyor, aşağıdaki drift-fix'lerdeki
            // DELETE FROM "RolePagePermissions" satırları da yetkilerini siliyordu.
            //
            // Artık dokunulacak veritabanları yapılandırmayla sınırlanabiliyor:
            //   Tenants:MigrationAllowlist  -> doluysa YALNIZ bunlara dokunulur
            //   Tenants:MigrationDenylist   -> her hâlükârda atlanır (allowlist'ten güçlüdür)
            //   Tenants:ScanOrphanDatabases -> false ise pg_database taraması hiç yapılmaz,
            //                                  yalnızca master'da kayıtlı kiracılar işlenir
            // Girdiler kiracı kodu ("DEMO") ya da doğrudan veritabanı adı olabilir.
            // Hiçbiri ayarlanmazsa davranış eskisi gibi kalır (geliştirme makinesi etkilenmesin).
            var migrationAllowlist = builder.Configuration.GetSection("Tenants:MigrationAllowlist").Get<string[]>() ?? Array.Empty<string>();
            var migrationDenylist = builder.Configuration.GetSection("Tenants:MigrationDenylist").Get<string[]>() ?? Array.Empty<string>();
            var scanOrphanDatabases = builder.Configuration.GetValue<bool?>("Tenants:ScanOrphanDatabases") ?? true;

            var dbNameByTenantCode = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            foreach (var t in rawTenants)
            {
                if (string.IsNullOrWhiteSpace(t.Code)) continue;
                dbNameByTenantCode[t.Code] = string.IsNullOrWhiteSpace(t.DbName) ? $"b2b_erp_tenant_{t.Code}" : t.DbName;
            }

            HashSet<string> ExpandToDbNames(string[] entries)
            {
                var result = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                foreach (var entry in entries)
                {
                    if (string.IsNullOrWhiteSpace(entry)) continue;
                    var trimmed = entry.Trim();
                    result.Add(trimmed);
                    if (dbNameByTenantCode.TryGetValue(trimmed, out var mapped)) result.Add(mapped);
                    else if (!trimmed.StartsWith("b2b_", StringComparison.OrdinalIgnoreCase)) result.Add($"b2b_erp_tenant_{trimmed}");
                }
                return result;
            }

            var allowDbNames = ExpandToDbNames(migrationAllowlist);
            var denyDbNames = ExpandToDbNames(migrationDenylist);

            var allPgDatabases = new List<string>();
            if (scanOrphanDatabases)
            {
                try
                {
                    await using var masterConn = new Npgsql.NpgsqlConnection(baseConnStr);
                    await masterConn.OpenAsync();
                    await using var cmd = masterConn.CreateCommand();
                    cmd.CommandText = "SELECT datname FROM pg_database WHERE datname LIKE 'b2b_erp%' AND datistemplate = false;";
                    await using var reader = await cmd.ExecuteReaderAsync();
                    while (await reader.ReadAsync())
                    {
                        allPgDatabases.Add(reader.GetString(0));
                    }
                }
                catch {}
            }

            var candidateDbNames = tenantDbNamesFromMaster
                .Concat(allPgDatabases)
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .Where(x => !string.Equals(x, "b2b_erp_master", StringComparison.OrdinalIgnoreCase))
                .ToList();

            var tenantDbNames = candidateDbNames
                .Where(x => allowDbNames.Count == 0 || allowDbNames.Contains(x))
                .Where(x => !denyDbNames.Contains(x))
                .ToList();

            // Sunucuda hangi veritabanına dokunulduğu gözle doğrulanabilsin: yayın sonrası ilk
            // kontrol noktası bu satır.
            Console.WriteLine($"[tenant-migration] dokunulacak: {(tenantDbNames.Count == 0 ? "(yok)" : string.Join(", ", tenantDbNames))}");
            var skippedDbNames = candidateDbNames.Except(tenantDbNames, StringComparer.OrdinalIgnoreCase).ToList();
            if (skippedDbNames.Count > 0)
            {
                Console.WriteLine($"[tenant-migration] atlandi: {string.Join(", ", skippedDbNames)}");
            }

            foreach (var tenantDbName in tenantDbNames)
            {
                try
                {
                    var csb = new Npgsql.NpgsqlConnectionStringBuilder(baseConnStr)
                    {
                        Database = tenantDbName
                    };

                    // Pre-flight: ensure columns exist and mark migrations as applied before MigrateAsync.
                    // This prevents 42701 (duplicate column) failures on tenant DBs that had columns
                    // created directly rather than through EF migrations.
                    await using (var preConn = new Npgsql.NpgsqlConnection(csb.ConnectionString))
                    {
                        await preConn.OpenAsync();

                        // Step 1: Add all known columns idempotently (IF NOT EXISTS).
                        await using (var cmd1 = preConn.CreateCommand())
                        {
                            cmd1.CommandText = @"
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND lower(table_name)='customerledgerentries') THEN
    ALTER TABLE ""CustomerLedgerEntries"" ADD COLUMN IF NOT EXISTS ""Balance"" numeric NOT NULL DEFAULT 0;
    UPDATE ""CustomerLedgerEntries"" SET ""Date"" = ""CreateTime"" WHERE ""Date"" = date_trunc('day', ""Date"");
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='PurchaseInvoices') THEN
    ALTER TABLE ""PurchaseInvoices"" ADD COLUMN IF NOT EXISTS ""TerminStatus"" integer NOT NULL DEFAULT 0;
    ALTER TABLE ""PurchaseInvoices"" ADD COLUMN IF NOT EXISTS ""CashAccountId"" integer NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='Employees') THEN
    ALTER TABLE ""Employees"" ADD COLUMN IF NOT EXISTS ""WorkPermitRenewalFee"" numeric(18,2) NOT NULL DEFAULT 0;
    ALTER TABLE ""Employees"" ADD COLUMN IF NOT EXISTS ""WorkType"" character varying(80) NULL;
  END IF;
  /*
   * SİPARİŞTE TESLİMAT ADRESİ ANLIK GÖRÜNTÜSÜ (2026-09-08).
   *
   * E-ticaret siparişinin teslimat bilgisi bugüne kadar hiçbir yerde saklanmıyordu; montaj
   * kaydı ve sipariş dökümü adresi CARİ KARTINDAN okuyordu. Müşteri profilinden adresini
   * değiştirdiği anda GEÇMİŞ siparişlerin adresi de değişiyordu — kargo çıkmış bir siparişin
   * nereye gittiği sistemde kaybolan bir bilgiydi.
   *
   * Kolonlar NULL: bayi siparişlerinde doldurulmuyor, yalnızca e-ticaret yolunda yazılıyor.
   * Boş olan eski siparişlerde okuyucular eskisi gibi cari kartına düşüyor.
   */
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'SalesOrders'
  ) THEN
    ALTER TABLE ""SalesOrders"" ADD COLUMN IF NOT EXISTS ""DeliveryName"" character varying(200) NULL;
    ALTER TABLE ""SalesOrders"" ADD COLUMN IF NOT EXISTS ""DeliveryPhone"" character varying(40) NULL;
    ALTER TABLE ""SalesOrders"" ADD COLUMN IF NOT EXISTS ""DeliveryAddress"" character varying(500) NULL;
    ALTER TABLE ""SalesOrders"" ADD COLUMN IF NOT EXISTS ""DeliveryCity"" character varying(120) NULL;
    ALTER TABLE ""SalesOrders"" ADD COLUMN IF NOT EXISTS ""DeliveryDistrict"" character varying(120) NULL;
  END IF;
  -- InvoiceLines: satirin MAL/HIZMET niteligi (denetim md. E3). 0 = damgalanmamis eski satir.
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'InvoiceLines'
  ) THEN
    ALTER TABLE ""InvoiceLines"" ADD COLUMN IF NOT EXISTS ""Nature"" integer NOT NULL DEFAULT 0;
  END IF;
  -- Alis faturasi satirinin MAL/HIZMET nitelIgi (2026-09-18). Hizmet satiri stok hareketi
  -- yazmaz ve hizmet harcama raporu bu kolondan gruplanir.
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='PurchaseInvoiceLines') THEN
    ALTER TABLE ""PurchaseInvoiceLines"" ADD COLUMN IF NOT EXISTS ""Nature"" integer NOT NULL DEFAULT 0;

    /*
      GERIYE DONUK DAMGA (2026-09-18 kullanici istegi: eski alis satirlarini da doldur).

      Kolon yeni; eski satirlarin hepsi 0 (Unspecified) kaldi ve hizmet harcama raporu
      onlari hic gormuyordu. Damga BIR KEZ atilir: asagisi yalnizca `Nature = 0` satirlara
      dokunur, ikinci acilista 0 satir gunceller.

      Kural, kesim anindaki damga ile AYNI (AppDbContext.StampPurchaseInvoiceLineNaturesAsync):
      urun karti ACIKCA hizmet tipindeyse (HIZMET/SERVIS) hizmet, gerisi mal. Alista
      'karti yok = hizmet' kurali UYGULANMAZ; kartsiz satir cogu zaman henuz acilmamis bir
      MAL kartidir, hepsini hizmet saymak raporu sisirirdi.

      Eslesme STOK KODU uzerinden (ProductId degil): eski satirlarda ProductId bos olabiliyor
      ama stok kodu yaziliyor. Buyuk/kucuk harf ayrimi yok, damgalama kodu da oyle.
    */
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='Products') THEN
      UPDATE ""PurchaseInvoiceLines"" l
         SET ""Nature"" = 2
        FROM ""Products"" p
       WHERE l.""Nature"" = 0
         AND p.""ProductType"" IS NOT NULL
         AND upper(btrim(p.""StockCode"")) = upper(btrim(l.""StockCode""))
         AND btrim(p.""ProductType"") ILIKE ANY (ARRAY['HIZMET', 'HİZMET', 'SERVIS', 'SERVİS']);
    END IF;

    -- Hizmet KATALOGUNDAN (HIZ-NAKLIYE, HIZ-ELEKTRIK...) gelen satirlar da hizmettir.
    -- Bu kodlarin Products'ta karsiligi yoktur; yukaridaki kural onlari yakalamaz.
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='ServiceCatalogItems') THEN
      UPDATE ""PurchaseInvoiceLines"" l
         SET ""Nature"" = 2
        FROM ""ServiceCatalogItems"" sc
       WHERE l.""Nature"" = 0
         AND upper(btrim(sc.""Code"")) = upper(btrim(l.""StockCode""));
    END IF;

    -- Geriye kalan her sey MAL.
    UPDATE ""PurchaseInvoiceLines"" SET ""Nature"" = 1 WHERE ""Nature"" = 0;
  END IF;
  -- HESAP KESIM TARIHI (2026-08-22). Sirket kredi karti hesaplari icin; saat tasimaz,
  -- `date` olarak durur ki firma saat dilimine gore bir gun kaymasin. Diger hesap
  -- turlerinde NULL kalir.
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'BankAccountDefinitions'
  ) THEN
    ALTER TABLE ""BankAccountDefinitions"" ADD COLUMN IF NOT EXISTS ""StatementDate"" date NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='BankAccountTransactions') THEN
    ALTER TABLE ""BankAccountTransactions"" ADD COLUMN IF NOT EXISTS ""CurrencyTypeId"" integer NOT NULL DEFAULT 0;
  END IF;
  -- POS MASRAFINDA VERGİ AYRIŞTIRMASI (2026-08-20, denetim md. A4).
  -- Komisyon tek kalem gider olarak yazılıyordu; BSMV/KDV bileşeni hiçbir yerde yoktu.
  -- Oranlar ELLE girilir, varsayılan 0 = ayrıştırma yok (eski kayıtlar böyle okunur).
  -- `Amount` (brüt) DEĞİŞMEZ; bu kolonlar yalnızca o tutarın içini açıklar.
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='BankAccountTransactions') THEN
    ALTER TABLE ""BankAccountTransactions"" ADD COLUMN IF NOT EXISTS ""PosFeeBsmvRate"" numeric(18,4) NOT NULL DEFAULT 0;
    ALTER TABLE ""BankAccountTransactions"" ADD COLUMN IF NOT EXISTS ""PosFeeVatRate"" numeric(18,4) NOT NULL DEFAULT 0;
    ALTER TABLE ""BankAccountTransactions"" ADD COLUMN IF NOT EXISTS ""PosFeeBsmvAmount"" numeric(18,2) NOT NULL DEFAULT 0;
    ALTER TABLE ""BankAccountTransactions"" ADD COLUMN IF NOT EXISTS ""PosFeeVatAmount"" numeric(18,2) NOT NULL DEFAULT 0;
    -- ÇEK BAĞI (2026-08-24). Bu hareket bir çekten doğduysa çekin kimliği; değilse NULL.
    -- Çek bir hesaptan ayrıldığında (portföye dönüş, tahsil, iade, karşılıksız, silme)
    -- satır SİLİNİR; silinecek satır açıklama metnine değil bu kimliğe göre bulunur.
    ALTER TABLE ""BankAccountTransactions"" ADD COLUMN IF NOT EXISTS ""CheckId"" integer NULL;
    CREATE INDEX IF NOT EXISTS ""IX_BankAccountTransactions_CheckId"" ON ""BankAccountTransactions"" (""CheckId"");
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='StockMovements') THEN
    -- STOK HAREKETİNDE PARA BİRİMİ (2026-08-19). Tabloda para birimi hiç yoktu; `UnitPrice`
    -- TL çapasıydı ama ürün satış / stok raporları dolarlı satışı TL satıştan ayırt
    -- edemiyordu. 0 = TL (mevcut kolonlarla aynı kural).
    ALTER TABLE ""StockMovements"" ADD COLUMN IF NOT EXISTS ""CurrencyTypeId"" integer NOT NULL DEFAULT 0;
    ALTER TABLE ""StockMovements"" ADD COLUMN IF NOT EXISTS ""CurrencyRate"" numeric(18,6) NOT NULL DEFAULT 1;
    ALTER TABLE ""StockMovements"" ADD COLUMN IF NOT EXISTS ""CurrencyUnitPrice"" numeric(18,4) NOT NULL DEFAULT 0;

    -- DEPO BAZLI BAKIYE INDEKSI (denetim md. 236) — ikinci drift blogu.
    CREATE INDEX IF NOT EXISTS ""IX_StockMovements_StockCode_WarehouseCode"" ON ""StockMovements"" (""StockCode"", ""WarehouseCode"");

    -- GERIYE DONUK DAMGA. Kolonlar eklendi ama ESKI hareketler damgasiz kaldi: urun satis
    -- raporunda her satir TL / 0,00 gorunuyordu. Damga faturanin KALEMINDEN kopyalanir
    -- (fis no + stok kodu + satir no ile); kur hesaplanmaz, belgenin donmus kuru alinir.
    --
    -- IDEMPOTENS: kosul ""CurrencyUnitPrice"" = 0 uzerinden yurur. Guncellenen satirda bu
    -- alan doldugu icin ikinci calistirma hicbir seyi degistirmez. (TL kalemde
    -- ""CurrencyTypeId"" 0 kalabilir; 0 ile 1 bu sistemde ayni seydir.)
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'InvoiceLines'
    ) THEN
      UPDATE ""StockMovements"" sm
      SET ""CurrencyTypeId"" = il.""CurrencyTypeId"",
          ""CurrencyRate"" = CASE WHEN il.""CurrencyRate"" > 0 THEN il.""CurrencyRate"" ELSE 1 END,
          ""CurrencyUnitPrice"" = CASE WHEN il.""CurrencyUnitPrice"" > 0 THEN il.""CurrencyUnitPrice"" ELSE il.""UnitPrice"" END
      FROM ""InvoiceLines"" il
      JOIN ""Invoices"" i ON i.""Id"" = il.""InvoiceId""
      WHERE sm.""CurrencyUnitPrice"" = 0
        AND sm.""InvoiceNo"" = i.""InvoiceNo""
        AND sm.""StockCode"" = il.""StockCode""
        AND sm.""LineNo"" = il.""LineNo"";
    END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='Customers') THEN
    -- PARA BİRİMİ BAŞINA KREDİ LİMİTİ (2026-08-19) — gerekçe için varsayılan veritabanı
    -- bloğundaki açıklamaya bakınız. Her firma DB'sinde de olmalı, yoksa limiti okuyan
    -- her sorgu o firmada 500 verir.
    ALTER TABLE ""Customers"" ADD COLUMN IF NOT EXISTS ""CreditLimitUsd"" numeric(18,2) NOT NULL DEFAULT 0;
    ALTER TABLE ""Customers"" ADD COLUMN IF NOT EXISTS ""CreditLimitEur"" numeric(18,2) NOT NULL DEFAULT 0;
    ALTER TABLE ""Customers"" ADD COLUMN IF NOT EXISTS ""CreditLimitGbp"" numeric(18,2) NOT NULL DEFAULT 0;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='Invoices') THEN
    ALTER TABLE ""Invoices"" ADD COLUMN IF NOT EXISTS ""IsManuallyPaid"" boolean NOT NULL DEFAULT false;
    -- FATURA BAŞLIĞINDA PARA BİRİMİ VE DONMUŞ KUR (2026-08-14) — gerekçe için varsayılan
    -- veritabanı bloğundaki açıklamaya bakınız. Muhasebe fişi fatura ANINDAKİ kuru ister.
    ALTER TABLE ""Invoices"" ADD COLUMN IF NOT EXISTS ""CurrencyTypeId"" integer NOT NULL DEFAULT 0;
    ALTER TABLE ""Invoices"" ADD COLUMN IF NOT EXISTS ""ExchangeRate"" numeric(18,6) NOT NULL DEFAULT 1;
    ALTER TABLE ""Invoices"" ADD COLUMN IF NOT EXISTS ""RateSource"" character varying(40) NULL;
  END IF;
  -- KASA HAREKETİNDE BELGE NUMARASI (2026-08-14). Banka tarafında zaten vardı.
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='CashAccountTransactions') THEN
    ALTER TABLE ""CashAccountTransactions"" ADD COLUMN IF NOT EXISTS ""DocumentNo"" character varying(30) NULL;
  END IF;
  -- KASA/BANKADA DÖVİZ ÇEVRİMİ (2026-08-17).
  -- Gelen para ile onun işlendiği hesap ayrı para birimlerinde olabilir: müşteri 1.000 DOLAR
  -- getirir, TL kasaya günün kuruyla yazılır. Hareket eskiden yalnız hesabın para birimini
  -- taşıyordu, gelen paranın ne olduğu kayboluyordu. `Tender*` alanları gelen parayı saklar;
  -- TL çapası (`Amount`) daima tenderTutar × tenderKur'dur, hesap tutarı da o çapadan türer.
  -- `ExchangeCode` yalnız ÇEVRİM VARSA dolar ve iki ucu (kasa hareketi + cari ekstre satırı)
  -- birbirine bağlar; muhasebe kur farkını bu kodla ayıklar. 0 = çevrim yok (eski kayıtlar).
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='CashAccountTransactions') THEN
    ALTER TABLE ""CashAccountTransactions"" ADD COLUMN IF NOT EXISTS ""TenderCurrencyTypeId"" integer NOT NULL DEFAULT 0;
    ALTER TABLE ""CashAccountTransactions"" ADD COLUMN IF NOT EXISTS ""TenderRate"" numeric(18,6) NOT NULL DEFAULT 0;
    ALTER TABLE ""CashAccountTransactions"" ADD COLUMN IF NOT EXISTS ""TenderAmount"" numeric(18,2) NOT NULL DEFAULT 0;
    ALTER TABLE ""CashAccountTransactions"" ADD COLUMN IF NOT EXISTS ""ExchangeCode"" character varying(30) NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='BankAccountTransactions') THEN
    ALTER TABLE ""BankAccountTransactions"" ADD COLUMN IF NOT EXISTS ""TenderCurrencyTypeId"" integer NOT NULL DEFAULT 0;
    ALTER TABLE ""BankAccountTransactions"" ADD COLUMN IF NOT EXISTS ""TenderRate"" numeric(18,6) NOT NULL DEFAULT 0;
    ALTER TABLE ""BankAccountTransactions"" ADD COLUMN IF NOT EXISTS ""TenderAmount"" numeric(18,2) NOT NULL DEFAULT 0;
    ALTER TABLE ""BankAccountTransactions"" ADD COLUMN IF NOT EXISTS ""ExchangeCode"" character varying(30) NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND lower(table_name)='customerledgerentries') THEN
    ALTER TABLE ""CustomerLedgerEntries"" ADD COLUMN IF NOT EXISTS ""ExchangeCode"" character varying(30) NULL;
    -- PARANIN İŞLENDİĞİ CARİ DÖVİZ HESABI (2026-08-20).
    -- Kasa/bankada ""hangi cari hesabına yazılacağı"" ekrandan seçilir (varsayılan TL). Bu
    -- kolon yalnız HEDEF DAMGASIDIR; tutar çevrilmez — 1.500 £ tahsilat EUR hesabı seçilse
    -- de satırda 1.500 £ olarak durur. (Çapraz kurla çeviren eski davranış 1.500 £'yi
    -- 31,66 €'ya düşürüyordu; seçim geri geldi, çevrim gelmedi.)
    -- 0 = belirtilmemiş (eski satırlar).
    ALTER TABLE ""CustomerLedgerEntries"" ADD COLUMN IF NOT EXISTS ""TargetAccountCurrencyTypeId"" integer NOT NULL DEFAULT 0;
  END IF;
  -- TEKLİFTE PARA BİRİMİ (2026-08-17) — gerekçe için varsayılan veritabanı bloğuna bakınız.
  -- Teklif artık kendi para birimini taşır; basım sembolü carinin kartından ALINMAZ.
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='CustomerOffers') THEN
    ALTER TABLE ""CustomerOffers"" ADD COLUMN IF NOT EXISTS ""CurrencyTypeId"" integer NOT NULL DEFAULT 1;
    ALTER TABLE ""CustomerOffers"" ADD COLUMN IF NOT EXISTS ""ExchangeRate"" numeric(18,6) NOT NULL DEFAULT 1;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='CustomerOfferLines') THEN
    ALTER TABLE ""CustomerOfferLines"" ADD COLUMN IF NOT EXISTS ""CurrencyTypeId"" integer NOT NULL DEFAULT 1;
    -- Kampanya satiri kilidi (2026-09-20): dolu ise satir duzenlemede kilitli gelir.
    ALTER TABLE ""CustomerOfferLines"" ADD COLUMN IF NOT EXISTS ""CampaignName"" character varying(200) NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='CariOffers') THEN
    ALTER TABLE ""CariOffers"" ADD COLUMN IF NOT EXISTS ""CurrencyTypeId"" integer NOT NULL DEFAULT 1;
    ALTER TABLE ""CariOffers"" ADD COLUMN IF NOT EXISTS ""ExchangeRate"" numeric(18,6) NOT NULL DEFAULT 1;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='CariOfferLines') THEN
    ALTER TABLE ""CariOfferLines"" ADD COLUMN IF NOT EXISTS ""CurrencyTypeId"" integer NOT NULL DEFAULT 1;
  END IF;
  -- HİZMET TANIMINDA PARA BİRİMİ (2026-08-20).
  -- Hizmet kataloğunda para birimi YOKTU; gümrük masrafı gibi doğası gereği dövizli hizmetler
  -- faturaya TL düşüyor, kullanıcı her kalemde elle çeviriyordu. Para birimi hizmetin kendi
  -- özelliği; fatura kalemine ÖNTANIM olarak taşınır ve kalemde değiştirilebilir.
  -- 0 = TL (mevcut kolonlarla aynı kural; eski hizmetler aynen TL kalır).
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='ServiceCatalogItems') THEN
    ALTER TABLE ""ServiceCatalogItems"" ADD COLUMN IF NOT EXISTS ""CurrencyTypeId"" integer NOT NULL DEFAULT 0;
  END IF;
  -- PARA BİRİMİ KODLAMASI TEKİLLEŞTİRİLDİ (2026-08-14).
  --
  -- Sistemde iki kodlama vardı ve ÇAKIŞIYORLARDI: CurrencyTypeId'de 3 = USD iken
  -- Products.CurrencyCode'da 3 = GBP, 43 = USD, 0 = TL idi. Ürün kodu CurrencyTypeId
  -- beklenen bir yere geçtiğinde sterlin SESSİZCE dolara dönüyordu.
  --
  -- Artık tek kodlama: 1=TRY 2=EUR 3=USD 4=GBP.
  --
  -- TEK BİR UPDATE + CASE kullanılıyor: ayrı UPDATE'ler yazılsaydı 43→3 ardından 3→4
  -- çalışıp yeni USD satırlarını GBP yapardı. CASE eski değer üzerinden çalışır.
  -- Nöbetçi kayıt (NumberSeries) göçün TAM OLARAK BİR KEZ çalışmasını garanti eder.
  -- ÜRÜNÜN SATIŞ PARA BİRİMİ (2026-08-14).
  -- `CurrencyCode` ürünün ALIŞ dövizidir; satış dövizi yalnızca fiyat satırında (metin olarak)
  -- vardı ve toplu fiyat ekranı her yeni satıra sabit ""TRY"" yazdığı için arayüzden ürünü
  -- dövizle satmanın yolu yoktu. Varsayılan 1 = TRY: mevcut davranış korunur.
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='Products') THEN
    ALTER TABLE ""Products"" ADD COLUMN IF NOT EXISTS ""SalesCurrencyCode"" integer NOT NULL DEFAULT 1;
  END IF;
  -- ALIŞ FATURASI VE VİRMAN PARA BİRİMİ (2026-08-14).
  -- İkisinde de para birimi alanı hiç yoktu. Alış faturasının tedarikçi tarafında
  -- (cari yok, yalnızca SupplierCode) ve cariden cariye virmanda ekstre satırı zorunlu
  -- olarak TL yazılıyordu — bakiye döviz başına yürüdüğü için dövizli işlem imkânsızdı.
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='PurchaseInvoices') THEN
    ALTER TABLE ""PurchaseInvoices"" ADD COLUMN IF NOT EXISTS ""CurrencyTypeId"" integer NOT NULL DEFAULT 0;
    ALTER TABLE ""PurchaseInvoices"" ADD COLUMN IF NOT EXISTS ""ExchangeRate"" numeric(18,6) NOT NULL DEFAULT 1;
    -- KUR KAYNAGI (2026-08-29): TCMB ya da Manuel. Alis faturasinda kur artik elle
    -- girilebiliyor; hangi kurun nereden geldigi damgalanmazsa ay sonunda o kurun nereden
    -- ciktigi sorusunun cevabi olmaz. Satis faturasinda karsiligi zaten vardi.
    ALTER TABLE ""PurchaseInvoices"" ADD COLUMN IF NOT EXISTS ""RateSource"" character varying(20) NULL;
    -- TESLIMATIN HANGI SIPARISTEN BOLUNDUGU (2026-08-29). Once yalnizca aciklama
    -- metniyle bagliydi (Kismi Teslimat - X seklinde); metin degisince bag kopuyordu ve
    -- teslimat gecmisi gosterilemiyordu.
    ALTER TABLE ""PurchaseInvoices"" ADD COLUMN IF NOT EXISTS ""SplitFromPurchaseInvoiceId"" integer NULL;
  END IF;
  -- ALIS KALEMINDE BELGE PARA BIRIMI FIYATI (2026-08-29).
  -- `UnitPrice` TL capasidir; `CurrencyUnitPrice` kalemin BELGENIN kendi para birimindeki
  -- fiyatidir. Satis faturasinda bu ayrim vardi, aliste yoktu: dovizli alisin ORIJINAL
  -- tutari kayitta hic durmuyordu. Denetimdeki B3 bulgusu (Id 50) bundan cikiyordu.
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='PurchaseInvoiceLines') THEN
    ALTER TABLE ""PurchaseInvoiceLines"" ADD COLUMN IF NOT EXISTS ""CurrencyUnitPrice"" numeric(18,4) NOT NULL DEFAULT 0;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='Virmans') THEN
    ALTER TABLE ""Virmans"" ADD COLUMN IF NOT EXISTS ""CurrencyTypeId"" integer NOT NULL DEFAULT 0;
    ALTER TABLE ""Virmans"" ADD COLUMN IF NOT EXISTS ""ExchangeRate"" numeric(18,6) NOT NULL DEFAULT 1;
  END IF;
  -- GARANTİ KAYDI PARA BİRİMİ (2026-08-15).
  -- Tutarlar ürünün satış fiyatından geliyor ve o fiyat dolar olabiliyor; para birimi
  -- yazılmadığı için dolar bir garanti kaydı ekranda ₺ görünüyor ve KPI toplamına
  -- TL gibi giriyordu. Eski satırlar için varsayılan 1 (TL) — davranış değişmez.
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='WarrantyRecords') THEN
    ALTER TABLE ""WarrantyRecords"" ADD COLUMN IF NOT EXISTS ""CurrencyTypeId"" integer NOT NULL DEFAULT 1;
    ALTER TABLE ""WarrantyRecords"" ADD COLUMN IF NOT EXISTS ""CurrencyRate"" numeric(18,6) NOT NULL DEFAULT 1;
  END IF;
  -- PLANLAYICI TUZAGI (2026-08-23). Bu information_schema kontrolleri KORUMA SANILIYORDU ama
  -- korumuyorlardi: PostgreSQL IF kosulunun TAMAMINI once PLANLAR, sonra calistirir. AND kisa
  -- devre yapsa bile asagidaki ""NumberSeries"" gondermesi plan asamasinda cozulmek zorunda;
  -- tablo yoksa 42P01 firlar. Yani kosul 'yanlis' diye atlanmaz, kosulun KENDISI patlar.
  -- 2026-08-21'de canli ERP'yi tamamen durduran zincirin koku buydu: acilis blogu burada olup
  -- kendisinden sonraki BUTUN DDL'leri atliyordu. Cozum: tablo varligi DIS IF'te sorulur,
  -- tabloya gonderme ancak IC IF'te - varligi bilindikten sonra - planlanir.
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='Products')
     AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='NumberSeries') THEN
    IF NOT EXISTS (SELECT 1 FROM ""NumberSeries"" WHERE ""Key"" = 'migration:productcurrency-v2') THEN
      UPDATE ""Products"" SET ""CurrencyCode"" = CASE ""CurrencyCode""
        WHEN 43 THEN 3   -- USD
        WHEN 3  THEN 4   -- GBP
        WHEN 0  THEN 1   -- TL
        ELSE ""CurrencyCode""   -- 2 = EUR değişmiyor
      END;
      INSERT INTO ""NumberSeries"" (""Key"", ""LastValue"") VALUES ('migration:productcurrency-v2', 1);
    END IF;
  END IF;
  -- KALEM BAZLI ÇIKIŞ DEPOSU (kullanıcı kuralı, 2026-08-13).
  --
  -- Servisten gelen fatura kalemleri, işlemi yapan teknisyenin ARAÇ deposundan çıkmak zorunda;
  -- faturayı imzalayan kişinin deposundan değil. Fatura başlığındaki tek depo bunu ifade
  -- edemiyordu. `SalesOrderLines.SourceWarehouseCode` servisin damgaladığı öntanımlı depo,
  -- `InvoiceLines.WarehouseCode` ise stoğun fiilen düştüğü depo — fatura silinince iade de
  -- oradan okunuyor.
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='SalesOrderLines') THEN
    ALTER TABLE ""SalesOrderLines"" ADD COLUMN IF NOT EXISTS ""SourceWarehouseCode"" integer NULL;
    ALTER TABLE ""SalesOrderLines"" ADD COLUMN IF NOT EXISTS ""ServicePerformerName"" character varying(200) NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='InvoiceLines') THEN
    ALTER TABLE ""InvoiceLines"" ADD COLUMN IF NOT EXISTS ""WarehouseCode"" integer NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='Users') THEN
    ALTER TABLE ""Users"" ADD COLUMN IF NOT EXISTS ""DefaultCashAccountId"" integer NULL;
    ALTER TABLE ""Users"" ADD COLUMN IF NOT EXISTS ""DefaultBankAccountId"" integer NULL;
    -- CALISAN YONETIMI ERISIMI (2026-08-23). ERP kullanicisinin personel portalina YONETICI
    -- olarak girmesini acar. ServiceOpsAccess'ten farki: super admin bypass'i YOK, bu kutu
    -- isaretlenmeden kimse giremez. Varsayilan FALSE = herkese kapali dogar.
    ALTER TABLE ""Users"" ADD COLUMN IF NOT EXISTS ""EmployeeAccess"" boolean NOT NULL DEFAULT FALSE;
    ALTER TABLE ""Users"" ADD COLUMN IF NOT EXISTS ""AsistanAccess"" boolean NOT NULL DEFAULT FALSE;
    ALTER TABLE ""Users"" ADD COLUMN IF NOT EXISTS ""CariEkstreTipleri"" character varying(200) NULL;
  END IF;
  -- NESTPAY MAGAZA TIPI (2026-08-23). `storetype` koda gomuluydu (3D_PAY_HOSTING).
  -- Creditwest CardPlus uye isyeri, isyeri kullanim tipi desteklenmiyor diye 18/18 reddetti;
  -- banka hangi modelde oldugunu soyledigi anda YENI DERLEME BEKLEMEDEN degisebilmeli.
  -- Varsayilan mevcut davranisin aynisi, yani hicbir POS'un davranisi degismez.
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'VirtualPosDefinitions'
  ) THEN
    ALTER TABLE ""VirtualPosDefinitions"" ADD COLUMN IF NOT EXISTS ""StoreType"" character varying(40) NOT NULL DEFAULT '3D_PAY_HOSTING';
  END IF;
  -- Rol bazlı kampanya anahtarı (2026-08-11). Kurumsal yalnızca sütun İLK oluşturulurken
  -- kapatılır; sonradan elle açılırsa her açılışta geri kapanmasın.
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='Roles') THEN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name='Roles' AND column_name='CampaignsEnabled'
    ) THEN
      ALTER TABLE ""Roles"" ADD COLUMN ""CampaignsEnabled"" boolean NOT NULL DEFAULT TRUE;
      UPDATE ""Roles"" SET ""CampaignsEnabled"" = FALSE WHERE lower(""Code"") = 'kurumsal';
    END IF;
    -- Limit aşımıyla sipariş onayı (2026-10-14): rol bazlı, varsayılan KAPALI.
    ALTER TABLE ""Roles"" ADD COLUMN IF NOT EXISTS ""OverLimitApprovalEnabled"" boolean NOT NULL DEFAULT FALSE;
  END IF;
  -- Kampanya e-ticaret anahtari (2026-09-19): B2B kampanyasi vitrine ancak bu acikken gider.
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='Campaigns') THEN
    ALTER TABLE ""Campaigns"" ADD COLUMN IF NOT EXISTS ""EcommerceEnabled"" boolean NOT NULL DEFAULT FALSE;
  END IF;
  -- Kampanya indirimlerinin fiyat gruplari (2026-08-12).
  -- Eskiden CampaignDiscounts.IskontoFiyat1..6 diye SABIT ALTI KOLONDU; fiyat gruplari ise
  -- veritabanindan yonetiliyor ve 6'dan fazla olabiliyor (7 = Askeriye Tipi Fatura).
  -- Yedinci grup uclardaki 1..6 suzgecine takilip sessizce dusuyordu.
  --
  -- DIKKAT: bu blok MigrateAsync'ten ONCE calisir. Migration zinciri kirik tenant'larda
  -- MigrateAsync sonrasindaki drift-fix'lere hic ulasilmiyor; tabloyu oraya koyarsan
  -- o tenant'larda hic olusmaz. Ayrica bu blogun IKI KOPYASI var (ana DB + tenant
  -- dongusu pre-flight); birini guncelleyip digerini unutma.
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='CampaignDiscounts') THEN
    CREATE TABLE IF NOT EXISTS ""CampaignDiscountPriceGroups"" (
      ""Id"" uuid NOT NULL,
      ""CampaignDiscountId"" uuid NOT NULL,
      ""PriceGroupCode"" integer NOT NULL,
      ""Deger"" numeric(18,4) NOT NULL,
      ""IsDeleted"" boolean NOT NULL DEFAULT FALSE,
      ""CreateUser"" character varying(50) NOT NULL DEFAULT '',
      ""CreateTime"" timestamp with time zone NOT NULL DEFAULT now(),
      ""EditUser"" character varying(50) NULL,
      ""EditTime"" timestamp with time zone NULL,
      CONSTRAINT ""PK_CampaignDiscountPriceGroups"" PRIMARY KEY (""Id""),
      CONSTRAINT ""FK_CampaignDiscountPriceGroups_CampaignDiscounts"" FOREIGN KEY (""CampaignDiscountId"")
        REFERENCES ""CampaignDiscounts"" (""Id"") ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS ""IX_CampaignDiscountPriceGroups_CampaignDiscountId""
      ON ""CampaignDiscountPriceGroups"" (""CampaignDiscountId"");
    CREATE UNIQUE INDEX IF NOT EXISTS ""IX_CampaignDiscountPriceGroups_Discount_Code""
      ON ""CampaignDiscountPriceGroups"" (""CampaignDiscountId"", ""PriceGroupCode"");

    -- Mevcut kayitlari eski kolonlardan tasi. TEK SEFERLIK: yalnizca hic satiri olmayan
    -- indirimler icin calisir, yoksa ekrandan yapilan degisiklik her acilista geri alinirdi.
    INSERT INTO ""CampaignDiscountPriceGroups""
      (""Id"", ""CampaignDiscountId"", ""PriceGroupCode"", ""Deger"", ""IsDeleted"", ""CreateUser"", ""CreateTime"")
    SELECT gen_random_uuid(), d.""Id"", v.code, v.deger, FALSE, 'schema-migration', now()
    FROM ""CampaignDiscounts"" d
    CROSS JOIN LATERAL (VALUES
      (1, d.""IskontoFiyat1""), (2, d.""IskontoFiyat2""), (3, d.""IskontoFiyat3""),
      (4, d.""IskontoFiyat4""), (5, d.""IskontoFiyat5""), (6, d.""IskontoFiyat6"")
    ) AS v(code, deger)
    WHERE v.deger IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM ""CampaignDiscountPriceGroups"" x WHERE x.""CampaignDiscountId"" = d.""Id""
      );
  END IF;
  -- Toplu Fiyat Atama sayfasi (2026-08-12).
  -- PageConfiguration.HasData yalnizca MIGRATION ile isler; migration zinciri kirik
  -- tenant'larda sayfa hic olusmuyor. Bu yuzden burada da idempotent ekleniyor.
  -- Kimlik PageConfiguration'daki AddFixedId(700, ...) ile AYNI olmali, yoksa iki yol
  -- farkli kimlik uretir ve RolePagePermissions yanlis satira baglanir.
  -- Hicbir role acilmiyor: yalnizca SuperAdmin gorur (koddaki bypass sayesinde).
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='Pages') THEN
    INSERT INTO ""Pages"" (""Id"", ""ModuleKey"", ""Key"", ""DisplayName"", ""SortOrder"", ""IsActive"")
    SELECT 700, 'users', 'topluFiyatAtama', 'Toplu Fiyat Atama', 22, TRUE
    WHERE NOT EXISTS (
      SELECT 1 FROM ""Pages"" WHERE ""ModuleKey""='users' AND ""Key""='topluFiyatAtama'
    )
    AND NOT EXISTS (
      SELECT 1 FROM ""Pages"" WHERE ""Id""=700
    );

    -- Sistem Denetimi + Kataloglar (2026-09-13). Ayni kural: kimlik PageConfiguration'daki
    -- AddFixedId(701/702, ...) ile AYNI. Varsayilan HICBIR role acilmiyor; kullanici Rol
    -- Yetkileri'nden istedigi role sonradan acar. Yalniz SuperAdmin ROLUNE (IsSuperAdmin=true)
    -- ve SSA'ya (kod tarafinda ayri bypass, RolePagePermissions'a hic ihtiyaci yok) acik.
    INSERT INTO ""Pages"" (""Id"", ""ModuleKey"", ""Key"", ""DisplayName"", ""SortOrder"", ""IsActive"")
    SELECT 701, 'users', 'sistemDenetimi', 'Sistem Denetimi', 23, TRUE
    WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""ModuleKey""='users' AND ""Key""='sistemDenetimi')
      AND NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id""=701);

    INSERT INTO ""Pages"" (""Id"", ""ModuleKey"", ""Key"", ""DisplayName"", ""SortOrder"", ""IsActive"")
    SELECT 702, 'eticaret', 'kataloglar', 'Kataloglar', 7, TRUE
    WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""ModuleKey""='eticaret' AND ""Key""='kataloglar')
      AND NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id""=702);

    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='RolePagePermissions')
       AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='Roles' AND column_name='IsSuperAdmin')
    THEN
      -- E-TICARET SAYFALARI (2026-09-21): tek 'Vitrin Yonetimi' formu ayri sayfalara dagitildi.
      -- Kim 'vitrin'(5200) sayfasini gorebiliyorsa yeni sayfalari da gorur (kimse erisim kaybetmesin);
      -- kampanyalar/arama sekmeleri Pages'te HIC yoktu (yalniz SSA goruyordu) — artik rol yetkisinde.
      UPDATE ""Pages"" SET ""DisplayName"" = 'Anasayfa & Vitrin', ""SortOrder"" = 10 WHERE ""ModuleKey"" = 'eticaret' AND ""Key"" = 'vitrin' AND ""DisplayName"" = 'Vitrin Yönetimi';
      UPDATE ""Pages"" SET ""DisplayName"" = 'Ürün Yönetimi' WHERE ""ModuleKey"" = 'eticaret' AND ""Key"" = 'urunYayin' AND ""DisplayName"" = 'Ürün Yayını';

      INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
      SELECT 5207, 'Vitrin Kategorileri', TRUE, 'kategoriler', 'eticaret', 9
      WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id"" = 5207 OR (""ModuleKey"" = 'eticaret' AND ""Key"" = 'kategoriler'));

      INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
      SELECT 5208, 'Firma & İletişim', TRUE, 'firmaBilgileri', 'eticaret', 11
      WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id"" = 5208 OR (""ModuleKey"" = 'eticaret' AND ""Key"" = 'firmaBilgileri'));

      INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
      SELECT 5209, 'Ödeme & Havale', TRUE, 'odeme', 'eticaret', 12
      WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id"" = 5209 OR (""ModuleKey"" = 'eticaret' AND ""Key"" = 'odeme'));

      INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
      SELECT 5210, 'Pazarlama & Güven', TRUE, 'pazarlama', 'eticaret', 13
      WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id"" = 5210 OR (""ModuleKey"" = 'eticaret' AND ""Key"" = 'pazarlama'));

      INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
      SELECT 5211, 'E-Ticaret Kampanyaları', TRUE, 'kampanyalar', 'eticaret', 4
      WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id"" = 5211 OR (""ModuleKey"" = 'eticaret' AND ""Key"" = 'kampanyalar'));

      INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
      SELECT 5212, 'Talep Raporu', TRUE, 'arama', 'eticaret', 5
      WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id"" = 5212 OR (""ModuleKey"" = 'eticaret' AND ""Key"" = 'arama'));

      INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
      SELECT 5213, 'Ziyaret Analizi', TRUE, 'analitik', 'eticaret', 6
      WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id"" = 5213 OR (""ModuleKey"" = 'eticaret' AND ""Key"" = 'analitik'));

      INSERT INTO ""RolePagePermissions"" (""RoleId"", ""PageId"", ""CanAccess"")
      SELECT rp.""RoleId"", p.""Id"", TRUE
      FROM ""RolePagePermissions"" rp
      JOIN ""Pages"" v ON v.""Id"" = rp.""PageId"" AND v.""ModuleKey"" = 'eticaret' AND v.""Key"" = 'vitrin'
      CROSS JOIN ""Pages"" p
      WHERE rp.""CanAccess"" = TRUE AND p.""Id"" IN (5207,5208,5209,5210,5211,5212)
      ON CONFLICT (""RoleId"", ""PageId"") DO NOTHING;

      INSERT INTO ""RolePagePermissions"" (""RoleId"", ""PageId"", ""CanAccess"")
      SELECT r.""Id"", p.""Id"", TRUE
      FROM ""Roles"" r CROSS JOIN ""Pages"" p
      WHERE r.""IsSuperAdmin"" = TRUE AND p.""Id"" IN (5207,5208,5209,5210,5211,5212)
      ON CONFLICT (""RoleId"", ""PageId"") DO NOTHING;
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='RolePagePermissions')
       AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='Roles')
       AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='Roles' AND column_name='IsSuperAdmin')
    THEN
      INSERT INTO ""RolePagePermissions"" (""RoleId"", ""PageId"", ""CanAccess"")
      SELECT r.""Id"", p.""Id"", TRUE
      FROM ""Roles"" r
      CROSS JOIN ""Pages"" p
      WHERE r.""IsSuperAdmin"" = TRUE AND p.""Id"" IN (701, 702)
      ON CONFLICT (""RoleId"", ""PageId"") DO NOTHING;
    END IF;
  END IF;
  -- Urun fiyat gecmisi (2026-08-12). ProductPrices yalnizca GUNCEL fiyati tutuyor ve
  -- uzerine yaziliyor; gecmis hicbir yerde yoktu. Mevcut tabloya DOKUNULMADI.
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='Products') THEN
    CREATE TABLE IF NOT EXISTS ""ProductPriceHistories"" (
      ""Id"" uuid NOT NULL,
      ""ProductId"" uuid NOT NULL,
      ""StockCode"" character varying(50) NOT NULL,
      ""PriceGroupCode"" integer NOT NULL,
      ""OldPrice"" numeric(18,2) NOT NULL,
      ""NewPrice"" numeric(18,2) NOT NULL,
      ""ChangeRate"" numeric(18,6) NULL,
      ""ChangedAt"" timestamp with time zone NOT NULL DEFAULT now(),
      ""ChangedBy"" character varying(100) NOT NULL DEFAULT '',
      ""Source"" character varying(50) NOT NULL DEFAULT '',
      CONSTRAINT ""PK_ProductPriceHistories"" PRIMARY KEY (""Id"")
    );
    CREATE INDEX IF NOT EXISTS ""IX_ProductPriceHistories_Product_Group_Date""
      ON ""ProductPriceHistories"" (""ProductId"", ""PriceGroupCode"", ""ChangedAt"");
  END IF;
  CREATE TABLE IF NOT EXISTS ""UserCashAccounts"" (
    ""UserId"" integer NOT NULL,
    ""CashAccountId"" integer NOT NULL,
    PRIMARY KEY (""UserId"", ""CashAccountId"")
  );
  CREATE TABLE IF NOT EXISTS ""UserBankAccounts"" (
    ""UserId"" integer NOT NULL,
    ""BankAccountId"" integer NOT NULL,
    PRIMARY KEY (""UserId"", ""BankAccountId"")
  );
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE tablename = 'Customers' AND indexname = 'IX_Customers_MainCustomerCode') THEN
    IF EXISTS (SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid WHERE c.relname = 'IX_Customers_MainCustomerCode' AND i.indisunique = true) THEN
      DROP INDEX IF EXISTS ""IX_Customers_MainCustomerCode"";
      CREATE INDEX ""IX_Customers_MainCustomerCode"" ON ""Customers"" (""MainCustomerCode"") WHERE ""MainCustomerCode"" IS NOT NULL;
    END IF;
  END IF;
END $$;
";
                            await cmd1.ExecuteNonQueryAsync();
                        }

                        // Step 2: Mark migrations as applied in __EFMigrationsHistory so MigrateAsync skips them.
                        await using (var cmd2 = preConn.CreateCommand())
                        {
                            cmd2.CommandText = @"
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='__EFMigrationsHistory') THEN
    INSERT INTO ""__EFMigrationsHistory"" (""MigrationId"", ""ProductVersion"")
    VALUES ('20260525235726_AddTerminStatusToPurchaseInvoices', '8.0.0')
    ON CONFLICT (""MigrationId"") DO NOTHING;

    INSERT INTO ""__EFMigrationsHistory"" (""MigrationId"", ""ProductVersion"")
    VALUES ('20260627172222_AddInvoiceIsManuallyPaid', '8.0.0')
    ON CONFLICT (""MigrationId"") DO NOTHING;

    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='JwtSessionSettings' AND column_name='CampaignGiftAccountingMode') THEN
      INSERT INTO ""__EFMigrationsHistory"" (""MigrationId"", ""ProductVersion"")
      VALUES ('20260625233152_AddCampaignGiftSettings', '8.0.0')
      ON CONFLICT (""MigrationId"") DO NOTHING;
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='CampaignBuyRules') THEN
      INSERT INTO ""__EFMigrationsHistory"" (""MigrationId"", ""ProductVersion"")
      VALUES ('20260707161749_AddCampaignBuyRulesBack', '8.0.0')
      ON CONFLICT (""MigrationId"") DO NOTHING;
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='Virmans') THEN
      INSERT INTO ""__EFMigrationsHistory"" (""MigrationId"", ""ProductVersion"")
      VALUES ('20260707151232_AddVirman', '8.0.0')
      ON CONFLICT (""MigrationId"") DO NOTHING;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'PurchaseInvoices' AND column_name = 'CashAccountId'
    ) THEN
      INSERT INTO ""__EFMigrationsHistory"" (""MigrationId"", ""ProductVersion"")
      VALUES ('20260711225100_AddBankAccountTransactionIndexes', '8.0.0')
      ON CONFLICT (""MigrationId"") DO NOTHING;
    END IF;
  END IF;
END $$;
";
                            await cmd2.ExecuteNonQueryAsync();
                        }
                    }

                    var options = new DbContextOptionsBuilder<AppDbContext>()
                        .UseNpgsql(csb.ConnectionString)
                        .Options;

                    await using var tenantDb = new AppDbContext(options);
                    try
                    {
                        await tenantDb.Database.ExecuteSqlRawAsync(@"DROP INDEX IF EXISTS ""IX_Pages_ModuleKey_Key"";");
                        await tenantDb.Database.ExecuteSqlRawAsync(@"ALTER TABLE ""DeletionLogs"" ALTER COLUMN ""DetailsJson"" TYPE text;");
                        await tenantDb.Database.ExecuteSqlRawAsync(@"ALTER TABLE ""UserActivityLogs"" ALTER COLUMN ""DetailsJson"" TYPE text;");
                    }
                    catch {}

                    // Silme nedeni (2026-10-04) — varsayılan veritabanı yolundaki ile aynı.
                    try
                    {
                        await tenantDb.Database.ExecuteSqlRawAsync(@"ALTER TABLE ""DeletionLogs"" ADD COLUMN IF NOT EXISTS ""Reason"" character varying(1000) NULL;");
                    }
                    catch {}

                    // Ürüne özel kampanyalı fiyat (2026-10-07) — varsayılan veritabanı yolundaki ile aynı.
                    try
                    {
                        await tenantDb.Database.ExecuteSqlRawAsync(@"ALTER TABLE ""CampaignDiscounts"" ADD COLUMN IF NOT EXISTS ""HedefFiyat"" numeric(18,4) NULL;");
                    }
                    catch {}

                    await tenantDb.Database.MigrateAsync();
                    await BackfillDriftColumnsAsync(tenantDb, tenantDbName);
                    await BackfillModelSchemaAsync(tenantDb, tenantDbName);

                    await SealProductCurrencyMigrationForFreshDatabaseAsync(tenantDb);
                    await B2B.Erp.Api.Data.Services.VirtualPosSeeder.SeedPosDataAsync(tenantDb, vposLogger);

                    try
                    {
                        var tPg7 = await tenantDb.PriceGroups.FirstOrDefaultAsync(x => x.Code == 7);
                        if (tPg7 == null)
                        {
                            tenantDb.PriceGroups.Add(new PriceGroup
                            {
                                Id = new Guid("77777777-7777-7777-7777-777777777777"),
                                Code = 7,
                                Name = "Askeriye Tipi Fatura",
                                Formula = "REMOVE_KDV(F4*(1-DISCOUNT/100))",
                                InvoiceType = "ASKERIYE",
                                SortOrder = 7,
                                IsActive = true
                            });
                            await tenantDb.SaveChangesAsync();
                        }
                        else if (tPg7.InvoiceType != "ASKERIYE")
                        {
                            tPg7.InvoiceType = "ASKERIYE";
                            await tenantDb.SaveChangesAsync();
                        }

                        try
                        {
                            await tenantDb.Database.ExecuteSqlRawAsync(@"
                                -- ASKERIYE GERIYE DONUK YAZMA KALDIRILDI (2026-08-23).
                                --
                                -- Buradaki sekiz UPDATE her acilista kosulsuz calisiyordu ve iki ayri hata
                                -- iceriyordu:
                                --  1) Cari tipini ADINDAN turetiyordu (%TUGAY% %KOLORDU% %KOMUTAN%) ve fiyat
                                --     grubu 7 uyeligini KDV muafiyeti sayiyordu. Adinda Tugay gecen bir bayi
                                --     sessizce KDV siz sinifina duserdi. Cari tipi cari ekraninda atanir.
                                --  2) KESILMIS faturayi geriye donuk yeniden yaziyordu: VatTotal=0,
                                --     GrandTotal=NetTotal ve ekstre tutari. Fatura mali belgedir; kesildigi
                                --     andaki degeriyle kalir.
                                --
                                -- Normal akis zaten dogru calisiyor: InvoicesController / SalesOrdersController
                                -- fatura keserken Customers.InvoiceType degerine bakiyor. Bu blok tek seferlik
                                -- bir geriye donuk doldurmaydi, nobetci kaydina baglanmadigi icin aylardir her
                                -- acilista tekrar calisiyordu.
                                --
                                -- Asagidaki iki ifade KALDI: fiyat grubunun kendi tanimi ve grup 7 fiyat
                                -- satirlarinin tohumlanmasi. Ikisi de vergiye dokunmuyor ve idempotent.
                                UPDATE ""PriceGroups"" SET ""InvoiceType"" = 'ASKERIYE' WHERE ""Code"" = 7;
                                -- ""ProductPrices"" tablosunda ""IsActive""/""CreateUser""/""CreateTime"" kolonlari YOK
                                -- (2026-09-05 denetimi): asagidaki INSERT bu yuzden ""column does not exist"" ile
                                -- HER ACILISTA sessizce patliyordu (dis try/catch yutuyordu) ve yeni urunler grup 7
                                -- (ASKERIYE) fiyati hic almiyordu. Kolon listesi gercek semaya indirildi.
                                INSERT INTO ""ProductPrices"" (""Id"", ""ProductId"", ""PriceGroupId"", ""Price"", ""Currency"")
                                SELECT gen_random_uuid(), p.""Id"", (SELECT ""Id"" FROM ""PriceGroups"" WHERE ""Code"" = 7 LIMIT 1), COALESCE((SELECT pp.""Price"" FROM ""ProductPrices"" pp JOIN ""PriceGroups"" pg ON pp.""PriceGroupId"" = pg.""Id"" WHERE pp.""ProductId"" = p.""Id"" AND pg.""Code"" = 3 LIMIT 1), (SELECT pp.""Price"" FROM ""ProductPrices"" pp JOIN ""PriceGroups"" pg ON pp.""PriceGroupId"" = pg.""Id"" WHERE pp.""ProductId"" = p.""Id"" AND pg.""Code"" = 1 LIMIT 1), p.""PurchasePrice"", 0), COALESCE((SELECT pp.""Currency"" FROM ""ProductPrices"" pp JOIN ""PriceGroups"" pg ON pp.""PriceGroupId"" = pg.""Id"" WHERE pp.""ProductId"" = p.""Id"" AND pg.""Code"" = 3 LIMIT 1), 'TRY') FROM ""Products"" p WHERE (SELECT ""Id"" FROM ""PriceGroups"" WHERE ""Code"" = 7 LIMIT 1) IS NOT NULL AND NOT EXISTS (SELECT 1 FROM ""ProductPrices"" pp2 WHERE pp2.""ProductId"" = p.""Id"" AND pp2.""PriceGroupId"" = (SELECT ""Id"" FROM ""PriceGroups"" WHERE ""Code"" = 7 LIMIT 1));
                            ");
                        }
                        catch {}
                    }
                    catch {}

                    try
                    {
                        await tenantDb.Database.ExecuteSqlRawAsync(@"CREATE UNIQUE INDEX IF NOT EXISTS ""IX_Pages_ModuleKey_Key"" ON ""Pages"" (""ModuleKey"", ""Key"");");
                    }
                    catch {}

                    await tenantDb.Database.ExecuteSqlRawAsync(@"
UPDATE ""Pages""
SET ""DisplayName"" = 'Stok Giriş/Çıkış Raporu'
WHERE ""Key"" = 'muhasebeStokGirisCikisRaporu';

UPDATE ""Pages""
SET ""ModuleKey"" = 'cash'
WHERE ""Key"" = 'virmanListesi';

UPDATE ""PriceGroups""
SET ""InvoiceType"" = 'ACIK'
WHERE ""Code"" = 4;
");
                    // KALDIRILDI (2026-10-14 canlı bildirim: "güncellemeyi her attıkça bu carinin tipi değişiyor").
                    // Burada HER AÇILIŞTA koşulsuz bir UPDATE vardı: plasiyeri 100 (MAGAZA) ya da adı "mağaza"
                    // olan BÜTÜN carileri (alt hesaplarıyla) zorla grup 4 + ACIK yapıyordu. 2026-09-16'da 524
                    // müşteri carisi MAGAZA plasiyerine atandığı için her paket/yeniden başlatmada elle faturalıya
                    // alınan cariler açığa dönüyor, -1 fatura hesabı da ACIK/grup 4 olup satış faturası KDV'siz
                    // kesiliyordu (120-03-004623). Mevcut cariler olduğu gibi kalır; artık yalnız kullanıcının
                    // verdiği tip geçerli.

                    // Seed pages and tables for each tenant database during startup
                    await tenantDb.Database.ExecuteSqlRawAsync(@"
DO $$
DECLARE
  users_page_id integer;
  invoice_page_id integer;
  final_invoice_page_id integer;
BEGIN
  SELECT ""Id"" INTO users_page_id
  FROM ""Pages""
  WHERE ""ModuleKey"" = 'users' AND ""Key"" = 'irsaliye'
  LIMIT 1;

  SELECT ""Id"" INTO invoice_page_id
  FROM ""Pages""
  WHERE ""ModuleKey"" = 'invoice' AND ""Key"" = 'irsaliye'
  LIMIT 1;

  IF users_page_id IS NOT NULL AND invoice_page_id IS NULL THEN
    UPDATE ""Pages""
    SET ""ModuleKey"" = 'invoice',
        ""DisplayName"" = 'Konsinye',
        ""SortOrder"" = 12
    WHERE ""Id"" = users_page_id;
    final_invoice_page_id := users_page_id;
  ELSIF users_page_id IS NOT NULL AND invoice_page_id IS NOT NULL THEN
    UPDATE ""RolePagePermissions""
    SET ""PageId"" = invoice_page_id
    WHERE ""PageId"" = users_page_id;

    DELETE FROM ""Pages"" WHERE ""Id"" = users_page_id;
    final_invoice_page_id := invoice_page_id;
  ELSIF invoice_page_id IS NOT NULL THEN
    UPDATE ""Pages""
    SET ""DisplayName"" = 'Konsinye',
        ""SortOrder"" = 12
    WHERE ""Id"" = invoice_page_id;
    final_invoice_page_id := invoice_page_id;
  END IF;

  IF final_invoice_page_id IS NOT NULL THEN
    -- RoleId 9 (AltBayi) deliberately excluded: it is limited to order entry + POS payment,
    -- so granting it anything else only produces permissions that can never take effect.
    INSERT INTO ""RolePagePermissions"" (""RoleId"", ""PageId"", ""CanAccess"")
    SELECT r, final_invoice_page_id, TRUE
    FROM (SELECT ""Id"" FROM ""Roles"" WHERE ""Id"" = ANY(ARRAY[6,8,12,3,10,2])) AS rr(r)
    ON CONFLICT (""RoleId"", ""PageId"") DO NOTHING;
  END IF;
END $$;
");

                    await tenantDb.Database.ExecuteSqlRawAsync(@"
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'CustomerChecks'
      AND indexname = 'IX_CustomerChecks_VBordroNo'
      AND indexdef ILIKE '%UNIQUE%'
  ) THEN
    EXECUTE 'DROP INDEX IF EXISTS ""IX_CustomerChecks_VBordroNo""';
    EXECUTE 'CREATE INDEX IF NOT EXISTS ""IX_CustomerChecks_VBordroNo"" ON ""CustomerChecks"" (""VBordroNo"")';
  END IF;
END $$;
");

                    await tenantDb.Database.ExecuteSqlRawAsync(@"
ALTER TABLE ""Campaigns"" ADD COLUMN IF NOT EXISTS ""KampanyaTipi"" integer NOT NULL DEFAULT 1;
");

                    await tenantDb.Database.ExecuteSqlRawAsync(@"
ALTER TABLE ""Campaigns"" ADD COLUMN IF NOT EXISTS ""SubeKodu"" character varying(50) NULL;
");

                    // `MinStock` = stok alarmı ("bitmek üzere"), `BsyMinStock` = satışa kapanma
                    // eşiği. AYRI şeyler; ikisi tek kolona bindirilmemeli.
                    await tenantDb.Database.ExecuteSqlRawAsync(@"
ALTER TABLE ""Products"" ADD COLUMN IF NOT EXISTS ""MinStock"" integer NOT NULL DEFAULT 0;
ALTER TABLE ""Products"" ADD COLUMN IF NOT EXISTS ""BsyMinStock"" integer NOT NULL DEFAULT 12;
ALTER TABLE ""Products"" ADD COLUMN IF NOT EXISTS ""DisplayName"" character varying(300) NULL;
");

                    await tenantDb.Database.ExecuteSqlRawAsync(@"
CREATE TABLE IF NOT EXISTS ""Employees"" (
  ""Id"" integer GENERATED BY DEFAULT AS IDENTITY,
  ""FirstName"" character varying(100) NOT NULL,
  ""LastName"" character varying(100) NOT NULL,
  ""Mail"" character varying(200) NOT NULL,
  ""Tc"" character varying(20) NOT NULL,
  ""Phone"" character varying(30) NOT NULL,
  ""TaxNo"" character varying(30) NOT NULL,
  ""TaxOffice"" character varying(100) NOT NULL,
  ""IsActive"" boolean NOT NULL DEFAULT TRUE,
  ""CreateUser"" character varying(50) NOT NULL,
  ""CreateTime"" timestamp with time zone NOT NULL,
  ""EditUser"" character varying(50) NULL,
  ""EditTime"" timestamp with time zone NULL,
  CONSTRAINT ""PK_Employees"" PRIMARY KEY (""Id"")
);

CREATE UNIQUE INDEX IF NOT EXISTS ""IX_Employees_Tc"" ON ""Employees"" (""Tc"");
");

                    await tenantDb.Database.ExecuteSqlRawAsync(@"
CREATE TABLE IF NOT EXISTS ""EmployeeFaceEmbeddings"" (
  ""Id"" integer GENERATED BY DEFAULT AS IDENTITY,
  ""EmployeeId"" integer NOT NULL,
  ""EmbeddingJson"" text NOT NULL DEFAULT '[]',
  ""CreateUser"" character varying(50) NOT NULL DEFAULT '',
  ""CreateTime"" timestamp with time zone NOT NULL DEFAULT now(),
  ""EditUser"" character varying(50) NULL,
  ""EditTime"" timestamp with time zone NULL,
  CONSTRAINT ""PK_EmployeeFaceEmbeddings"" PRIMARY KEY (""Id""),
  CONSTRAINT ""FK_EmployeeFaceEmbeddings_Employees"" FOREIGN KEY (""EmployeeId"") REFERENCES ""Employees"" (""Id"") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS ""IX_EmployeeFaceEmbeddings_EmployeeId"" ON ""EmployeeFaceEmbeddings"" (""EmployeeId"");
");

                    await tenantDb.Database.ExecuteSqlRawAsync(@"
CREATE TABLE IF NOT EXISTS ""JwtSessionSettings"" (
  ""Id"" integer GENERATED BY DEFAULT AS IDENTITY,
  ""AccessTokenExpirationMinutes"" integer NOT NULL,
  ""AlertBeforeMinutes"" integer NOT NULL,
  ""UpdatedAtUtc"" timestamp with time zone NOT NULL,
  ""UpdatedByUserId"" integer NULL,
  CONSTRAINT ""PK_JwtSessionSettings"" PRIMARY KEY (""Id"")
);
ALTER TABLE ""JwtSessionSettings"" ADD COLUMN IF NOT EXISTS ""InvoiceDeleteLockDate"" timestamp with time zone NULL;
ALTER TABLE ""JwtSessionSettings"" ADD COLUMN IF NOT EXISTS ""InvoiceTrackingStartDate"" timestamp with time zone NULL;
");

                    await tenantDb.Database.ExecuteSqlRawAsync(@"
DELETE FROM ""RolePagePermissions"" WHERE ""PageId"" IN (SELECT ""Id"" FROM ""Pages"" WHERE ""Key""='faturaDokum2024');
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='TenantEnabledPages') THEN
    DELETE FROM ""TenantEnabledPages"" WHERE ""PageId"" IN (SELECT ""Id"" FROM ""Pages"" WHERE ""Key""='faturaDokum2024');
  END IF;
END $$;
DELETE FROM ""Pages"" WHERE ""Key""='faturaDokum2024';

INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 300, 'BSY(H): Ürünü Gösterme', TRUE, 'bsyHHide', 'invoice', 102
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""ModuleKey""='invoice' AND ""Key""='bsyHHide')
  AND NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id""=300);

INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 301, 'BSY(H): ComingSoon ile Göster', TRUE, 'bsyHComingSoon', 'invoice', 103
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""ModuleKey""='invoice' AND ""Key""='bsyHComingSoon')
  AND NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id""=301);

INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 302, 'Satış Faturası: Depo Bakiyesi Görsün', TRUE, 'satisFaturaDepoBakiyeGorsun', 'invoice', 104
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""ModuleKey""='invoice' AND ""Key""='satisFaturaDepoBakiyeGorsun')
  AND NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id""=302);

INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 303, 'Satış Faturası: Ödemeyi Hemen Al', TRUE, 'satisFaturaOdemeAl', 'invoice', 105
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""ModuleKey""='invoice' AND ""Key""='satisFaturaOdemeAl')
  AND NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id""=303);

INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 304, 'Satış Faturası: Proformadan Gelenleri Görsün', TRUE, 'satisFaturaProformaGorsun', 'invoice', 106
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""ModuleKey""='invoice' AND ""Key""='satisFaturaProformaGorsun')
  AND NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id""=304);

INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 305, 'Satış Faturası: Siparişten Gelenleri Görsün', TRUE, 'satisFaturaSiparisGorsun', 'invoice', 107
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""ModuleKey""='invoice' AND ""Key""='satisFaturaSiparisGorsun')
  AND NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id""=305);

INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 306, 'Satış Faturası: Mağaza Siparişinden Gelenleri Görsün', TRUE, 'satisFaturaMagazaSiparisGorsun', 'invoice', 108
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""ModuleKey""='invoice' AND ""Key""='satisFaturaMagazaSiparisGorsun')
  AND NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id""=306);

INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 307, 'Satış Faturası: Servisten Gelenleri Görsün', TRUE, 'satisFaturaServisGorsun', 'invoice', 109
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""ModuleKey""='invoice' AND ""Key""='satisFaturaServisGorsun')
  AND NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id""=307);

INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 308, 'Satış Faturası: Konsinyeden Gelenleri Görsün', TRUE, 'satisFaturaKonsinyeGorsun', 'invoice', 110
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""ModuleKey""='invoice' AND ""Key""='satisFaturaKonsinyeGorsun')
  AND NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id""=308);

DELETE FROM ""RolePagePermissions"" WHERE ""PageId"" IN (SELECT ""Id"" FROM ""Pages"" WHERE ""ModuleKey""='invoice' AND ""Key""='etiket');
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='TenantEnabledPages') THEN
    DELETE FROM ""TenantEnabledPages"" WHERE ""PageId"" IN (SELECT ""Id"" FROM ""Pages"" WHERE ""ModuleKey""='invoice' AND ""Key""='etiket');
  END IF;
END $$;
DELETE FROM ""Pages"" WHERE ""ModuleKey""='invoice' AND ""Key""='etiket';

INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 160, 'Etiket Basım (Fiyatlı)', TRUE, 'etiketFiyatli', 'invoice', 6
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""ModuleKey""='invoice' AND ""Key""='etiketFiyatli')
  AND NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id""=160);

INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 161, 'Etiket Basım (Fiyatsız)', TRUE, 'etiketFiyatsiz', 'invoice', 7
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""ModuleKey""='invoice' AND ""Key""='etiketFiyatsiz')
  AND NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id""=161);

INSERT INTO ""RolePagePermissions"" (""RoleId"", ""PageId"", ""CanAccess"")
SELECT r.""Id"", p.""Id"", TRUE
FROM ""Roles"" r
CROSS JOIN ""Pages"" p
WHERE p.""Key"" IN ('etiketFiyatli', 'etiketFiyatsiz')
AND NOT EXISTS (
    SELECT 1 FROM ""RolePagePermissions"" rpp WHERE rpp.""RoleId"" = r.""Id"" AND rpp.""PageId"" = p.""Id""
);

INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 400, 'Çalışan', TRUE, 'calisan', 'employee', 1
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Key""='calisan' OR ""Id""=400);

UPDATE ""Pages""
SET ""ModuleKey""='employee', ""SortOrder""=1
WHERE (""Id""=400 OR ""Key""='calisan') AND ""ModuleKey"" <> 'employee';

-- PERSONEL PORTALI YONETIM SAYFALARI (2026-08-23).
-- ERP kullanicisi personel portalina YONETICI olarak girdiginde hangi sayfayi gorecegi
-- rolunden gelir. Her sayfa AYRI satir; portalin menusu ve rotalari giris cevabinda donen
-- bu anahtarlara gore suzulur.
--
-- DIKKAT: rol yetkisi satiri BILEREK acilmiyor. Sayfalar herkese KAPALI dogar; yetki
-- Rol Yetkileri ekranindan tek tek verilir.
--
-- Sabit PageId yazarken Id kontrolu sart: firmaya gore o Id baska bir sayfada olabilir,
-- yoksa PK_Pages patlar ve acilis dongusu o kiracida komple duser.
-- Kiosk/self-servis sayfalari (Yuzle Giris/Cikis, QR Okut, Bilgilerim) bu kapiya girmez;
-- onlar calisanlarin, ERP kullanicisini ilgilendirmiyor.

INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 30000, 'Panel', TRUE, 'personelPanel', 'employee', 10
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""ModuleKey""='employee' AND ""Key""='personelPanel')
  AND NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id""=30000);

INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 30001, 'Çalışanlar', TRUE, 'personelCalisanlar', 'employee', 11
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""ModuleKey""='employee' AND ""Key""='personelCalisanlar')
  AND NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id""=30001);

INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 30002, 'İzin Yönetimi', TRUE, 'personelIzinler', 'employee', 12
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""ModuleKey""='employee' AND ""Key""='personelIzinler')
  AND NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id""=30002);

INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 30003, 'Hakedişler', TRUE, 'personelHakedis', 'employee', 13
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""ModuleKey""='employee' AND ""Key""='personelHakedis')
  AND NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id""=30003);

INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 30004, 'Cari Ekstre', TRUE, 'personelEkstre', 'employee', 14
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""ModuleKey""='employee' AND ""Key""='personelEkstre')
  AND NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id""=30004);

INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 30005, 'Maaş Ödemeleri', TRUE, 'personelMaas', 'employee', 15
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""ModuleKey""='employee' AND ""Key""='personelMaas')
  AND NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id""=30005);

INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 30006, 'Avanslar', TRUE, 'personelAvans', 'employee', 16
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""ModuleKey""='employee' AND ""Key""='personelAvans')
  AND NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id""=30006);

INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 30007, 'Prim Ödemeleri', TRUE, 'personelPrim', 'employee', 17
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""ModuleKey""='employee' AND ""Key""='personelPrim')
  AND NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id""=30007);

INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 30008, 'Yemek Ödemeleri', TRUE, 'personelYemek', 'employee', 18
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""ModuleKey""='employee' AND ""Key""='personelYemek')
  AND NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id""=30008);

INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 30009, 'Kasa Hareketleri', TRUE, 'personelKasa', 'employee', 19
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""ModuleKey""='employee' AND ""Key""='personelKasa')
  AND NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id""=30009);

INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 30010, 'Mesai Tanımları', TRUE, 'personelMesaiTanimlari', 'employee', 20
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""ModuleKey""='employee' AND ""Key""='personelMesaiTanimlari')
  AND NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id""=30010);

INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 30011, 'Tatil Takvimi', TRUE, 'personelTatilTakvimi', 'employee', 21
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""ModuleKey""='employee' AND ""Key""='personelTatilTakvimi')
  AND NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id""=30011);

INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 30012, 'Yüz ile Giriş Linki', TRUE, 'personelYuzLink', 'employee', 22
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""ModuleKey""='employee' AND ""Key""='personelYuzLink')
  AND NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id""=30012);

INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 30013, 'QR Test & Üretici', TRUE, 'personelQrTest', 'employee', 23
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""ModuleKey""='employee' AND ""Key""='personelQrTest')
  AND NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id""=30013);

INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 30014, 'Konum Ayarları', TRUE, 'personelKonumAyarlari', 'employee', 24
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""ModuleKey""='employee' AND ""Key""='personelKonumAyarlari')
  AND NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id""=30014);

INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT (SELECT COALESCE(MAX(""Id""), 0) + 1 FROM ""Pages""), 'Genel Ayarlar', TRUE, 'genelAyarlar', 'users', 14
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""ModuleKey""='users' AND ""Key""='genelAyarlar')
  -- Sabit PageId firmaya gore baska bir sayfada olabilir (2026-08-23):
  -- Id kontrolu olmadan PK_Pages patlar ve acilis dongusu komple duser.
  AND NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id""=402);

INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 402, 'Kampanya Tanım', TRUE, 'kampanya', 'users', 19
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""ModuleKey""='users' AND ""Key""='kampanya')
  AND NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id""=402);

INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 10450, 'Konsinye: Kaç Adet Düzenle', TRUE, 'irsaliyeQuantityEdit', 'invoice', 200
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""ModuleKey""='invoice' AND ""Key""='irsaliyeQuantityEdit')
  AND NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id""=10450);

INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 10451, 'Konsinye: Sevk Adedi Düzenle', TRUE, 'irsaliyeShippedQuantityEdit', 'invoice', 201
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""ModuleKey""='invoice' AND ""Key""='irsaliyeShippedQuantityEdit')
  AND NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id""=10451);

INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 10452, 'Konsinye: Durum Onaylandı', TRUE, 'irsaliyeStatusOnaylandi', 'invoice', 202
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""ModuleKey""='invoice' AND ""Key""='irsaliyeStatusOnaylandi')
  AND NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id""=10452);

INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 10453, 'Konsinye: Durum Sevk Edildi', TRUE, 'irsaliyeStatusSevkEdildi', 'invoice', 203
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""ModuleKey""='invoice' AND ""Key""='irsaliyeStatusSevkEdildi')
  AND NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id""=10453);

INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 10454, 'Cari Proforma', TRUE, 'bayiTeklifleri', 'invoice', 204
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""ModuleKey""='invoice' AND ""Key""='bayiTeklifleri')
  -- Sabit PageId firmaya gore baska bir sayfada olabilir (2026-08-23):
  -- Id kontrolu olmadan PK_Pages patlar ve acilis dongusu komple duser.
  AND NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id""=10454);

INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 10455, 'Cari Müşteri Teklifi', TRUE, 'cariTeklifleri', 'invoice', 205
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""ModuleKey""='invoice' AND ""Key""='cariTeklifleri')
  -- Sabit PageId firmaya gore baska bir sayfada olabilir (2026-08-23):
  -- Id kontrolu olmadan PK_Pages patlar ve acilis dongusu komple duser.
  AND NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id""=10455);

-- Kapsam yetkisi: butun cari musteri tekliflerini/proformalarini gorur (sahibi kim olursa olsun).
INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 10460, 'Cari Müşteri Teklifi: Hepsini Görsün', TRUE, 'cariTeklifleriTumu', 'invoice', 10460
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""ModuleKey""='invoice' AND ""Key""='cariTeklifleriTumu')
  -- Sabit PageId firmaya gore baska bir sayfada olabilir (2026-08-23):
  -- Id kontrolu olmadan PK_Pages patlar ve acilis dongusu komple duser.
  AND NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id""=10460);

-- Davranis korunsun diye: bu yetki, cari teklifleri zaten goren YONETIM rollerine acilir.
-- Bayi/AltBayi bilerek DISARIDA — onlar yalnizca kendi carilerininkini gormeli.
-- Yalnizca sayfa ilk olusturuldugunda calisir; sonradan elle kapatilirsa geri acilmaz.
INSERT INTO ""RolePagePermissions"" (""RoleId"", ""PageId"", ""CanAccess"")
SELECT r.""Id"", 10460, TRUE
FROM ""Roles"" r
WHERE lower(r.""Code"") IN ('superadmin','yonetim','mudur','muhasebe','admin')
  AND EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id"" = 10460)
  AND NOT EXISTS (SELECT 1 FROM ""RolePagePermissions"" p WHERE p.""RoleId"" = r.""Id"" AND p.""PageId"" = 10460);

INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 10456, 'Düzenle', TRUE, 'cariTeklifleriDuzenle', 'invoice', 10456
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""ModuleKey""='invoice' AND ""Key""='cariTeklifleriDuzenle')
  -- Sabit PageId firmaya gore baska bir sayfada olabilir (2026-08-23):
  -- Id kontrolu olmadan PK_Pages patlar ve acilis dongusu komple duser.
  AND NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id""=10456);

INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 10457, 'Sil', TRUE, 'cariTeklifleriSil', 'invoice', 10457
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""ModuleKey""='invoice' AND ""Key""='cariTeklifleriSil')
  -- Sabit PageId firmaya gore baska bir sayfada olabilir (2026-08-23):
  -- Id kontrolu olmadan PK_Pages patlar ve acilis dongusu komple duser.
  AND NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id""=10457);

INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 10458, 'Proforma Aktar', TRUE, 'cariTeklifleriProformaAktar', 'invoice', 10458
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""ModuleKey""='invoice' AND ""Key""='cariTeklifleriProformaAktar')
  -- Sabit PageId firmaya gore baska bir sayfada olabilir (2026-08-23):
  -- Id kontrolu olmadan PK_Pages patlar ve acilis dongusu komple duser.
  AND NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id""=10458);

INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 10459, 'Basım', TRUE, 'cariTeklifleriBasim', 'invoice', 10459
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""ModuleKey""='invoice' AND ""Key""='cariTeklifleriBasim')
  -- Sabit PageId firmaya gore baska bir sayfada olabilir (2026-08-23):
  -- Id kontrolu olmadan PK_Pages patlar ve acilis dongusu komple duser.
  AND NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id""=10459);

INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 105, 'Termin', TRUE, 'termin', 'invoice', 14
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""ModuleKey""='invoice' AND ""Key""='termin')
  -- Sabit PageId firmaya gore baska bir sayfada olabilir (2026-08-23):
  -- Id kontrolu olmadan PK_Pages patlar ve acilis dongusu komple duser.
  AND NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id""=105);

-- Seed permissions for other invoice pages
INSERT INTO ""RolePagePermissions"" (""RoleId"", ""PageId"", ""CanAccess"")
SELECT r, p.""Id"", TRUE
FROM (SELECT ""Id"" FROM ""Roles"" WHERE ""Id"" = ANY(ARRAY[6,8,12,3,10,2])) AS rr(r)
CROSS JOIN (
  SELECT ""Id""
  FROM ""Pages""
  WHERE ""ModuleKey""='invoice'
    AND ""Key"" IN ('irsaliyeQuantityEdit','irsaliyeShippedQuantityEdit','irsaliyeStatusOnaylandi','irsaliyeStatusSevkEdildi', 'bayiTeklifleri', 'termin')
) AS p
ON CONFLICT (""RoleId"", ""PageId"") DO NOTHING;

-- Seed permissions for Cari Teklifleri (roles: 1 SuperAdmin, 2 Yönetim, 8 Bayi)
INSERT INTO ""RolePagePermissions"" (""RoleId"", ""PageId"", ""CanAccess"")
SELECT r, p.""Id"", TRUE
FROM (SELECT ""Id"" FROM ""Roles"" WHERE ""Id"" = ANY(ARRAY[1,2,8])) AS rr(r)
CROSS JOIN (
  SELECT ""Id""
  FROM ""Pages""
  WHERE ""ModuleKey""='invoice'
    AND ""Key"" IN ('cariTeklifleri', 'cariTeklifleriDuzenle', 'cariTeklifleriSil', 'cariTeklifleriProformaAktar', 'cariTeklifleriBasim')
) AS p
ON CONFLICT (""RoleId"", ""PageId"") DO NOTHING;

-- CARI TEKLIFLERI YETKI IPTALI KALDIRILDI (2026-08-23, kullanici karari).
--
-- Burada, her ACILISTA kosan bir yetki SILME cumlesi vardi: Cari Teklifleri sayfalarini
-- SuperAdmin/Yonetim/Bayi disindaki BUTUN rollerden kaldiriyordu.
-- Yalnizca ilk kurulumu ayarlamiyor, Rol Yetkileri ekranindan ELLE verilen yetkiyi de
-- geri aliyordu — hem de sessizce. Yonetici yetkiyi veriyor, calisiyor, ilk yeniden
-- baslatmada kayboluyor ve sebebi hicbir yerde gorunmuyordu.
--
-- 2026-08-23'te canlida tam bu oldu: yeni DLL atilinca uygulama yeniden basladi ve 11 rol
-- bu 5 sayfadaki yetkisini bir anda kaybetti (rol basina 5 satir).
--
-- Yetki artik TAMAMEN Rol Yetkileri ekranindan yonetiliyor. Yukaridaki tohumlama duruyor:
-- sayfalar ilk olustugunda varsayilan yine 1/2/8'e aciliyor, `ON CONFLICT DO NOTHING`
-- oldugu icin sonradan yapilan degisikliklere dokunmuyor.
--
-- Ayni kalip baska bir sayfaya eklenecekse: acilista SILME yazma, yalnizca tohumla.

INSERT INTO ""RolePagePermissions"" (""RoleId"", ""PageId"", ""CanAccess"")
SELECT r, pid, TRUE
-- Rol ve sayfa kimlikleri firmaya gore degisir (2026-08-23): ikisi de kendi
-- tablosundan dogrulaniyor. Sabit Id yazilinca olmayan role/sayfaya yetki
-- yazilmaya calisiliyor, FK patliyor ve acilis dongusu O KIRACI icin komple dusuyor.
FROM (SELECT ""Id"" FROM ""Roles"" WHERE ""Id"" = ANY(ARRAY[1,6,2])) AS rr(r)
CROSS JOIN (SELECT ""Id"" FROM ""Pages"" WHERE ""Id"" = 500) AS pp(pid)
ON CONFLICT (""RoleId"", ""PageId"") DO NOTHING;

INSERT INTO ""RolePagePermissions"" (""RoleId"", ""PageId"", ""CanAccess"")
SELECT r, pid, TRUE
-- Rol ve sayfa kimlikleri firmaya gore degisir (2026-08-23): ikisi de kendi
-- tablosundan dogrulaniyor. Sabit Id yazilinca olmayan role/sayfaya yetki
-- yazilmaya calisiliyor, FK patliyor ve acilis dongusu O KIRACI icin komple dusuyor.
FROM (SELECT ""Id"" FROM ""Roles"" WHERE ""Id"" = ANY(ARRAY[1,6,2])) AS rr(r)
CROSS JOIN (SELECT ""Id"" FROM ""Pages"" WHERE ""Id"" = 501) AS pp(pid)
ON CONFLICT (""RoleId"", ""PageId"") DO NOTHING;

UPDATE ""Pages""
SET ""DisplayName"" = 'Stok Giriş/Çıkış Raporu'
WHERE ""Id"" = 38 OR (""ModuleKey"" = 'reports' AND ""Key"" = 'muhasebeStokGirisCikisRaporu');

INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 600, 'Fatura Dökümü', TRUE, 'deleteRule/faturaDokum', 'deleteRule', 1
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""ModuleKey""='deleteRule' AND ""Key""='deleteRule/faturaDokum')
  -- Sabit PageId firmaya gore baska bir sayfada olabilir (2026-08-23):
  -- Id kontrolu olmadan PK_Pages patlar ve acilis dongusu komple duser.
  AND NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id""=600);

INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 601, 'Müşteri Teklifi', TRUE, 'deleteRule/musteriTeklifi', 'deleteRule', 2
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""ModuleKey""='deleteRule' AND ""Key""='deleteRule/musteriTeklifi')
  -- Sabit PageId firmaya gore baska bir sayfada olabilir (2026-08-23):
  -- Id kontrolu olmadan PK_Pages patlar ve acilis dongusu komple duser.
  AND NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id""=601);

INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 605, 'Garanti Değişim', TRUE, 'deleteRule/garantiDegisim', 'deleteRule', 6
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""ModuleKey""='deleteRule' AND ""Key""='deleteRule/garantiDegisim')
  -- Sabit PageId firmaya gore baska bir sayfada olabilir (2026-08-23):
  -- Id kontrolu olmadan PK_Pages patlar ve acilis dongusu komple duser.
  AND NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id""=605);

                    INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
                    SELECT 600, 'Fatura Dökümü', TRUE, 'deleteRule/faturaDokum', 'deleteRule', 1
                    WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""ModuleKey""='deleteRule' AND ""Key""='deleteRule/faturaDokum')
                      -- Sabit PageId firmaya gore baska bir sayfada olabilir (2026-08-23):
                      -- Id kontrolu olmadan PK_Pages patlar ve acilis dongusu komple duser.
                      AND NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id""=600);

                    INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
                    SELECT 601, 'Müşteri Teklifi', TRUE, 'deleteRule/musteriTeklifi', 'deleteRule', 2
                    WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""ModuleKey""='deleteRule' AND ""Key""='deleteRule/musteriTeklifi')
                      -- Sabit PageId firmaya gore baska bir sayfada olabilir (2026-08-23):
                      -- Id kontrolu olmadan PK_Pages patlar ve acilis dongusu komple duser.
                      AND NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id""=601);

                    INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
                    SELECT 602, 'Proforma', TRUE, 'deleteRule/proforma', 'deleteRule', 3
                    WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""ModuleKey""='deleteRule' AND ""Key""='deleteRule/proforma')
                      -- Sabit PageId firmaya gore baska bir sayfada olabilir (2026-08-23):
                      -- Id kontrolu olmadan PK_Pages patlar ve acilis dongusu komple duser.
                      AND NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id""=602);

                    INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
                    SELECT 603, 'Alış Faturaları', TRUE, 'deleteRule/alis', 'deleteRule', 4
                    WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""ModuleKey""='deleteRule' AND ""Key""='deleteRule/alis')
                      -- Sabit PageId firmaya gore baska bir sayfada olabilir (2026-08-23):
                      -- Id kontrolu olmadan PK_Pages patlar ve acilis dongusu komple duser.
                      AND NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id""=603);

                    INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
                    SELECT 604, 'Tüm İşlemleri Silebilsin', TRUE, 'deleteRule/tumIslemleriSilebilsin', 'deleteRule', 5
                    WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""ModuleKey""='deleteRule' AND ""Key""='deleteRule/tumIslemleriSilebilsin')
                      -- Sabit PageId firmaya gore baska bir sayfada olabilir (2026-08-23):
                      -- Id kontrolu olmadan PK_Pages patlar ve acilis dongusu komple duser.
                      AND NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id""=604);

                    INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
                    SELECT 605, 'Garanti Değişim', TRUE, 'deleteRule/garantiDegisim', 'deleteRule', 6
                    WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""ModuleKey""='deleteRule' AND ""Key""='deleteRule/garantiDegisim')
                      -- Sabit PageId firmaya gore baska bir sayfada olabilir (2026-08-23):
                      -- Id kontrolu olmadan PK_Pages patlar ve acilis dongusu komple duser.
                      AND NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id""=605);

                    INSERT INTO ""RolePagePermissions"" (""RoleId"", ""PageId"", ""CanAccess"")
                    SELECT r, pid, TRUE
                    -- Rol ve sayfa kimlikleri firmaya gore degisir (2026-08-23): ikisi de kendi
                    -- tablosundan dogrulaniyor. Sabit Id yazilinca olmayan role/sayfaya yetki
                    -- yazilmaya calisiliyor, FK patliyor ve acilis dongusu O KIRACI icin komple dusuyor.
                    FROM (SELECT ""Id"" FROM ""Roles"" WHERE ""Id"" = ANY(ARRAY[1,6,2])) AS rr(r)
                    CROSS JOIN (SELECT ""Id"" FROM ""Pages"" WHERE ""Id"" = 604) AS pp(pid)
                    ON CONFLICT (""RoleId"", ""PageId"") DO NOTHING;


                    INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
                    SELECT 110, 'Ödeme Alındı', TRUE, 'faturaDokumOdemeAlindi', 'invoice', 110
                    WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""ModuleKey""='invoice' AND ""Key""='faturaDokumOdemeAlindi')
                      -- Sabit PageId firmaya gore baska bir sayfada olabilir (2026-08-23):
                      -- Id kontrolu olmadan PK_Pages patlar ve acilis dongusu komple duser.
                      AND NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id""=110);

                    INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
                    SELECT 111, 'Nakit Miktar', TRUE, 'faturaDokumNakitMiktar', 'invoice', 111
                    WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""ModuleKey""='invoice' AND ""Key""='faturaDokumNakitMiktar')
                      -- Sabit PageId firmaya gore baska bir sayfada olabilir (2026-08-23):
                      -- Id kontrolu olmadan PK_Pages patlar ve acilis dongusu komple duser.
                      AND NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id""=111);

                    INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
                    SELECT 112, 'Barkod', TRUE, 'faturaDokumBarkod', 'invoice', 112
                    WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""ModuleKey""='invoice' AND ""Key""='faturaDokumBarkod')
                      -- Sabit PageId firmaya gore baska bir sayfada olabilir (2026-08-23):
                      -- Id kontrolu olmadan PK_Pages patlar ve acilis dongusu komple duser.
                      AND NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id""=112);

                    INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
                    SELECT 113, 'Basım', TRUE, 'faturaDokumBasim', 'invoice', 113
                    WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""ModuleKey""='invoice' AND ""Key""='faturaDokumBasim')
                      -- Sabit PageId firmaya gore baska bir sayfada olabilir (2026-08-23):
                      -- Id kontrolu olmadan PK_Pages patlar ve acilis dongusu komple duser.
                      AND NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id""=113);

                    INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
                    SELECT 114, 'Sil', TRUE, 'faturaDokumSil', 'invoice', 114
                    WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""ModuleKey""='invoice' AND ""Key""='faturaDokumSil')
                      -- Sabit PageId firmaya gore baska bir sayfada olabilir (2026-08-23):
                      -- Id kontrolu olmadan PK_Pages patlar ve acilis dongusu komple duser.
                      AND NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id""=114);

                    INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
                    SELECT 115, 'Satış Tipi', TRUE, 'faturaDokumTipSatis', 'invoice', 115
                    WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""ModuleKey""='invoice' AND ""Key""='faturaDokumTipSatis')
                      -- Sabit PageId firmaya gore baska bir sayfada olabilir (2026-08-23):
                      -- Id kontrolu olmadan PK_Pages patlar ve acilis dongusu komple duser.
                      AND NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id""=115);

                    INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
                    SELECT 116, 'Tamir Tipi', TRUE, 'faturaDokumTipTamir', 'invoice', 116
                    WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""ModuleKey""='invoice' AND ""Key""='faturaDokumTipTamir')
                      -- Sabit PageId firmaya gore baska bir sayfada olabilir (2026-08-23):
                      -- Id kontrolu olmadan PK_Pages patlar ve acilis dongusu komple duser.
                      AND NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id""=116);

                    INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
                    SELECT 117, 'İade Tipi', TRUE, 'faturaDokumTipIade', 'invoice', 117
                    WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""ModuleKey""='invoice' AND ""Key""='faturaDokumTipIade')
                      -- Sabit PageId firmaya gore baska bir sayfada olabilir (2026-08-23):
                      -- Id kontrolu olmadan PK_Pages patlar ve acilis dongusu komple duser.
                      AND NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id""=117);

                    INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
                    SELECT 118, 'Alış Tipi', TRUE, 'faturaDokumTipAlis', 'invoice', 118
                    WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""ModuleKey""='invoice' AND ""Key""='faturaDokumTipAlis')
                      -- Sabit PageId firmaya gore baska bir sayfada olabilir (2026-08-23):
                      -- Id kontrolu olmadan PK_Pages patlar ve acilis dongusu komple duser.
                      AND NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id""=118);

                    INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
                    SELECT 119, 'Hizmet Tipi', TRUE, 'faturaDokumTipHizmet', 'invoice', 119
                    WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""ModuleKey""='invoice' AND ""Key""='faturaDokumTipHizmet')
                      -- Sabit PageId firmaya gore baska bir sayfada olabilir (2026-08-23):
                      -- Id kontrolu olmadan PK_Pages patlar ve acilis dongusu komple duser.
                      AND NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id""=119);

                    INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
                    SELECT 120, 'Düzenle', TRUE, 'musteriTeklifiDuzenle', 'invoice', 120
                    WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""ModuleKey""='invoice' AND ""Key""='musteriTeklifiDuzenle')
                      -- Sabit PageId firmaya gore baska bir sayfada olabilir (2026-08-23):
                      -- Id kontrolu olmadan PK_Pages patlar ve acilis dongusu komple duser.
                      AND NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id""=120);

                    INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
                    SELECT 121, 'Sil', TRUE, 'musteriTeklifiSil', 'invoice', 121
                    WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""ModuleKey""='invoice' AND ""Key""='musteriTeklifiSil')
                      -- Sabit PageId firmaya gore baska bir sayfada olabilir (2026-08-23):
                      -- Id kontrolu olmadan PK_Pages patlar ve acilis dongusu komple duser.
                      AND NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id""=121);

                    INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
                    SELECT 122, 'Proforma Aktar', TRUE, 'musteriTeklifiProformaAktar', 'invoice', 122
                    WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""ModuleKey""='invoice' AND ""Key""='musteriTeklifiProformaAktar')
                      -- Sabit PageId firmaya gore baska bir sayfada olabilir (2026-08-23):
                      -- Id kontrolu olmadan PK_Pages patlar ve acilis dongusu komple duser.
                      AND NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id""=122);

                    INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
                    SELECT 123, 'Basım', TRUE, 'musteriTeklifiBasim', 'invoice', 123
                    WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""ModuleKey""='invoice' AND ""Key""='musteriTeklifiBasim')
                      -- Sabit PageId firmaya gore baska bir sayfada olabilir (2026-08-23):
                      -- Id kontrolu olmadan PK_Pages patlar ve acilis dongusu komple duser.
                      AND NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id""=123);

                    INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
                    SELECT 130, 'Düzenle', TRUE, 'alisDuzenle', 'invoice', 130
                    WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""ModuleKey""='invoice' AND ""Key""='alisDuzenle')
                      -- Sabit PageId firmaya gore baska bir sayfada olabilir (2026-08-23):
                      -- Id kontrolu olmadan PK_Pages patlar ve acilis dongusu komple duser.
                      AND NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id""=130);

                    INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
                    SELECT 131, 'Termin', TRUE, 'alisTermin', 'invoice', 131
                    WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""ModuleKey""='invoice' AND ""Key""='alisTermin')
                      -- Sabit PageId firmaya gore baska bir sayfada olabilir (2026-08-23):
                      -- Id kontrolu olmadan PK_Pages patlar ve acilis dongusu komple duser.
                      AND NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id""=131);

                     INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
                    SELECT 132, 'Sil', TRUE, 'alisSil', 'invoice', 132
                    WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""ModuleKey""='invoice' AND ""Key""='alisSil')
                      -- Sabit PageId firmaya gore baska bir sayfada olabilir (2026-08-23):
                      -- Id kontrolu olmadan PK_Pages patlar ve acilis dongusu komple duser.
                      AND NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id""=132);

                    INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
                    SELECT 133, 'Alış Tipi', TRUE, 'alisTipAlis', 'invoice', 133
                    WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""ModuleKey""='invoice' AND ""Key""='alisTipAlis')
                      -- Sabit PageId firmaya gore baska bir sayfada olabilir (2026-08-23):
                      -- Id kontrolu olmadan PK_Pages patlar ve acilis dongusu komple duser.
                      AND NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id""=133);

                    INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
                    SELECT 134, 'Hizmet Tipi', TRUE, 'alisTipHizmet', 'invoice', 134
                    WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""ModuleKey""='invoice' AND ""Key""='alisTipHizmet')
                      -- Sabit PageId firmaya gore baska bir sayfada olabilir (2026-08-23):
                      -- Id kontrolu olmadan PK_Pages patlar ve acilis dongusu komple duser.
                      AND NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id""=134);

                    INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
                    SELECT 135, 'İade Tipi', TRUE, 'alisTipIade', 'invoice', 135
                    WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""ModuleKey""='invoice' AND ""Key""='alisTipIade')
                      -- Sabit PageId firmaya gore baska bir sayfada olabilir (2026-08-23):
                      -- Id kontrolu olmadan PK_Pages patlar ve acilis dongusu komple duser.
                      AND NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id""=135);

                    INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
                    SELECT 140, 'Durum Değiştir', TRUE, 'terminDurumDegistir', 'invoice', 140
                    WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""ModuleKey""='invoice' AND ""Key""='terminDurumDegistir')
                      -- Sabit PageId firmaya gore baska bir sayfada olabilir (2026-08-23):
                      -- Id kontrolu olmadan PK_Pages patlar ve acilis dongusu komple duser.
                      AND NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id""=140);

                    INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
                    SELECT 150, 'Fatura Döküme Aktar', TRUE, 'proformaFaturaDokumeAktar', 'invoice', 150
                    WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""ModuleKey""='invoice' AND ""Key""='proformaFaturaDokumeAktar')
                      -- Sabit PageId firmaya gore baska bir sayfada olabilir (2026-08-23):
                      -- Id kontrolu olmadan PK_Pages patlar ve acilis dongusu komple duser.
                      AND NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id""=150);

                    INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
                    SELECT 151, 'Basım', TRUE, 'proformaBasim', 'invoice', 151
                    WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""ModuleKey""='invoice' AND ""Key""='proformaBasim')
                      -- Sabit PageId firmaya gore baska bir sayfada olabilir (2026-08-23):
                      -- Id kontrolu olmadan PK_Pages patlar ve acilis dongusu komple duser.
                      AND NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id""=151);

                    INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
                    SELECT 152, 'Sil', TRUE, 'proformaSil', 'invoice', 152
                    WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""ModuleKey""='invoice' AND ""Key""='proformaSil')
                      -- Sabit PageId firmaya gore baska bir sayfada olabilir (2026-08-23):
                      -- Id kontrolu olmadan PK_Pages patlar ve acilis dongusu komple duser.
                      AND NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id""=152);

                    INSERT INTO ""RolePagePermissions"" (""RoleId"", ""PageId"", ""CanAccess"")
                    SELECT r, p.""Id"", TRUE
                    FROM (SELECT ""Id"" FROM ""Roles"" WHERE ""Id"" = ANY(ARRAY[1,6,2])) AS rr(r)
                    CROSS JOIN (
                      SELECT ""Id""
                      FROM ""Pages""
                      WHERE ""ModuleKey""='invoice'
                        AND ""Key"" IN ('faturaDokumOdemeAlindi', 'faturaDokumNakitMiktar', 'faturaDokumBarkod', 'faturaDokumBasim', 'faturaDokumSil', 'musteriTeklifiDuzenle', 'musteriTeklifiSil', 'musteriTeklifiProformaAktar', 'musteriTeklifiBasim', 'alisDuzenle', 'alisTermin', 'alisSil', 'terminDurumDegistir', 'alisTipAlis', 'alisTipHizmet', 'alisTipIade', 'proformaFaturaDokumeAktar', 'proformaBasim', 'proformaSil')
                    ) AS p
                    ON CONFLICT (""RoleId"", ""PageId"") DO NOTHING;

                    -- Fatura Dökümü tip görünürlüğü: üst roller hepsi, diğer fatura dökümü açık roller ALIŞ hariç.
                    INSERT INTO ""RolePagePermissions"" (""RoleId"", ""PageId"", ""CanAccess"")
                    SELECT r.""Id"", p.""Id"", TRUE
                    FROM ""Roles"" r
                    CROSS JOIN ""Pages"" p
                    WHERE r.""Code"" IN ('SuperAdmin', 'Yonetim')
                      AND p.""ModuleKey""='invoice'
                      AND p.""Key"" IN ('faturaDokumTipSatis', 'faturaDokumTipTamir', 'faturaDokumTipIade', 'faturaDokumTipAlis', 'faturaDokumTipHizmet')
                    ON CONFLICT (""RoleId"", ""PageId"") DO NOTHING;

                    INSERT INTO ""RolePagePermissions"" (""RoleId"", ""PageId"", ""CanAccess"")
                    SELECT rpp.""RoleId"", p.""Id"", TRUE
                    FROM ""RolePagePermissions"" rpp
                    JOIN ""Pages"" parent ON parent.""Id"" = rpp.""PageId"" AND parent.""ModuleKey""='invoice' AND parent.""Key""='faturaDokum'
                    JOIN ""Roles"" r ON r.""Id"" = rpp.""RoleId""
                    CROSS JOIN ""Pages"" p
                    WHERE rpp.""CanAccess"" = TRUE
                      AND r.""Code"" NOT IN ('SuperAdmin', 'Yonetim')
                      AND p.""ModuleKey""='invoice'
                      AND p.""Key"" IN ('faturaDokumTipSatis', 'faturaDokumTipTamir', 'faturaDokumTipIade', 'faturaDokumTipHizmet')
                    ON CONFLICT (""RoleId"", ""PageId"") DO NOTHING;

                    INSERT INTO ""RolePagePermissions"" (""RoleId"", ""PageId"", ""CanAccess"")
                    SELECT r, p.""Id"", TRUE
                    FROM (SELECT ""Id"" FROM ""Roles"" WHERE ""Id"" = ANY(ARRAY[1,6,2])) AS rr(r)
                    CROSS JOIN (
                      SELECT ""Id""
                      FROM ""Pages""
                      WHERE ""Key""='virmanListesi'
                    ) AS p
                    ON CONFLICT (""RoleId"", ""PageId"") DO NOTHING;

                    -- Seed sub-pages for bildirimler: 403 (bildirimlerGelen) and 404 (bildirimlerGonder)
                    INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
                    SELECT 403, 'Gelen Bildirimler', TRUE, 'bildirimlerGelen', 'users', 18
                    WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""ModuleKey""='users' AND ""Key""='bildirimlerGelen')
                      -- Sabit PageId firmaya gore baska bir sayfada olabilir (2026-08-23):
                      -- Id kontrolu olmadan PK_Pages patlar ve acilis dongusu komple duser.
                      AND NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id""=403);

                    INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
                    SELECT 404, 'Bildirim Gönder', TRUE, 'bildirimlerGonder', 'users', 18
                    WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""ModuleKey""='users' AND ""Key""='bildirimlerGonder')
                      -- Sabit PageId firmaya gore baska bir sayfada olabilir (2026-08-23):
                      -- Id kontrolu olmadan PK_Pages patlar ve acilis dongusu komple duser.
                      AND NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id""=404);

                    -- Gelen Bildirimler should be enabled by default for all roles except
                    -- AltBayi (9), which is limited to order entry + POS payment.
                    INSERT INTO ""RolePagePermissions"" (""RoleId"", ""PageId"", ""CanAccess"")
                    SELECT r, pid, TRUE
                    -- Rol ve sayfa kimlikleri firmaya gore degisir (2026-08-23): ikisi de kendi
                    -- tablosundan dogrulaniyor. Sabit Id yazilinca olmayan role/sayfaya yetki
                    -- yazilmaya calisiliyor, FK patliyor ve acilis dongusu O KIRACI icin komple dusuyor.
                    FROM (SELECT ""Id"" FROM ""Roles"" WHERE ""Id"" = ANY(ARRAY[1,2,3,4,5,6,7,8,10,11,12])) AS rr(r)
                    CROSS JOIN (SELECT ""Id"" FROM ""Pages"" WHERE ""Id"" = 403) AS pp(pid)
                    ON CONFLICT (""RoleId"", ""PageId"") DO NOTHING;

                    -- Seed Yönetim Ekstre Raporu
                    INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
                    SELECT 502, 'Yönetim Ekstre Raporu', TRUE, 'yonetimEkstre', 'reports', 18
                    WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""ModuleKey""='reports' AND ""Key""='yonetimEkstre')
                      -- Sabit PageId firmaya gore baska bir sayfada olabilir (2026-08-23):
                      -- Id kontrolu olmadan PK_Pages patlar ve acilis dongusu komple duser.
                      AND NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id""=502);

                    INSERT INTO ""RolePagePermissions"" (""RoleId"", ""PageId"", ""CanAccess"")
                    SELECT r, pid, TRUE
                    -- Rol ve sayfa kimlikleri firmaya gore degisir (2026-08-23): ikisi de kendi
                    -- tablosundan dogrulaniyor. Sabit Id yazilinca olmayan role/sayfaya yetki
                    -- yazilmaya calisiliyor, FK patliyor ve acilis dongusu O KIRACI icin komple dusuyor.
                    FROM (SELECT ""Id"" FROM ""Roles"" WHERE ""Id"" = ANY(ARRAY[1,6,2])) AS rr(r)
                    CROSS JOIN (SELECT ""Id"" FROM ""Pages"" WHERE ""Id"" = 502) AS pp(pid)
                    ON CONFLICT (""RoleId"", ""PageId"") DO NOTHING;

                    -- Bildirim Gönder is enabled for SuperAdmin (1), Yonetim (2), Mudur (3), and ServisMudur (5)
                    INSERT INTO ""RolePagePermissions"" (""RoleId"", ""PageId"", ""CanAccess"")
                    SELECT r, pid, TRUE
                    -- Rol ve sayfa kimlikleri firmaya gore degisir (2026-08-23): ikisi de kendi
                    -- tablosundan dogrulaniyor. Sabit Id yazilinca olmayan role/sayfaya yetki
                    -- yazilmaya calisiliyor, FK patliyor ve acilis dongusu O KIRACI icin komple dusuyor.
                    FROM (SELECT ""Id"" FROM ""Roles"" WHERE ""Id"" = ANY(ARRAY[2,3,5])) AS rr(r)
                    CROSS JOIN (SELECT ""Id"" FROM ""Pages"" WHERE ""Id"" = 404) AS pp(pid)
                    ON CONFLICT (""RoleId"", ""PageId"") DO NOTHING;

                    -- Seed Sipariş: Sadece Fiyat 4 Görsün (PageId = 309). Bu bir kısıtlama filtresidir, varsayılan olarak kapalıdır.
                    INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
                    SELECT 309, 'Sipariş: Sadece Fiyat 4 Görsün', TRUE, 'siparisSadeceFiyat4Gorsun', 'invoice', 111
                    WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""ModuleKey""='invoice' AND ""Key""='siparisSadeceFiyat4Gorsun')
                      -- Sabit PageId firmaya gore baska bir sayfada olabilir (2026-08-23):
                      -- Id kontrolu olmadan PK_Pages patlar ve acilis dongusu komple duser.
                      AND NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id""=309);

                    -- SuperAdmin (RoleId = 1) için varsayılan olarak kapalı tut
                    UPDATE ""RolePagePermissions""
                    SET ""CanAccess"" = FALSE
                    WHERE ""PageId"" IN (SELECT ""Id"" FROM ""Pages"" WHERE ""ModuleKey""='invoice' AND ""Key""='siparisSadeceFiyat4Gorsun')
                      AND ""RoleId"" = 1;

                    -- Seed Sipariş: Stokta Olmayanı Sipariş Edebilsin (PageId = 310).
                    -- Bir KISITLAMAYI KALDIRAN yetki: verilmediği sürece bugünkü davranış aynen sürer
                    -- (stok 0 ise sepete eklenemez).
                    INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
                    SELECT 310, 'Sipariş: Stokta Olmayanı Sipariş Edebilsin', TRUE, 'stokYokSiparis', 'invoice', 112
                    WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""ModuleKey""='invoice' AND ""Key""='stokYokSiparis')
                      -- Sabit PageId firmaya gore baska bir sayfada olabilir (2026-08-23):
                      -- Id kontrolu olmadan PK_Pages patlar ve acilis dongusu komple duser.
                      AND NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id""=310);

                    -- VARSAYILAN: yalnız SuperAdmin ve Yonetim (2026-08-20 kullanıcı isteği).
                    -- Diğer roller satır almaz; satırı olmayan rol kapalıdır.
                    --
                    -- Rol ADIYLA eşleşiyor, kimlikle DEĞİL: rol kimlikleri firmadan firmaya
                    -- değişebiliyor, sabit sayı yazmak bir kiracıda başka rolü açardı.
                    --
                    -- ""Bu sayfa için HİÇ satır yoksa"" koşulu, ayarın YALNIZ İLK KURULUMDA
                    -- yazılmasını sağlar: yönetici sonradan SuperAdmin'den alırsa her açılışta
                    -- geri verilmez (kampanya bayrağındaki kural ile aynı).
                    INSERT INTO ""RolePagePermissions"" (""RoleId"", ""PageId"", ""CanAccess"")
                    SELECT r.""Id"", p.""Id"", TRUE
                    FROM ""Pages"" p
                    JOIN ""Roles"" r ON r.""Name"" IN ('SuperAdmin', 'Yonetim')
                    WHERE p.""ModuleKey""='invoice' AND p.""Key""='stokYokSiparis'
                      AND NOT EXISTS (
                        SELECT 1 FROM ""RolePagePermissions"" x WHERE x.""PageId"" = p.""Id""
                      )
                    ON CONFLICT (""RoleId"", ""PageId"") DO NOTHING;

                    -- Seed Müşteri Teklifi: Sınırsız İndirim (PageId = 124).
                    -- Teklif satırının net birim fiyatı normalde TOPTAN F grubunun altına inemez;
                    -- bu yetki o tabanı kaldırır. Bir KISITLAMAYI KALDIRAN yetki: verilmediği
                    -- sürece bugünkü davranış aynen sürer.
                    INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
                    SELECT 124, 'Sınırsız İndirim', TRUE, 'musteriTeklifiSinirsizIndirim', 'invoice', 124
                    WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""ModuleKey""='invoice' AND ""Key""='musteriTeklifiSinirsizIndirim')
                      -- Sabit PageId firmaya gore baska bir sayfada olabilir (2026-08-23):
                      -- Id kontrolu olmadan PK_Pages patlar ve acilis dongusu komple duser.
                      AND NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id""=124);

                    -- VARSAYILAN: yalnız SuperAdmin ve Yonetim (2026-08-22 kullanıcı isteği).
                    -- Rol ADIYLA eşleşiyor, kimlikle DEĞİL: rol kimlikleri firmadan firmaya değişiyor.
                    -- ""Bu sayfa için HİÇ satır yoksa"" koşulu ayarı YALNIZ ilk kurulumda yazar:
                    -- yönetici sonradan yetkiyi alırsa her açılışta geri verilmez.
                    INSERT INTO ""RolePagePermissions"" (""RoleId"", ""PageId"", ""CanAccess"")
                    SELECT r.""Id"", p.""Id"", TRUE
                    FROM ""Pages"" p
                    JOIN ""Roles"" r ON r.""Name"" IN ('SuperAdmin', 'Yonetim')
                    WHERE p.""ModuleKey""='invoice' AND p.""Key""='musteriTeklifiSinirsizIndirim'
                      AND NOT EXISTS (
                        SELECT 1 FROM ""RolePagePermissions"" x WHERE x.""PageId"" = p.""Id""
                      )
                    ON CONFLICT (""RoleId"", ""PageId"") DO NOTHING;

                    CREATE TABLE IF NOT EXISTS ""UserBasketItems"" (
                        ""Id"" uuid NOT NULL,
                        ""CustomerCode"" text NOT NULL,
                        ""CustomerName"" text NOT NULL,
                        ""Username"" text NOT NULL,
                        ""ProductId"" text NOT NULL,
                        ""StockCode"" text NOT NULL,
                        ""ProductName"" text NOT NULL,
                        ""Quantity"" numeric NOT NULL,
                        ""UnitPrice"" numeric NOT NULL,
                        ""VatRate"" numeric NOT NULL,
                        ""Currency"" text NOT NULL,
                        ""Montaj"" text NOT NULL,
                        ""Note"" text NOT NULL,
                        ""Key"" text NOT NULL,
                        ""CreateTime"" timestamp with time zone NOT NULL,
                        ""UpdateTime"" timestamp with time zone NOT NULL,
                        CONSTRAINT ""PK_UserBasketItems"" PRIMARY KEY (""Id"")
                    );

                    ALTER TABLE ""UserBasketItems"" ADD COLUMN IF NOT EXISTS ""CampaignTitle"" text DEFAULT '';
                    ALTER TABLE ""UserBasketItems"" ADD COLUMN IF NOT EXISTS ""DiscountAmount"" numeric DEFAULT 0;
                    ALTER TABLE ""UserBasketItems"" ADD COLUMN IF NOT EXISTS ""DiscountRate"" numeric DEFAULT 0;
                    ALTER TABLE ""UserBasketItems"" ADD COLUMN IF NOT EXISTS ""IsGift"" boolean DEFAULT FALSE;
                    ALTER TABLE ""CustomerLedgerEntries"" ADD COLUMN IF NOT EXISTS ""Balance"" numeric NOT NULL DEFAULT 0;
                    ");

                    // Pages referenced by [AuthorizePage] that are missing in some tenants.
                    // PageAuthorizationFilter treats an unknown page as "no permission", so these
                    // endpoints answered 403 to every non-superadmin user without any log line.
                    // Creating the row makes the page grantable; copying the twin page's grants
                    // keeps effective access identical instead of widening it.
                    await tenantDb.Database.ExecuteSqlRawAsync(@"
DO $$
DECLARE
    r record;
    v_page_id integer;
    v_twin_id integer;
BEGIN
    FOR r IN
        SELECT * FROM (VALUES
            -- (module, key, display name, twin module, twin key)
            ('reports', 'yaslandirma',      'Müşteri Yaşlandırma Raporu', 'service', 'yaslandirma'),
            ('reports', 'virmanRaporlari',  'Virman Raporları',           'cash',    'virmanListesi'),
            ('service', 'montajListesi',    'Montaj Listesi',             'bank',    'montajListesi'),
            ('service', 'montajRapor',      'Montaj Raporu',              'bank',    'montajRapor'),
            ('users',   'bildirimler',      'Bildirimler',                'users',   'bildirimlerGelen'),
            ('users',   'installmentRules', 'Taksit Kuralları',            NULL,      NULL),
            ('pos',     'taksitOranlari',   'Taksit Oranları',             NULL,      NULL),
            ('users',   'maliDonemler',     'Mali Dönemler',               NULL,      NULL)
        ) AS t(module_key, page_key, display_name, twin_module, twin_key)
    LOOP
        SELECT ""Id"" INTO v_page_id FROM ""Pages""
        WHERE ""ModuleKey"" = r.module_key AND ""Key"" = r.page_key;

        CONTINUE WHEN v_page_id IS NOT NULL;

        INSERT INTO ""Pages"" (""Id"", ""ModuleKey"", ""Key"", ""DisplayName"", ""SortOrder"", ""IsActive"")
        VALUES ((SELECT COALESCE(MAX(""Id""), 0) + 1 FROM ""Pages""),
                r.module_key, r.page_key, r.display_name,
                (SELECT COALESCE(MAX(""SortOrder""), 0) + 1 FROM ""Pages""), TRUE)
        RETURNING ""Id"" INTO v_page_id;

        IF r.twin_module IS NULL THEN
            CONTINUE;
        END IF;

        SELECT ""Id"" INTO v_twin_id FROM ""Pages""
        WHERE ""ModuleKey"" = r.twin_module AND ""Key"" = r.twin_key;

        CONTINUE WHEN v_twin_id IS NULL;

        INSERT INTO ""RolePagePermissions"" (""RoleId"", ""PageId"", ""CanAccess"")
        SELECT rpp.""RoleId"", v_page_id, rpp.""CanAccess""
        FROM ""RolePagePermissions"" rpp
        WHERE rpp.""PageId"" = v_twin_id
        ON CONFLICT (""RoleId"", ""PageId"") DO NOTHING;
    END LOOP;
END $$;
                    ");

                    // Aynı telafi firma veritabanları için: yetki satırı hiç açılmamış
                    // sayfaları superadmin'e aç. Bilerek kapatılmış satıra dokunmaz.
                    try
                    {
                        await tenantDb.Database.ExecuteSqlRawAsync(B2B.Erp.Api.Data.Services.SuperAdminPageAccessSchema.BackfillSql);
                    }
                    catch (Exception ex)
                    {
                        Console.WriteLine($"[SuperAdminPageAccess] {tenantDbName}: telafi atlandı: {ex.Message}");
                    }

                    // AltBayi (RoleId 9) exists for one job: a user attached to a dealer takes
                    // orders on a tablet at the customer's side, seeing price category 4, and
                    // collects payment over the virtual POS. PageAuthorizationFilter and the
                    // frontend menu both hard-limit the role to invoice/siparis + pos/posPayment,
                    // so every other grant is decorative — it shows as ticked in the role screen
                    // and can never take effect. Drop them so the screen tells the truth.
                    // Virtual POS is unaffected: PaymentsController and VirtualPosController
                    // authorize with plain [Authorize] and carry no page permission at all.
                    await tenantDb.Database.ExecuteSqlRawAsync(@"
DO $$
DECLARE
    v_removed integer;
BEGIN
    -- Keep a one-off snapshot so the previous configuration can be restored if needed
    CREATE TABLE IF NOT EXISTS ""RolePagePermissionsAltBayiBackup"" (
        ""RoleId"" integer NOT NULL,
        ""PageId"" integer NOT NULL,
        ""CanAccess"" boolean NOT NULL,
        ""BackedUpAt"" timestamp with time zone NOT NULL DEFAULT NOW()
    );

    INSERT INTO ""RolePagePermissionsAltBayiBackup"" (""RoleId"", ""PageId"", ""CanAccess"")
    SELECT rpp.""RoleId"", rpp.""PageId"", rpp.""CanAccess""
    FROM ""RolePagePermissions"" rpp
    JOIN ""Pages"" p ON p.""Id"" = rpp.""PageId""
    WHERE rpp.""RoleId"" = 9
      AND NOT (p.""ModuleKey"" = 'invoice' AND p.""Key"" = 'siparis')
      AND NOT (p.""ModuleKey"" = 'pos' AND p.""Key"" = 'posPayment')
      AND NOT EXISTS (SELECT 1 FROM ""RolePagePermissionsAltBayiBackup"" b
                      WHERE b.""RoleId"" = rpp.""RoleId"" AND b.""PageId"" = rpp.""PageId"");

    DELETE FROM ""RolePagePermissions"" rpp
    USING ""Pages"" p
    WHERE p.""Id"" = rpp.""PageId""
      AND rpp.""RoleId"" = 9
      AND NOT (p.""ModuleKey"" = 'invoice' AND p.""Key"" = 'siparis')
      AND NOT (p.""ModuleKey"" = 'pos' AND p.""Key"" = 'posPayment');

    GET DIAGNOSTICS v_removed = ROW_COUNT;
    IF v_removed > 0 THEN
        RAISE NOTICE 'AltBayi: % ineffective page permission(s) removed', v_removed;
    END IF;

    -- Make sure the two the role actually needs are present
    INSERT INTO ""RolePagePermissions"" (""RoleId"", ""PageId"", ""CanAccess"")
    SELECT 9, p.""Id"", TRUE
    FROM ""Pages"" p
    WHERE (p.""ModuleKey"" = 'invoice' AND p.""Key"" = 'siparis')
       OR (p.""ModuleKey"" = 'pos' AND p.""Key"" = 'posPayment')
    ON CONFLICT (""RoleId"", ""PageId"") DO NOTHING;
END $$;
                    ");

                    // The unique index on (ModuleKey, Key) is dropped further up before
                    // MigrateAsync and was never recreated on this path, which let the same
                    // page be inserted twice. Merge the known duplicates onto the id the other
                    // tenants already use, then put the index back so it cannot happen again.
                    await tenantDb.Database.ExecuteSqlRawAsync(@"
DO $$
DECLARE
    r record;
    v_keep integer;
    v_dupes integer;
BEGIN
    FOR r IN
        SELECT * FROM (VALUES
            -- (module, key, id to keep — the one the healthy tenants carry)
            ('bank',  'bankaHavaleEft', 20001),
            ('users', 'depolar',         9991),
            ('users', 'tedarikciEkle',   1001)
        ) AS t(module_key, page_key, keep_id)
    LOOP
        -- Only act when this tenant really has more than one row for the key
        IF (SELECT COUNT(*) FROM ""Pages""
            WHERE ""ModuleKey"" = r.module_key AND ""Key"" = r.page_key) < 2 THEN
            CONTINUE;
        END IF;

        -- Fall back to the highest id if the expected one is absent in this tenant
        SELECT COALESCE(
            (SELECT ""Id"" FROM ""Pages"" WHERE ""Id"" = r.keep_id
                AND ""ModuleKey"" = r.module_key AND ""Key"" = r.page_key),
            (SELECT MAX(""Id"") FROM ""Pages"" WHERE ""ModuleKey"" = r.module_key AND ""Key"" = r.page_key)
        ) INTO v_keep;

        -- Union the grants onto the surviving page: nobody loses access
        INSERT INTO ""RolePagePermissions"" (""RoleId"", ""PageId"", ""CanAccess"")
        SELECT rpp.""RoleId"", v_keep, rpp.""CanAccess""
        FROM ""RolePagePermissions"" rpp
        JOIN ""Pages"" p ON p.""Id"" = rpp.""PageId""
        WHERE p.""ModuleKey"" = r.module_key AND p.""Key"" = r.page_key AND rpp.""PageId"" <> v_keep
        ON CONFLICT (""RoleId"", ""PageId"") DO NOTHING;

        -- RolePagePermissions cascades on delete, and the grants were just copied over
        DELETE FROM ""Pages""
        WHERE ""ModuleKey"" = r.module_key AND ""Key"" = r.page_key AND ""Id"" <> v_keep;

        RAISE NOTICE 'Pages: merged duplicate %:% onto id %', r.module_key, r.page_key, v_keep;
    END LOOP;

    -- Recreating the index would abort startup if an unknown duplicate is still around,
    -- so check first and leave a trace instead of failing.
    SELECT COUNT(*) INTO v_dupes FROM (
        SELECT 1 FROM ""Pages"" GROUP BY ""ModuleKey"", ""Key"" HAVING COUNT(*) > 1
    ) d;

    IF v_dupes = 0 THEN
        CREATE UNIQUE INDEX IF NOT EXISTS ""IX_Pages_ModuleKey_Key""
            ON ""Pages"" (""ModuleKey"", ""Key"");
    ELSE
        RAISE NOTICE 'Pages: % duplicate key group(s) left, unique index not restored', v_dupes;
    END IF;
END $$;
                    ");

                    // Dynamically map and enable required page permissions in TenantEnabledPages for this specific tenant
                    var currentTenantPages = await tenantDb.Pages.AsNoTracking().ToListAsync();
                    var tenantRecord = await masterDb.Tenants.FirstOrDefaultAsync(x => x.DbName == tenantDbName);
                    if (tenantRecord != null)
                    {
                        foreach (var kp in keysToEnable)
                        {
                            var p = currentTenantPages.FirstOrDefault(x => string.Equals(x.ModuleKey, kp.ModuleKey, StringComparison.OrdinalIgnoreCase) && 
                                                                         string.Equals(x.Key, kp.Key, StringComparison.OrdinalIgnoreCase));
                            if (p != null)
                            {
                                var exists = await masterDb.TenantEnabledPages.AnyAsync(x => x.TenantId == tenantRecord.Id && x.PageId == p.Id);
                                if (!exists)
                                {
                                    masterDb.TenantEnabledPages.Add(new TenantEnabledPage
                                    {
                                        TenantId = tenantRecord.Id,
                                        PageId = p.Id,
                                        IsEnabled = true
                                    });
                                }
                            }
                        }
                        await masterDb.SaveChangesAsync();
                    }

                    // Category Synchronization
                    var targetCategories = new Dictionary<string, List<string>>(StringComparer.OrdinalIgnoreCase)
                    {
                        ["DEMO"] = new List<string> { "G.HAZIR", "I.HAZIR", "EV.GEREC", "EV.TEMIZ", "K.BAKIM", "UTU" },
                        ["YATAKBAZA"] = new List<string> { "SILTE", "BASLIK", "BAZA", "TEKSTIL" },
                        ["BYZ-ESYA"] = new List<string> { "KLIMA", "SEBIL", "ANKASTRE", "CAM.MAK", "BUZDLB", "DRN.DON", "BUL-MAK", "SOLO", "ELEKTRO" }
                    };

                    // 1. Get all categories
                    var allDbCategories = await tenantDb.Set<ProductCategory>().ToListAsync();
                    var mainDbCategories = allDbCategories.Where(x => x.ParentId == null).ToList();

                    /*
                      LISTE DISINDAKI KATEGORILER ARTIK SILINMIYOR (2026-08-24).

                      Burada "hedef listede olmayan her ana kategori, alt kategorileriyle
                      birlikte SILINIR" diyen bir dongu vardi. Liste KODA SABIT YAZILI (yukarida
                      `targetCategories`) ve yalnizca 3 ana + 19 alt kategori iceriyor.

                      Sonuc: kullanicinin actigi HER kategori -- yedek parca kategorileri dahil --
                      API'nin bir sonraki acilisinda siliniyordu. Kullanici gun icinde uc kez
                      "yedek parca kategorileri gene gitti" dedi; her seferinde bir dagitim
                      yapilmisti. Silme `DeletionLogs`'a da yazilmadigi icin iz birakmiyordu ve
                      sebep aylarca bulunamadi.

                      Bu blok bir KURULUM adimi: yeni firmada standart kategorileri olusturmak
                      icin var. Olusturmak faydali, SILMEK degil -- veri kaybi uretiyor.
                      Asagidaki "eksikleri ekle" kismi oldugu gibi duruyor.
                    */
                    await tenantDb.SaveChangesAsync();

                    // Reload lists after deletions
                    allDbCategories = await tenantDb.Set<ProductCategory>().ToListAsync();
                    mainDbCategories = allDbCategories.Where(x => x.ParentId == null).ToList();

                    // 3. Process each target main category and its subs
                    var mainSort = 0;
                    foreach (var kp in targetCategories)
                    {
                        var mainKey = kp.Key;
                        var targetSubs = kp.Value;

                        var dbMain = mainDbCategories.FirstOrDefault(x => string.Equals(x.Key, mainKey, StringComparison.OrdinalIgnoreCase));
                        if (dbMain == null)
                        {
                            dbMain = new ProductCategory
                            {
                                Id = Guid.NewGuid(),
                                ParentId = null,
                                Key = mainKey.ToUpperInvariant(),
                                Name = mainKey.ToUpperInvariant(),
                                IsActive = true,
                                SortOrder = mainSort++
                            };
                            tenantDb.Set<ProductCategory>().Add(dbMain);
                            await tenantDb.SaveChangesAsync();
                        }
                        else
                        {
                            // NAME'E DOKUNMA (2026-09-03). Önceden her açılışta
                            // `Name = KEY.ToUpper()` yazılıyordu: kullanıcı "G.HAZIR"
                            // kategorisini "Gıda Hazırlama" diye adlandırınca sonraki restart
                            // geri "G.HAZIR" yapıyor, kullanıcı da yeni bir "Gıda Hazırlama"
                            // kategorisi açıp ürünleri bölüyordu — Toplu Fiyat Atama'da iki
                            // ayrı alt grup görünmesinin sebebi buydu. Key kimlik, Name görünen
                            // ad; kurulum yalnız EKSİK kategoriyi OLUŞTURUR, adı sabitlemez.
                            dbMain.Key = mainKey.ToUpperInvariant();
                            if (string.IsNullOrWhiteSpace(dbMain.Name)) dbMain.Name = mainKey.ToUpperInvariant();
                            dbMain.IsActive = true;
                            dbMain.SortOrder = mainSort++;
                        }

                        // Load existing subs under this parent
                        var dbSubs = allDbCategories.Where(x => x.ParentId == dbMain.Id).ToList();

                        // FAZLA ALT KATEGORILER DE SILINMIYOR -- yukaridaki gerekcenin aynisi.
                        // Standart ana kategorinin altina kullanicinin ekledigi alt kategori
                        // (orn. BYZ-ESYA altina acilan yeni bir grup) her acilista siliniyordu.
                        await tenantDb.SaveChangesAsync();

                        // Add missing subs
                        dbSubs = await tenantDb.Set<ProductCategory>().Where(x => x.ParentId == dbMain.Id).ToListAsync();
                        var subSort = 0;
                        foreach (var targetSub in targetSubs)
                        {
                            var dbSub = dbSubs.FirstOrDefault(x => string.Equals(x.Key, targetSub, StringComparison.OrdinalIgnoreCase));
                            if (dbSub == null)
                            {
                                dbSub = new ProductCategory
                                {
                                    Id = Guid.NewGuid(),
                                    ParentId = dbMain.Id,
                                    Key = targetSub.ToUpperInvariant(),
                                    Name = targetSub.ToUpperInvariant(),
                                    IsActive = true,
                                    SortOrder = subSort++
                                };
                                tenantDb.Set<ProductCategory>().Add(dbSub);
                            }
                            else
                            {
                                // NAME'E DOKUNMA — yukarıdaki ana kategori notuyla aynı sebep.
                                dbSub.Key = targetSub.ToUpperInvariant();
                                if (string.IsNullOrWhiteSpace(dbSub.Name)) dbSub.Name = targetSub.ToUpperInvariant();
                                dbSub.IsActive = true;
                                dbSub.SortOrder = subSort++;
                            }
                        }
                        await tenantDb.SaveChangesAsync();
                    }
                }
                catch (Exception ex)
                {
                    Console.Error.WriteLine($"[WARN] Tenant DB migrate failed for '{tenantDbName}': {ex}");
                }
            }
        }
    }
    catch (Exception ex)
    {
        Console.Error.WriteLine("[WARN] Tenant DB migrate scan failed: " + ex);
    }

    // Master şeması artık AYRI ve bağımsız bir blokta kuruluyor; burada yalnız çağrılıyor.
    // Gerekçe: aşağıdaki bağımsız blokun başındaki nota bakınız.
    await EnsureMasterSchemaAsync(masterDb);

    // Ensure Balance column exists in ALL Postgres databases (master and all tenant DBs)
    try
    {
        var masterConnStr = builder.Configuration.GetConnectionString("MasterConnection") ?? "Host=localhost;Port=5434;Database=b2b_erp_master;Username=b2b;Password=b2b";
        var builderCs = new Npgsql.NpgsqlConnectionStringBuilder(masterConnStr) { Database = "postgres" };
        using var sysConn = new Npgsql.NpgsqlConnection(builderCs.ConnectionString);
        await sysConn.OpenAsync();
        using var sysCmd = sysConn.CreateCommand();
        sysCmd.CommandText = "SELECT datname FROM pg_database WHERE datistemplate = false;";
        var dbNames = new List<string>();
        using (var reader = await sysCmd.ExecuteReaderAsync())
        {
            while (await reader.ReadAsync())
            {
                var dName = reader.GetString(0);
                if (dName.StartsWith("b2b_", StringComparison.OrdinalIgnoreCase))
                {
                    dbNames.Add(dName);
                }
            }
        }

        // ALLOWLIST/DENYLIST BURADA DA GECERLI (2026-08-23).
        //
        // Bu dongu pg_database i tarayip b2b_ ile baslayan HER veritabanina yaziyordu ve
        // Tenants:MigrationAllowlist / MigrationDenylist / ScanOrphanDatabases ayarlarini
        // TAMAMEN yok sayiyordu. Calistirdigi ifade zararsiz (ADD COLUMN IF NOT EXISTS,
        // ustelik tablo varlik kontrolu de var) ama operatorun bilerek disarida biraktigi
        // bir veritabanina dokunmak korumayi delik birakir: buraya ileride yikici bir ifade
        // eklenirse hicbir liste onu durduramaz. Master veritabani her zaman dahildir.
        try
        {
            var balAllow = builder.Configuration.GetSection("Tenants:MigrationAllowlist").Get<string[]>() ?? Array.Empty<string>();
            var balDeny = builder.Configuration.GetSection("Tenants:MigrationDenylist").Get<string[]>() ?? Array.Empty<string>();
            var balScanOrphan = builder.Configuration.GetValue<bool?>("Tenants:ScanOrphanDatabases") ?? true;

            var balCodeToDb = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            var balRegistered = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (var t in await masterDb.Tenants.AsNoTracking().Select(x => new { x.DbName, x.Code }).ToListAsync())
            {
                var resolved = string.IsNullOrWhiteSpace(t.DbName) ? $"b2b_erp_tenant_{t.Code}" : t.DbName;
                if (string.IsNullOrWhiteSpace(resolved)) continue;
                balRegistered.Add(resolved);
                if (!string.IsNullOrWhiteSpace(t.Code)) balCodeToDb[t.Code] = resolved;
            }

            HashSet<string> BalExpand(string[] entries)
            {
                var result = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                foreach (var entry in entries)
                {
                    if (string.IsNullOrWhiteSpace(entry)) continue;
                    var trimmed = entry.Trim();
                    result.Add(trimmed);
                    if (balCodeToDb.TryGetValue(trimmed, out var mapped)) result.Add(mapped);
                    else if (!trimmed.StartsWith("b2b_", StringComparison.OrdinalIgnoreCase)) result.Add($"b2b_erp_tenant_{trimmed}");
                }
                return result;
            }

            var balAllowDb = BalExpand(balAllow);
            var balDenyDb = BalExpand(balDeny);
            var balMaster = new Npgsql.NpgsqlConnectionStringBuilder(masterConnStr).Database ?? string.Empty;

            var oncesi = dbNames.Count;
            dbNames = dbNames
                .Where(x => string.Equals(x, balMaster, StringComparison.OrdinalIgnoreCase)
                            || ((balScanOrphan || balRegistered.Contains(x))
                                && (balAllowDb.Count == 0 || balAllowDb.Contains(x))
                                && !balDenyDb.Contains(x)))
                .ToList();

            var elenen = oncesi - dbNames.Count;
            Console.WriteLine($"[Balance] dokunulacak: {(dbNames.Count == 0 ? "(yok)" : string.Join(", ", dbNames))}" + (elenen > 0 ? $" | elenen: {elenen}" : string.Empty));
        }
        catch (Exception exFilter)
        {
            // Suzgec kurulamazsa GUVENLI tarafa gec: hicbir tabana dokunma.
            Console.Error.WriteLine("[WARN] Balance suzgeci kurulamadi, dongu atlandi: " + exFilter.Message);
            dbNames.Clear();
        }

        foreach (var dbName in dbNames)
        {
            try
            {
                var dbCs = new Npgsql.NpgsqlConnectionStringBuilder(masterConnStr) { Database = dbName };
                using var targetConn = new Npgsql.NpgsqlConnection(dbCs.ConnectionString);
                await targetConn.OpenAsync();
                using var targetCmd = targetConn.CreateCommand();
                targetCmd.CommandText = @"
                    DO $$
                    BEGIN
                        IF EXISTS (
                            SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND lower(table_name) = 'customerledgerentries'
                        ) THEN
                            ALTER TABLE ""CustomerLedgerEntries"" ADD COLUMN IF NOT EXISTS ""Balance"" numeric NOT NULL DEFAULT 0;
                        END IF;
                    END $$;";
                await targetCmd.ExecuteNonQueryAsync();
                Console.WriteLine($"[DB-SUCCESS] Balance column ensured on DB '{dbName}'");
            }
            catch (Exception exDb)
            {
                Console.Error.WriteLine($"[WARN] Failed adding Balance column to DB '{dbName}': {exDb.Message}");
            }
        }
    }
    catch (Exception exSys)
    {
        Console.Error.WriteLine("[WARN] Global DB scan for Balance column failed: " + exSys.Message);
    }
}
catch (Exception ex)
{
    Console.Error.WriteLine("[WARN] Startup schema ensure failed (kiraci bolumu): " + ex);
}

// MASTER ŞEMASI HER HÂLÜKÂRDA KURULUR (2026-08-21).
//
// Yukarıdaki blok varsayılan veritabanına bağlı ve orada patlarsa kendi içindeki her şeyi
// atlıyor. Master şeması ise sistemin AYAKTA KALMASI için şart: `Tenants` üzerindeki bir
// kolon eksik kaldığında giriş/marka ucu 500 veriyor ve hiç kimse sisteme giremiyor.
// Bu yüzden ayrı scope, ayrı try — yukarısı ne yaparsa yapsın burası çalışır.
try
{
    using var masterSchemaScope = app.Services.CreateScope();
    var masterSchemaDb = masterSchemaScope.ServiceProvider.GetRequiredService<MasterDbContext>();
    await EnsureMasterSchemaAsync(masterSchemaDb);
}
catch (Exception ex)
{
    Console.Error.WriteLine("[WARN] Master schema ensure failed: " + ex.Message);
}

if (args.Length >= 1 && string.Equals(args[0], "schema-check", StringComparison.OrdinalIgnoreCase))
{
    var schemaExit = await RunSchemaCheckAsync(app.Services);
    Environment.Exit(schemaExit);
}

if (args.Length >= 1 && string.Equals(args[0], "count-bins", StringComparison.OrdinalIgnoreCase))
{
    var exitCode = await RunBinsCountAsync(app.Services);
    Environment.Exit(exitCode);
}

if (args.Length >= 2 && string.Equals(args[0], "import-bins", StringComparison.OrdinalIgnoreCase))
{
    var filePath = args[1];
    var exitCode = await RunBinsImportAsync(app.Services, filePath);
    Environment.Exit(exitCode);
}

// Middleware Pipeline
if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}

if (!app.Environment.IsDevelopment())
{
    app.UseHttpsRedirection();
}

// TEK SITE BARINDIRMA (erp.example.com).
// API ve React arayuzu AYNI site altinda: `/api/*` controller'lara, gerisi wwwroot'a gider.
// IIS'te /api'yi ayri surece vekillemek ARR kurulumu ister (Plesk'te yok); tek site olunca
// CORS da ikinci sertifika da gerekmiyor. Ayni desen personel portalinda calisiyor.
app.UseDefaultFiles();
app.UseStaticFiles();

app.UseCors("AllowReactApp");

app.UseRateLimiter();

app.UseMiddleware<GlobalExceptionMiddleware>();

// Must run before the virtual POS controller is activated: AppDbContext picks its connection
// string at activation time, and a 3D callback carries its tenant only in the URL path.
app.UseMiddleware<VirtualPosCallbackTenantMiddleware>();

// Aynı sebep: giriş isteğinde firma yalnızca GÖVDEDE gelir, ama AppDbContext bağlantısını
// controller kurulurken seçer. Bu yüzden gövdeden okuma işi ara katmanda yapılmalı — action
// içinde yapmak geç kalıyor ve seçilen firma yok sayılıyordu.
app.UseMiddleware<AuthTenantBindingMiddleware>();

app.UseAuthentication();
app.UseAuthorization();

app.MapControllers();

using (var scope = app.Services.CreateScope())
{
    var dbContext = scope.ServiceProvider.GetRequiredService<B2B.Erp.Api.Data.AppDbContext>();
    var logger = scope.ServiceProvider.GetRequiredService<ILoggerFactory>().CreateLogger("VirtualPosSeeder");
    await B2B.Erp.Api.Data.Services.VirtualPosSeeder.SeedPosDataAsync(dbContext, logger);
}

// ESLESMEYEN /api CAGRISI HTML DONMEMELI.
// Fallback'ten ONCE durmasi sart: aksi halde yanlis yazilmis bir uc adresi index.html
// donuyor, istemci JSON bekledigi icin okunmasi zor bir ayristirma hatasi aliyor.
app.Map("/api/{**rest}", () => Results.NotFound());

// React yonlendiricisi: sunucuda karsiligi olmayan yollar (/pos/posPayment gibi) index.html'e
// duser, gerisini tarayici halleder. Statik bir dosya varsa UseStaticFiles onu zaten vermistir.
app.MapFallbackToFile("index.html");

app.Run();


