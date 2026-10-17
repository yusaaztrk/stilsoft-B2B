using System.Net.Http.Json;
using System.Text.Json;

namespace B2B.Erp.Api.Features.Ecommerce;

/// <summary>Teslimat kaydının açılması için ServiceOps'a gönderilen gövde.</summary>
public sealed class CargoTaskPayload
{
    public string OrderNumber { get; set; } = string.Empty;
    public string? ProductDetails { get; set; }
    public string? CustomerName { get; set; }

    /// <summary>Kuryenin arayacağı numara. ServiceOps'ta ayrı kolon; boş gelebilir.</summary>
    public string? CustomerPhone { get; set; }

    public string? DeliveryAddress { get; set; }
    public DateTime OrderDate { get; set; }

    /// <summary>
    /// Fatura numarası. Ödeme anında BOŞ gelir (fatura henüz yok), fatura kesilince aynı
    /// kayıt bu alanla güncellenir. ServiceOps'ta ayrı bir kolon açılmıyor; numara paket
    /// dökümünün altına yazılıyor — kuryenin ekranında görünmesi yeterli.
    /// </summary>
    public string? InvoiceNo { get; set; }
}

/// <summary>Müşteriye gösterilebilir teslimat durumu (ServiceOps'un dar kapısından).</summary>
public sealed class CargoTrackingSnapshot
{
    public bool Exists { get; set; }
    public int Status { get; set; } = -1;
    public string StatusLabel { get; set; } = "Hazırlanıyor";
    public DateTime? PlannedDate { get; set; }
    public DateTime? UpdatedAt { get; set; }
    public List<CargoTrackingStep> History { get; set; } = new();
}

public sealed class CargoTrackingStep
{
    public int Status { get; set; }
    public string StatusLabel { get; set; } = string.Empty;
    public DateTime Timestamp { get; set; }
}

/// <summary>
/// E-ticaret siparişinin ServiceOps'taki teslimat (kargo) kaydına açılan tek kapı.
///
/// NEDEN AYRI SINIF: aynı çağrı artık İKİ yerden yapılıyor —
///   1. ödeme onaylanınca (EcommerceFulfilmentService) kayıt AÇILIYOR,
///   2. fatura kesilince (InvoicesController) aynı kayıt GÜNCELLENİYOR.
/// İkisi ayrı ayrı istemci kurup ayrı başlık listesi taşısaydı, biri değiştiğinde diğeri
/// sessizce eski kalırdı; firma kodu başlığı eksik gittiğinde kayıt YANLIŞ FİRMAYA yazılıyor
/// (ServiceOps başlıksız istekte varsayılan veritabanına düşüyor), yani hata değil sessiz
/// yanlış davranış üretiyor.
///
/// HİÇBİR METOT FIRLATMAZ. Teslimat kaydı açılamadı diye tahsilat geri alınmaz, fatura
/// silinmez; sonuç yalnızca günlüğe yazılır. Kayıt ServiceOps ekranından elle de açılabiliyor.
/// </summary>
public sealed class ServiceOpsCargoClient
{
    private readonly IHttpClientFactory _httpClientFactory;
    private readonly IConfiguration _configuration;
    private readonly ILogger<ServiceOpsCargoClient> _logger;
    private readonly Data.Services.TenantConnectionStringResolver _tenantResolver;
    private readonly IHttpContextAccessor _httpContextAccessor;

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true
    };

    public ServiceOpsCargoClient(
        IHttpClientFactory httpClientFactory,
        IConfiguration configuration,
        ILogger<ServiceOpsCargoClient> logger,
        Data.Services.TenantConnectionStringResolver tenantResolver,
        IHttpContextAccessor httpContextAccessor)
    {
        _httpClientFactory = httpClientFactory;
        _configuration = configuration;
        _logger = logger;
        _tenantResolver = tenantResolver;
        _httpContextAccessor = httpContextAccessor;
    }

    /// <summary>
    /// Firma kodu ZORUNLU. Başlık isteğin kendisinden, oturumdan ya da bağlantı çözücüden
    /// sırayla aranıyor: ödeme geri çağrısı bankadan geliyor ve bizim başlıklarımızı taşımaz,
    /// o yolda tek kaynak çözücüdür.
    /// </summary>
    private HttpClient? CreateClient()
    {
        var baseUrl = _configuration["ServiceOps:BaseUrl"];
        if (string.IsNullOrWhiteSpace(baseUrl))
        {
            _logger.LogWarning("[Kargo] ServiceOps:BaseUrl tanimli degil, teslimat kaydi gonderilmedi.");
            return null;
        }

        if (!baseUrl.EndsWith("/")) baseUrl += "/";

        var http = _httpContextAccessor.HttpContext;
        var tenantCode = http?.Request.Headers["X-Tenant-Code"].FirstOrDefault();
        if (string.IsNullOrWhiteSpace(tenantCode)) tenantCode = http?.User?.FindFirst("TenantCode")?.Value;
        if (string.IsNullOrWhiteSpace(tenantCode)) tenantCode = http?.User?.FindFirst("tenantCode")?.Value;
        if (string.IsNullOrWhiteSpace(tenantCode)) tenantCode = _tenantResolver.GetCurrentTenantCode();

        if (string.IsNullOrWhiteSpace(tenantCode))
        {
            _logger.LogWarning("[Kargo] Firma kodu cozulemedi, teslimat kaydi gonderilmedi.");
            return null;
        }

        var client = _httpClientFactory.CreateClient();
        client.BaseAddress = new Uri(baseUrl);
        client.Timeout = TimeSpan.FromSeconds(15);

        var key = _configuration["ServiceOps:InternalApiKey"];
        if (!string.IsNullOrWhiteSpace(key)) client.DefaultRequestHeaders.Add("X-ServiceOps-Key", key);
        client.DefaultRequestHeaders.Add("X-Tenant-Code", tenantCode);

        return client;
    }

    /// <summary>
    /// Teslimat kaydını açar ya da var olanı günceller.
    ///
    /// ServiceOps tarafındaki uç aynı sipariş numarası için ikinci kayıt AÇMIYOR; dolu gelen
    /// alanlarla var olanı tazeliyor. Yani bu metot ödeme anında da, fatura anında da, geri
    /// çağrı iki kez geldiğinde de güvenle çağrılabilir.
    /// </summary>
    public async Task<bool> UpsertAsync(CargoTaskPayload payload, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(payload.OrderNumber)) return false;

        try
        {
            using var client = CreateClient();
            if (client is null) return false;

            var response = await client.PostAsJsonAsync("api/cargotracking", payload, ct);
            var ok = response.IsSuccessStatusCode;

            if (!ok)
            {
                var text = await response.Content.ReadAsStringAsync(ct);
                _logger.LogWarning(
                    "[Kargo] Teslimat kaydi yazilamadi. OrderNo={OrderNo} Status={Status} Body={Body}",
                    payload.OrderNumber, (int)response.StatusCode, text);
            }
            else
            {
                _logger.LogInformation("[Kargo] Teslimat kaydi yazildi. OrderNo={OrderNo}", payload.OrderNumber);
            }

            return ok;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "[Kargo] Teslimat kaydi gonderilemedi. OrderNo={OrderNo}", payload.OrderNumber);
            return false;
        }
    }

    /// <summary>
    /// Siparişin müşteriye gösterilebilir teslimat durumu.
    ///
    /// Kayıt yoksa ServiceOps exists=false + "Hazırlanıyor" döndürüyor; bu bir hata değil,
    /// "henüz kargoya verilmedi" demek. Servise hiç ulaşılamazsa da aynı boş anlık görüntü
    /// dönüyor: sipariş ekranı teslimat bilgisi yok diye çökmemeli.
    /// </summary>
    public async Task<CargoTrackingSnapshot> GetTrackingAsync(string orderNo, CancellationToken ct)
    {
        var empty = new CargoTrackingSnapshot();
        if (string.IsNullOrWhiteSpace(orderNo)) return empty;

        try
        {
            using var client = CreateClient();
            if (client is null) return empty;

            var response = await client.GetAsync(
                $"api/cargotracking/public/{Uri.EscapeDataString(orderNo)}", ct);

            if (!response.IsSuccessStatusCode) return empty;

            var body = await response.Content.ReadAsStringAsync(ct);
            using var doc = JsonDocument.Parse(body);

            if (!doc.RootElement.TryGetProperty("data", out var data)) return empty;

            return JsonSerializer.Deserialize<CargoTrackingSnapshot>(data.GetRawText(), JsonOptions) ?? empty;
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "[Kargo] Teslimat durumu okunamadi. OrderNo={OrderNo}", orderNo);
            return empty;
        }
    }

    /// <summary>Siparişin teslimat kaydını siler (sipariş iptali / son faturanın silinmesi).</summary>
    public async Task<bool> DeleteAsync(string orderNo, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(orderNo)) return false;

        try
        {
            using var client = CreateClient();
            if (client is null) return false;

            var response = await client.DeleteAsync(
                $"api/cargotracking/order/{Uri.EscapeDataString(orderNo)}", ct);

            return response.IsSuccessStatusCode;
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "[Kargo] Teslimat kaydi silinemedi. OrderNo={OrderNo}", orderNo);
            return false;
        }
    }
}
