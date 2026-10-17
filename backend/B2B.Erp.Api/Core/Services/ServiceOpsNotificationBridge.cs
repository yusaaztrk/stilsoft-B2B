using System.Net.Http.Json;

namespace B2B.Erp.Api.Core.Services;

/// <summary>
/// Bayide (B2B) üretilen bildirimi servise (ServiceOps) de taşıyan köprü.
///
/// Ortak kimlik KULLANICI ADI: serviste teknisyen bir Guid, burada kullanıcı bir int; ikisini
/// eşleyen tek sabit alan <c>Technician.UserId</c> ve o da kullanıcı adını tutuyor. Servis
/// tarafında karşılığı olmayan kullanıcılar sessizce atlanır — her B2B kullanıcısının teknisyen
/// olması beklenmez.
///
/// Ağ hatası bildirimi düşürür ama gönderme işlemini DÜŞÜRMEZ: bildirim zaten B2B'ye yazıldı.
/// </summary>
public interface IServiceOpsNotificationBridge
{
    Task MirrorAsync(IEnumerable<string> usernames, string title, string content, CancellationToken cancellationToken = default);
}

public sealed class ServiceOpsNotificationBridge : IServiceOpsNotificationBridge
{
    private readonly IHttpClientFactory _httpClientFactory;
    private readonly IConfiguration _configuration;
    private readonly ILogger<ServiceOpsNotificationBridge> _logger;
    private readonly Data.Services.TenantConnectionStringResolver _tenantResolver;

    public ServiceOpsNotificationBridge(
        IHttpClientFactory httpClientFactory,
        IConfiguration configuration,
        ILogger<ServiceOpsNotificationBridge> logger,
        Data.Services.TenantConnectionStringResolver tenantResolver)
    {
        _httpClientFactory = httpClientFactory;
        _configuration = configuration;
        _logger = logger;
        _tenantResolver = tenantResolver;
    }

    public async Task MirrorAsync(
        IEnumerable<string> usernames,
        string title,
        string content,
        CancellationToken cancellationToken = default)
    {
        var list = usernames?.Where(u => !string.IsNullOrWhiteSpace(u)).Distinct(StringComparer.OrdinalIgnoreCase).ToList()
                   ?? new List<string>();

        if (list.Count == 0) return;

        var baseUrl = _configuration["ServiceOps:BaseUrl"];
        var internalKey = _configuration["ServiceOps:InternalApiKey"];

        if (string.IsNullOrWhiteSpace(baseUrl) || string.IsNullOrWhiteSpace(internalKey))
        {
            _logger.LogWarning("Bildirim köprüsü: ServiceOps yapılandırması eksik, servise yazılmadı.");
            return;
        }

        if (!baseUrl.EndsWith("/")) baseUrl += "/";

        var tenantCode = _tenantResolver.GetCurrentTenantCode();

        // Tek tek gönderiliyor: servis tarafı kullanıcı adını teknisyene çeviriyor ve
        // karşılığı olmayanları atlıyor. Toplu bir uç, "hangisi düştü" bilgisini kaybettirirdi.
        //
        // AMA ARDIŞIK DEĞİL: her istek 10 sn zaman aşımıyla sırayla bekleniyordu; 20 kişilik bir
        // toplu iş atamasında çağıran istek en kötü durumda dakikalarca asılı kalıp istemcide
        // ağ geçidi zaman aşımı üretiyordu. İstekler birbirinden bağımsız (ortak DbContext yok,
        // her biri kendi hatasını kendi yakalıyor), o yüzden birlikte yürütülüyor; kullanıcı
        // bazlı günlük kaydı aynen duruyor.
        await Task.WhenAll(list.Select(SendOneAsync));

        async Task SendOneAsync(string username)
        {
            try
            {
                var client = _httpClientFactory.CreateClient();
                client.Timeout = TimeSpan.FromSeconds(10);

                using var request = new HttpRequestMessage(HttpMethod.Post, $"{baseUrl}api/notifications/internal")
                {
                    Content = JsonContent.Create(new { username, title, message = content })
                };

                request.Headers.Add("X-ServiceOps-Key", internalKey);
                if (!string.IsNullOrWhiteSpace(tenantCode))
                {
                    request.Headers.Add("X-Tenant-Code", tenantCode);
                }

                var response = await client.SendAsync(request, cancellationToken);

                if (!response.IsSuccessStatusCode)
                {
                    _logger.LogWarning(
                        "Bildirim köprüsü servise yazamadı ({Status}) — kullanıcı: {Username}",
                        (int)response.StatusCode,
                        username);
                }
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Bildirim köprüsü hatası — kullanıcı: {Username}", username);
            }
        }
    }
}
