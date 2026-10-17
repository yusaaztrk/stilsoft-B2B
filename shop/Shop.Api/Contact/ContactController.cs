using System.ComponentModel.DataAnnotations;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Shop.Api.Infrastructure;
using Shop.Api.Storefront;
using Shop.Api.Catalog;

namespace Shop.Api.Contact;

/// <summary>
/// İletişim sayfasındaki formu bayinin e-postasına ileten uç.
///
/// Form daha önce hiçbir yere gönderilmiyordu — vitrindeki `onSubmit` boştu, müşteri
/// mesajını yazıp gönderdiğinde hiçbir şey olmuyordu (2026-09-05 denetiminde bulundu).
/// Kimlik doğrulama İSTEMEZ: ziyaretçi üye olmadan da mesaj bırakabilmeli.
/// </summary>
[ApiController]
[Route("api/contact")]
public sealed class ContactController : ControllerBase
{
    private readonly StorefrontStore _store;
    private readonly ShopEmailService _emailService;
    private readonly CallbackService _callbacks;
    private readonly ILogger<ContactController> _logger;

    public ContactController(StorefrontStore store, ShopEmailService emailService, CallbackService callbacks, ILogger<ContactController> logger)
    {
        _store = store;
        _emailService = emailService;
        _callbacks = callbacks;
        _logger = logger;
    }

    /// <summary>
    /// Formların düşeceği kutu: önce <c>SupportEmail</c>, o boşsa yasal metinlerdeki
    /// <c>CompanyEmail</c>.
    ///
    /// <para>Eskiden yalnızca <c>CompanyEmail</c> okunuyordu ve o alan panelde hiç
    /// doldurulmamıştı: iletişim ve servis formları 503 dönüyor, ziyaretçinin yazdığı mesaj
    /// hiçbir yere ulaşmıyordu (2026-09-09'da fark edildi). Destek adresinin varsayılanı
    /// dolu olduğu için form artık ayar girilmeden de çalışıyor.</para>
    /// </summary>
    private static string ResolveInboxAsync(StorefrontSettings settings)
    {
        var support = (settings.SupportEmail ?? string.Empty).Trim();
        if (support.Length > 0) return support;
        return (settings.CompanyEmail ?? string.Empty).Trim();
    }

    public sealed class ContactRequest
    {
        [Required, MaxLength(200)] public string Name { get; set; } = string.Empty;
        [Required, MaxLength(50)] public string Phone { get; set; } = string.Empty;
        [EmailAddress, MaxLength(200)] public string? Email { get; set; }
        [Required, MaxLength(50)] public string Subject { get; set; } = string.Empty;
        [Required, MaxLength(4000)] public string Message { get; set; } = string.Empty;
    }

    [HttpPost]
    [EnableRateLimiting(RateLimitPolicies.Contact)]
    public async Task<IActionResult> Send([FromBody] ContactRequest request, CancellationToken ct)
    {
        if (!ModelState.IsValid) return ValidationProblem(ModelState);

        /*
         * ÖNCE PANELE YAZ, SONRA E-POSTA (2026-09-21).
         *
         * Sunucuda SMTP bilgisi aylardır girilmemiş; e-posta servisi ayar yoksa sessizce
         * "return" ediyor ve müşteri "mesajınız alındı" görüyordu — mesaj HİÇBİR YERE gitmiyordu.
         * Artık her mesaj önce panelin "Sizi Arayalım" listesine düşüyor (kaynak: iletişim formu,
         * konu + mesaj notta); e-posta gidebilirse ayrıca gider. Hiçbir müşteri mesajı kaybolmaz.
         */
        var subjectLabel = request.Subject.Trim() switch
        {
            "siparis" => "Sipariş & Teslimat",
            "urun" => "Ürün Bilgisi",
            "servis" => "Servis & Garanti",
            "kurumsal" => "Toptan & Kurumsal",
            var x => string.IsNullOrWhiteSpace(x) ? "Diğer" : x
        };
        var kayit = await _callbacks.CreateAsync(
            request.Name.Trim(), request.Phone.Trim(), null, $"İletişim formu · {subjectLabel}",
            (string.IsNullOrWhiteSpace(request.Email) ? "" : $"E-posta: {request.Email.Trim()} · ") + request.Message.Trim(),
            "iletisim", null, ct);
        if (!kayit.Success)
        {
            return BadRequest(new { message = kayit.Error ?? "Mesaj alınamadı." });
        }

        var settings = await _store.GetAsync(ct);
        var toEmail = ResolveInboxAsync(settings);
        if (!string.IsNullOrWhiteSpace(toEmail))
        {
            try
            {
                await _emailService.SendContactMessageAsync(
                    toEmail, request.Name.Trim(), request.Phone.Trim(), request.Email?.Trim(), request.Subject.Trim(), request.Message.Trim());
            }
            catch (Exception ex)
            {
                // Kayıt panelde; e-posta gidememesi müşteriye hata olarak dönmez.
                _logger.LogWarning(ex, "İletişim formu e-postası gönderilemedi (kayıt panelde).");
            }
        }

        return Ok(new { success = true });
    }

    public sealed class ServiceRequestDto
    {
        [Required, MaxLength(200)] public string Name { get; set; } = string.Empty;
        [Required, MaxLength(50)] public string Phone { get; set; } = string.Empty;
        [Required, MaxLength(100)] public string City { get; set; } = string.Empty;
        [Required, MaxLength(100)] public string Category { get; set; } = string.Empty;
        [MaxLength(200)] public string? Model { get; set; }

        /// <summary>
        /// Seçilen ürünün stok kodu. Müşteri ürünü katalogdan SEÇTİYSE dolu gelir; "elle
        /// yazayım" dediyse boş. Servis için ürünü tek anlama getiren alan bu — serbest
        /// metin ("fırın", "ST 700 galiba") hangi cihaz olduğunu söylemiyordu.
        /// </summary>
        [MaxLength(60)] public string? ProductStockCode { get; set; }

        /// <summary>garantili · garanti-disi · bilmiyorum</summary>
        [MaxLength(30)] public string? Warranty { get; set; }

        [MaxLength(20)] public string? PurchaseDate { get; set; }

        [MaxLength(50)] public string? Invoice { get; set; }
        [Required, MaxLength(500)] public string Address { get; set; } = string.Empty;
        [Required, MaxLength(4000)] public string Description { get; set; } = string.Empty;
    }

    /// <summary>
    /// /servis sayfasındaki "Online Servis Kaydı" formunun ucu — <b>KAPATILDI</b>.
    ///
    /// <para>2026-09-09 kullanıcı kararı: "bu sayfadaki formu komple kaldır, burdan mesaj
    /// gelmesin". Servis talebi artık yalnızca telefonla alınıyor.</para>
    ///
    /// <para><b>Neden uç silinmedi de kapatıldı:</b> vitrin sayfaları önbellekleniyor
    /// (`revalidate`), ayrıca tarayıcıda açık kalmış eski bir sekme forma hâlâ sahip olabilir.
    /// Uç tamamen kaldırılsaydı o istekler 404 alır ve kullanıcıya "sayfa yok" gibi görünürdü;
    /// daha kötüsü, uç ayakta kalsaydı form kaldırılmış olmasına rağmen e-posta üretmeye devam
    /// ederdi. Açık ve okunabilir bir "artık kullanılmıyor" yanıtı ikisini de çözüyor.</para>
    ///
    /// <para>Geri açılacaksa: aşağıdaki gövdeyi eski hâline döndürmek yetmez, vitrinde
    /// <c>app/servis/page.tsx</c> içindeki form bloğu da geri konmalı.</para>
    /// </summary>
    [HttpPost("service-request")]
    [EnableRateLimiting(RateLimitPolicies.Auth)]
    public IActionResult SendServiceRequest()
    {
        _logger.LogInformation("Servis talebi ucu kapalı; gelen istek yok sayıldı (form 2026-09-09'da kaldırıldı).");

        return StatusCode(StatusCodes.Status410Gone, new
        {
            message = "Online servis kaydı kaldırıldı. Servis talebiniz için lütfen bizi telefonla arayın."
        });
    }
}
