using Npgsql;
using Shop.Api.Infrastructure;
using System.Security.Cryptography;

namespace Shop.Api.Members;

/// <summary>Doğrulama kodunun ne için istendiği. Kodlar amaçlar arasında geçersizdir.</summary>
public static class SmsPurpose
{
    /// <summary>Yeni üyelik — telefon sahipliği kanıtı.</summary>
    public const string Register = "register";

    /// <summary>Şifre sıfırlama.</summary>
    public const string Reset = "reset";

    /// <summary>
    /// Şifresiz giriş (2026-09-20): telefon + kod. Numara kayıtlıysa oturum açar, değilse ad
    /// alınıp üyelik o anda açılır. Kıbrıs'taki müşteri e-posta/şifre hatırlamıyor; giriş
    /// engeli satışın önündeki en büyük duvardı.
    /// </summary>
    public const string Login = "login";

    public static bool IsValid(string? value) =>
        value is Register or Reset or Login;
}

public enum SmsRequestStatus
{
    Sent,
    Disabled,
    InvalidPhone,
    Cooldown,
    DailyLimit,
    SendFailed
}

public sealed record SmsRequestResult(SmsRequestStatus Status, int RetryAfterSeconds = 0)
{
    public bool Ok => Status == SmsRequestStatus.Sent;
}

public enum SmsVerifyStatus
{
    Verified,
    NotFound,
    Expired,
    WrongCode,
    TooManyAttempts
}

public sealed record SmsVerifyResult(SmsVerifyStatus Status, string? Ticket = null, Guid? MemberId = null)
{
    public bool Ok => Status == SmsVerifyStatus.Verified;
}

/// <summary>
/// SMS ile telefon doğrulama: kod üretimi, hız sınırları, doğrulama ve tek kullanımlık bilet.
///
/// <para><b>Neden burada toplandı:</b> "sınırı kontrol et → kod üret → gönder → kaydet"
/// zincirinin parçalanması, sınırın atlanabildiği bir yol açar. Denetleyici yalnız çağırıyor.</para>
///
/// <para><b>Hız sınırı üç katmanlı</b> — SMS hem <i>para</i> hem <i>silah</i> (bir mağdurun
/// telefonunu bombalamak için kullanılabilir). Uçlardaki genel <c>Auth</c> politikası IP
/// başına çalışıyor ve tek başına yetmez: saldırgan IP değiştirebilir, ama kurbanın numarası
/// sabittir. Bu yüzden asıl sınır <b>numara başına</b>.</para>
/// <list type="bullet">
/// <item><b>Tekrar gönderme:</b> aynı numara+amaç için 60 saniyede bir.</item>
/// <item><b>Günlük:</b> numara başına 24 saatte 5 kod.</item>
/// <item><b>Deneme:</b> bir kod için 5 yanlış giriş → kod yakılır.</item>
/// </list>
///
/// <para><b>Kod düz saklanmaz</b> (PBKDF2). Veritabanını okuyabilen biri bekleyen kodları
/// göremesin; şifrelerde uygulanan kuralın aynısı.</para>
/// </summary>
public sealed class SmsVerificationStore
{
    private readonly TenantResolver _tenant;
    private readonly ShopSchema _schema;
    private readonly ISmsService _sms;
    private readonly WhatsAppOtpSender _whatsApp;
    private readonly ILogger<SmsVerificationStore> _logger;
    private readonly IWebHostEnvironment _environment;
    private readonly IConfiguration _configuration;

    /// <summary>Kod ömrü. Kısa: SMS anında ulaşır, uzun ömür yalnız saldırgana zaman verir.</summary>
    public static readonly TimeSpan CodeLifetime = TimeSpan.FromMinutes(5);

    /// <summary>Doğrulama sonrası biletin ömrü — kullanıcı formu doldurmaya devam ediyor.</summary>
    public static readonly TimeSpan TicketLifetime = TimeSpan.FromMinutes(15);

    public static readonly TimeSpan ResendCooldown = TimeSpan.FromSeconds(60);

    private const int DailyLimitPerPhone = 5;
    private const int MaxAttempts = 5;

    public SmsVerificationStore(
        TenantResolver tenant,
        ShopSchema schema,
        ISmsService sms,
        WhatsAppOtpSender whatsApp,
        ILogger<SmsVerificationStore> logger,
        IWebHostEnvironment environment,
        IConfiguration configuration)
    {
        _tenant = tenant;
        _schema = schema;
        _sms = sms;
        _whatsApp = whatsApp;
        _logger = logger;
        _environment = environment;
        _configuration = configuration;
    }

    public bool IsEnabled => _sms.IsConfigured;

    private async Task<NpgsqlConnection> OpenAsync(CancellationToken ct)
    {
        await _schema.EnsureAsync(ct);
        var conn = new NpgsqlConnection(_tenant.ShopConnectionString());
        await conn.OpenAsync(ct);
        return conn;
    }

    // ------------------------------------------------------------------ kod isteme

    /// <param name="sendMessage">
    /// <c>false</c> ise sınırlar işletilir ve kayıt açılır ama SMS <b>gönderilmez</b>.
    ///
    /// Şifre sıfırlamada kullanılıyor: kayıtlı olmayan bir numara için de aynı sınırların
    /// işlemesi gerekiyor, yoksa saldırgan "ikinci istekte bekleme çıktı mı" diye bakarak
    /// numaranın sisteme kayıtlı olup olmadığını anlardı (kullanıcı sayımı). Cevap her iki
    /// durumda da birebir aynı olmalı.
    /// </param>
    public async Task<SmsRequestResult> RequestCodeAsync(
        string phone,
        string purpose,
        Guid? memberId,
        string? clientKey,
        CancellationToken ct,
        bool sendMessage = true)
    {
        if (!IsEnabled) return new SmsRequestResult(SmsRequestStatus.Disabled);

        // Kanonik numara: sınırlar da bunun üzerinden sayılıyor, yoksa aynı numarayı farklı
        // biçimlerde yazarak (0533…, +90533…) sınır katlanarak aşılırdı.
        var msisdn = _sms.NormalizeMsisdn(phone);
        if (msisdn.Length == 0) return new SmsRequestResult(SmsRequestStatus.InvalidPhone);

        await using var conn = await OpenAsync(ct);

        // 1) Tekrar gönderme aralığı
        await using (var cd = new NpgsqlCommand("""
            SELECT EXTRACT(EPOCH FROM (now() - max(created_at)))
            FROM public.sms_verifications
            WHERE phone = @p AND purpose = @u
            """, conn))
        {
            cd.Parameters.AddWithValue("p", msisdn);
            cd.Parameters.AddWithValue("u", purpose);

            var raw = await cd.ExecuteScalarAsync(ct);
            if (raw is not null && raw is not DBNull)
            {
                var elapsed = Convert.ToDouble(raw);
                if (elapsed < ResendCooldown.TotalSeconds)
                {
                    var wait = (int)Math.Ceiling(ResendCooldown.TotalSeconds - elapsed);
                    return new SmsRequestResult(SmsRequestStatus.Cooldown, wait);
                }
            }
        }

        // 2) Günlük tavan — amaç ayrımı YOK: maliyet ve rahatsızlık numaranın kendisinde.
        await using (var daily = new NpgsqlCommand("""
            SELECT count(*) FROM public.sms_verifications
            WHERE phone = @p AND created_at > now() - interval '24 hours'
            """, conn))
        {
            daily.Parameters.AddWithValue("p", msisdn);
            var used = Convert.ToInt32(await daily.ExecuteScalarAsync(ct));
            if (used >= DailyLimitPerPhone) return new SmsRequestResult(SmsRequestStatus.DailyLimit);
        }

        // 3) Aynı numara+amaç için bekleyen eski kodları geçersiz kıl: iki geçerli kodun aynı
        //    anda dolaşması, deneme sınırını fiilen ikiye katlardı.
        await using (var invalidate = new NpgsqlCommand("""
            UPDATE public.sms_verifications SET expires_at = now()
            WHERE phone = @p AND purpose = @u AND verified_at IS NULL AND expires_at > now()
            """, conn))
        {
            invalidate.Parameters.AddWithValue("p", msisdn);
            invalidate.Parameters.AddWithValue("u", purpose);
            await invalidate.ExecuteNonQueryAsync(ct);
        }

        var code = NewCode();

        await using (var insert = new NpgsqlCommand("""
            INSERT INTO public.sms_verifications
              (id, phone, purpose, code_hash, member_id, created_at, expires_at, attempts, client_key)
            VALUES (@id, @p, @u, @h, @m, now(), @exp, 0, @ck)
            """, conn))
        {
            insert.Parameters.AddWithValue("id", Guid.NewGuid());
            insert.Parameters.AddWithValue("p", msisdn);
            insert.Parameters.AddWithValue("u", purpose);
            insert.Parameters.AddWithValue("h", PasswordHasher.Hash(code));
            insert.Parameters.AddWithValue("m", (object?)memberId ?? DBNull.Value);
            insert.Parameters.AddWithValue("exp", DateTime.UtcNow.Add(CodeLifetime));
            insert.Parameters.AddWithValue("ck", (object?)clientKey ?? DBNull.Value);
            await insert.ExecuteNonQueryAsync(ct);
        }

        if (!sendMessage) return new SmsRequestResult(SmsRequestStatus.Sent);

        /*
          KOD İKİ KANALDAN AYNI ANDA GİDER (2026-10-12, kullanıcı kararı "A"): SMS (OTP ucu, olmazsa toplu)
          + WhatsApp kimlik doğrulama şablonu. Müşteri hangisine önce bakarsa. İkisinden BİRİ ulaştıysa
          gönderim başarılıdır; ikisi de düşerse müşteri "gönderilemedi" görür. WhatsApp ayarı yoksa
          (`WhatsAppOtp` bölümü boş) yalnız SMS gider — eski davranış.
        */
        var smsTask = _sms.SendAsync(msisdn, BuildMessage(code), ct, SmsKind.Otp);
        var waTask = _whatsApp.IsConfigured
            ? _whatsApp.SendCodeAsync(msisdn, code, ct)
            : Task.FromResult((Ok: false, Result: "WA_DISABLED"));
        await Task.WhenAll(smsTask, waTask);
        var sent = smsTask.Result;
        var wa = waTask.Result;

        if (!sent.Success && !wa.Ok)
        {
            // KAYIT SİLİNMİYOR: gönderim başarısızken satırı silmek, sağlayıcı arızalıyken
            // sınırsız yeniden denemeye kapı açardı. 60 saniyelik aralık burada da geçerli.
            _logger.LogWarning("Doğrulama kodu hiçbir kanaldan gönderilemedi. Amaç: {Purpose}, SMS: {Error}, WhatsApp: {Wa}", purpose, sent.ErrorCode, wa.Result);
            return new SmsRequestResult(SmsRequestStatus.SendFailed);
        }
        if (!sent.Success)
            _logger.LogWarning("Doğrulama kodu SMS ile gitmedi ({Error}), WhatsApp ile gitti. Amaç: {Purpose}", sent.ErrorCode, purpose);
        else if (_whatsApp.IsConfigured && !wa.Ok)
            _logger.LogWarning("Doğrulama kodu WhatsApp ile gitmedi ({Wa}), SMS ile gitti. Amaç: {Purpose}", wa.Result, purpose);

        return new SmsRequestResult(SmsRequestStatus.Sent);
    }

    // ------------------------------------------------------------------ doğrulama

    public async Task<SmsVerifyResult> VerifyAsync(string phone, string purpose, string code, CancellationToken ct)
    {
        var msisdn = _sms.NormalizeMsisdn(phone);
        if (msisdn.Length == 0) return new SmsVerifyResult(SmsVerifyStatus.NotFound);

        await using var conn = await OpenAsync(ct);

        Guid id;
        string hash;
        int attempts;
        Guid? memberId;

        await using (var find = new NpgsqlCommand("""
            SELECT id, code_hash, attempts, member_id
            FROM public.sms_verifications
            WHERE phone = @p AND purpose = @u AND verified_at IS NULL
            ORDER BY created_at DESC
            LIMIT 1
            """, conn))
        {
            find.Parameters.AddWithValue("p", msisdn);
            find.Parameters.AddWithValue("u", purpose);

            await using var reader = await find.ExecuteReaderAsync(ct);
            if (!await reader.ReadAsync(ct)) return new SmsVerifyResult(SmsVerifyStatus.NotFound);

            id = reader.GetGuid(0);
            hash = reader.GetString(1);
            attempts = reader.GetInt32(2);
            memberId = reader.IsDBNull(3) ? null : reader.GetGuid(3);
        }

        // Süre kontrolü ayrı sorguda: "süresi doldu" ile "kod yanlış" farklı mesajlar ve
        // kullanıcının hangisiyle karşılaştığını bilmesi gerekiyor.
        await using (var alive = new NpgsqlCommand(
            "SELECT expires_at > now() FROM public.sms_verifications WHERE id = @id", conn))
        {
            alive.Parameters.AddWithValue("id", id);
            if (await alive.ExecuteScalarAsync(ct) is not true)
            {
                return new SmsVerifyResult(SmsVerifyStatus.Expired);
            }
        }

        if (attempts >= MaxAttempts) return new SmsVerifyResult(SmsVerifyStatus.TooManyAttempts);

        /*
         * YEREL TEST ANA KODU (2026-09-21, kullanıcı isteği): sahte SMS sağlayıcısı AÇIKKEN
         * "1111" her doğrulamayı geçer — kullanıcı lokalde SMS kutusuna bakmadan akışı deniyor.
         * Kapı `FakeSmsService.IsEnabled` = yalnız Development ortamı + EnableFakeProvider bayrağı;
         * canlıda ikisi de yok, bu satır hiç çalışmaz. Gerçek sağlayıcıyla asla geçmez.
         */
        var masterOk = (code ?? string.Empty).Trim() == "1111" && FakeSmsService.IsEnabled(_environment, _configuration);

        if (!masterOk && !PasswordHasher.Verify((code ?? string.Empty).Trim(), hash))
        {
            var next = attempts + 1;

            await using var bump = new NpgsqlCommand("""
                UPDATE public.sms_verifications
                SET attempts = @a, expires_at = CASE WHEN @a >= @max THEN now() ELSE expires_at END
                WHERE id = @id
                """, conn);
            bump.Parameters.AddWithValue("a", next);
            bump.Parameters.AddWithValue("max", MaxAttempts);
            bump.Parameters.AddWithValue("id", id);
            await bump.ExecuteNonQueryAsync(ct);

            return new SmsVerifyResult(next >= MaxAttempts ? SmsVerifyStatus.TooManyAttempts : SmsVerifyStatus.WrongCode);
        }

        var ticket = PasswordHasher.NewSessionToken();

        await using (var ok = new NpgsqlCommand("""
            UPDATE public.sms_verifications
            SET verified_at = now(), ticket = @t, ticket_expires_at = @exp
            WHERE id = @id
            """, conn))
        {
            ok.Parameters.AddWithValue("t", ticket);
            ok.Parameters.AddWithValue("exp", DateTime.UtcNow.Add(TicketLifetime));
            ok.Parameters.AddWithValue("id", id);
            await ok.ExecuteNonQueryAsync(ct);
        }

        return new SmsVerifyResult(SmsVerifyStatus.Verified, ticket, memberId);
    }

    // ------------------------------------------------------------------ bilet

    /// <summary>
    /// Bileti <b>tek kullanımlık</b> olarak harcar ve doğrulanmış numarayı döndürür.
    ///
    /// Harcama tek bir <c>UPDATE … WHERE ticket_used_at IS NULL … RETURNING</c> ile yapılıyor:
    /// "önce oku, sonra işaretle" iki adımda yapılsaydı aynı bileti aynı anda gönderen iki
    /// istek ikisi de geçerli sayılabilirdi.
    /// </summary>
    public async Task<(string Phone, Guid? MemberId)?> ConsumeTicketAsync(string ticket, string purpose, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(ticket)) return null;

        await using var conn = await OpenAsync(ct);
        await using var cmd = new NpgsqlCommand("""
            UPDATE public.sms_verifications
            SET ticket_used_at = now()
            WHERE ticket = @t
              AND purpose = @u
              AND verified_at IS NOT NULL
              AND ticket_used_at IS NULL
              AND ticket_expires_at > now()
            RETURNING phone, member_id
            """, conn);

        cmd.Parameters.AddWithValue("t", ticket.Trim());
        cmd.Parameters.AddWithValue("u", purpose);

        await using var reader = await cmd.ExecuteReaderAsync(ct);
        if (!await reader.ReadAsync(ct)) return null;

        return (reader.GetString(0), reader.IsDBNull(1) ? null : reader.GetGuid(1));
    }

    /// <summary>
    /// Bileti HARCAMADAN doğrular (telefonla girişte "ad gerekli" ara adımı için). Harcama
    /// yalnızca oturum/üyelik açılırken <see cref="ConsumeTicketAsync"/> ile yapılır.
    /// </summary>
    public async Task<(string Phone, Guid? MemberId)?> PeekTicketAsync(string ticket, string purpose, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(ticket)) return null;

        await using var conn = await OpenAsync(ct);
        await using var cmd = new NpgsqlCommand("""
            SELECT phone, member_id
            FROM public.sms_verifications
            WHERE ticket = @t
              AND purpose = @u
              AND verified_at IS NOT NULL
              AND ticket_used_at IS NULL
              AND ticket_expires_at > now()
            LIMIT 1
            """, conn);

        cmd.Parameters.AddWithValue("t", ticket.Trim());
        cmd.Parameters.AddWithValue("u", purpose);

        await using var reader = await cmd.ExecuteReaderAsync(ct);
        if (!await reader.ReadAsync(ct)) return null;

        return (reader.GetString(0), reader.IsDBNull(1) ? null : reader.GetGuid(1));
    }

    /// <summary>Numaranın kanonik hâli — denetleyici karşılaştırma yaparken aynı biçimi kullanmalı.</summary>
    public string Normalize(string phone) => _sms.NormalizeMsisdn(phone);

    // ------------------------------------------------------------------ yardımcılar

    /// <summary>
    /// 6 haneli kod, kriptografik rastgelelikle. <c>Random</c> tahmin edilebilir olduğu için
    /// doğrulama kodunda kullanılmaz.
    /// </summary>
    private static string NewCode() => RandomNumberGenerator.GetInt32(0, 1_000_000).ToString("D6");

    /// <summary>
    /// Mesaj metni <b>Türkçe karaktersiz</b>.
    ///
    /// Sebep maliyet: bir SMS, GSM-7 alfabesiyle 160 karakter; içinde tek bir "ç/ğ/ı/ş/ü/ö"
    /// geçerse mesaj UCS-2'ye düşüyor ve sınır 70 karaktere iniyor — yani aynı metin iki
    /// kredi harcıyor. Doğrulama mesajı her gönderimde tekrarlandığı için fark katlanıyor.
    /// </summary>
    private static string BuildMessage(string code) =>
        $"STILSOFT DEMO dogrulama kodunuz: {code}. Kod 5 dakika gecerlidir, kimseyle paylasmayin.";
}
