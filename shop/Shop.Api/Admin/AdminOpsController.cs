using System.ComponentModel.DataAnnotations;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using Npgsql;
using Shop.Api.Erp;
using Shop.Api.Infrastructure;
using Shop.Api.Members;
using Shop.Api.Orders;

namespace Shop.Api.Admin;

/// <summary>
/// Bayi panelinin e-ticaret ekranları: siparişler, üyeler ve mutabakat.
///
/// NEDEN MAĞAZA API'SİNDE: bayi paneli e-ticaretle ilgili her şeyi zaten buradan okuyor (vitrin,
/// ürün yayını). Mutabakat için ayrıca ERP'ye doğrudan bağlanmak, panelde iki farklı adres ve iki
/// farklı kimlik doğrulaması demek olurdu. Üstelik mutabakatın yarısı zaten burada: ERP "banka ne
/// dedi"yi biliyor, mağaza "müşteri ne yaptı"yı.
///
/// Kimlik doğrulaması bayinin kendi B2B token'ıyla (<see cref="B2BAdminAuthAttribute"/>);
/// mağazanın ayrı bir personel hesabı YOK.
/// </summary>
[ApiController]
[Route("api/admin")]
public sealed class AdminOpsController : ControllerBase
{
    private readonly ErpWriteClient _erp;
    private readonly OrderEventLog _events;
    private readonly TenantResolver _tenant;
    private readonly ShopSchema _schema;
    private readonly MemberStore _members;
    private readonly Shop.Api.Infrastructure.ISmsService _sms;
    private readonly ILogger<AdminOpsController> _logger;

    public AdminOpsController(
        ErpWriteClient erp,
        OrderEventLog events,
        TenantResolver tenant,
        ShopSchema schema,
        MemberStore members,
        Shop.Api.Infrastructure.ISmsService sms,
        ILogger<AdminOpsController> logger)
    {
        _erp = erp;
        _events = events;
        _tenant = tenant;
        _schema = schema;
        _members = members;
        _sms = sms;
        _logger = logger;
    }

    /// <summary>
    /// SMS servisinin durumu: açık mı, kaç kredi kaldı, gönderici adı ne.
    ///
    /// NEDEN PANELDE: kredi bitince doğrulama SMS'leri sessizce gitmiyor ve kayıt ekranı
    /// çalışmıyormuş gibi görünüyor. Bayinin bunu ancak müşteri şikayet edince öğrenmesi,
    /// bir günlük kayıp demek. Servis metotları baştan beri vardı, panel tarafı yazılmamıştı.
    ///
    /// Kredentials yoksa `configured=false` dönüyor ve kredi hiç sorulmuyor — kapalı bir
    /// servise istek atmanın anlamı yok.
    /// </summary>
    [HttpGet("sms-status")]
    [B2BAdminAuth]
    public async Task<IActionResult> SmsStatus(CancellationToken ct)
    {
        if (!_sms.IsConfigured)
        {
            return Ok(new
            {
                configured = false,
                credit = (int?)null,
                senderName = (string?)null,
                message = "SMS kapalı. appsettings.Local.json içindeki TMessage bilgileri (ApiUN, ApiPP, SenderName) girilmemiş."
            });
        }

        // İki çağrı da başarısız olabilir (servis kapalı, kredentials yanlış); o hâlde null
        // dönüyor ve panel "okunamadı" yazıyor. Uydurma bir sayı göstermek, kredi bittiğinde
        // de "her şey yolunda" demek olurdu.
        var credit = await _sms.GetCreditAsync(ct);
        var otpCredit = await _sms.GetOtpCreditAsync(ct);
        var sender = await _sms.GetSenderNameAsync(ct);

        return Ok(new
        {
            configured = true,
            credit,
            otpCredit,
            senderName = sender,
            message = credit is null ? "Kredi bilgisi okunamadı. Kullanıcı adı/şifre doğru mu?" : null,
            /*
              SON HATALAR (2026-09-21). "SMS gitmiyor" şikayetinde tek işe yarayan bilgi
              sağlayıcının verdiği kod. Panelde göründüğü anda sorunun kredi mi, şifre mi,
              numara biçimi mi yoksa ağ mı olduğu belli oluyor; önceden bu yalnız sunucu
              günlüğünde kalıyordu ve kimse bakmıyordu.
            */
            recentFailures = _sms.RecentFailures.Select(f => new
            {
                atUtc = f.AtUtc,
                phone = f.MaskedPhone,
                errorCode = f.ErrorCode
            })
        });
    }

    private string CurrentUser =>
        (HttpContext.Items[B2BAdminAuthAttribute.PrincipalItemKey] as System.Security.Claims.ClaimsPrincipal)?
            .FindFirst(System.Security.Claims.ClaimTypes.Name)?.Value ?? "bayi";

    /// <summary>
    /// SAHTE SMS KUTUSU — yalnızca sahte sağlayıcı açıkken (yani yalnızca Development).
    ///
    /// NEDEN VAR: doğrulama kodu olmadan kayıt akışı otomatik test edilemiyor. Gerçek
    /// gönderim kredentials, kredi ve gerçek bir telefon istiyor; sanal POS'ta aynı sorun
    /// için sahte sağlayıcı yazılmıştı, kod da aynı şekilde okunabilir olmalı.
    ///
    /// KAPI: <see cref="Shop.Api.Infrastructure.FakeSmsService.IsEnabled"/>. Kapalıysa 404 —
    /// "yetkisiz" değil, "böyle bir uç yok". Üretimde bu uç hiçbir koşulda cevap vermez;
    /// verseydi doğrulama kodlarını okuyan bir kapı olurdu.
    /// </summary>
    [HttpGet("sms-outbox")]
    public IActionResult SmsOutbox(
        [FromServices] IWebHostEnvironment environment,
        [FromServices] IConfiguration configuration)
    {
        if (!Shop.Api.Infrastructure.FakeSmsService.IsEnabled(environment, configuration))
        {
            return NotFound();
        }

        return Ok(new
        {
            success = true,
            data = Shop.Api.Infrastructure.FakeSmsService.Outbox()
                .OrderByDescending(x => x.SentAtUtc)
                .Select(x => new { sentAtUtc = x.SentAtUtc, phone = x.Phone, message = x.Message })
                .ToList()
        });
    }

    /// <summary>E-ticaret siparişleri — ödeme ve fatura durumuyla birlikte.</summary>
    [HttpGet("orders")]
    [B2BAdminAuth]
    public async Task<IActionResult> Orders([FromQuery] int gun, [FromQuery] string? ara, CancellationToken ct)
    {
        var path = $"/api/ecommerce/admin/orders?days={(gun <= 0 ? 30 : gun)}";
        if (!string.IsNullOrWhiteSpace(ara)) path += $"&ara={Uri.EscapeDataString(ara)}";

        var data = await ReadErpDataAsync(path, ct);
        if (data is null) return StatusCode(StatusCodes.Status502BadGateway, new { message = "ERP'den sipariş listesi alınamadı." });

        return Content(data.Value.GetRawText(), "application/json");
    }

    /// <summary>
    /// Mağaza üyeleri.
    ///
    /// ŞİFRE ÖZETİ VE OTURUM ANAHTARI DÖNMEZ. Panelin ihtiyacı olan şey "kim üye oldu, carisi
    /// açıldı mı, en son ne zaman girdi" — hesabı ele geçirmeye yarayacak hiçbir alan değil.
    /// </summary>
    [HttpGet("members")]
    [B2BAdminAuth]
    public async Task<IActionResult> Members(
        [FromQuery] string? ara,
        [FromQuery] bool misafirDahil,
        CancellationToken ct)
    {
        await _schema.EnsureAsync(ct);

        await using var conn = new NpgsqlConnection(_tenant.ShopConnectionString());
        await conn.OpenAsync(ct);

        var search = (ara ?? string.Empty).Trim();

        /*
         * MİSAFİR SATIRLARI VARSAYILAN OLARAK GİZLİ (2026-09-09).
         *
         * Ziyaretçi giriş yapmadan sepete ürün ekleyince perde arkasında bir "misafir üye"
         * satırı açılıyor (bkz. AccountController.EnsureGuestAsync) — sepetin bir sahibi olmak
         * zorunda. Bu satırlar gerçek üye değil: adları "Misafir Kullanıcı", e-postaları
         * uydurma (@guest.stilsoft), telefonları yok ve carileri hiç açılmıyor.
         *
         * Liste bunları da gösterince sayfa saatte onlarca satırla şişiyor ve gerçek üyeler
         * arasında kayboluyordu — canlıda 45 dakikada 12 satır. Panelin sorusu "kim üye oldu";
         * cevabı bu satırlar değil.
         *
         * SİLİNMİYOR, yalnızca gizleniyor: misafir satırı canlı bir sepete bağlı olabilir ve
         * üye olduğunda sepeti yeni hesaba taşınıyor. `misafirDahil=true` ile görülebilir —
         * "sepette ürün var ama üye yok" durumunu incelemek gerekebilir.
         */
        var guestFilter = misafirDahil
            ? string.Empty
            : "AND m.email NOT LIKE '%@guest.stilsoft' ";

        await using var cmd = new NpgsqlCommand(
            "SELECT m.id, m.email, m.full_name, m.phone, m.customer_code, m.is_active, " +
            "       m.created_at, m.last_login_at, " +
            "       (SELECT count(*) FROM public.cart_items c WHERE c.member_id = m.id) AS cart_lines " +
            "FROM public.members m " +
            "WHERE (@q = '' OR m.email ILIKE '%' || @q || '%' OR m.full_name ILIKE '%' || @q || '%' " +
            "       OR coalesce(m.customer_code, '') ILIKE '%' || @q || '%') " +
            guestFilter +
            "ORDER BY m.created_at DESC " +
            "LIMIT 300", conn);

        cmd.Parameters.AddWithValue("q", search);

        var rows = new List<object>();
        await using (var reader = await cmd.ExecuteReaderAsync(ct))
        {
            while (await reader.ReadAsync(ct))
            {
                rows.Add(new
                {
                    id = reader.GetGuid(0),
                    email = reader.GetString(1),
                    fullName = reader.GetString(2),
                    phone = reader.IsDBNull(3) ? null : reader.GetString(3),
                    customerCode = reader.IsDBNull(4) ? null : reader.GetString(4),
                    isActive = reader.GetBoolean(5),
                    createdAt = reader.GetDateTime(6),
                    lastLoginAt = reader.IsDBNull(7) ? (DateTime?)null : reader.GetDateTime(7),
                    cartLines = reader.GetInt64(8)
                });
            }
        }

        // Gizlenen satır sayısı panele söyleniyor: liste kısaldığında "üyelerim nereye gitti"
        // sorusunun cevabı ekranda dursun.
        long guestCount = 0;
        await using (var guestCmd = new NpgsqlCommand(
            "SELECT count(*) FROM public.members WHERE email LIKE '%@guest.stilsoft'", conn))
        {
            guestCount = Convert.ToInt64(await guestCmd.ExecuteScalarAsync(ct) ?? 0L);
        }

        return Ok(new
        {
            success = true,
            data = rows,
            guestCount,
            guestsIncluded = misafirDahil
        });
    }

    // -----------------------------------------------------------------------------------------
    // ÜYE YÖNETİMİ
    //
    // Buradaki her işlem bir personelin BAŞKASININ hesabına dokunması. İki kural kodda tutuluyor:
    //  1. Şifre okunamaz — panel yalnızca YENİ şifre koyabilir.
    //  2. Hesaba müdahale eden işlem açık oturumları düşürür (MemberStore).
    // -----------------------------------------------------------------------------------------

    public sealed class CreateMemberRequest
    {
        [Required, EmailAddress, MaxLength(200)] public string Email { get; set; } = string.Empty;
        [Required, MinLength(8), MaxLength(128)] public string Password { get; set; } = string.Empty;
        [Required, MaxLength(150)] public string FullName { get; set; } = string.Empty;
        [Required, MaxLength(30)] public string Phone { get; set; } = string.Empty;
        [MaxLength(100)] public string? City { get; set; }
        [MaxLength(100)] public string? District { get; set; }
        [MaxLength(500)] public string? Address { get; set; }
    }

    /// <summary>
    /// Bayi adına üye açar. Sırası müşterinin kendi kaydıyla AYNI: önce ERP'de cari, sonra üye.
    ///
    /// Ters sırada çalışsaydı, cari açılamayan üyeler birikirdi ve bu üyeler sipariş veremezdi —
    /// panelden bakan kişi de sebebini göremezdi.
    /// </summary>
    [HttpPost("members")]
    [B2BAdminAuth]
    public async Task<IActionResult> CreateMember([FromBody] CreateMemberRequest request, CancellationToken ct)
    {
        if (!ModelState.IsValid) return ValidationProblem(ModelState);

        if (await _members.EmailExistsAsync(request.Email, ct))
        {
            return Conflict(new { message = "Bu e-posta adresiyle bir üye zaten var." });
        }

        var creation = await _erp.CreateEcommerceCustomerAsync(
            request.FullName, request.Email, request.Phone, request.City, request.District, request.Address, ct);

        if (!creation.Success)
        {
            return StatusCode(StatusCodes.Status502BadGateway, new
            {
                message = creation.Error ?? "ERP'de cari açılamadı; üye oluşturulmadı."
            });
        }

        var member = await _members.CreateAsync(
            request.Email, request.Password, request.FullName, request.Phone, creation.CustomerCode, ct);

        _logger.LogInformation("Panelden üye açıldı: {Email} → {CustomerCode} ({User})",
            member.Email, member.CustomerCode, CurrentUser);

        return Ok(new { success = true, id = member.Id, customerCode = member.CustomerCode });
    }

    public sealed class UpdateMemberRequest
    {
        [Required, EmailAddress, MaxLength(200)] public string Email { get; set; } = string.Empty;
        [Required, MaxLength(150)] public string FullName { get; set; } = string.Empty;
        [Required, MaxLength(30)] public string Phone { get; set; } = string.Empty;
        [MaxLength(100)] public string? City { get; set; }
        [MaxLength(100)] public string? District { get; set; }
        [MaxLength(500)] public string? Address { get; set; }
    }

    /// <summary>
    /// Üyenin iletişim bilgilerini günceller ve cariye yansıtır.
    ///
    /// CARİ KODU DEĞİŞTİRİLEMEZ: cari, siparişin ve faturanın sahibi; elle başka bir koda
    /// çevirmek geçmiş siparişleri başka bir cariye devretmek olurdu. ERP'ye giden alanlar da
    /// beyaz listeli (ad, telefon, adres) — vergi no, fiyat grubu, kredi limiti buradan geçmez.
    /// </summary>
    [HttpPut("members/{id:guid}")]
    [B2BAdminAuth]
    public async Task<IActionResult> UpdateMember(Guid id, [FromBody] UpdateMemberRequest request, CancellationToken ct)
    {
        if (!ModelState.IsValid) return ValidationProblem(ModelState);

        var member = await _members.FindByIdAsync(id, ct);
        if (member is null) return NotFound(new { message = "Üye bulunamadı." });

        if (await _members.EmailExistsForOtherAsync(request.Email, id, ct))
        {
            return Conflict(new { message = "Bu e-posta başka bir üyede kullanılıyor." });
        }

        await _members.UpdateByAdminAsync(id, request.FullName, request.Email, request.Phone, ct);

        if (!string.IsNullOrWhiteSpace(member.CustomerCode))
        {
            // E-posta ERP'ye GİTMİYOR: cari kartının beyaz listesinde yok (ad, telefon, adres).
            // Giriş kimliği mağazanın kendi verisi, carinin değil.
            var ok = await _erp.UpdateCustomerContactAsync(
                member.CustomerCode!, request.FullName, request.Phone,
                request.City, request.District, request.Address, ct);

            if (!ok)
            {
                // Üye tarafı güncellendi ama cari güncellenemedi. Sessiz geçilmiyor: fatura
                // adresinin eski kalması, müşterinin fark etmeyeceği ama sonucu olan bir hâl.
                return Ok(new
                {
                    success = true,
                    warning = "Üye güncellendi ancak ERP'deki cari kartına yansıtılamadı. ERP'ye ulaşılabildiğinde tekrar kaydedin."
                });
            }
        }

        return Ok(new { success = true });
    }

    public sealed class MemberStatusRequest
    {
        public bool IsActive { get; set; }
    }

    /// <summary>
    /// Üyeyi açar/kapatır. Kapatınca açık oturumları da düşer — aksi halde telefonunda açık
    /// kalan uygulamayla alışverişe devam edebilirdi.
    ///
    /// SİLME YOK, bilerek: üyenin carisi faturalarının sahibi; kaydı silmek muhasebe bağını
    /// koparırdı. Pasife alınan üye giriş yapamaz, siparişleri ve faturaları yerinde durur.
    /// </summary>
    [HttpPut("members/{id:guid}/status")]
    [B2BAdminAuth]
    public async Task<IActionResult> SetMemberStatus(Guid id, [FromBody] MemberStatusRequest request, CancellationToken ct)
    {
        var member = await _members.FindByIdAsync(id, ct);
        if (member is null) return NotFound(new { message = "Üye bulunamadı." });

        await _members.SetActiveAsync(id, request.IsActive, ct);
        _logger.LogInformation("Üye {Email} {Durum} ({User})", member.Email,
            request.IsActive ? "aktifleştirildi" : "pasife alındı", CurrentUser);

        return Ok(new { success = true });
    }

    public sealed class MemberPasswordRequest
    {
        [Required, MinLength(8), MaxLength(128)] public string NewPassword { get; set; } = string.Empty;
    }

    /// <summary>
    /// Üyeye yeni şifre belirler.
    ///
    /// E-posta doğrulaması kapalı olduğu için "sıfırlama bağlantısı" gönderilemiyor (§2 kararı);
    /// müşteri şifresini unuttuğunda tek yol bu. Şifre YAZILIR ama HİÇBİR YERDE OKUNMAZ: panel
    /// var olanı gösteremez, yalnızca yenisini koyar. Yeni şifre müşteriye bayi tarafından
    /// iletilir; işlemden sonra üyenin bütün oturumları düşer.
    /// </summary>
    [HttpPost("members/{id:guid}/password")]
    [B2BAdminAuth]
    public async Task<IActionResult> SetMemberPassword(Guid id, [FromBody] MemberPasswordRequest request, CancellationToken ct)
    {
        if (!ModelState.IsValid) return ValidationProblem(ModelState);

        var member = await _members.FindByIdAsync(id, ct);
        if (member is null) return NotFound(new { message = "Üye bulunamadı." });

        await _members.SetPasswordAsync(id, request.NewPassword, ct);
        _logger.LogInformation("Üye {Email} şifresi panelden değiştirildi ({User})", member.Email, CurrentUser);

        return Ok(new { success = true, message = "Yeni şifre belirlendi ve üyenin açık oturumları kapatıldı." });
    }

    /// <summary>
    /// Üyenin siparişleri ve faturaları — "bu müşteri ne aldı?" sorusunun tek yerdeki cevabı.
    ///
    /// Üye ekranından ERP'ye gidiliyor çünkü ikisi de ERP'nin verisi; mağazada kopyası yok.
    /// Carisi olmayan üye için boş dönüyor, hata değil: cari açılmamış olması üyenin hiç sipariş
    /// verememiş olması demek.
    /// </summary>
    [HttpGet("members/{id:guid}/activity")]
    [B2BAdminAuth]
    public async Task<IActionResult> MemberActivity(Guid id, CancellationToken ct)
    {
        var member = await _members.FindByIdAsync(id, ct);
        if (member is null) return NotFound(new { message = "Üye bulunamadı." });

        if (string.IsNullOrWhiteSpace(member.CustomerCode))
        {
            return Ok(new
            {
                success = true,
                data = new
                {
                    member = new { member.Id, member.Email, member.FullName, member.Phone, member.CustomerCode, member.IsActive },
                    orders = Array.Empty<object>(),
                    invoices = Array.Empty<object>(),
                    note = "Üyenin carisi açılmamış; sipariş veremez."
                }
            });
        }

        var code = Uri.EscapeDataString(member.CustomerCode!);
        var orders = await ReadErpDataAsync($"/api/ecommerce/orders/{code}", ct);
        var invoices = await ReadErpDataAsync($"/api/ecommerce/invoices/{code}", ct);

        return Ok(new
        {
            success = true,
            data = new
            {
                member = new { member.Id, member.Email, member.FullName, member.Phone, member.CustomerCode, member.IsActive },
                orders = orders ?? (object)Array.Empty<object>(),
                invoices = invoices ?? (object)Array.Empty<object>()
            }
        });
    }

    /// <summary>Üyenin açık oturumlarını düşürür — şifreyi değiştirmeden "her yerden çıkış".</summary>
    [HttpPost("members/{id:guid}/revoke-sessions")]
    [B2BAdminAuth]
    public async Task<IActionResult> RevokeSessions(Guid id, CancellationToken ct)
    {
        var member = await _members.FindByIdAsync(id, ct);
        if (member is null) return NotFound(new { message = "Üye bulunamadı." });

        var count = await _members.RevokeSessionsAsync(id, ct);
        return Ok(new { success = true, closed = count });
    }

    /// <summary>
    /// Mutabakat: POS ↔ sipariş ↔ fatura.
    ///
    /// ERP'nin bulguları alınır, üstüne mağazanın olay kaydı eklenir. İkincisi olmadan "müşteri
    /// ödedim diyor" tartışması havada kalıyor: ERP tarafında hiç kayıt yoksa, ödemenin
    /// başlatılıp başlatılmadığını söyleyebilecek tek yer mağazanın kendi olay kaydı.
    /// </summary>
    [HttpGet("reconciliation")]
    [B2BAdminAuth]
    public async Task<IActionResult> Reconciliation([FromQuery] int gun, CancellationToken ct)
    {
        var data = await ReadErpDataAsync($"/api/ecommerce/reconciliation?days={(gun <= 0 ? 30 : gun)}", ct);
        if (data is null) return StatusCode(StatusCodes.Status502BadGateway, new { message = "ERP'den mutabakat raporu alınamadı." });

        return Content(data.Value.GetRawText(), "application/json");
    }

    /// <summary>Tek bir siparişin mağaza tarafındaki olay dökümü.</summary>
    [HttpGet("orders/{orderNo}/events")]
    [B2BAdminAuth]
    public async Task<IActionResult> OrderEvents(string orderNo, CancellationToken ct)
    {
        var rows = await _events.ListForOrderAsync(orderNo, ct);
        return Ok(new { success = true, data = rows });
    }

    /// <summary>
    /// Siparişin tam dökümü: kalemler (ERP), mağaza olay kaydı ve teslimat durumu tek yerde.
    ///
    /// Üçü birden dönüyor çünkü paneldeki soru hep aynı: "bu siparişe ne oldu?" — cevabı üç ayrı
    /// sistemde duruyor ve personelin üç ekran gezmesi, aralarındaki çelişkiyi hiç görmemesi
    /// demek. Biri okunamazsa diğerleri yine dönüyor; eksik olan alan null kalıyor.
    /// </summary>
    [HttpGet("orders/{orderNo}/detail")]
    [B2BAdminAuth]
    public async Task<IActionResult> OrderDetail(string orderNo, CancellationToken ct)
    {
        var code = (orderNo ?? string.Empty).Trim();
        if (code.Length == 0) return BadRequest(new { message = "Sipariş numarası zorunlu." });

        var order = await ReadErpDataAsync($"/api/ecommerce/admin/orders/{Uri.EscapeDataString(code)}", ct);
        if (order is null) return NotFound(new { message = "Sipariş bulunamadı." });

        // Olay kaydı okunamasa da sipariş dönmeli: ikisi ayrı veritabanında ve biri yüzünden
        // diğerini gizlemek, "sipariş kayıp" gibi görünen bir hâl yaratırdı.
        IReadOnlyList<OrderEventRow> events;
        try
        {
            events = await _events.ListForOrderAsync(code, ct);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Olay kaydı okunamadı: {OrderNo}", code);
            events = Array.Empty<OrderEventRow>();
        }

        return Ok(new
        {
            success = true,
            data = new
            {
                order = order.Value,
                events
            }
        });
    }

    public sealed class CancelOrderRequest
    {
        [MaxLength(500)]
        public string? Reason { get; set; }
    }

    /// <summary>
    /// Siparişi iptal eder (bayi paneli).
    ///
    /// Kararı ERP veriyor: faturalanmış sipariş iptal edilemiyor, montaj kayıtları kapanıyor ve
    /// teslimat kaydı ServiceOps'tan düşüyor. Mağaza tarafında yapılan tek şey OLAY KAYDI —
    /// "bu siparişi kim, ne zaman, hangi gerekçeyle iptal etti" sorusunun cevabı başka hiçbir
    /// yerde kalmıyor.
    ///
    /// PARA İADESİ BURADAN YAPILMAZ: bayi bankadan iade edip cari ekstresine kendisi işliyor
    /// (2026-09-09 kullanıcı kararı).
    /// </summary>
    [HttpPost("orders/{orderNo}/cancel")]
    [B2BAdminAuth]
    public async Task<IActionResult> CancelOrder(
        string orderNo, [FromBody] CancelOrderRequest? request, CancellationToken ct)
    {
        var code = (orderNo ?? string.Empty).Trim();
        if (code.Length == 0) return BadRequest(new { message = "Sipariş numarası zorunlu." });

        var response = await _erp.PostAsync(
            $"/api/ecommerce/admin/orders/{Uri.EscapeDataString(code)}/cancel",
            new { reason = request?.Reason },
            ct);

        if (response is null)
        {
            return StatusCode(StatusCodes.Status502BadGateway, new { message = "ERP'ye ulaşılamadı." });
        }

        using (response)
        {
            var body = await response.Content.ReadAsStringAsync(ct);

            if (!response.IsSuccessStatusCode)
            {
                // ERP'nin açıklaması kullanıcıya gösterilebilir ("faturası kesilmiş" gibi);
                // genel bir hata metni bayiye ne yapacağını söylemezdi.
                string? reason = null;
                try
                {
                    using var problem = JsonDocument.Parse(body);
                    if (problem.RootElement.TryGetProperty("message", out var m)) reason = m.GetString();
                }
                catch
                {
                }

                return StatusCode((int)response.StatusCode, new { message = reason ?? "Sipariş iptal edilemedi." });
            }

            try
            {
                await _events.WriteAsync(
                    OrderEventLog.OrderCancelled,
                    null,
                    code,
                    $"{CurrentUser} iptal etti. {(request?.Reason ?? string.Empty).Trim()}".Trim(),
                    ct);
            }
            catch (Exception ex)
            {
                // İptal ERP'de gerçekleşti; olay kaydı yazılamadı diye hata döndürmek,
                // bayiyi aynı işlemi tekrar denemeye iterdi.
                _logger.LogWarning(ex, "İptal olay kaydı yazılamadı: {OrderNo}", code);
            }

            return Content(body, "application/json");
        }
    }

    private async Task<JsonElement?> ReadErpDataAsync(string path, CancellationToken ct)
    {
        var response = await _erp.GetAsync(path, ct);
        if (response is null) return null;

        using (response)
        {
            if (!response.IsSuccessStatusCode)
            {
                _logger.LogWarning("ERP {Path} → {Status}", path, response.StatusCode);
                return null;
            }

            try
            {
                using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync(ct));
                return doc.RootElement.TryGetProperty("data", out var data) ? data.Clone() : null;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "ERP yanıtı çözümlenemedi: {Path}", path);
                return null;
            }
        }
    }
}
