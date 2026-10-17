using System.Text;
using System.Threading.RateLimiting;
using B2B.Erp.Api.Core.Services;
using B2B.Erp.Api.Data;
using B2B.Erp.Api.Data.Services;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddControllers().AddJsonOptions(options =>
{
    options.JsonSerializerOptions.PropertyNamingPolicy = System.Text.Json.JsonNamingPolicy.CamelCase;
    options.JsonSerializerOptions.DictionaryKeyPolicy = System.Text.Json.JsonNamingPolicy.CamelCase;
});
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();

builder.Services.AddDbContext<MasterDbContext>(options =>
    options.UseNpgsql(builder.Configuration.GetConnectionString("MasterConnection")));

builder.Services.AddHttpContextAccessor();
builder.Services.AddScoped<TenantConnectionStringResolver>();

builder.Services.AddDbContext<AppDbContext>((sp, options) =>
{
    var resolver = sp.GetRequiredService<TenantConnectionStringResolver>();
    var conn = resolver.Resolve();
    options.UseNpgsql(conn);
});

builder.Services.AddScoped<AccountMovementWriter>();
builder.Services.AddScoped<ErpPaymentAccountService>();
builder.Services.AddScoped<EmployeeCashService>();
builder.Services.AddScoped<WorkCalendarService>();
builder.Services.AddScoped<EmployeeAccrualService>();
builder.Services.AddScoped<ReverseGeocoder>();
// 23:00'e kadar çıkış yapılmamış mesaiyi o günün 18:00'inde kapatır (2026-10-16).
builder.Services.AddSingleton<B2B.Erp.Api.Core.Services.AutoCheckOutWorker>();
builder.Services.AddHostedService(sp => sp.GetRequiredService<B2B.Erp.Api.Core.Services.AutoCheckOutWorker>());
// Konum -> il/ilce (Nominatim). Zaman asimi istekte ayrica 3 sn ile sinirli.
builder.Services.AddHttpClient(ReverseGeocoder.HttpClientName, client => client.Timeout = TimeSpan.FromSeconds(5));

var jwtSettings = builder.Configuration.GetSection("JwtSettings");
var secretKey = jwtSettings["SecretKey"];
if (string.IsNullOrWhiteSpace(secretKey))
{
    throw new InvalidOperationException("JwtSettings:SecretKey boş. Employee-service ERP ile aynı SecretKey'i kullanmalı.");
}

builder.Services.AddAuthentication(options =>
{
    options.DefaultAuthenticateScheme = JwtBearerDefaults.AuthenticationScheme;
    options.DefaultChallengeScheme = JwtBearerDefaults.AuthenticationScheme;
}).AddJwtBearer(options =>
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
});

builder.Services.AddAuthorization();

/*
 * Yuz tanima mikroservisi (face-service, :5300).
 *
 * `FaceAuthController` bu servise sunucu-sunucu gidiyor; tarayici :5300 ile HIC konusmaz.
 * Bu kayit ana API'de vardi ve yuz uclari yalnizca orada yasiyordu; personel portali tek
 * basina yayina alinabilsin diye ucler bu servise tasindi, istemci kaydi da onunla geldi.
 */
builder.Services.AddHttpClient("FaceService", client =>
{
    var baseUrl = builder.Configuration["FaceService:BaseUrl"] ?? "http://localhost:5300";
    if (!baseUrl.EndsWith("/")) baseUrl += "/";
    client.BaseAddress = new Uri(baseUrl);
    var timeout = int.TryParse(builder.Configuration["FaceService:TimeoutSeconds"], out var t) ? t : 30;
    client.Timeout = TimeSpan.FromSeconds(Math.Max(1, timeout));
});

// Giriş uçları kullanıcı adı + şifre alıyor ve anonim erişime açık: kaba kuvvet denemesine
// karşı IP başına sınır. Ana API'deki "auth" politikasının aynısı; bu serviste hiç yoktu.
builder.Services.AddRateLimiter(options =>
{
    options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;

    options.AddPolicy("auth", httpContext =>
        RateLimitPartition.GetFixedWindowLimiter(
            partitionKey: httpContext.Connection.RemoteIpAddress?.ToString() ?? "unknown",
            factory: _ => new FixedWindowRateLimiterOptions
            {
                PermitLimit = 10,
                Window = TimeSpan.FromMinutes(1),
                QueueLimit = 0
            }));

    /*
     * Yuz ucları icin AYRI ve daha genis sinir.
     *
     * Yuz ile giris ekrani kamera acilir acilmaz 1200 ms'de bir kare gonderiyor — dakikada
     * ~50 istek. `auth` politikasinin dakikada 10 istegi bunun besde biri; ekran acildiktan
     * ~12 saniye sonra her istek 429 donmeye basliyor ve kullaniciya "yuz eslesmedi" gibi
     * gorunuyor, oysa istek sunucuya hic ulasmiyor.
     *
     * Sinir IP BASINA isliyor ve ofiste herkes ayni genel IP'den cikiyor: 50 kisilik ekipte
     * vardiya basinda onlarca telefon ayni anda tarar ve hepsi TEK kotayi paylasir.
     * Bir cihaz 1200 ms'de bir istek atiyor, yani dakikada ~50. Dakikada 600 sinir, ayni
     * anda ~12 cihazin kesintisiz taramasina yeter; gercek kullanimda (kisi basi 2-3 saniye
     * icinde taninir) bu sayiya hic yaklasilmaz, sinir yalnizca kotu senaryoda devreye girer.
     *
     * Sinir tamamen kaldirilmiyor: `check-in`/`check-out` anonim ve her istek yuz vektoru
     * cikardigi icin islemci maliyeti yuksek; sinirsiz birakmak servisi mesgul etmenin kolay
     * yolu olurdu.
     *
     * Sifre alan uclar (giris, QR) `auth`ta kaliyor: orada dusuk sinir kaba kuvvete karsi
     * bilincli bir savunma.
     */
    options.AddPolicy("face", httpContext =>
        RateLimitPartition.GetFixedWindowLimiter(
            partitionKey: httpContext.Connection.RemoteIpAddress?.ToString() ?? "unknown",
            factory: _ => new FixedWindowRateLimiterOptions
            {
                PermitLimit = 600,
                Window = TimeSpan.FromMinutes(1),
                QueueLimit = 0
            }));
});

// CORS: Development ortamında yerel ağ IP'leri (telefon erişimi dahil) serbesttir.
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
                    if (host == "localhost" || host == "127.0.0.1" || host == "::1") return true;
                    if (host.StartsWith("10.") || host.StartsWith("192.168.") || host.StartsWith("172.")) return true;
                    if (host.EndsWith(".trycloudflare.com", StringComparison.OrdinalIgnoreCase)) return true;
                    if (host.EndsWith(".ngrok-free.app", StringComparison.OrdinalIgnoreCase)) return true;
                    return false;
                })
                .AllowAnyHeader()
                .AllowAnyMethod()
                .AllowCredentials();
        }
        else
        {
            var allowedOrigins = builder.Configuration.GetSection("AllowedOrigins").Get<string[]>() ?? Array.Empty<string>();
            if (allowedOrigins.Length > 0)
            {
                policy.WithOrigins(allowedOrigins);
            }
            else
            {
                policy.AllowAnyOrigin();
            }
            policy.AllowAnyHeader().AllowAnyMethod();
        }
    });
});


var app = builder.Build();

app.UseCors("AllowReactApp");

if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}

app.UseRateLimiter();

/*
 * Statik dosyalar. Iki isi birden goruyor:
 *
 *   1) Firma logosu — `/tenant-assets/...`. Ana API yayina alinmadigi icin bu dosyalari da
 *      bu servis sunar; klasor yoksa istek 404 doner, marka bilgisi sessizce bos kalir.
 *
 *   2) Personel portalinin kendisi — `wwwroot` icine kopyalanan Vite ciktisi (dist).
 *      Windows/IIS kurulumunda `/api` yolunu ayri bir surece yonlendirmek ARR kurulumu
 *      gerektiriyor; onun yerine TEK site: ayni uygulama hem API hem portal. Tek sertifika,
 *      CORS yok, ayri servis yok. `wwwroot` bos birakilirsa (gelistirme) hicbir sey degismez.
 */
app.UseDefaultFiles();
app.UseStaticFiles();

app.UseAuthentication();
app.UseAuthorization();

app.MapControllers();

/*
 * Eslesmeyen `/api/...` cagrilari icin acik 404.
 *
 * Asagidaki SPA geri donusu olmasa gerek yoktu; onunla birlikte yanlis yazilmis bir API
 * yoluna index.html donerdi ve istemci "JSON bekliyordum HTML geldi" gibi yaniltici bir hata
 * verirdi. Yol onceligi bu ayrimi kendisi yapar: gercek controller yollari duz metin
 * bolumlerden olustugu icin bu yakala-hepsini kaliptan ONCE eslesir.
 */
app.Map("/api/{**rest}", () => Results.NotFound());

/*
 * Tarayici tarafi yonlendirme (React Router). Personel QR ile dogrudan `/face-checkin`
 * adresine giriyor; diskte o adla bir dosya yok, uygulamayi index.html yukluyor.
 *
 * Portal `wwwroot`'a konmadiysa (gelistirme) bu kural da dogal olarak 404 doner.
 */
app.MapFallbackToFile("index.html");

app.Run();
