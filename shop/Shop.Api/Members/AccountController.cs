using System.ComponentModel.DataAnnotations;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Shop.Api.Infrastructure;
using Shop.Api.Erp;
using Shop.Api.Cart;

namespace Shop.Api.Members;

/// <summary>
/// Üyelik: kayıt, giriş, oturum, profil.
///
/// Kayıt iki yerde iz bırakır: mağazada üye hesabı (e-posta + şifre), ERP'de <c>120-11-</c> ön ekli
/// cari. İkisi <c>customer_code</c> ile bağlanır. Cari, siparişin ve faturanın sahibi olacağı için
/// asıl kimlik odur; mağazadaki kayıt yalnızca müşterinin siteye girebilmesini sağlar.
/// </summary>
[ApiController]
[Route("api/account")]
public sealed class AccountController : ControllerBase
{
    private readonly MemberStore _members;
    private readonly ErpWriteClient _erp;
    private readonly ShopEmailService _emailService;
    private readonly SmsVerificationStore _smsVerification;
    private readonly ClientAddress _clientAddress;
    private readonly CartService _cart;
    private readonly Storefront.StorefrontStore _storefront;
    private readonly IConfiguration _configuration;
    private readonly ILogger<AccountController> _logger;

    public const string SessionHeader = "X-Shop-Session";
    private const string GuestEmailSuffix = "@guest.stilsoft";

    public AccountController(
        MemberStore members,
        ErpWriteClient erp,
        ShopEmailService emailService,
        SmsVerificationStore smsVerification,
        ClientAddress clientAddress,
        CartService cart,
        Storefront.StorefrontStore storefront,
        IConfiguration configuration,
        ILogger<AccountController> logger)
    {
        _members = members;
        _erp = erp;
        _emailService = emailService;
        _smsVerification = smsVerification;
        _clientAddress = clientAddress;
        _cart = cart;
        _storefront = storefront;
        _configuration = configuration;
        _logger = logger;
    }

    /// <summary>
    /// Kayıt/giriş anında istekte hâlâ bir MİSAFİR oturumu varsa o üyenin kimliğini döner.
    ///
    /// Yalnızca misafir (<c>@guest.stilsoft</c>) üyeler döner — gerçek bir üyenin oturumu bu
    /// yoldan asla dönmez: aksi hâlde A üyesi olarak giriş açıkken B için yeni kayıt açan biri
    /// A'nın sepetini B'ye taşımış olurdu, iki farklı müşterinin sepeti karışırdı.
    /// </summary>
    /// <summary>
    /// Cari açılamadığında verilecek yanıt. Eskiden her sebep "Kayıt şu anda tamamlanamıyor"
    /// (503) idi; canlıda telefonu zaten bir caride kayıtlı kişi de bunu görüyor, "birazdan"
    /// tekrar deneyip yine aynı duvara çarpıyordu. Telefon çakışması artık 409 + açık mesaj.
    /// </summary>
    /// <summary>
    /// TELEFON ZATEN BİR E-TİCARET CARİSİNDE (2026-09-21).
    ///
    /// Numara SMS ile az önce doğrulandı; sahibi bu kişi. Cari 120-11- (e-ticaret) ise ve o
    /// koda bağlı AKTİF bir üye yoksa ikinci bir cari açmak yerine üyelik o cariye bağlanır
    /// (eski e-ticaretten gelen ya da üyeliği silinmiş müşteri böyle geri döner). Bayi
    /// carisindeki numara buraya hiç düşmez: ERP tekilliği yalnız e-ticaret carileri arasında
    /// arıyor (kullanıcı kararı) — bayi de e-ticarette ayrı üyelik açar. Tip yine de kontrol
    /// ediliyor: eski ERP'den / beklenmedik tipten gelirse bağlanmaz, null döner (açık mesaj).
    ///
    /// Bağlanınca carinin iletişim bilgisi de ŞİMDİ yazılan ad/adresle güncellenir: sipariş
    /// teslimat adresini carideki adresten okuyor (`preparePendingOrder`); güncellenmese
    /// müşteri az önce yazdığı adrese değil, carideki eski adrese gönderilirdi.
    /// </summary>
    private async Task<string?> BaglanacakEticaretCarisiAsync(
        ErpWriteClient.CustomerCreation creation,
        string fullName,
        string? phone,
        string? city,
        string? district,
        string? address,
        CancellationToken ct)
    {
        if (!creation.PhoneConflict) return null;
        if (string.IsNullOrWhiteSpace(creation.ExistingCustomerCode)) return null;
        if (!string.Equals(creation.ExistingCustomerType?.Trim(), "eticaret", StringComparison.OrdinalIgnoreCase)) return null;

        var code = creation.ExistingCustomerCode.Trim();
        if (await _members.FindByCustomerCodeAsync(code, ct) is not null) return null;

        _logger.LogInformation("Üyelik mevcut e-ticaret carisine bağlandı: {Code}", code);

        if (!string.IsNullOrWhiteSpace(address) || !string.IsNullOrWhiteSpace(city))
        {
            try
            {
                await _erp.UpdateCustomerContactAsync(code, fullName.Trim(), phone, city, district, address, ct);
            }
            catch (Exception ex)
            {
                // Adres güncellenemedi diye üyelik düşmez; ödeme adımında adres yeniden sorulur.
                _logger.LogWarning(ex, "Bağlanan carinin iletişim bilgisi güncellenemedi: {Code}", code);
            }
        }

        return code;
    }

    /// <summary>Ad soyad: kenar boşlukları atılır, içerideki ardışık boşluklar teke iner (ERP tarafı zaten böyle saklıyor).</summary>
    private static string AdTemizle(string? ad) =>
        System.Text.RegularExpressions.Regex.Replace((ad ?? string.Empty).Trim(), @"\s+", " ");

    private IActionResult CariAcilamadi(ErpWriteClient.CustomerCreation creation, string baglam)
    {
        if (creation.PhoneConflict)
        {
            _logger.LogWarning(
                "{Baglam} reddedildi: telefon ERP'de kayıtlı bir cariye ait ({Code}, {Type}).",
                baglam, creation.ExistingCustomerCode ?? "?", creation.ExistingCustomerType ?? "?");
            // Kullanıcı isteği (2026-09-21): "kayıtlı numaranız var, şifrenizi alın ya da sıfırlayın" denmeli.
            return Conflict(new
            {
                message = "Bu telefon numarasıyla kayıtlı bir hesabınız zaten var. E-posta ve şifrenizle giriş yapın; şifrenizi bilmiyorsanız \"Şifremi unuttum\" ile yeni şifre oluşturun.",
                phoneConflict = true,
                accountExists = true
            });
        }

        _logger.LogError("{Baglam} başarısız (cari açılamadı): {Error}", baglam, creation.Error);
        return StatusCode(StatusCodes.Status503ServiceUnavailable, new
        {
            message = "Kayıt şu anda tamamlanamıyor. Lütfen birazdan tekrar deneyin."
        });
    }

    private async Task<Guid?> CurrentGuestMemberIdAsync(CancellationToken ct)
    {
        var token = Request.Headers[SessionHeader].ToString();
        if (string.IsNullOrWhiteSpace(token)) return null;

        var existing = await _members.FindBySessionAsync(token, ct);
        if (existing is null) return null;
        return existing.Email.EndsWith(GuestEmailSuffix, StringComparison.OrdinalIgnoreCase) ? existing.Id : null;
    }

    public sealed class RegisterRequest
    {
        /// <summary>
        /// İSTEĞE BAĞLI (2026-10-05 kullanıcı isteği: "koda gerek yok, direkt üye olabilelim").
        /// Boşsa hesap telefon + şifreyle açılır, e-posta yerine iç adres yazılır.
        /// </summary>
        [MaxLength(200)]
        public string? Email { get; set; }

        [Required, MinLength(8), MaxLength(128)]
        public string Password { get; set; } = string.Empty;

        [Required, MaxLength(150)]
        public string FullName { get; set; } = string.Empty;

        [Required, MaxLength(30)]
        public string Phone { get; set; } = string.Empty;

        [MaxLength(100)] public string? City { get; set; }
        [MaxLength(100)] public string? District { get; set; }
        [MaxLength(500)] public string? Address { get; set; }

        /// <summary>
        /// <c>phone/verify</c>'dan alınan tek kullanımlık bilet. SMS doğrulaması AÇIKKEN
        /// zorunlu, kapalıyken hiç bakılmaz.
        /// </summary>
        [MaxLength(200)] public string? PhoneVerificationTicket { get; set; }
    }

    public sealed class LoginRequest
    {
        /// <summary>
        /// E-posta YA DA telefon (2026-10-05). Alan adı geriye uyum için "email" kaldı; '@'
        /// içermiyorsa telefon sayılır.
        /// </summary>
        [Required, MaxLength(200)] public string Email { get; set; } = string.Empty;
        [Required] public string Password { get; set; } = string.Empty;
    }

    public sealed class ProfileRequest
    {
        [Required, MaxLength(150)] public string FullName { get; set; } = string.Empty;
        [Required, MaxLength(30)] public string Phone { get; set; } = string.Empty;
        [MaxLength(100)] public string? City { get; set; }
        [MaxLength(100)] public string? District { get; set; }
        [MaxLength(500)] public string? Address { get; set; }
        /// <summary>Kampanya SMS'i istemiyor (null = değişmesin).</summary>
        public bool? SmsOptOut { get; set; }
    }

    [HttpPost("register")]
    [EnableRateLimiting(RateLimitPolicies.Auth)]
    public async Task<IActionResult> Register([FromBody] RegisterRequest request, CancellationToken ct)
    {
        if (!ModelState.IsValid) return ValidationProblem(ModelState);

        var email = (request.Email ?? string.Empty).Trim();
        if (email.Length > 0)
        {
            if (!new EmailAddressAttribute().IsValid(email) || !email.Contains('.'))
            {
                return BadRequest(new { message = "E-posta adresi geçersiz. Boş bırakabilir ya da doğru yazabilirsiniz." });
            }
            if (await _members.EmailExistsAsync(email, ct))
            {
                return Conflict(new { message = "Bu e-posta adresiyle bir hesap zaten var. Giriş yapmayı deneyin." });
            }
        }
        else
        {
            // E-postasız üyelik: giriş telefon + şifreyle. Yer tutucu tireli ve benzersiz.
            var rakamlar = new string(request.Phone.Where(char.IsDigit).ToArray());
            email = $"{rakamlar}-{Guid.NewGuid():N}"[..40] + "@telefon.stilsoft";
        }

        /*
          TELEFON DOĞRULAMASI HESAP AÇILMADAN ÖNCE.

          Sıra bilinçli: doğrulama sonraya bırakılsaydı sistemde doğrulanmamış hesaplar
          birikirdi ve biri başkasının numarasıyla kayıt olabilirdi. Bilet burada HARCANIYOR
          (tek kullanımlık) — aynı bilet ikinci bir hesap açmak için kullanılamaz.

          SMS kapalıyken (kredentials yok) adım tamamen atlanıyor: özellik açılana kadar
          kayıt bugünkü gibi çalışmaya devam etmeli.
        */
        /*
          SMS GİDEMEYEN NUMARA E-POSTAYLA ÜYE OLUR (2026-09-27, kullanıcı kararı: "sms yoksa e-posta
          olsun, önceki düzen"). SMS yalnız KKTC/Türkiye cep hattına gidiyor; yabancı numaralı müşteri
          (KKTC'de yaşayan yabancılar — Talep Raporu'ndaki İngilizce aramalar) hiçbir yoldan üye
          olamıyor, sipariş veremiyordu. Böyle numarada doğrulama İSTENMEZ; hesabın kimliği e-posta
          ve şifredir. SMS'e uygun numarada kural AYNEN sürer. Doğrulanmamış numara mevcut bir
          cariye bağlanmaz (aşağıda `BaglanacakEticaretCarisiAsync` yalnız SMS ile doğrulanmış
          numarada çalışır).
        */
        var smsyeUygun = _smsVerification.Normalize(request.Phone).Length > 0;
        if (!smsyeUygun)
        {
            var rakam = request.Phone.Count(char.IsDigit);
            if (rakam < 8 || rakam > 15)
            {
                return BadRequest(new { message = "Geçerli bir telefon numarası girin. / Please enter a valid phone number." });
            }
        }

        /*
          TELEFON KODU ARTIK ZORUNLU DEĞİL (2026-09-27 kullanıcı kararı: "telefona kod gelmiyor,
          adamlar ondan kaçıyor, zorunlu tutulmasın"). SMS bazı numaralara ulaşmıyor ve müşteri
          üyelik adımında vazgeçiyordu. Hesabın kimliği e-posta + şifre; SMS doğrulaması İSTEĞE
          BAĞLI. Doğrulanan numara (bilet geçerli VE formdaki numarayla aynı) mevcut e-ticaret
          carisine bağlanabilir ve "doğrulanmış" işaretlenir; doğrulanmamış numara hiçbir mevcut
          cariye BAĞLANMAZ (başkasının numarasıyla onun cari geçmişine erişilmesin).
        */
        var phoneVerified = false;
        if (_smsVerification.IsEnabled && smsyeUygun && !string.IsNullOrWhiteSpace(request.PhoneVerificationTicket))
        {
            var verified = await _smsVerification.ConsumeTicketAsync(
                request.PhoneVerificationTicket, SmsPurpose.Register, ct);

            // Doğrulanan numara ile forma yazılan numara AYNI olmalı: aksi hâlde kendi
            // numarasını doğrulayıp başkasının numarasıyla hesap açmak mümkün olurdu.
            phoneVerified = verified is not null
                && string.Equals(verified.Value.Phone, _smsVerification.Normalize(request.Phone), StringComparison.Ordinal);
        }

        // İstekteki oturum bir misafir sepetiyse kimliği burada yakalanır — cari/üye
        // oluşturulduktan sonra yeni oturum başlayınca eski token artık okunamaz.
        var guestMemberId = await CurrentGuestMemberIdAsync(ct);

        // Önce cari açılır: ERP kabul etmezse ortada yarım bir üye kalmasın. Ters sırada
        // çalışsaydı, cari açılamayan üyeler zamanla birikir ve sipariş veremezdi.
        var fullName = AdTemizle(request.FullName);
        var creation = await _erp.CreateEcommerceCustomerAsync(
            fullName, email, request.Phone, request.City, request.District, request.Address, ct);

        var customerCode = creation.CustomerCode;
        if (!creation.Success)
        {
            // Numara SMS ile doğrulandıysa telefonla girişteki kural burada da geçerli.
            customerCode = phoneVerified
                ? await BaglanacakEticaretCarisiAsync(creation, fullName, request.Phone, request.City, request.District, request.Address, ct)
                : null;

            /*
              KOD YOKSA ÜYELİK DURMAZ (2026-10-05 kullanıcı isteği: "kod gönder kısmını kaldır, koda
              gerek yok, direkt üye olabilelim"). Eskiden numara bir e-ticaret carisindeyse "kodu
              girin" diye üyelik kesiliyordu; SMS sağlayıcısı kod ulaştıramadığı için müşteri hiç
              üye olamıyordu. Artık doğrulanmamış numarada YENİ cari açılıyor.

              Mevcut cariye BAĞLANMIYOR: numarayı yazan herkes o carinin siparişlerini, faturalarını
              ve adresini görürdü. Aynı kişinin carileri panelden birleştirilebilir; yeni SMS
              sağlayıcısı gelince doğrulanan numara yine mevcut cariye bağlanacak.
            */
            if (customerCode is null && !phoneVerified && creation.PhoneConflict)
            {
                var ayri = await _erp.CreateEcommerceCustomerAsync(
                    fullName, email, request.Phone, request.City, request.District, request.Address, ct,
                    allowDuplicatePhone: true);
                if (ayri.Success) customerCode = ayri.CustomerCode;
                else creation = ayri;
            }

            if (customerCode is null)
            {
                return CariAcilamadi(creation, "Üyelik");
            }
        }

        var member = await _members.CreateAsync(
            email, request.Password, fullName, request.Phone, customerCode, ct);

        if (phoneVerified) await _members.MarkPhoneVerifiedAsync(member.Id, ct);

        var token = await _members.StartSessionAsync(member.Id, Request.Headers.UserAgent.ToString(), ct);

        // Misafirken sepete eklenen ürünler yeni üyeye taşınır — üye olma anı satın almaya en
        // yakın an olduğu için sepetin sıfırlanması burada en çok satışı kaybettiren yerdi
        // (2026-09-05 denetiminde bulundu).
        if (guestMemberId.HasValue) await _cart.TransferAsync(guestMemberId.Value, member.Id, ct);

        return Ok(new
        {
            session = token,
            member = new { member.Email, member.FullName, member.Phone, member.CustomerCode }
        });
    }

    [HttpPost("login")]
    [EnableRateLimiting(RateLimitPolicies.Auth)]
    public async Task<IActionResult> Login([FromBody] LoginRequest request, CancellationToken ct)
    {
        if (!ModelState.IsValid) return ValidationProblem(ModelState);

        // Şifre doğrulanmadan önce okunuyor: sonucu (başarılı/başarısız) etkilemeyen bir
        // başlık okuması, "bu e-posta kayıtlı mı" yanıt-süresi sızıntısına yol açmaz.
        var guestMemberId = await CurrentGuestMemberIdAsync(ct);

        const string SahteHash = "pbkdf2-sha256$210000$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
        var kimlik = request.Email.Trim();
        Member? member = null;

        if (kimlik.Contains('@'))
        {
            var found = await _members.FindForLoginAsync(kimlik, ct);

            // Kullanıcı yoksa da şifre doğrulaması yapılır: aksi halde yanıt süresi
            // "bu e-posta kayıtlı mı" sorusunu ele verir.
            var ok = PasswordHasher.Verify(request.Password, found?.PasswordHash ?? SahteHash);
            if (found is not null && ok && found.Value.Member.IsActive) member = found.Value.Member;
        }
        else
        {
            /*
              TELEFON + ŞİFRE (2026-10-05 kullanıcı isteği: "girişlerde kod zorunlu olmasın, direkt
              şifre — telefon veya mail şifre kombinasyonları ile giriş yapılabilsin"). SMS
              sağlayıcısı kod ulaştıramıyordu; telefonla üye olanlar giremiyordu.
              Numaradaki her aday denenir, şifresi tutan girer.
            */
            var adaylar = await _members.FindForLoginByPhoneAsync(kimlik, ct);
            if (adaylar.Count == 0)
            {
                PasswordHasher.Verify(request.Password, SahteHash);
            }
            foreach (var (aday, hash) in adaylar)
            {
                if (PasswordHasher.Verify(request.Password, hash))
                {
                    member = aday;
                    break;
                }
            }
        }

        if (member is null)
        {
            return Unauthorized(new { message = "Telefon / e-posta ya da şifre hatalı. Şifrenizi bilmiyorsanız \"Şifremi unuttum\" ile yenileyin ya da bizi arayın." });
        }
        var token = await _members.StartSessionAsync(member.Id, Request.Headers.UserAgent.ToString(), ct);

        // Misafirken sepete eklenen ürünler, girilen mevcut hesaba taşınır (bkz. Register'daki
        // aynı gerekçe).
        if (guestMemberId.HasValue) await _cart.TransferAsync(guestMemberId.Value, member.Id, ct);

        return Ok(new
        {
            session = token,
            member = new { member.Email, member.FullName, member.Phone, member.CustomerCode }
        });
    }

    public sealed class PhoneLoginRequest
    {
        [Required, MaxLength(30)] public string Phone { get; set; } = string.Empty;
        [Required, MaxLength(200)] public string Ticket { get; set; } = string.Empty;
        /// <summary>Numara kayıtlı değilse üyelik için gerekli.</summary>
        [MaxLength(150)] public string? FullName { get; set; }
        [MaxLength(100)] public string? City { get; set; }
        [MaxLength(100)] public string? District { get; set; }
        [MaxLength(500)] public string? Address { get; set; }
    }

    /*
      ŞİFRESİZ TELEFON GİRİŞİ (2026-09-20).

      Akış: telefon → kod (phone/send-code, purpose=login) → kod doğrulandı, bilet alındı →
      bu uç. Numara kayıtlıysa oturum açılır. Kayıtlı değilse ve ad gelmemişse
      `needsProfile` döner (ekran adı/adresi sorar), ad gelmişse üyelik o anda açılır:
      e-posta ve şifre SORULMAZ — e-posta yerine numaradan türetilen yer tutucu adres,
      şifre rastgele. Sonradan "şifre belirle" derse mevcut SMS sıfırlama yolu çalışır.

      Bilet burada harcanmıyor; `needsProfile` cevabından sonra ekran adı alıp aynı biletle
      bir kez daha gelecek. Bilet 15 dakikalık ve tek numaraya bağlı; harcama üyelik/oturum
      açıldığı anda yapılır ki yarım kalan denemede bilet boşa gitmesin.
    */
    public sealed class GuestCheckoutRequest
    {
        [Required, MaxLength(30)] public string Phone { get; set; } = string.Empty;
        [Required, MaxLength(150)] public string FullName { get; set; } = string.Empty;
        [MaxLength(100)] public string? City { get; set; }
        [MaxLength(100)] public string? District { get; set; }
        [MaxLength(500)] public string? Address { get; set; }
    }

    /*
      SMS'SİZ ÜYESİZ SİPARİŞ (2026-09-20) — BAYİ AÇARSA.

      NEDEN VAR: üyeliksiz sipariş SMS servisine bağlı. PostaGüvercini bilgileri girilmemişse
      müşteri ödeme adımında "e-posta + şifre" duvarına çarpıyor — kaldırmak için uğraştığımız
      duvarın ta kendisi. Bu uç o durumda numarayı DOĞRULAMADAN üyelik açıp siparişi sürdürüyor.

      ÜÇ KAPI birden açık olmadan çalışmaz:
        1. bayi panelden `AllowGuestCheckoutWithoutSms` ayarını açmış olacak,
        2. SMS servisi GERÇEKTEN kapalı olacak (açıksa doğrulamalı akış kullanılmalı —
           doğrulamayı atlatmak için bu uca düşmek mümkün olmamalı),
        3. numara başka bir üyeye ait olmayacak.

      (3) kritik: doğrulama olmadığı için, kayıtlı bir numarayı yazan kişi o üyenin hesabına
      girebilirdi. Kayıtlı numarada bu uç REDDEDİYOR ve müşteriyi normal girişe yolluyor.
    */
    [HttpPost("guest-checkout")]
    [EnableRateLimiting(RateLimitPolicies.Auth)]
    public async Task<IActionResult> GuestCheckout([FromBody] GuestCheckoutRequest request, CancellationToken ct)
    {
        if (!ModelState.IsValid) return ValidationProblem(ModelState);

        /*
          ÜYE OLMADAN SİPARİŞ HER ZAMAN AÇIK (2026-10-04 kullanıcı kararı: "üye olmadan devam etsin,
          ödeme ekranında isim soyisim telefon adres almış oluruz").

          Eskiden bu yol yalnız SMS servisi KAPALIYKEN ve panel ayarı açıkken çalışıyordu; canlıda
          SMS açık olduğu için üyesiz müşterinin tek yolu SMS koduydu — kod gelmeyen müşteri
          ödemeden dönüyordu. Panel ayarı ve SMS kapısı kaldırıldı; sipariş peşin (kart/havale)
          olduğu için numaranın doğrulanmaması tahsilatı riske atmıyor.

          KAYITLI NUMARADA DA DOĞRUDAN SİPARİŞ (2026-10-05 kullanıcı kararı: "sizi tanıyoruz
          gelmesin, üye olmadan devam etme kısmında direkt sipariş oluşturulsun, gerekirse başka
          cari açılsın"). Önceki gün burada SMS kodu isteniyordu; müşteri kodu beklerken kaçıyordu.

          GÜVENLİK AYNI KALIYOR: numara kayıtlı olsa bile o hesaba ve o cariye BAĞLANMIYOR. Her
          üyesiz siparişte YENİ bir üye kaydı ve gerekirse YENİ bir 120-11- carisi açılıyor
          (ERP'ye allowDuplicatePhone). Numarayı yazan kişi başkasının siparişlerini, faturalarını
          ya da adresini göremez; yalnız kendi siparişini verir. Aynı kişinin cariler ileride
          panelden birleştirilebilir.
        */
        var fullName = AdTemizle(request.FullName);
        var digits = new string(request.Phone.Where(char.IsDigit).ToArray());
        var placeholderEmail = $"{digits}@telefon.stilsoft";

        // Numara zaten bir üyede ya da e-posta alınmışsa bu kayıt "ikinci" kayıttır: e-postası
        // tireli olur. Telefonla giriş ve sipariş takibi tireli kayıtları en sona koyuyor
        // (MemberStore.FindActiveByPhoneAsync) — gerçek hesabın sahibi SMS ile girdiğinde kendi
        // hesabına düşer.
        var phoneTaken = await _members.FindActiveByPhoneAsync(request.Phone, ct) is not null;
        if (phoneTaken || await _members.EmailExistsAsync(placeholderEmail, ct))
        {
            placeholderEmail = $"{digits}-{Guid.NewGuid():N}"[..40] + "@telefon.stilsoft";
        }

        var creation = await _erp.CreateEcommerceCustomerAsync(
            fullName, placeholderEmail, request.Phone, request.City, request.District, request.Address, ct,
            allowDuplicatePhone: true);
        if (!creation.Success)
        {
            return CariAcilamadi(creation, "Üyesiz sipariş");
        }

        var guestMemberId = await CurrentGuestMemberIdAsync(ct);
        var member = await _members.CreateAsync(
            placeholderEmail, Guid.NewGuid().ToString("N"), fullName, request.Phone, creation.CustomerCode, ct);

        // MarkPhoneVerified ÇAĞRILMIYOR: numara doğrulanmadı ve kayıt öyle görünmemeli.

        if (!string.IsNullOrWhiteSpace(request.Address) || !string.IsNullOrWhiteSpace(request.City))
        {
            try
            {
                await _members.CreateAddressAsync(
                    member.Id, "Ev", fullName, request.Phone, request.City, request.District, request.Address ?? string.Empty, true, ct);
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "SMS'siz misafir siparişinde adres kaydedilemedi: {MemberId}", member.Id);
            }
        }

        var token = await _members.StartSessionAsync(member.Id, Request.Headers.UserAgent.ToString(), ct);
        if (guestMemberId.HasValue) await _cart.TransferAsync(guestMemberId.Value, member.Id, ct);

        return Ok(new
        {
            session = token,
            isNew = true,
            member = new { member.Email, member.FullName, member.Phone, member.CustomerCode }
        });
    }

    [HttpPost("phone-login")]
    [EnableRateLimiting(RateLimitPolicies.Auth)]
    public async Task<IActionResult> PhoneLogin([FromBody] PhoneLoginRequest request, CancellationToken ct)
    {
        if (!ModelState.IsValid) return ValidationProblem(ModelState);
        if (!_smsVerification.IsEnabled)
        {
            return BadRequest(new { message = "Telefonla giriş şu anda kullanılamıyor." });
        }

        var phone = _smsVerification.Normalize(request.Phone);
        var existing = await _members.FindActiveByPhoneAsync(request.Phone, ct);

        if (existing is null && string.IsNullOrWhiteSpace(request.FullName))
        {
            // Bilet daha harcanmadı; ekran ad/adres isteyip aynı biletle dönecek.
            var peek = await _smsVerification.PeekTicketAsync(request.Ticket, SmsPurpose.Login, ct);
            if (peek is null || !string.Equals(peek.Value.Phone, phone, StringComparison.Ordinal))
            {
                return BadRequest(new { message = "Doğrulama süresi doldu. Kodu yeniden isteyin.", phoneVerificationRequired = true });
            }
            return Ok(new { needsProfile = true });
        }

        var verified = await _smsVerification.ConsumeTicketAsync(request.Ticket, SmsPurpose.Login, ct);
        if (verified is null || !string.Equals(verified.Value.Phone, phone, StringComparison.Ordinal))
        {
            return BadRequest(new { message = "Doğrulama süresi doldu. Kodu yeniden isteyin.", phoneVerificationRequired = true });
        }

        var guestMemberId = await CurrentGuestMemberIdAsync(ct);
        Member member;
        var isNew = false;

        if (existing is not null)
        {
            member = existing;
            // Numara az önce doğrulandı: e-postayla açılıp hiç doğrulanmamış eski üyelik de artık doğrulanmış sayılır (idempotent).
            await _members.MarkPhoneVerifiedAsync(existing.Id, ct);

            /*
              CARİSİ OLMAYAN ÜYE (ERP o an erişilemezken açılmış eski kayıt): ödeme adımında
              "Hesabınız henüz tamamlanmamış" duvarına çarpıyordu. Giriş anı en iyi fırsat —
              cari şimdi açılır ya da numaranın e-ticaret carisine bağlanır. Olmazsa giriş yine
              yapılır; eski davranış (ödemede uyarı) korunur.
            */
            if (string.IsNullOrWhiteSpace(existing.CustomerCode))
            {
                var onarim = await _erp.CreateEcommerceCustomerAsync(existing.FullName, existing.Email, request.Phone, null, null, null, ct);
                var kod = onarim.Success
                    ? onarim.CustomerCode
                    : await BaglanacakEticaretCarisiAsync(onarim, existing.FullName, request.Phone, null, null, null, ct);
                if (!string.IsNullOrWhiteSpace(kod))
                {
                    await _members.SetCustomerCodeAsync(existing.Id, kod, ct);
                    member = new Member { Id = existing.Id, Email = existing.Email, FullName = existing.FullName, Phone = existing.Phone, CustomerCode = kod, IsActive = existing.IsActive, SmsOptOut = existing.SmsOptOut };
                    _logger.LogInformation("Carisi olmayan üyeye giriş anında cari bağlandı: {MemberId} -> {Code}", existing.Id, kod);
                }
                else
                {
                    _logger.LogWarning("Carisi olmayan üyeye cari açılamadı: {MemberId} ({Error})", existing.Id, onarim.Error);
                }
            }
        }
        else
        {
            var fullName = AdTemizle(request.FullName!);
            var digits = new string(phone.Where(char.IsDigit).ToArray());
            var placeholderEmail = $"{digits}@telefon.stilsoft";

            var creation = await _erp.CreateEcommerceCustomerAsync(
                fullName, placeholderEmail, request.Phone, request.City, request.District, request.Address, ct);
            var customerCode = creation.CustomerCode;
            if (!creation.Success)
            {
                customerCode = await BaglanacakEticaretCarisiAsync(
                    creation, fullName, request.Phone, request.City, request.District, request.Address, ct);
                if (customerCode is null)
                {
                    return CariAcilamadi(creation, "Telefonla üyelik");
                }
            }

            if (await _members.EmailExistsAsync(placeholderEmail, ct))
            {
                placeholderEmail = $"{digits}-{Guid.NewGuid():N}"[..40] + "@telefon.stilsoft";
            }

            member = await _members.CreateAsync(placeholderEmail, Guid.NewGuid().ToString("N"), fullName, request.Phone, customerCode, ct);
            await _members.MarkPhoneVerifiedAsync(member.Id, ct);
            isNew = true;

            if (!string.IsNullOrWhiteSpace(request.Address) || !string.IsNullOrWhiteSpace(request.City))
            {
                try
                {
                    await _members.CreateAddressAsync(
                        member.Id, "Ev", fullName, request.Phone, request.City, request.District, request.Address ?? string.Empty, true, ct);
                }
                catch (Exception ex)
                {
                    // Adres kaydı üyeliği düşürmez; ödeme adımında yeniden sorulur.
                    _logger.LogWarning(ex, "Telefonla üyelikte adres kaydedilemedi: {MemberId}", member.Id);
                }
            }
        }

        var token = await _members.StartSessionAsync(member.Id, Request.Headers.UserAgent.ToString(), ct);
        if (guestMemberId.HasValue) await _cart.TransferAsync(guestMemberId.Value, member.Id, ct);

        return Ok(new
        {
            session = token,
            isNew,
            member = new { member.Email, member.FullName, member.Phone, member.CustomerCode }
        });
    }

    [HttpPost("logout")]
    public async Task<IActionResult> Logout(CancellationToken ct)
    {
        var token = Request.Headers[SessionHeader].ToString();
        if (!string.IsNullOrWhiteSpace(token)) await _members.EndSessionAsync(token, ct);
        return Ok(new { success = true });
    }

    [HttpGet("me")]
    public async Task<IActionResult> Me(CancellationToken ct)
    {
        var member = await CurrentMemberAsync(ct);
        if (member is null) return Unauthorized(new { message = "Oturum bulunamadı." });

        return Ok(new { member.Email, member.FullName, member.Phone, member.CustomerCode });
    }

    [HttpPost("guest-session")]
    public async Task<IActionResult> GuestSession(CancellationToken ct)
    {
        var guestId = Guid.NewGuid();
        var email = $"guest_{guestId:N}@guest.stilsoft";
        var member = await _members.CreateAsync(email, Guid.NewGuid().ToString("N"), "Misafir Kullanıcı", null, null, ct);
        var token = await _members.StartSessionAsync(member.Id, Request.Headers.UserAgent.ToString(), ct);

        return Ok(new
        {
            session = token,
            member = new { member.Email, member.FullName, member.Phone, member.CustomerCode }
        });
    }

    public sealed class ChangePasswordRequest
    {
        [Required] public string CurrentPassword { get; set; } = string.Empty;
        [Required, MinLength(8), MaxLength(128)] public string NewPassword { get; set; } = string.Empty;
    }

    /// <summary>
    /// Müşterinin kendi şifresini değiştirmesi.
    ///
    /// MEVCUT ŞİFRE SORULUYOR. Oturum açık olması yetmez: ortak bilgisayarda açık kalmış bir
    /// oturumu bulan kişi, şifreyi değiştirip hesabı tamamen ele geçirebilirdi.
    ///
    /// Değişiklikten sonra DİĞER oturumlar düşüyor, bu oturum ayakta kalıyor. Sebep: şifresini
    /// değiştirmenin en yaygın nedeni "başkası girmiş olabilir" endişesi; o hâlde diğer
    /// cihazların düşmesi istenen sonuç. Kendi oturumunu da düşürmek ise kullanıcıyı işlemin
    /// hemen ardından giriş ekranına atmak olurdu.
    ///
    /// Hız sınırı `auth`: burası da bir şifre deneme yüzeyi — mevcut şifre tahmin edilebilir.
    /// </summary>
    [HttpPost("password")]
    [EnableRateLimiting(RateLimitPolicies.Auth)]
    public async Task<IActionResult> ChangePassword([FromBody] ChangePasswordRequest request, CancellationToken ct)
    {
        if (!ModelState.IsValid) return ValidationProblem(ModelState);

        var token = Request.Headers[SessionHeader].ToString();
        var member = await CurrentMemberAsync(ct);
        if (member is null) return Unauthorized(new { message = "Oturum bulunamadı." });

        var found = await _members.FindForLoginAsync(member.Email, ct);
        if (found is null || !PasswordHasher.Verify(request.CurrentPassword, found.Value.PasswordHash))
        {
            return BadRequest(new { message = "Mevcut şifreniz hatalı." });
        }

        if (PasswordHasher.Verify(request.NewPassword, found.Value.PasswordHash))
        {
            return BadRequest(new { message = "Yeni şifre eskisiyle aynı olamaz." });
        }

        await _members.SetPasswordAsync(member.Id, request.NewPassword, ct);

        // SetPasswordAsync bütün oturumları düşürdü; kullanıcı burada kalabilsin diye
        // bu istekteki oturum yeniden açılıyor ve yeni anahtar dönüyor.
        var fresh = await _members.StartSessionAsync(member.Id, Request.Headers.UserAgent.ToString(), ct);
        _logger.LogInformation("Üye kendi şifresini değiştirdi: {Email}", member.Email);

        return Ok(new
        {
            success = true,
            session = fresh,
            message = "Şifreniz değiştirildi. Diğer cihazlardaki oturumlarınız kapatıldı."
        });
    }

    public sealed class ForgotPasswordRequest
    {
        [Required, EmailAddress] public string Email { get; set; } = string.Empty;
    }

    /// <summary>
    /// Şifre belirleme. İki yoldan biriyle gelir ve <b>tam olarak biri</b> dolu olmalıdır:
    /// <list type="bullet">
    /// <item><c>Token</c> — e-postayla gönderilen bağlantıdaki anahtar.</item>
    /// <item><c>Ticket</c> — SMS kodu doğrulandığında <c>phone/verify</c>'ın verdiği bilet.</item>
    /// </list>
    /// </summary>
    public sealed class ResetPasswordRequest
    {
        public string? Token { get; set; }
        public string? Ticket { get; set; }
        [Required, MinLength(8), MaxLength(128)] public string NewPassword { get; set; } = string.Empty;
    }

    /// <summary>
    /// Şifremi Unuttum: e-posta adresine tek kullanımlık 15 dakikalık sıfırlama bağlantısı gönderir.
    ///
    /// Zamanlama ve bilgi sızdırma koruması: E-posta sistemde kayıtlı olsun ya da olmasın aynı
    /// başarılı mesajı döner; böylece saldırgan sistemdeki e-postaları listeleyemez.
    /// </summary>
    [HttpPost("forgot-password")]
    [EnableRateLimiting(RateLimitPolicies.Auth)]
    public async Task<IActionResult> ForgotPassword([FromBody] ForgotPasswordRequest request, CancellationToken ct)
    {
        if (!ModelState.IsValid) return ValidationProblem(ModelState);

        var email = (request.Email ?? string.Empty).Trim().ToLowerInvariant();
        var found = await _members.FindForLoginAsync(email, ct);

        if (found is not null && found.Value.Member.IsActive)
        {
            var member = found.Value.Member;
            var token = await _members.CreatePasswordResetTokenAsync(member.Id, TimeSpan.FromMinutes(15), ct);

            var origin = Request.Headers.Origin.ToString();
            if (string.IsNullOrWhiteSpace(origin))
            {
                origin = _configuration["Storefront:BaseUrl"] ?? "http://localhost:3000";
            }
            var resetLink = $"{origin.TrimEnd('/')}/sifre-sifirla?token={Uri.EscapeDataString(token)}";

            _ = Task.Run(async () =>
            {
                try
                {
                    await _emailService.SendPasswordResetEmailAsync(member.Email, member.FullName, resetLink);
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "Şifre sıfırlama e-postası arka planda gönderilemedi: {Email}", member.Email);
                }
            });
        }

        return Ok(new
        {
            success = true,
            message = "Eğer bu e-posta adresiyle kayıtlı bir hesap varsa, şifre sıfırlama bağlantısı gönderilmiştir."
        });
    }

    /// <summary>
    /// Şifre sıfırlama bağlantısının geçerliliğini denetler.
    /// </summary>
    [HttpGet("validate-reset-token")]
    public async Task<IActionResult> ValidateResetToken([FromQuery] string token, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(token))
        {
            return BadRequest(new { valid = false, message = "Geçersiz şifre sıfırlama bağlantısı." });
        }

        var member = await _members.FindMemberByResetTokenAsync(token, ct);
        if (member is null)
        {
            return BadRequest(new { valid = false, message = "Şifre sıfırlama bağlantısının süresi dolmuş veya daha önce kullanılmış." });
        }

        return Ok(new { valid = true, email = member.Email, fullName = member.FullName });
    }

    /// <summary>
    /// Şifre sıfırlama token'ı ile yeni şifre belirler.
    /// </summary>
    [HttpPost("reset-password")]
    [EnableRateLimiting(RateLimitPolicies.Auth)]
    public async Task<IActionResult> ResetPassword([FromBody] ResetPasswordRequest request, CancellationToken ct)
    {
        if (!ModelState.IsValid) return ValidationProblem(ModelState);

        var hasToken = !string.IsNullOrWhiteSpace(request.Token);
        var hasTicket = !string.IsNullOrWhiteSpace(request.Ticket);

        // İkisi birden gönderilirse istek reddediliyor: hangisinin geçerli sayıldığı belirsiz
        // kalmamalı, "biri tutmazsa diğerini dene" davranışı iki yolu da zayıflatırdı.
        if (hasToken == hasTicket)
        {
            return BadRequest(new { message = "Şifre sıfırlama isteği geçersiz." });
        }

        if (hasTicket)
        {
            // SMS YOLU: bilet tek kullanımlık harcanır ve hangi üyeye ait olduğu ondan gelir.
            var verified = await _smsVerification.ConsumeTicketAsync(request.Ticket!, SmsPurpose.Reset, ct);
            if (verified?.MemberId is null)
            {
                return BadRequest(new
                {
                    message = "Doğrulama süresi dolmuş veya daha önce kullanılmış. Yeni kod isteyin."
                });
            }

            await _members.SetPasswordAsync(verified.Value.MemberId.Value, request.NewPassword, ct);

            // Telefonunu doğrulamış oldu; kayıt sırasında doğrulanmamış eski üyeler de
            // böylece işaretlenmiş oluyor.
            await _members.MarkPhoneVerifiedAsync(verified.Value.MemberId.Value, ct);
        }
        else
        {
            var success = await _members.ResetPasswordWithTokenAsync(request.Token!, request.NewPassword, ct);
            if (!success)
            {
                return BadRequest(new
                {
                    message = "Şifre sıfırlama bağlantısı geçersiz, süresi dolmuş veya daha önce kullanılmış."
                });
            }
        }

        return Ok(new
        {
            success = true,
            message = "Şifreniz başarıyla güncellendi. Yeni şifrenizle giriş yapabilirsiniz."
        });
    }

    // ==================================================================== SMS DOĞRULAMA

    public sealed class SendCodeRequest
    {
        [Required, MaxLength(30)]
        public string Phone { get; set; } = string.Empty;

        /// <summary><c>register</c> ya da <c>reset</c>.</summary>
        [Required, MaxLength(20)]
        public string Purpose { get; set; } = string.Empty;
    }

    public sealed class VerifyCodeRequest
    {
        [Required, MaxLength(30)]
        public string Phone { get; set; } = string.Empty;

        [Required, MaxLength(20)]
        public string Purpose { get; set; } = string.Empty;

        [Required, MinLength(4), MaxLength(6)] // 4: yerel test ana kodu "1111" (sahte sağlayıcı açıkken)
        public string Code { get; set; } = string.Empty;
    }

    /// <summary>
    /// Vitrin, SMS doğrulamasının açık olup olmadığını buradan öğrenir.
    ///
    /// Kredentials girilmemişken kayıt ekranının "SMS kodu" adımını göstermesi, kullanıcıyı
    /// hiç gelmeyecek bir kodu beklerken bırakırdı. Ekran bu bayrağa göre adımı atlıyor.
    /// </summary>
    [HttpGet("sms-status")]
    public IActionResult SmsStatus() => Ok(new
    {
        enabled = _smsVerification.IsEnabled,
        codeLength = 6,
        resendAfterSeconds = (int)SmsVerificationStore.ResendCooldown.TotalSeconds
    });

    /// <summary>
    /// Telefona doğrulama kodu gönderir.
    ///
    /// <b>Şifre sıfırlamada</b> kod yalnızca numara kayıtlıysa gönderilir, ama cevap her iki
    /// durumda da birebir aynıdır — sınırlar da üyeden bağımsız işletiliyor. Aksi hâlde bu uç
    /// "bu numarayla hesap var mı" sorusunu herkese cevaplayan bir sorgulama aracı olurdu.
    /// </summary>
    [HttpPost("phone/send-code")]
    [EnableRateLimiting(RateLimitPolicies.Auth)]
    public async Task<IActionResult> SendPhoneCode([FromBody] SendCodeRequest request, CancellationToken ct)
    {
        if (!ModelState.IsValid) return ValidationProblem(ModelState);

        if (!SmsPurpose.IsValid(request.Purpose))
        {
            return BadRequest(new { message = "Geçersiz doğrulama amacı." });
        }

        if (!_smsVerification.IsEnabled)
        {
            return BadRequest(new { message = "SMS doğrulama şu anda kullanılamıyor." });
        }

        Guid? memberId = null;
        var shouldSend = true;

        if (request.Purpose == SmsPurpose.Reset)
        {
            // Sınırlar üyeden BAĞIMSIZ işletiliyor (aşağıdaki `sendMessage` notu): kayıtlı
            // olmayan numarada da aynı bekleme/tavan davranışı görünsün.
            var member = await _members.FindActiveByPhoneAsync(request.Phone, ct);
            memberId = member?.Id;
            shouldSend = member is not null;
        }

        var result = await _smsVerification.RequestCodeAsync(
            request.Phone,
            request.Purpose,
            memberId,
            _clientAddress.ResolveKey(HttpContext),
            ct,
            sendMessage: shouldSend);

        return result.Status switch
        {
            SmsRequestStatus.Sent => Ok(new
            {
                success = true,
                message = "Doğrulama kodu telefonunuza gönderildi.",
                resendAfterSeconds = (int)SmsVerificationStore.ResendCooldown.TotalSeconds
            }),

            // Yabancı numaraya SMS gidemiyor; müşteri e-postayla devam edebilir (bkz. Register).
            // `internationalNumber` işaretiyle arayüz e-posta yolunu gösteriyor.
            SmsRequestStatus.InvalidPhone => BadRequest(new
            {
                message = "Bu numaraya SMS gönderemiyoruz. KKTC/Türkiye cep numarası girin ya da e-posta ile devam edin. / We can't send SMS to this number. Please continue with your e-mail.",
                internationalNumber = true
            }),

            SmsRequestStatus.Cooldown => StatusCode(429, new
            {
                message = $"Yeni kod için {result.RetryAfterSeconds} saniye bekleyin.",
                retryAfterSeconds = result.RetryAfterSeconds
            }),

            SmsRequestStatus.DailyLimit => StatusCode(429, new
            {
                message = "Bu numara için günlük doğrulama sınırına ulaşıldı. Yarın tekrar deneyin."
            }),

            // Sağlayıcı hatasının ayrıntısı DIŞARI VERİLMEZ (kredi bitti mi, hesap kısıtlı mı
            // — bunlar iç bilgi). Ayrıntı günlükte duruyor.
            _ => StatusCode(502, new { message = "Doğrulama kodu gönderilemedi. Lütfen biraz sonra tekrar deneyin." })
        };
    }

    /// <summary>
    /// Kodu doğrular ve tek kullanımlık bir <b>bilet</b> döner. Bilet, kayıt ya da şifre
    /// belirleme adımında kullanılır.
    /// </summary>
    [HttpPost("phone/verify")]
    [EnableRateLimiting(RateLimitPolicies.Auth)]
    public async Task<IActionResult> VerifyPhoneCode([FromBody] VerifyCodeRequest request, CancellationToken ct)
    {
        if (!ModelState.IsValid) return ValidationProblem(ModelState);

        if (!SmsPurpose.IsValid(request.Purpose))
        {
            return BadRequest(new { message = "Geçersiz doğrulama amacı." });
        }

        var result = await _smsVerification.VerifyAsync(request.Phone, request.Purpose, request.Code, ct);

        return result.Status switch
        {
            SmsVerifyStatus.Verified => Ok(new
            {
                success = true,
                ticket = result.Ticket,
                expiresInSeconds = (int)SmsVerificationStore.TicketLifetime.TotalSeconds
            }),

            SmsVerifyStatus.Expired => BadRequest(new
            {
                message = "Kodun süresi doldu. Yeni kod isteyin."
            }),

            SmsVerifyStatus.TooManyAttempts => BadRequest(new
            {
                message = "Çok fazla hatalı deneme yaptınız. Yeni kod isteyin."
            }),

            // "Kod yanlış" ile "böyle bir istek yok" AYNI mesajı veriyor: farklı cevaplar,
            // hangi numaraya kod gönderildiğini dışarıdan anlamaya yarardı.
            _ => BadRequest(new { message = "Doğrulama kodu hatalı." })
        };
    }

    /// <summary>
    /// Düzenlenebilir profil: üyenin kendi kaydı + carideki teslimat/fatura adresi.
    ///
    /// `GET me`'den AYRI duruyor ve bilerek: `me` her sayfa render'ında çağrılıyor (oturum
    /// kontrolü), oraya bir ERP çağrısı eklemek sitenin her sayfasına ağ gecikmesi eklemek
    /// olurdu. Bu uç yalnızca profil ekranından çağrılıyor.
    ///
    /// `addressAvailable` alanı ayrı: ERP'ye ulaşılamadığında adres alanları boş geliyor ve
    /// ekranın bunu "adresiniz boş" diye göstermemesi gerekiyor. Boş kutuları farkında olmadan
    /// kaydetmek kayba yol açmıyor (ERP ucu null gelen alanı atlıyor) ama kullanıcıya adresini
    /// kaybettiğini düşündürürdü.
    /// </summary>
    [HttpGet("profile")]
    public async Task<IActionResult> GetProfile(CancellationToken ct)
    {
        var member = await CurrentMemberAsync(ct);
        if (member is null) return Unauthorized(new { message = "Oturum bulunamadı." });

        var contact = string.IsNullOrWhiteSpace(member.CustomerCode)
            ? null
            : await _erp.GetCustomerContactAsync(member.CustomerCode, ct);

        return Ok(new
        {
            member.Email,
            member.FullName,
            member.Phone,
            member.CustomerCode,
            city = contact?.City,
            district = contact?.District,
            address = contact?.Address,
            addressAvailable = contact is not null,
            smsOptOut = await _members.GetSmsOptOutAsync(member.Id, ct)
        });
    }

    [HttpPut("profile")]
    [EnableRateLimiting(RateLimitPolicies.Write)]
    public async Task<IActionResult> UpdateProfile([FromBody] ProfileRequest request, CancellationToken ct)
    {
        if (!ModelState.IsValid) return ValidationProblem(ModelState);

        var member = await CurrentMemberAsync(ct);
        if (member is null) return Unauthorized(new { message = "Oturum bulunamadı." });

        await _members.UpdateProfileAsync(member.Id, request.FullName, request.Phone, ct, request.SmsOptOut);

        // Cariye yansıtılan alanlar BEYAZ LİSTE: ad, telefon, adres. Vergi no, cari tipi,
        // fiyat grubu ve kredi limiti müşterinin değiştirebileceği şeyler değil — istek
        // gövdesine yazılsa bile buraya girmiyor.
        if (!string.IsNullOrWhiteSpace(member.CustomerCode))
        {
            var synced = await _erp.UpdateCustomerContactAsync(
                member.CustomerCode, request.FullName, request.Phone, request.City, request.District, request.Address, ct);

            if (!synced)
            {
                // Mağaza tarafı güncellendi ama cari güncellenemedi: kullanıcıya doğruyu söylüyoruz.
                return StatusCode(StatusCodes.Status502BadGateway, new
                {
                    message = "Bilgileriniz kaydedildi ancak cari kaydına işlenemedi. Ekibimiz kontrol edecek."
                });
            }
        }

        return Ok(new { success = true });
    }

    /* ==========================================================================
       KAYITLI ADRESLER ENDPOINTS
       ========================================================================== */
    [HttpGet("addresses")]
    public async Task<IActionResult> ListAddresses(CancellationToken ct)
    {
        var member = await CurrentMemberAsync(ct);
        if (member is null) return Unauthorized(new { message = "Oturum bulunamadı." });

        var list = await _members.ListAddressesAsync(member.Id, ct);
        return Ok(list);
    }

    /// <summary>
    /// Varsayılan adresi ERP cari kartına yansıtır.
    ///
    /// Sipariş oluşturma ucu (`POST /api/orders`) adres kabul ETMİYOR — teslimat her zaman
    /// carideki güncel adresten okunuyor (bkz. `preparePendingOrder`). Kayıtlı adres listesi
    /// bu senkron olmadan yalnızca kozmetikti: müşteri "İş" adresini varsayılan yapsa bile
    /// sipariş hep carideki eski adrese giderdi (2026-09-05 denetiminde bulundu). Varsayılan
    /// DEĞİŞTİĞİ her an burada tetiklenir; böylece "hangi adres varsayılan" ile "ERP nereye
    /// gönderecek" hiçbir zaman ayrışmaz.
    /// </summary>
    private async Task SyncDefaultAddressToErpAsync(Member member, MemberAddressDto address, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(member.CustomerCode)) return;
        await _erp.UpdateCustomerContactAsync(
            member.CustomerCode, address.FullName, address.Phone, address.City, address.District, address.Address, ct);
    }

    [HttpPost("addresses")]
    [EnableRateLimiting(RateLimitPolicies.Write)]
    public async Task<IActionResult> CreateAddress([FromBody] AddressRequest request, CancellationToken ct)
    {
        if (!ModelState.IsValid) return ValidationProblem(ModelState);

        var eligibilityError = KktcCityValidator.CheckEligibility(request.City, request.Address);
        if (eligibilityError is not null) return BadRequest(new { message = eligibilityError });

        var member = await CurrentMemberAsync(ct);
        if (member is null) return Unauthorized(new { message = "Oturum bulunamadı." });

        var created = await _members.CreateAddressAsync(
            member.Id, request.Title, request.FullName, request.Phone, request.City, request.District, request.Address, request.IsDefault, ct);

        if (created.IsDefault) await SyncDefaultAddressToErpAsync(member, created, ct);

        return Ok(created);
    }

    [HttpPut("addresses/{id:guid}")]
    [EnableRateLimiting(RateLimitPolicies.Write)]
    public async Task<IActionResult> UpdateAddress(Guid id, [FromBody] AddressRequest request, CancellationToken ct)
    {
        if (!ModelState.IsValid) return ValidationProblem(ModelState);

        var eligibilityError = KktcCityValidator.CheckEligibility(request.City, request.Address);
        if (eligibilityError is not null) return BadRequest(new { message = eligibilityError });

        var member = await CurrentMemberAsync(ct);
        if (member is null) return Unauthorized(new { message = "Oturum bulunamadı." });

        var updated = await _members.UpdateAddressAsync(
            member.Id, id, request.Title, request.FullName, request.Phone, request.City, request.District, request.Address, request.IsDefault, ct);

        if (!updated) return NotFound(new { message = "Adres bulunamadı." });

        if (request.IsDefault)
        {
            await SyncDefaultAddressToErpAsync(member, new MemberAddressDto
            {
                Id = id,
                Title = request.Title,
                FullName = request.FullName,
                Phone = request.Phone,
                City = request.City,
                District = request.District,
                Address = request.Address,
                IsDefault = true
            }, ct);
        }

        return Ok(new { success = true });
    }

    [HttpDelete("addresses/{id:guid}")]
    [EnableRateLimiting(RateLimitPolicies.Write)]
    public async Task<IActionResult> DeleteAddress(Guid id, CancellationToken ct)
    {
        var member = await CurrentMemberAsync(ct);
        if (member is null) return Unauthorized(new { message = "Oturum bulunamadı." });

        var deleted = await _members.DeleteAddressAsync(member.Id, id, ct);
        if (!deleted) return NotFound(new { message = "Adres bulunamadı." });
        return Ok(new { success = true });
    }

    [HttpPut("addresses/{id:guid}/default")]
    [EnableRateLimiting(RateLimitPolicies.Write)]
    public async Task<IActionResult> SetDefaultAddress(Guid id, CancellationToken ct)
    {
        var member = await CurrentMemberAsync(ct);
        if (member is null) return Unauthorized(new { message = "Oturum bulunamadı." });

        var updated = await _members.SetDefaultAddressAsync(member.Id, id, ct);
        if (updated is null) return NotFound(new { message = "Adres bulunamadı." });

        await SyncDefaultAddressToErpAsync(member, updated, ct);
        return Ok(new { success = true });
    }

    private async Task<Member?> CurrentMemberAsync(CancellationToken ct)
    {
        var token = Request.Headers[SessionHeader].ToString();
        return string.IsNullOrWhiteSpace(token) ? null : await _members.FindBySessionAsync(token, ct);
    }
}

public sealed class AddressRequest
{
    [MaxLength(100)] public string Title { get; set; } = "Adresim";
    [Required, MaxLength(200)] public string FullName { get; set; } = string.Empty;
    [Required, MaxLength(50)] public string Phone { get; set; } = string.Empty;
    [MaxLength(100)] public string? City { get; set; }
    // Montaj/kargo ekibi Region'ı buradan okur (SalesOrder.DeliveryDistrict -> Installation.Region).
    // Eskiden zorunlu değildi, çoğu müşteri boş bırakıyordu — montaj kaydına bölge hiç gelmiyordu.
    [Required, MinLength(2), MaxLength(100)] public string District { get; set; } = string.Empty;
    [Required, MaxLength(500)] public string Address { get; set; } = string.Empty;
    public bool IsDefault { get; set; }
}
