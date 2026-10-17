using System.Text.Json;
using System.Threading.RateLimiting;
using Asistan.Api.Ai;
using Asistan.Api.Infrastructure;
using Asistan.Api.Messaging;
using Asistan.Api.WhatsApp;

var builder = WebApplication.CreateBuilder(args);

// Gizli değerler (Meta token'ı, App Secret, JWT anahtarları) git'e alınmayan yerel dosyadan.
builder.Configuration.AddJsonFile("appsettings.Local.json", optional: true, reloadOnChange: true);

builder.Services.AddControllers().AddJsonOptions(o =>
{
    o.JsonSerializerOptions.PropertyNamingPolicy = JsonNamingPolicy.CamelCase;
});

builder.Services.Configure<WhatsAppOptions>(builder.Configuration.GetSection("WhatsApp"));

builder.Services.AddSingleton<TenantDb>();
builder.Services.AddSingleton<AsistanSchema>();
builder.Services.AddSingleton<AsistanTokens>();
builder.Services.AddSingleton<PageAccess>();
builder.Services.AddScoped<MessageStore>();
builder.Services.AddScoped<OpsStore>();
builder.Services.AddScoped<InboxAccess>();
builder.Services.AddScoped<ErpCustomerLookup>();
builder.Services.AddScoped<WebhookProcessor>();
builder.Services.AddHostedService<MaintenanceWorker>();
builder.Services.AddHostedService<Asistan.Api.Messaging.WarmupWorker>();

/*
 * YAPAY ZEKÂ ASİSTANI (2. aşama). Sağlayıcı Ai:Provider ile seçilir; model kararı henüz verilmedi
 * (ileride aramalarda da kullanılacak, ChatGPT de olabilir). Asistanın geri kalanı yalnız
 * IAiClassifier'ı bilir. Boşsa asistan kapalı, gelen kutusu normal çalışır. Development'ta boşsa
 * ücretsiz SAHTE asistan (anahtar kelime kuralı) — gerçek çağrı yapılmaz.
 */
builder.Services.Configure<AiOptions>(builder.Configuration.GetSection("Ai"));
builder.Services.AddSingleton<AiQueue>();
builder.Services.AddScoped<AiStore>();
var aiProvider = (builder.Configuration["Ai:Provider"] ?? string.Empty).Trim().ToLowerInvariant();
if (aiProvider.Length == 0 && builder.Environment.IsDevelopment()) aiProvider = "fake";
switch (aiProvider)
{
    case "claude" when !string.IsNullOrWhiteSpace(builder.Configuration["Ai:ApiKey"]):
        builder.Services.AddSingleton<IAiClassifier, ClaudeClassifier>();
        break;
    case "openai" when !string.IsNullOrWhiteSpace(builder.Configuration["Ai:ApiKey"]):
        // 2026-10-09 kararı: mesaj + ileride arama/görsel/DM tek sağlayıcıda (OpenAI).
        builder.Services.AddHttpClient("openai", c => c.Timeout = TimeSpan.FromSeconds(120));
        builder.Services.AddSingleton<IAiClassifier, OpenAiClassifier>();
        break;
    case "fake":
        builder.Services.AddSingleton<IAiClassifier, FakeClassifier>();
        Console.WriteLine("[UYARI] SAHTE ASİSTAN ETKİN — taslaklar anahtar kelime kuralıyla yazılıyor, yapay zekâ çağrılmıyor.");
        break;
    default:
        if (aiProvider.Length > 0) Console.WriteLine($"[UYARI] Ai:Provider='{aiProvider}' kullanılamıyor (anahtar yok ya da tanımsız) — asistan kapalı.");
        builder.Services.AddSingleton<IAiClassifier, DisabledClassifier>();
        break;
}
builder.Services.AddHostedService<AiWorker>();

// 3. aşama: asistanın ERP/Servis kayıtlarına salt-okunur bakışı. Anahtar yoksa araç tanımlanmaz.
builder.Services.Configure<Asistan.Api.Ai.Tools.AiToolOptions>(builder.Configuration.GetSection("Tools"));
builder.Services.AddHttpClient("asistan-tools", c => c.Timeout = TimeSpan.FromSeconds(30));
builder.Services.AddSingleton<Asistan.Api.Ai.Tools.AiToolbox>();
builder.Services.AddHttpClient("erp", c => c.Timeout = TimeSpan.FromSeconds(20));

/*
 * SAHTE WHATSAPP — yalnız Development VE AccessToken boşken. Gerçek Meta hesabı gelmeden
 * ekrandan "gönder" denenebilsin; mesaj günlüğe yazılır, hiçbir yere gitmez.
 * Üretimde token yoksa gerçek istemci kalır ve gönderim "yapılandırılmamış" der.
 */
var useFake = builder.Environment.IsDevelopment()
              && string.IsNullOrWhiteSpace(builder.Configuration["WhatsApp:AccessToken"]);
if (useFake)
{
    builder.Services.AddSingleton<IWhatsAppClient, FakeWhatsAppClient>();
    Console.WriteLine("[UYARI] SAHTE WHATSAPP ETKİN — mesajlar gönderilmiyor, günlüğe yazılıyor.");
}
else
{
    builder.Services.AddHttpClient<IWhatsAppClient, WhatsAppClient>();
}

/*
 * Şifre denemesi sınırı: IP başına dakikada 10 giriş/devir. Kaba kuvvet denemesi ERP'ye
 * asistan üzerinden taşınmasın. Webhook sınırlanmaz — Meta toplu gönderebilir.
 */
builder.Services.AddRateLimiter(o =>
{
    o.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    o.AddPolicy("login", http => RateLimitPartition.GetFixedWindowLimiter(
        http.Connection.RemoteIpAddress?.ToString() ?? "?",
        _ => new FixedWindowRateLimiterOptions { PermitLimit = 10, Window = TimeSpan.FromMinutes(1), QueueLimit = 0 }));
    // Devir (B2B'den "Asistan'a Geç") şifre denemesi değil, imzalı token ister; ofiste herkes
    // aynı dış IP'den çıktığı için şifre sınırını paylaşmasın.
    o.AddPolicy("exchange", http => RateLimitPartition.GetFixedWindowLimiter(
        http.Connection.RemoteIpAddress?.ToString() ?? "?",
        _ => new FixedWindowRateLimiterOptions { PermitLimit = 30, Window = TimeSpan.FromMinutes(1), QueueLimit = 0 }));
});

/*
 * CORS: canlıda ekran AYNI siteden sunulur (wwwroot), CORS gerekmez. Yalnız geliştirmede
 * Vite (5177) ayrı porttan gelir — o da proxy kullandığı için çoğu zaman yine aynı kaynak.
 */
builder.Services.AddCors(options =>
{
    var configured = builder.Configuration.GetSection("Cors:AllowedOrigins").Get<string[]>() ?? Array.Empty<string>();
    options.AddPolicy("Panel", policy =>
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

app.UseCors("Panel");
app.UseRateLimiter();

/*
 * EKRAN AYNI SİTEDEN: asistan.example.com → wwwroot/index.html (React).
 * Personel portalındaki düzen. API (/api), Meta webhook'u (/webhook) ve deneme uçları (/dev)
 * eşleşmezse 404 döner — yoksa yanlış yazılmış bir API adresi sessizce index.html döndürürdü.
 */
app.UseDefaultFiles();
app.UseStaticFiles();

app.MapControllers();
app.MapGet("/health", () => Results.Ok(new { status = "ok", service = "asistan" }));
app.Map("/api/{**rest}", () => Results.NotFound());
app.Map("/webhook/{**rest}", () => Results.NotFound());
app.Map("/dev/{**rest}", () => Results.NotFound());
app.MapFallbackToFile("index.html");

app.Run();
