using System.Text.Json;
using Shop.Api.Infrastructure;

namespace Shop.Api.Erp;

/// <summary>
/// ServiceOps'a OKUMA — yalnızca teslimat takibi.
///
/// Kargo/teslimat ERP'de değil ServiceOps'ta yaşıyor, o yüzden mağazanın üçüncü bir muhatabı
/// var. Bağlantı yine sunucu-sunucu anahtarıyla (<c>X-ServiceOps-Key</c>), ERP'nin montaj
/// webhook'unda kullandığı desenin aynısı.
///
/// ANAHTAR TARAYICIYA VERİLMEZ. ServiceOps siparişin kime ait olduğunu bilmiyor — bilemez de,
/// mağaza üyeleri onun veritabanında yok. Sahiplik kontrolü bu yüzden ÇAĞIRAN tarafta:
/// <see cref="Orders.AccountDataService.GetOrderDetailAsync"/> sipariş numarasını önce üyenin
/// kendi sipariş listesinde arıyor. Anahtar dışarı sızarsa sipariş numarasını bilen herkes
/// başkasının teslimat durumunu okuyabilir.
/// </summary>
public sealed class ServiceOpsClient
{
    private readonly IHttpClientFactory _httpClientFactory;
    private readonly IConfiguration _configuration;
    private readonly TenantResolver _tenant;
    private readonly ILogger<ServiceOpsClient> _logger;

    public ServiceOpsClient(
        IHttpClientFactory httpClientFactory,
        IConfiguration configuration,
        TenantResolver tenant,
        ILogger<ServiceOpsClient> logger)
    {
        _httpClientFactory = httpClientFactory;
        _configuration = configuration;
        _tenant = tenant;
        _logger = logger;
    }

    private bool IsConfigured => !string.IsNullOrWhiteSpace(_configuration["ServiceOps:InternalApiKey"]);

    private string BaseUrl => (_configuration["ServiceOps:BaseUrl"] ?? "http://localhost:5137").TrimEnd('/');

    /// <summary>
    /// Siparişin teslimat durumu. Kayıt yoksa ServiceOps "Hazırlanıyor" diye cevaplıyor;
    /// bu bir hata değil, siparişin henüz kargo aşamasına gelmemiş olması.
    ///
    /// ServiceOps kapalıysa null dönüyor — teslimat servisi yüzünden müşterinin sipariş
    /// ekranı çökmemeli, o bölüm boş kalır.
    /// </summary>
    private static DateTime _lastFailure = DateTime.MinValue;

    public async Task<JsonElement?> GetDeliveryAsync(string orderNo, CancellationToken ct)
    {
        if (!IsConfigured || string.IsNullOrWhiteSpace(orderNo)) return null;

        // Devre kesici: Servis kapalıysa her istekte soket beklemesi yapıp sayfayı yavaşlatmaz.
        if (DateTime.UtcNow - _lastFailure < TimeSpan.FromSeconds(30)) return null;

        try
        {
            var client = _httpClientFactory.CreateClient();
            /*
              ZAMAN AŞIMI 1200ms → 4sn (2026-09-10).

              1,2 saniye yerel geliştirmeye göre ayarlanmıştı. Canlıda ServiceOps ayrı bir IIS
              uygulaması: havuz uyuduysa ilk istek soğuk açılışla kolayca 1,2 saniyeyi aşıyor.
              Aşınca da aşağıdaki devre kesici 30 saniye boyunca BÜTÜN teslimat sorgularını
              sessizce null'a düşürüyor — müşteri sipariş sayfasında kargo hiç ilerlememiş
              gibi görüyor ("durumu değiştirdim ama yansımıyor" şikâyeti).

              4 saniye, soğuk açılışa yeten ama sayfayı bekletmeyen bir orta yol.
            */
            client.Timeout = TimeSpan.FromSeconds(4);

            using var request = new HttpRequestMessage(
                HttpMethod.Get,
                $"{BaseUrl}/api/cargotracking/public/{Uri.EscapeDataString(orderNo)}");

            request.Headers.TryAddWithoutValidation("X-ServiceOps-Key", _configuration["ServiceOps:InternalApiKey"]);

            // Firma başlığı ŞART: ServiceOps hangi veritabanına bakacağını buradan seçiyor.
            // Başlıksız istek varsayılan veritabanına düşüyor, kaydı bulamıyor ve "henüz
            // kargoya verilmedi" diye cevaplıyor — yani sessizce yanlış cevap veriyor, hata
            // vermiyor. ERP'nin montaj webhook'u da aynı başlığı gönderiyor.
            request.Headers.TryAddWithoutValidation("X-Tenant-Code", _tenant.TenantCode);

            using var response = await client.SendAsync(request, ct);
            if (!response.IsSuccessStatusCode)
            {
                _logger.LogWarning("Teslimat durumu alınamadı: {Status} {OrderNo}", response.StatusCode, orderNo);
                return null;
            }

            using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync(ct));

            // JsonDocument burada kapanıyor; klonlanmadan döndürmek serbest bırakılmış belleği
            // okumak olurdu.
            return doc.RootElement.TryGetProperty("data", out var data) ? data.Clone() : null;
        }
        catch (Exception ex)
        {
            _lastFailure = DateTime.UtcNow;
            _logger.LogWarning("Teslimat servisine ulaşılamadı (devre kesici devreye alındı): {OrderNo}", orderNo);
            return null;
        }
    }
}
