using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Security.Claims;
using System.Net.Http;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.IdentityModel.Tokens;
using Microsoft.EntityFrameworkCore;
using ServiceOps.Application;
using ServiceOps.Infrastructure;
using ServiceOps.Api.Hubs;

var builder = WebApplication.CreateBuilder(args);

builder.Configuration
    .AddJsonFile(Path.Combine(builder.Environment.ContentRootPath, "..", "appsettings.json"), optional: true)
    .AddJsonFile(Path.Combine(builder.Environment.ContentRootPath, "..", $"appsettings.{builder.Environment.EnvironmentName}.json"), optional: true);

builder.Services.AddControllers(options =>
    {
        // Yazma işlemleri için varsayılan-reddet kapısı. Denetimde 27 yazma ucunun gövdesinde
        // hiçbir yetki kontrolü olmadığı görüldü; tek tek düzeltmek yerine kapı merkezî, böylece
        // sonradan eklenen her yeni uç da kapsanıyor. Ayrıntı: ServiceOpsWriteAuthorizationFilter.
        options.Filters.Add<ServiceOps.Api.Filters.ServiceOpsWriteAuthorizationFilter>();

        // Okuma tarafı 2026-08-11 denetimine kadar açıktaydı: 11 controller'ın GET uçlarında
        // hiçbir sayfa yetkisi aranmıyordu (müşteri iletişim bilgileri, stok/maliyet, iş kayıtları).
        // Haritası yazma tarafından daha GENİŞ — bazı okumalar referans verisi olduğu için başka
        // sayfaların formlarında da gerekiyor. Ayrıntı: ServiceOpsReadAuthorizationFilter.
        options.Filters.Add<ServiceOps.Api.Filters.ServiceOpsReadAuthorizationFilter>();
    })
    .AddJsonOptions(options =>
    {
        options.JsonSerializerOptions.Converters.Add(new JsonStringEnumConverter());
    });

builder.Services.AddScoped<ServiceOps.Api.Filters.ServiceOpsWriteAuthorizationFilter>();
builder.Services.AddScoped<ServiceOps.Api.Filters.ServiceOpsReadAuthorizationFilter>();

/*
 * CORS.
 *
 * Politika `SetIsOriginAllowed(_ => true)` + `AllowCredentials()` idi: HER kaynak, kimlik
 * bilgisiyle birlikte bu API'ye istek atabiliyordu. Kullanıcının tarayıcısında açık herhangi
 * bir sayfa, onun oturumuyla servis API'sine yazabilirdi.
 *
 * Geliştirmede localhost'un rastgele portlarıyla çalışmak gerektiği için kaynak listesi
 * yapılandırmadan okunuyor; verilmediyse yalnızca localhost'a izin veriliyor.
 * Üretimde `Cors:AllowedOrigins` mutlaka doldurulmalı.
 */
builder.Services.AddCors(options =>
{
    var configured = builder.Configuration.GetSection("Cors:AllowedOrigins").Get<string[]>() ?? Array.Empty<string>();

    options.AddPolicy("DevCors", policy =>
    {
        policy.AllowAnyHeader().AllowAnyMethod().AllowCredentials();

        if (configured.Length > 0)
        {
            policy.WithOrigins(configured);
            return;
        }

        policy.SetIsOriginAllowed(origin =>
        {
            if (string.IsNullOrWhiteSpace(origin)) return false;
            if (!Uri.TryCreate(origin, UriKind.Absolute, out var uri)) return false;

            if (uri.IsLoopback || string.Equals(uri.Host, "localhost", StringComparison.OrdinalIgnoreCase))
                return true;

            // YEREL AĞ da kabul: teknisyenler ofis ağındaki telefonlarından bağlanıyor, yani
            // kaynak 10.x / 172.16-31.x / 192.168.x oluyor. Yalnızca localhost'a izin vermek
            // gerçek kullanımı keserdi. İnternetten gelen kaynaklar yine reddediliyor.
            if (!System.Net.IPAddress.TryParse(uri.Host, out var ip)) return false;
            var b = ip.GetAddressBytes();
            if (b.Length != 4) return false;

            return b[0] == 10
                || (b[0] == 172 && b[1] >= 16 && b[1] <= 31)
                || (b[0] == 192 && b[1] == 168);
        });
    });
});

builder.Services.AddHttpClient("ErpApi", client =>
{
    var baseUrl = builder.Configuration["ErpApi:BaseUrl"] ?? "http://localhost:5200";
    if (!baseUrl.EndsWith("/", StringComparison.Ordinal)) baseUrl += "/";
    client.BaseAddress = new Uri(baseUrl);
});

builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(options =>
    {
        var issuer = builder.Configuration["Jwt:Issuer"];
        var audience = builder.Configuration["Jwt:Audience"];
        var key = builder.Configuration["Jwt:Key"];

        if (string.IsNullOrWhiteSpace(key))
            throw new InvalidOperationException("Jwt:Key bulunamadı");

        options.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer = true,
            ValidateAudience = true,
            ValidateIssuerSigningKey = true,
            ValidateLifetime = true,
            ValidIssuer = issuer,
            ValidAudience = audience,
            IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(key))
        };

        // SignalR WebSocket el sıkışması Authorization başlığı taşıyamaz; tarayıcı API'si izin
        // vermiyor. SignalR istemcisi token'ı `access_token` sorgu parametresiyle gönderir ve
        // sunucunun onu buradan alması gerekir. Yalnızca hub yolunda okunuyor: her istekte sorgu
        // parametresinden token kabul etmek, token'ı tarayıcı geçmişine ve log'lara taşırdı.
        options.Events = new JwtBearerEvents
        {
            OnMessageReceived = ctx =>
            {
                var accessToken = ctx.Request.Query["access_token"];
                var path = ctx.HttpContext.Request.Path;
                if (!string.IsNullOrEmpty(accessToken) && path.StartsWithSegments("/hubs"))
                {
                    ctx.Token = accessToken;
                }
                return Task.CompletedTask;
            },

            // Bayiden (ya da başka bir cihazdan) yapılan çıkış bu token'ı da düşürür.
            OnTokenValidated = ServiceOps.Api.Services.SharedSessionRevocationGuard.RejectRevokedAsync
        };
    });

builder.Services.AddAuthorization();

builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();

builder.Services.AddHttpContextAccessor();
builder.Services.AddScoped<ServiceOps.Infrastructure.Data.ITenantConnectionStringResolver, ServiceOps.Api.Services.TenantConnectionStringResolver>();
builder.Services.AddScoped<ServiceOps.Api.Services.IServiceOpsPermissionService, ServiceOps.Api.Services.ServiceOpsPermissionService>();
builder.Services.AddScoped<ServiceOps.Api.Reports.IReportQueryService, ServiceOps.Api.Reports.ReportQueryService>();
builder.Services.AddScoped<ServiceOps.Api.Reports.IReportExportService, ServiceOps.Api.Reports.ReportExportService>();
// B2B ile ortak oturum defteri: süre, uzatma ve çıkış tek kayıttan yürür.
builder.Services.AddMemoryCache();
builder.Services.AddScoped<ServiceOps.Api.Services.ISharedSessionStore, ServiceOps.Api.Services.SharedSessionStore>();
// "Sana iş atandı" bildirimi: atamanın yapıldığı her uç bunu çağırır.
builder.Services.AddScoped<ServiceOps.Api.Services.IJobAssignmentNotifier, ServiceOps.Api.Services.JobAssignmentNotifier>();
builder.Services.AddScoped<ServiceOps.Api.Services.INotificationBridge, ServiceOps.Api.Services.NotificationBridge>();
// Telefon bildirimi. Firebase servis hesabı verilmediyse gönderici sessiz kalır — kayıt yine de
// yapılıyor ki yapılandırma eklendiğinde uygulamayı değiştirmeye gerek kalmasın.
builder.Services.AddScoped<ServiceOps.Api.Services.IPushSender, ServiceOps.Api.Services.FcmPushSender>();
builder.Services.AddApplication();
builder.Services.AddInfrastructure(builder.Configuration);
builder.Services.AddSignalR();
builder.Services.AddHostedService<ServiceOps.Api.Services.ApproachingJobsNotificationService>();

/*
  CEVAP SIKIŞTIRMA (2026-10-05 kullanıcı bildirimi: "servis genel olarak çok yavaş").
  Kabul/atölye/planlama ekranları listeyi binlerce kayıtla tek seferde alıyor ve cevap
  sıkıştırılmadan gidiyordu — birkaç MB'lık JSON, özellikle telefondaki teknisyende saniyeler
  demek. JSON metni brotli/gzip ile kabaca 5-10 kat küçülüyor; aynı site arayüzün JS/CSS
  dosyalarını da verdiği için ilk açılış da hızlanıyor. "Fastest" seviyesi: sunucuya ek yük
  ihmal edilebilir. IIS ayrıca sıkıştırırsa çift sıkıştırma olmaz (Content-Encoding varsa
  dokunmaz).
*/
builder.Services.AddResponseCompression(options =>
{
    options.EnableForHttps = true;
    options.Providers.Add<Microsoft.AspNetCore.ResponseCompression.BrotliCompressionProvider>();
    options.Providers.Add<Microsoft.AspNetCore.ResponseCompression.GzipCompressionProvider>();
});
builder.Services.Configure<Microsoft.AspNetCore.ResponseCompression.BrotliCompressionProviderOptions>(o =>
    o.Level = System.IO.Compression.CompressionLevel.Fastest);
builder.Services.Configure<Microsoft.AspNetCore.ResponseCompression.GzipCompressionProviderOptions>(o =>
    o.Level = System.IO.Compression.CompressionLevel.Fastest);

var app = builder.Build();

try
{
    var cfg = app.Services.GetRequiredService<IConfiguration>();
    ServiceOps.Api.Services.TenantConnectionStringResolver.MigrateAllTenantDatabases(cfg);
}
catch (Exception ex)
{
    Console.WriteLine($"[Startup Migration Error]: {ex.Message}");
}

if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}

// Sıkıştırma EN DIŞTA: controller, minimal API ve statik dosya cevaplarının hepsini sarar.
app.UseResponseCompression();

app.UseCors("DevCors");

app.UseMiddleware<ServiceOps.Api.Middleware.GlobalExceptionMiddleware>();

/*
 * Giriş isteklerinde firma kodunu GÖVDEDEN okuyup bağlar.
 *
 * Tenant çözücü X-Tenant-Code başlığına bakıyor, ama giriş isteğinde böyle bir başlık yok:
 * henüz oturum açılmamış, istemci ham fetch ile gönderiyor. Başlık yokken çözücü varsayılan
 * `serviceops_dev` veritabanına düşüyor, dolayısıyla firmanın ServiceUsers satırları hiç
 * görülmüyor ve teknisyen girişleri "kullanıcı bulunamadı" ile en sondaki dala kayıyordu.
 *
 * Controller action'ının içinde Items'a yazmak GEÇ KALIYOR: DbContext controller kurulurken
 * DI tarafından üretiliyor ve bağlantı dizesi o anda seçiliyor. Bu yüzden ara katman.
 */
app.Use(async (context, next) =>
{
    var path = context.Request.Path.Value ?? string.Empty;
    // technician-login ucu kaldirildi (bkz. AuthController); tek giris yolu /api/auth/login.
    var isLogin = path.StartsWith("/api/auth/login", StringComparison.OrdinalIgnoreCase);

    if (isLogin
        && HttpMethods.IsPost(context.Request.Method)
        && !context.Request.Headers.ContainsKey("X-Tenant-Code"))
    {
        context.Request.EnableBuffering();
        try
        {
            using var reader = new StreamReader(context.Request.Body, Encoding.UTF8, leaveOpen: true);
            var body = await reader.ReadToEndAsync();
            context.Request.Body.Position = 0;

            if (!string.IsNullOrWhiteSpace(body))
            {
                using var doc = JsonDocument.Parse(body);
                if (doc.RootElement.TryGetProperty("tenantCode", out var t)
                    && t.ValueKind == JsonValueKind.String)
                {
                    var code = t.GetString();
                    if (!string.IsNullOrWhiteSpace(code))
                    {
                        context.Items["TenantCode"] = code.Trim();
                    }
                }
            }
        }
        catch
        {
            // Gövde okunamadıysa giriş yine denenir; yalnızca firma bağlama atlanır.
            context.Request.Body.Position = 0;
        }
    }

    await next();
});

// /uploads is intentionally NOT served as static files — montaj documents are
// served through the authenticated GET /api/montaj/document/{docId} endpoint.

app.UseAuthentication();
app.UseAuthorization();

app.MapControllers();
// Hub KİMLİK İSTER. Eskiden AllowAnonymous idi ve hub'ın kendi belgesi "kimlik doğrulaması
// gerekmez, bağlanan her istemci bütün olayları alır" diyordu: ağdan erişebilen herkes
// bütün firmaların canlı servis kaydı / montaj / kargo güncellemelerini dinleyebiliyordu.
app.MapHub<ServiceOpsHub>("/hubs/serviceops").RequireAuthorization();

// ── ERP Proxy: ürünler ──────────────────────────────────────────────────────
// Token cache (process-lifetime; resets on restart)
string? _cachedErpToken = null;
DateTime _tokenExpiry = DateTime.MinValue;

async Task<string?> GetCachedErpToken(IHttpClientFactory factory, IConfiguration cfg, CancellationToken ct, bool forceRefresh = false)
{
    Console.WriteLine("[ERP_AUTH] Checking cache...");

    // ÖNBELLEKTEKİ TOKEN ERKEN ÖLEBİLİR (2026-08-21).
    //
    // Token yalnızca kendi `exp`ine bakılarak saklanıyordu. Ama ERP tarafında token bundan
    // ÖNCE geçersizleşebiliyor: ERP yeniden başlatılıp imza anahtarı değişirse, ortak oturum
    // servis hesabını düşürürse ya da parola değişirse. O anda ERP 401 dönüyor, biz 502'ye
    // çevirip "ürünler alınamadı" diyoruz — ve önbellekteki ölü token SÜRESİ DOLANA KADAR
    // (saatler) kullanılmaya devam ediyordu. Kullanıcı tarafında bu, ürünlerin bir anda
    // kaybolup bir süre sonra kendiliğinden geri gelmesi olarak görünüyordu.
    //
    // `forceRefresh` bu kilidi açar: 401/403 alan çağıran, önbelleği atlayıp yeniden giriş
    // yapılmasını isteyebilir.
    if (forceRefresh)
    {
        Console.WriteLine("[ERP_AUTH] Force refresh istendi, onbellek atlaniyor.");
        _cachedErpToken = null;
        _tokenExpiry = DateTime.MinValue;
    }

    if (_cachedErpToken != null && DateTime.UtcNow < _tokenExpiry) 
    {
        Console.WriteLine("[ERP_AUTH] Using cached token.");
        return _cachedErpToken;
    }
    
    Console.WriteLine("[ERP_AUTH] Cache miss or expired. Attempting login...");
    var client = factory.CreateClient("ErpApi");
    
    // SESSİZ YER TUTUCU YOK (2026-08-21). Burada üç tane vardı: kullanıcı yoksa "ssa",
    // parola yoksa "123", firma kodu boşsa sabit "SERVIS". Üçü de yapılandırma eksikken
    // girişi DENEMEYE devam ediyordu; ERP 401/500 dönüyor, ekranda görünen tek şey
    // "Ürünler bulunamadı" oluyordu. Yani eksik ayar, "bu firmada ürün yok" diye okunuyordu.
    // Artık eksik olan neyse adıyla log'a yazılır ve giriş hiç denenmez.
    var tCode = (cfg["ErpApi:ServiceAccount:TenantCode"] ?? "").Trim();
    var user = (cfg["ErpApi:ServiceAccount:Username"] ?? "").Trim();
    var pass = cfg["ErpApi:ServiceAccount:Password"] ?? "";

    if (string.IsNullOrWhiteSpace(user) || string.IsNullOrWhiteSpace(pass))
    {
        Console.WriteLine("[ERP_AUTH_CONFIG] ErpApi:ServiceAccount:Username / Password ayarlı değil — appsettings.Production.json'a eklenmeli.");
        return null;
    }

    // 'ssa' firmaya bağlı OLMAYAN hesap: token'ında firma yok, firma seçimi
    // X-Tenant-Code başlığına kalır. Ama girişin KENDİSİ varsayılan veritabanına
    // (DefaultConnection -> b2b_erp) düşer; o şema kurulu değilse giriş 500 verir.
    if (string.Equals(user, "ssa", StringComparison.OrdinalIgnoreCase))
    {
        tCode = "";
    }
    else if (string.IsNullOrWhiteSpace(tCode))
    {
        Console.WriteLine($"[ERP_AUTH_CONFIG] '{user}' firmaya bağlı bir hesap ama ErpApi:ServiceAccount:TenantCode boş. Firma kodu yazılmalı.");
        return null;
    }

    Console.WriteLine($"[ERP_AUTH] Tenant: {tCode}, User: {user}");

    var bodyObj = new { tenantCode = tCode, username = user, password = pass };
    var body = System.Text.Json.JsonSerializer.Serialize(bodyObj);
    
    try
    {
        var erpUrl = client.BaseAddress?.ToString() ?? "http://localhost:5200/";
        Console.WriteLine($"[ERP_AUTH] POST {erpUrl}api/auth/login");

        var request = new HttpRequestMessage(HttpMethod.Post, "api/auth/login")
        {
            Content = new StringContent(body, System.Text.Encoding.UTF8, "application/json")
        };
        if (!string.IsNullOrWhiteSpace(tCode))
        {
            request.Headers.Add("X-Tenant-Code", tCode);
        }

        var res = await client.SendAsync(request, ct);
        Console.WriteLine($"[ERP_AUTH] Response Status: {res.StatusCode}");

        if (!res.IsSuccessStatusCode) 
        {
            var err = await res.Content.ReadAsStringAsync(ct);
            Console.WriteLine($"[ERP_AUTH_ERROR] Status: {res.StatusCode}, Body: {err}");
            return null;
        }
        var json = await res.Content.ReadAsStringAsync(ct);
        using var doc = System.Text.Json.JsonDocument.Parse(json);
        
        var token = doc.RootElement.TryGetProperty("accessToken", out var t1) ? t1.GetString()
            : doc.RootElement.TryGetProperty("data", out var d) && d.TryGetProperty("accessToken", out var t2) ? t2.GetString()
            : null;
            
        if (!string.IsNullOrEmpty(token)) 
        { 
            Console.WriteLine("[ERP_AUTH] Token acquired successfully.");
            _cachedErpToken = token; 
            var expiry = DateTime.UtcNow.AddMinutes(2); // Fallback to 2 minutes
            try
            {
                var parts = token.Split('.');
                if (parts.Length > 1)
                {
                    var payloadBase64 = parts[1].Replace('-', '+').Replace('_', '/');
                    switch (payloadBase64.Length % 4)
                    {
                        case 2: payloadBase64 += "=="; break;
                        case 3: payloadBase64 += "="; break;
                    }
                    var payloadBytes = Convert.FromBase64String(payloadBase64);
                    var payloadJson = System.Text.Encoding.UTF8.GetString(payloadBytes);
                    using var payloadDoc = JsonDocument.Parse(payloadJson);
                    if (payloadDoc.RootElement.TryGetProperty("exp", out var expProp))
                    {
                        var expSeconds = expProp.GetInt64();
                        expiry = DateTimeOffset.FromUnixTimeSeconds(expSeconds).UtcDateTime.AddSeconds(-15);
                    }
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[ERP_AUTH] Expiry parse error: {ex.Message}");
            }
            _tokenExpiry = expiry; 
            Console.WriteLine($"[ERP_AUTH] Token expiry set to: {_tokenExpiry} (UTC), Current time: {DateTime.UtcNow} (UTC)");
        }
        else
        {
            Console.WriteLine("[ERP_AUTH] Token property not found in response.");
            Console.WriteLine($"[ERP_AUTH] Full Body: {json}");
        }
        return _cachedErpToken;
    }
    catch (Exception ex) 
    { 
        Console.WriteLine($"[ERP_AUTH_EXCEPTION] {ex.GetType().Name}: {ex.Message}");
        if (ex.InnerException != null) Console.WriteLine($"[ERP_AUTH_INNER] {ex.InnerException.Message}");
        return null; 
    }
}

// Stok / yedek parça listesi. Cari listesiyle aynı kural: SADECE çağıranın firması.
//
// Eskiden burada bütün firmalar dolaşılıp ürünleri tek listede birleştiriliyordu; firmalar arası
// veri sızıntısıydı ve firma listesi çekilemediğinde sabit "DEMO"e düşüyordu — yani başka bir
// firmadaki kullanıcı ya yabancı ürünler ya da hiçbir şey görüyordu ("Ürünler bulunamadı").
app.MapGet("/api/erp/products", async (
    System.Security.Claims.ClaimsPrincipal user,
    HttpRequest httpRequest,
    IHttpClientFactory httpClientFactory,
    IConfiguration configuration,
    ServiceOps.Infrastructure.Data.ApplicationDbContext dbContext,
    string? q,
    // Ana kategori süzgeci ERP'ye olduğu gibi geçer. Hızlı Servis ekranı buraya 'YED' yollar:
    // ERP tarafındaki eşleşme kategori adını normalleştirip ÖNEK karşılaştırdığı için tek
    // değerle hem YED-STIL hem YED-MUHT yakalanır (bkz. ProductsController.NormalizeCategoryKey).
    string? mainCategory,
    int pageSize = 200, int page = 1,
    CancellationToken cancellationToken = default) =>
{
    var client = httpClientFactory.CreateClient("ErpApi");

    var callerTenant = httpRequest.Headers["X-Tenant-Code"].FirstOrDefault()
        ?? user.FindFirst("tenantCode")?.Value
        ?? user.FindFirst("TenantCode")?.Value;

    if (string.IsNullOrWhiteSpace(callerTenant))
    {
        return Results.Problem("Firma kodu bulunamadı.", statusCode: 400);
    }

    var tenants = new List<string> { callerTenant };

    var localDiagrams = await dbContext.ExplodedDiagrams
        .AsNoTracking()
        .Where(d => d.IsActive)
        .OrderByDescending(d => d.UploadedAt)
        .Select(d => new { d.Id, d.Product.StockCode })
        .ToListAsync(cancellationToken);

    var diagramMap = localDiagrams
        .Where(d => !string.IsNullOrEmpty(d.StockCode))
        .GroupBy(d => d.StockCode!)
        .ToDictionary(g => g.Key, g => g.First().Id, StringComparer.OrdinalIgnoreCase);

    var allItems = new List<object>();
    var erpToken = await GetCachedErpToken(httpClientFactory, configuration, cancellationToken);
    
    if (string.IsNullOrEmpty(erpToken))
    {
        return Results.Problem("ERP kimlik doğrulaması başarısız oldu (ssa login failure).", statusCode: 502);
    }

    foreach (var tCode in tenants)
    {
        var qs = $"?pageSize={pageSize}&page={page}";
        if (!string.IsNullOrWhiteSpace(q)) qs += $"&q={Uri.EscapeDataString(q)}";
        if (!string.IsNullOrWhiteSpace(mainCategory)) qs += $"&mainCategory={Uri.EscapeDataString(mainCategory)}";

        var req = new HttpRequestMessage(HttpMethod.Get, $"api/products{qs}");
        req.Headers.Add("X-Tenant-Code", tCode);
        req.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", erpToken);

        HttpResponseMessage res;
        string body;
        try
        {
            res = await client.SendAsync(req, cancellationToken);
            body = await res.Content.ReadAsStringAsync(cancellationToken);
        }
        catch (Exception ex)
        {
            // Hata YUTULMUYOR. Eskiden burada catch boştu: ERP'ye ulaşılamadığında uç 200 ile
            // boş liste dönüyor, ekranda "Ürünler bulunamadı" yazıyordu — yani bağlantı arızası
            // "bu firmada ürün yok" gibi görünüyordu.
            return Results.Problem(
                title: "ERP ürün listesi alınamadı",
                detail: $"ERP API bağlantı hatası: {ex.Message}",
                statusCode: 502);
        }

        // ÖLÜ TOKEN'DA BİR KEZ YENİDEN DENE (2026-08-21).
        //
        // "Ürünler bazen kendiliğinden gelmiyor, sonra kendiliğinden geliyor" şikayetinin
        // sebebi buydu: önbellekteki ERP token'ı kendi `exp`inden ÖNCE geçersizleşebiliyor
        // (ERP yeniden başlar, ortak oturum servis hesabını düşürür, parola değişir). O anda
        // ERP 401 dönüyor, biz 502 verip "alınamadı" diyorduk ve ölü token önbellekte SAATLERCE
        // kalmaya devam ediyordu — süresi dolana kadar her istek başarısız. Süre dolunca yeni
        // giriş yapılıyor ve ürünler "kendiliğinden" geri geliyordu.
        //
        // Tek deneme bilerek: giriş bilgileri gerçekten yanlışsa sonsuz döngüye girmesin.
        if (res.StatusCode is System.Net.HttpStatusCode.Unauthorized or System.Net.HttpStatusCode.Forbidden)
        {
            Console.WriteLine("[ERP_AUTH] Urun listesi 401/403 dondu, token yenilenip bir kez daha deneniyor.");
            var yeniToken = await GetCachedErpToken(httpClientFactory, configuration, cancellationToken, forceRefresh: true);
            if (!string.IsNullOrEmpty(yeniToken))
            {
                var tekrar = new HttpRequestMessage(HttpMethod.Get, $"api/products{qs}");
                tekrar.Headers.Add("X-Tenant-Code", tCode);
                tekrar.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", yeniToken);

                try
                {
                    res = await client.SendAsync(tekrar, cancellationToken);
                    body = await res.Content.ReadAsStringAsync(cancellationToken);
                }
                catch (Exception ex)
                {
                    return Results.Problem(
                        title: "ERP ürün listesi alınamadı",
                        detail: $"ERP API bağlantı hatası: {ex.Message}",
                        statusCode: 502);
                }
            }
        }

        if (!res.IsSuccessStatusCode)
        {
            var statusCode = res.StatusCode is System.Net.HttpStatusCode.Unauthorized or System.Net.HttpStatusCode.Forbidden
                ? 502
                : (int)res.StatusCode;
            return Results.Problem(
                title: "ERP ürün listesi alınamadı",
                detail: string.IsNullOrWhiteSpace(body) ? res.ReasonPhrase : body,
                statusCode: statusCode);
        }

        using var pDoc = JsonDocument.Parse(body);
        if (pDoc.RootElement.TryGetProperty("data", out var d) && d.TryGetProperty("items", out var items))
        {
            foreach (var item in items.EnumerateArray())
            {
                var dict = JsonSerializer.Deserialize<Dictionary<string, object>>(item.GetRawText());
                if (dict == null) continue;

                var stockCodeVal = dict.TryGetValue("stockCode", out var sc) ? sc?.ToString() : null;
                dict["explodedDiagramUrl"] =
                    !string.IsNullOrEmpty(stockCodeVal) && diagramMap.TryGetValue(stockCodeVal.Trim(), out var diagramId)
                        ? $"/api/serviceproducts/diagram/{diagramId}"
                        : null;

                allItems.Add(dict);
            }
        }
    }

    return Results.Ok(new { success = true, data = new { items = allItems } });
}).RequireAuthorization();

// Cari seçimi, Sipariş sayfasındaki uçların aynısını kullanır: cari tipini SUNUCUDA süzen
// api/customers/dealers ve api/customers/end-customers. Bunlar "-1/-2/-3" alt hesaplarını
// (FATURA / AÇIK / ASKERİYE) listeden düşürür, yani ekrana yalnızca ana cariler gelir —
// eskiden burada tüm tenant'lar dolaşılıp ham cari listesi 2000'de kesiliyordu ve arada bayi
// çıkması şansa kalıyordu.
app.MapGet("/api/erp/dealers", async (
    System.Security.Claims.ClaimsPrincipal user,
    HttpRequest httpRequest,
    IHttpClientFactory httpClientFactory,
    IConfiguration configuration,
    string? q,
    string? type,
    CancellationToken cancellationToken = default) =>
{
    var client = httpClientFactory.CreateClient("ErpApi");

    var tenantCode = httpRequest.Headers["X-Tenant-Code"].FirstOrDefault()
        ?? user.FindFirst("tenantCode")?.Value
        ?? user.FindFirst("TenantCode")?.Value;

    if (string.IsNullOrWhiteSpace(tenantCode))
    {
        return Results.Problem("Tenant kodu bulunamadı.", statusCode: 400);
    }

    var erpToken = await GetCachedErpToken(httpClientFactory, configuration, cancellationToken);
    if (string.IsNullOrEmpty(erpToken))
    {
        return Results.Problem("ERP kimlik doğrulaması başarısız oldu (ssa login failure).", statusCode: 502);
    }

    var normalizedType = (type ?? string.Empty).Trim().ToLowerInvariant() switch
    {
        "" or "bayi" or "dealer" => "bayi",
        "magaza" or "mağaza" or "store" or "parekende" => "magaza",
        "musteri" or "müşteri" or "customer" or "endcustomer" => "musteri",
        "all" or "hepsi" => "all",
        _ => "bayi"
    };

    var upstreamPaths = normalizedType switch
    {
        "bayi" => new[] { "api/customers/dealers?type=bayi" },
        "magaza" => new[] { "api/customers/dealers" },
        "musteri" => new[] { "api/customers/end-customers" },
        _ => new[] { "api/customers/dealers?type=bayi", "api/customers/dealers", "api/customers/end-customers" }
    };

    var allItems = new List<object>();
    var seenCodes = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

    foreach (var path in upstreamPaths)
    {
        var url = path + (path.Contains('?') ? "&" : "?") + "includeInactive=false";
        if (!string.IsNullOrWhiteSpace(q)) url += $"&q={Uri.EscapeDataString(q)}";

        var req = new HttpRequestMessage(HttpMethod.Get, url);
        req.Headers.Add("X-Tenant-Code", tenantCode);
        req.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", erpToken);

        HttpResponseMessage res;
        string body;
        try
        {
            res = await client.SendAsync(req, cancellationToken);
            body = await res.Content.ReadAsStringAsync(cancellationToken);
        }
        catch (Exception ex)
        {
            return Results.Problem(
                title: "ERP cari listesi alınamadı",
                detail: $"ERP API bağlantı hatası: {ex.Message}",
                statusCode: 502);
        }

        // Ölü token'da bir kez yeniden dene — gerekçe için ürün ucundaki nota bakınız.
        if (res.StatusCode is System.Net.HttpStatusCode.Unauthorized or System.Net.HttpStatusCode.Forbidden)
        {
            Console.WriteLine("[ERP_AUTH] Cari listesi 401/403 dondu, token yenilenip bir kez daha deneniyor.");
            var yeniToken = await GetCachedErpToken(httpClientFactory, configuration, cancellationToken, forceRefresh: true);
            if (!string.IsNullOrEmpty(yeniToken))
            {
                var tekrar = new HttpRequestMessage(HttpMethod.Get, url);
                tekrar.Headers.Add("X-Tenant-Code", tenantCode);
                tekrar.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", yeniToken);

                try
                {
                    res = await client.SendAsync(tekrar, cancellationToken);
                    body = await res.Content.ReadAsStringAsync(cancellationToken);
                }
                catch (Exception ex)
                {
                    return Results.Problem(
                        title: "ERP cari listesi alınamadı",
                        detail: $"ERP API bağlantı hatası: {ex.Message}",
                        statusCode: 502);
                }
            }
        }

        if (!res.IsSuccessStatusCode)
        {
            /*
              BİR UÇ DÜŞERSE DİĞERLERİ YAŞAR (2026-08-27 bildirimi: "müşteri carileri gelmiyor").

              `type=all` ÜÇ ERP ucunu sırayla çağırıyor: bayi, mağaza, son müşteri. Burası
              herhangi biri başarısız olunca isteğin TAMAMINI düşürüyordu — o ana kadar
              toplanmış bayiler de çöpe gidiyordu.

              Somut arıza: ERP'nin `end-customers` ucu sayfa yetkisi istiyor
              (`invoice.siparis` / `invoice.magaza`). ServiceOps servis hesabında o yetki yoksa
              uç 403 dönüyor, burası 502'ye çeviriyor, istemci de hatayı yutup boş liste
              gösteriyordu. Sonuç: arama kutusu hiç sonuç vermiyor ama sebebi görünmüyor.

              Artık başarısız uç ATLANIR ve sebebi günlüğe yazılır. Hiçbir uç başarılı olmazsa
              aşağıda zaten boş liste dönüyor; kısmi başarı tam kayıptan iyidir.
            */
            Console.WriteLine($"[ERP_CARI] '{path}' ucu {(int)res.StatusCode} döndü, atlanıyor. Yanıt: {body?.Trim()}");
            continue;
        }

        using var doc = JsonDocument.Parse(body);
        if (!doc.RootElement.TryGetProperty("data", out var data) || data.ValueKind != JsonValueKind.Array)
        {
            continue;
        }

        foreach (var item in data.EnumerateArray())
        {
            var code = item.TryGetProperty("customerCode", out var codeEl) ? codeEl.GetString() : null;
            if (string.IsNullOrWhiteSpace(code) || !seenCodes.Add(code)) continue;

            var priceGroupCode = item.TryGetProperty("priceGroupCode", out var pgEl) && pgEl.ValueKind == JsonValueKind.Number
                ? pgEl.GetInt32()
                : (int?)null;
            var rawInvoiceType = item.TryGetProperty("invoiceType", out var invEl) ? invEl.GetString() : null;

            allItems.Add(new
            {
                customerCode = code,
                name = item.TryGetProperty("name", out var nameEl) ? nameEl.GetString() : null,
                phone = item.TryGetProperty("phone", out var phoneEl) ? phoneEl.GetString() : null,
                address = item.TryGetProperty("address", out var addressEl) ? addressEl.GetString() : null,
                city = item.TryGetProperty("city", out var cityEl) ? cityEl.GetString() : null,
                district = item.TryGetProperty("district", out var districtEl) ? districtEl.GetString() : null,
                taxNumber = item.TryGetProperty("taxNumber", out var taxEl) ? taxEl.GetString() : null,
                customerType = item.TryGetProperty("customerType", out var ctEl) ? ctEl.GetString() : null,
                priceGroupCode,
                // Sipariş sepetindeki kuralın aynısı: fiyat grubu kodu 7 → ASKERİYE, 4-6 → AÇIK,
                // aksi halde carinin kendi fatura tipi, o da yoksa FATURA.
                invoiceType = ResolveErpInvoiceType(priceGroupCode, rawInvoiceType)
            });
        }
    }

    return Results.Ok(new { success = true, data = new { items = allItems } });
}).RequireAuthorization();

static string ResolveErpInvoiceType(int? priceGroupCode, string? invoiceType)
{
    if (priceGroupCode == 7) return "ASKERİYE";
    if (priceGroupCode is >= 4 and <= 6) return "ACIK";

    var inv = (invoiceType ?? string.Empty).Trim().ToUpperInvariant();
    if (inv == "ACIK" || inv == "AÇIK") return "ACIK";
    if (inv == "ASKERIYE" || inv == "ASKERİYE" || inv == "MUAF") return "ASKERİYE";
    return "FATURA";
}

app.MapGet("/api/erp/customers", async (
    System.Security.Claims.ClaimsPrincipal user,
    IHttpClientFactory httpClientFactory,
    IConfiguration configuration,
    HttpRequest httpRequest,
    string? q,
    string? type,
    int pageSize = 20000,
    CancellationToken cancellationToken = default) =>
{
    var client = httpClientFactory.CreateClient("ErpApi");
    var tenantCode = httpRequest.Headers["X-Tenant-Code"].FirstOrDefault()
        ?? user.FindFirst("tenantCode")?.Value
        ?? user.FindFirst("TenantCode")?.Value;

    if (string.IsNullOrWhiteSpace(tenantCode))
    {
        return Results.Problem("Tenant kodu bulunamadı.", statusCode: 400);
    }

    var erpToken = await GetCachedErpToken(httpClientFactory, configuration, cancellationToken);
    if (string.IsNullOrEmpty(erpToken))
    {
        return Results.Problem("ERP kimlik doğrulaması başarısız oldu (ssa login failure).", statusCode: 502);
    }

    var qs = new List<string>
    {
        "includeInactive=true"
    };
    if (!string.IsNullOrWhiteSpace(q)) qs.Add($"q={Uri.EscapeDataString(q)}");

    var req = new HttpRequestMessage(HttpMethod.Get, $"api/customers?{string.Join("&", qs)}");
    req.Headers.Add("X-Tenant-Code", tenantCode);
    req.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", erpToken);

    HttpResponseMessage res;
    string body;
    try
    {
        res = await client.SendAsync(req, cancellationToken);
        body = await res.Content.ReadAsStringAsync(cancellationToken);
    }
    catch (Exception ex)
    {
        return Results.Problem(
            title: "ERP cari listesi alınamadı",
            detail: $"ERP API bağlantı hatası: {ex.Message}",
            statusCode: 502);
    }
    // Ölü token'da bir kez yeniden dene — gerekçe için ürün ucundaki nota bakınız.
    if (res.StatusCode is System.Net.HttpStatusCode.Unauthorized or System.Net.HttpStatusCode.Forbidden)
    {
        Console.WriteLine("[ERP_AUTH] Musteri listesi 401/403 dondu, token yenilenip bir kez daha deneniyor.");
        var yeniToken = await GetCachedErpToken(httpClientFactory, configuration, cancellationToken, forceRefresh: true);
        if (!string.IsNullOrEmpty(yeniToken))
        {
            var tekrar = new HttpRequestMessage(HttpMethod.Get, $"api/customers?{string.Join("&", qs)}");
            tekrar.Headers.Add("X-Tenant-Code", tenantCode);
            tekrar.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", yeniToken);

            try
            {
                res = await client.SendAsync(tekrar, cancellationToken);
                body = await res.Content.ReadAsStringAsync(cancellationToken);
            }
            catch (Exception ex)
            {
                return Results.Problem(
                    title: "ERP cari listesi alınamadı",
                    detail: $"ERP API bağlantı hatası: {ex.Message}",
                    statusCode: 502);
            }
        }
    }

    if (!res.IsSuccessStatusCode)
    {
        var statusCode = res.StatusCode == System.Net.HttpStatusCode.Unauthorized || res.StatusCode == System.Net.HttpStatusCode.Forbidden
            ? 502
            : (int)res.StatusCode;
        return Results.Problem(
            title: "ERP cari listesi alınamadı",
            detail: string.IsNullOrWhiteSpace(body) ? res.ReasonPhrase : body,
            statusCode: statusCode);
    }

    var items = new List<object>();
    using var doc = JsonDocument.Parse(body);
    if (doc.RootElement.TryGetProperty("data", out var data) && data.ValueKind == JsonValueKind.Array)
    {
        foreach (var item in data.EnumerateArray())
        {
            var customerType = item.TryGetProperty("customerType", out var customerTypeEl) ? customerTypeEl.GetString() : null;
            if (!string.IsNullOrWhiteSpace(type) && !string.Equals(NormalizeErpCustomerType(customerType), NormalizeErpCustomerType(type), StringComparison.OrdinalIgnoreCase))
            {
                continue;
            }

            items.Add(new
            {
                id = item.TryGetProperty("customerCode", out var codeEl) ? codeEl.GetString() : null,
                customerNumber = item.TryGetProperty("customerCode", out var cnEl) ? cnEl.GetString() : null,
                fullName = item.TryGetProperty("name", out var nameEl) ? nameEl.GetString() : null,
                type = NormalizeErpCustomerType(customerType),
                typeLabel = string.IsNullOrWhiteSpace(customerType) ? "Cari" : customerType,
                phone = item.TryGetProperty("phone", out var phoneEl) ? phoneEl.GetString() : null,
                email = item.TryGetProperty("email", out var emailEl) ? emailEl.GetString() : null,
                address = item.TryGetProperty("address", out var addressEl) ? addressEl.GetString() : null,
                city = item.TryGetProperty("city", out var cityEl) ? cityEl.GetString() : null,
                district = item.TryGetProperty("district", out var districtEl) ? districtEl.GetString() : null,
                regionName = item.TryGetProperty("city", out var regionEl) ? regionEl.GetString() : null,
                totalServices = 0,
                lastServiceDate = (DateTime?)null,
                totalRevenue = 0,
                isActive = !item.TryGetProperty("isActive", out var activeEl) || activeEl.GetBoolean(),
                invoiceType = item.TryGetProperty("invoiceType", out var invoiceTypeEl) ? invoiceTypeEl.GetString() : null,
                parentCustomerCode = item.TryGetProperty("parentCustomerCode", out var parentEl) ? parentEl.GetString() : null,
                creditLimit = item.TryGetProperty("creditLimit", out var creditEl) && creditEl.ValueKind == JsonValueKind.Number ? creditEl.GetDecimal() : 0
            });
        }
    }

    return Results.Ok(items.Take(Math.Clamp(pageSize, 1, 100000)).ToList());
}).RequireAuthorization();

static string NormalizeErpCustomerType(string? raw)
{
    var value = (raw ?? string.Empty).Trim().ToLowerInvariant();
    return value switch
    {
        "müşteri" or "musteri" => "Customer",
        "bayi" => "Dealer",
        "çalışan" or "calisan" => "Employee",
        "şube" or "sube" => "Branch",
        "parekende" or "perakende" => "Retail",
        "mağaza" or "magaza" => "Store",
        "" => "Customer",
        _ => raw?.Trim() ?? "Customer"
    };
}

/*
 * Firma markası (logo + başlık gradyanı). B2B'de tanımlı, ServiceOps'ta vekil ucu YOKTU:
 * `StilsoftShell` bu adresi kendi API'sinden istiyor, 404 alıyor ve `catch` sessizce yutuyordu.
 * Sonuç: hiçbir firmanın logosu ve renkleri servis tarafında hiç görünmedi.
 * Kimlik gerektirmiyor — giriş ekranında da kullanılıyor, B2B'deki karşılığı da anonim.
 */
app.MapGet("/api/tenants/public-branding", async (
    IHttpClientFactory httpClientFactory,
    string? tenantCode,
    CancellationToken cancellationToken) =>
{
    var client = httpClientFactory.CreateClient("ErpApi");
    var qs = string.IsNullOrWhiteSpace(tenantCode) ? "" : $"?tenantCode={Uri.EscapeDataString(tenantCode)}";

    try
    {
        using var res = await client.GetAsync($"api/tenants/public-branding{qs}", cancellationToken);
        var body = await res.Content.ReadAsStringAsync(cancellationToken);

        if (!res.IsSuccessStatusCode)
        {
            // Marka bilgisi olmadan da çalışılır; varsayılan renklerle devam edilsin diye
            // hata yerine boş yanıt dönüyoruz.
            return Results.Ok(new { success = false, data = (object?)null });
        }

        return Results.Content(body, "application/json");
    }
    catch
    {
        return Results.Ok(new { success = false, data = (object?)null });
    }
}).AllowAnonymous();

app.MapGet("/api/tenants/public", async (IHttpClientFactory httpClientFactory, CancellationToken cancellationToken) =>
{
    var client = httpClientFactory.CreateClient("ErpApi");

    try
    {
        using var res = await client.GetAsync("api/tenants/public?serviceOpsOnly=true", cancellationToken);
        var body = await res.Content.ReadAsStringAsync(cancellationToken);

        if (!res.IsSuccessStatusCode)
        {
            return Results.Problem(
                title: "ERP tenant listesi alınamadı",
                detail: string.IsNullOrWhiteSpace(body) ? res.ReasonPhrase : body,
                statusCode: (int)res.StatusCode);
        }

        var json = JsonSerializer.Deserialize<JsonElement>(body);
        return Results.Ok(json);
    }
    catch
    {
        // ERP API kapalıysa login ekranı tamamen bloklanmasın.
        // Frontend { data: [{code,name}] } bekliyor.
        return Results.Ok(new
        {
            success = true,
            data = new[]
            {
                new { code = "DEMO", name = "DEMO" },
                new { code = "DEMO", name = "DEMO" },
                new { code = "DEMOTEST", name = "Stilsoft Test" }
            }
        });
    }
}).AllowAnonymous();

app.MapGet("/uploads/{*path}", async (
    string path,
    IHttpClientFactory httpClientFactory,
    CancellationToken cancellationToken) =>
{
    if (string.IsNullOrEmpty(path)) return Results.NotFound();

    // Check if file exists locally first
    var localPath = Path.Combine(AppContext.BaseDirectory, "uploads", path.Replace('/', Path.DirectorySeparatorChar));
    if (System.IO.File.Exists(localPath))
    {
        var ext = Path.GetExtension(localPath).ToLowerInvariant();
        var contentType = ext switch
        {
            ".jpg" or ".jpeg" => "image/jpeg",
            ".png" => "image/png",
            ".gif" => "image/gif",
            ".webp" => "image/webp",
            ".pdf" => "application/pdf",
            _ => "application/octet-stream"
        };
        var fileStream = new System.IO.FileStream(localPath, FileMode.Open, FileAccess.Read);
        return Results.Stream(fileStream, contentType);
    }

    var client = httpClientFactory.CreateClient("ErpApi");
    try
    {
        var response = await client.GetAsync($"uploads/{path}", HttpCompletionOption.ResponseHeadersRead, cancellationToken);
        if (!response.IsSuccessStatusCode)
        {
            return Results.StatusCode((int)response.StatusCode);
        }

        var contentType = response.Content.Headers.ContentType?.ToString() ?? "application/octet-stream";
        var stream = await response.Content.ReadAsStreamAsync(cancellationToken);
        return Results.Stream(stream, contentType);
    }
    catch (Exception ex)
    {
        return Results.Problem($"Failed to proxy upload: {ex.Message}");
    }
}).AllowAnonymous();

// TEK SITE BARINDIRMA (servis.example.com).
// API ve React arayuzu AYNI site altinda: `/api/*` controller'lara, gerisi wwwroot'a gider.
// Bu blok Program.cs'in EN SONUNDA duruyor ki once tum controller ve minimal API
// eslesmeleri denensin; index.html yalnizca hicbiri tutmadiginda devreye girsin.
app.UseDefaultFiles();
app.UseStaticFiles();

// ESLESMEYEN /api CAGRISI HTML DONMEMELI — fallback'ten ONCE durmasi sart.
app.Map("/api/{**rest}", () => Results.NotFound());

// React yonlendiricisi icin geri dusum.
app.MapFallbackToFile("index.html");

app.Run();
