using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using Shop.Api.Infrastructure;

namespace Shop.Api.Erp;

/// <summary>
/// ERP'ye YAZMA işlemleri — cari açma, sipariş, ödeme.
///
/// Okuma tarafı doğrudan veritabanından yapılıyor; yazma ise ERP'nin API'sinden geçer, çünkü
/// cari kodu üretimi, stok hareketi, ekstre ve muhasebe kuralları orada yaşıyor. Bunları burada
/// tekrarlamak, iki sistemin zamanla farklı davranması demek olurdu.
///
/// Kimlik doğrulaması sunucu-sunucu ANAHTARIYLA yapılır, kullanıcı hesabıyla değil. Eski
/// e-ticarette ERP'ye tam yetkili bir kullanıcıyla giriliyordu: mağaza sunucusu ele geçse
/// ERP'nin tamamı açılırdı. Anahtar ise ERP tarafında yalnızca /api/ecommerce/* uçlarını açar —
/// e-ticaret carisi açmak ve iletişim bilgisi güncellemek dışında hiçbir şey yapamaz.
/// </summary>
public sealed class ErpWriteClient
{
    private readonly IHttpClientFactory _httpClientFactory;
    private readonly IConfiguration _configuration;
    private readonly TenantResolver _tenant;
    private readonly ILogger<ErpWriteClient> _logger;

    public ErpWriteClient(
        IHttpClientFactory httpClientFactory,
        IConfiguration configuration,
        TenantResolver tenant,
        ILogger<ErpWriteClient> logger)
    {
        _httpClientFactory = httpClientFactory;
        _configuration = configuration;
        _tenant = tenant;
        _logger = logger;
    }

    /// <summary>Anahtar tanımlı değilse yazma denenmez; kapalı başarısız olunur.</summary>
    public bool IsConfigured => !string.IsNullOrWhiteSpace(_configuration["Erp:InternalApiKey"]);

    private string BaseUrl => (_configuration["Erp:BaseUrl"] ?? "http://localhost:5200").TrimEnd('/');

    private async Task<HttpResponseMessage?> SendAsync(HttpMethod method, string path, object? payload, CancellationToken ct)
    {
        var key = _configuration["Erp:InternalApiKey"];
        if (string.IsNullOrWhiteSpace(key)) return null;

        var client = _httpClientFactory.CreateClient();
        client.Timeout = TimeSpan.FromSeconds(45);

        using var request = new HttpRequestMessage(method, $"{BaseUrl}{path}");
        request.Headers.TryAddWithoutValidation("X-Internal-Key", key);
        request.Headers.TryAddWithoutValidation("X-Tenant-Code", _tenant.TenantCode);

        if (payload is not null)
        {
            request.Content = new StringContent(JsonSerializer.Serialize(payload), Encoding.UTF8, "application/json");
        }

        return await client.SendAsync(request, ct);
    }

    /// <summary>Sipariş gibi diğer e-ticaret uçları da aynı anahtarlı kanaldan geçer.</summary>
    public Task<HttpResponseMessage?> PostAsync(string path, object payload, CancellationToken ct)
        => SendAsync(HttpMethod.Post, path, payload, ct);

    public Task<HttpResponseMessage?> GetAsync(string path, CancellationToken ct)
        => SendAsync(HttpMethod.Get, path, null, ct);

    /// <summary>
    /// Siparişin ÖDENMİŞ olup olmadığını ERP'ye sorar.
    ///
    /// Mağaza bu soruyu kendi kaydından cevaplayamaz: tahsilatın kaydı ERP'de, imza doğrulaması
    /// da orada. Buradaki cevap tarayıcıdan değil sunucudan geliyor — müşterinin geri döndüğü
    /// adres bir kanıt değildir.
    ///
    /// Emin olunamadığında FALSE dönüyor: "ödenmiş olabilir"i ödenmiş saymak, ödenmemiş bir
    /// siparişi kapatmak demek olurdu.
    /// </summary>
    public async Task<bool> IsEcommerceOrderPaidAsync(string customerCode, string orderNo, CancellationToken ct)
    {
        var status = await GetEcommercePaymentStatusAsync(customerCode, orderNo, ct);
        return status is not null
               && status.Value.TryGetProperty("isPaid", out var paid)
               && paid.ValueKind == JsonValueKind.True;
    }

    /// <summary>Siparişin ödeme durumunun tamamı; okunamazsa null.</summary>
    public async Task<JsonElement?> GetEcommercePaymentStatusAsync(string customerCode, string orderNo, CancellationToken ct)
    {
        if (!IsConfigured || string.IsNullOrWhiteSpace(orderNo) || string.IsNullOrWhiteSpace(customerCode))
        {
            return null;
        }

        var path = $"/api/ecommerce/payments/{Uri.EscapeDataString(orderNo)}" +
                   $"?customerCode={Uri.EscapeDataString(customerCode)}";

        var response = await SendAsync(HttpMethod.Get, path, null, ct);
        if (response is null) return null;

        using (response)
        {
            if (!response.IsSuccessStatusCode) return null;

            var body = await response.Content.ReadAsStringAsync(ct);

            try
            {
                using var doc = JsonDocument.Parse(body);
                if (!doc.RootElement.TryGetProperty("data", out var data)) return null;

                // JsonDocument burada kapanıyor; öğeyi klonlamadan döndürmek serbest bırakılmış
                // belleği okumak olurdu.
                return data.Clone();
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Ödeme durumu çözümlenemedi: {OrderNo}", orderNo);
                return null;
            }
        }
    }

    /// <summary>
    /// <paramref name="PhoneConflict"/>: ERP aynı telefonla kayıtlı bir cari olduğu için (409)
    /// açmadı. <paramref name="ExistingCustomerCode"/>/<paramref name="ExistingCustomerType"/>
    /// yeni ERP'den gelir; eski ERP yalnız mesaj döndürür, o zaman ikisi null'dır.
    /// </summary>
    public sealed record CustomerCreation(
        bool Success,
        string? CustomerCode,
        string? Error,
        bool PhoneConflict = false,
        string? ExistingCustomerCode = null,
        string? ExistingCustomerType = null);

    /// <summary>
    /// Üyelik kaydında e-ticaret carisi açar.
    ///
    /// Cari kodunu ERP üretir (120-11- serisinden, kilitli sayaçla): aynı anda kayıt olan iki
    /// kişiye aynı kodun verilmemesi bu kilide bağlı, dolayısıyla kod burada hesaplanmıyor.
    /// </summary>
    public async Task<CustomerCreation> CreateEcommerceCustomerAsync(
        string fullName,
        string email,
        string? phone,
        string? city,
        string? district,
        string? address,
        CancellationToken ct,
        bool allowDuplicatePhone = false)
    {
        if (!IsConfigured)
        {
            return new CustomerCreation(false, null, "ERP servis anahtarı yapılandırılmamış.");
        }

        // allowDuplicatePhone: üyesiz siparişte numara başka bir caride olsa da yeni cari açılır
        // (bkz. ERP CustomersController.EcommerceCustomerRequest.AllowDuplicatePhone).
        var payload = new
        {
            name = fullName,
            email,
            phone,
            city,
            district,
            address,
            allowDuplicatePhone
        };

        var response = await SendAsync(HttpMethod.Post, "/api/ecommerce/customers", payload, ct);
        if (response is null) return new CustomerCreation(false, null, "ERP'ye bağlanılamadı.");

        using (response)
        {
            var body = await response.Content.ReadAsStringAsync(ct);

            if (response.StatusCode == System.Net.HttpStatusCode.Conflict)
            {
                /*
                  409 = TELEFON ZATEN BİR CARİDE (ERP kuralı: aynı numaraya ikinci cari açılmaz).
                  Bu, "ERP'ye ulaşılamadı" ile aynı kefeye konup 503'e çevriliyordu; canlıda
                  telefonu bir caride kayıtlı herkes "Kayıt şu anda tamamlanamıyor" görüyordu
                  ve günlükte de sadece "Conflict" yazıyordu. Ayrı döner; çağıran karar verir.
                */
                string? existingCode = null, existingType = null;
                try
                {
                    using var cdoc = JsonDocument.Parse(body);
                    var croot = cdoc.RootElement;
                    if (croot.TryGetProperty("customerCode", out var cc)) existingCode = cc.GetString();
                    if (croot.TryGetProperty("customerType", out var ctp)) existingType = ctp.GetString();
                }
                catch
                {
                    // Eski ERP: gövdede yalnız mesaj var.
                }

                _logger.LogWarning("Cari açılamadı: telefon zaten kayıtlı ({Code}, {Type}).", existingCode ?? "?", existingType ?? "?");
                return new CustomerCreation(false, null, "Bu telefon numarasına ait bir cari zaten var.", true, existingCode, existingType);
            }

            if (!response.IsSuccessStatusCode)
            {
                _logger.LogError("Cari açılamadı: {Status} {Body}", response.StatusCode, body);
                return new CustomerCreation(false, null, $"ERP {(int)response.StatusCode}: cari kaydı oluşturulamadı.");
            }

            try
            {
                using var doc = JsonDocument.Parse(body);
                var root = doc.RootElement;
                var data = root.TryGetProperty("data", out var d) ? d : root;
                var code = data.TryGetProperty("customerCode", out var c) ? c.GetString() : null;

                return string.IsNullOrWhiteSpace(code)
                    ? new CustomerCreation(false, null, "Cari kodu okunamadı.")
                    : new CustomerCreation(true, code, null);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Cari yanıtı çözümlenemedi.");
                return new CustomerCreation(false, null, "Cari yanıtı çözümlenemedi.");
            }
        }
    }

    /// <summary>
    /// Carinin iletişim bilgileri — teslimat ve fatura adresinin tek kaynağı.
    ///
    /// Mağaza bu bilgiyi kendi veritabanında TUTMUYOR: cari kartı ERP'nin verisi ve bayi de
    /// aynı kartı düzenliyor. İkinci bir kopya, iki tarafın farklı adres göstermeye başladığı
    /// güne kadar sorunsuz görünürdü. Okunamazsa null dönüyor; ekran o zaman bilgiyi boş
    /// gösterip uyarıyor, çünkü boş bir adres kutusu kaydedilirse dolu olan adresi silmez
    /// (ERP ucu null gelen alanı atlıyor) ama kullanıcı adresini kaybettiğini sanır.
    /// </summary>
    public async Task<CustomerContact?> GetCustomerContactAsync(string customerCode, CancellationToken ct)
    {
        if (!IsConfigured) return null;

        var response = await SendAsync(
            HttpMethod.Get,
            $"/api/ecommerce/customers/{Uri.EscapeDataString(customerCode)}/contact",
            null,
            ct);

        if (response is null) return null;

        using (response)
        {
            if (!response.IsSuccessStatusCode)
            {
                _logger.LogWarning("Cari iletişim bilgisi okunamadı: {Status}", response.StatusCode);
                return null;
            }

            try
            {
                return await response.Content.ReadFromJsonAsync<CustomerContact>(cancellationToken: ct);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Cari iletişim yanıtı çözümlenemedi.");
                return null;
            }
        }
    }

    public sealed class CustomerContact
    {
        public string? CustomerCode { get; set; }
        public string? Name { get; set; }
        public string? Phone { get; set; }
        public string? City { get; set; }
        public string? District { get; set; }
        public string? Address { get; set; }
    }

    /// <summary>Profil güncellemesi cariye de yansır — beyaz listedeki alanlarla sınırlı.</summary>
    public async Task<bool> UpdateCustomerContactAsync(
        string customerCode,
        string fullName,
        string? phone,
        string? city,
        string? district,
        string? address,
        CancellationToken ct)
    {
        if (!IsConfigured) return false;

        var payload = new
        {
            name = fullName,
            phone,
            city,
            district,
            address
        };

        var response = await SendAsync(HttpMethod.Put, $"/api/ecommerce/customers/{Uri.EscapeDataString(customerCode)}/contact", payload, ct);
        if (response is null) return false;

        using (response)
        {
            if (response.IsSuccessStatusCode) return true;

            var body = await response.Content.ReadAsStringAsync(ct);
            _logger.LogError("Cari güncellenemedi: {Status} {Body}", response.StatusCode, body);
            return false;
        }
    }
}
