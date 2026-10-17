using Npgsql;
using Shop.Api.Infrastructure;

namespace Shop.Api.Members;

public sealed class Member
{
    public Guid Id { get; init; }
    public string Email { get; init; } = string.Empty;
    public string FullName { get; init; } = string.Empty;
    public string? Phone { get; init; }
    public string? CustomerCode { get; init; }
    public bool IsActive { get; init; }
    /// <summary>Kampanya SMS'lerinden çıktı (sipariş/doğrulama SMS'leri etkilenmez).</summary>
    public bool SmsOptOut { get; init; }
}

/// <summary>
/// Üye kayıtları ve oturumları — mağazanın kendi veritabanında.
///
/// Oturum, JWT yerine veritabanındaki rastgele bir anahtar: müşteri oturumu haftalarca yaşıyor
/// ve gerektiğinde tek satır silinerek gerçekten sonlandırılabilmeli. JWT'de bu mümkün değil.
/// Personelin ortak oturumundan (B2B + ServiceOps) tamamen ayrı bir dünya; oradaki 100 dakikalık
/// süre müşteriye uygulansa alışverişin ortasında kullanıcı düşerdi.
/// </summary>
public sealed class MemberStore
{
    private readonly TenantResolver _tenant;
    private readonly ShopSchema _schema;

    public static readonly TimeSpan SessionLifetime = TimeSpan.FromDays(30);

    public MemberStore(TenantResolver tenant, ShopSchema schema)
    {
        _tenant = tenant;
        _schema = schema;
    }

    private async Task<NpgsqlConnection> OpenAsync(CancellationToken ct)
    {
        await _schema.EnsureAsync(ct);
        var conn = new NpgsqlConnection(_tenant.ShopConnectionString());
        await conn.OpenAsync(ct);
        return conn;
    }

    public async Task<bool> EmailExistsAsync(string email, CancellationToken ct)
    {
        await using var conn = await OpenAsync(ct);
        await using var cmd = new NpgsqlCommand("SELECT 1 FROM public.members WHERE lower(email) = lower(@e) LIMIT 1", conn);
        cmd.Parameters.AddWithValue("e", email.Trim());
        return await cmd.ExecuteScalarAsync(ct) is not null;
    }

    public async Task<Member> CreateAsync(string email, string password, string fullName, string? phone, string? customerCode, CancellationToken ct)
    {
        var id = Guid.NewGuid();

        await using var conn = await OpenAsync(ct);
        await using var cmd = new NpgsqlCommand("""
            INSERT INTO public.members (id, email, password_hash, full_name, phone, customer_code, is_active, created_at)
            VALUES (@id, @email, @hash, @name, @phone, @code, true, now())
            """, conn);

        cmd.Parameters.AddWithValue("id", id);
        cmd.Parameters.AddWithValue("email", email.Trim());
        cmd.Parameters.AddWithValue("hash", PasswordHasher.Hash(password));
        cmd.Parameters.AddWithValue("name", fullName.Trim());
        cmd.Parameters.AddWithValue("phone", (object?)phone?.Trim() ?? DBNull.Value);
        cmd.Parameters.AddWithValue("code", (object?)customerCode ?? DBNull.Value);

        await cmd.ExecuteNonQueryAsync(ct);

        return new Member { Id = id, Email = email.Trim(), FullName = fullName.Trim(), Phone = phone, CustomerCode = customerCode, IsActive = true };
    }

    /// <summary>Cari sonradan açılabildiği için ayrı yazılabiliyor (ERP geçici olarak erişilemezse).</summary>
    public async Task SetCustomerCodeAsync(Guid memberId, string customerCode, CancellationToken ct)
    {
        await using var conn = await OpenAsync(ct);
        await using var cmd = new NpgsqlCommand("UPDATE public.members SET customer_code = @code WHERE id = @id", conn);
        cmd.Parameters.AddWithValue("code", customerCode);
        cmd.Parameters.AddWithValue("id", memberId);
        await cmd.ExecuteNonQueryAsync(ct);
    }

    public async Task<(Member Member, string PasswordHash)?> FindForLoginAsync(string email, CancellationToken ct)
    {
        await using var conn = await OpenAsync(ct);
        await using var cmd = new NpgsqlCommand("""
            SELECT id, email, password_hash, full_name, phone, customer_code, is_active
            FROM public.members WHERE lower(email) = lower(@e) LIMIT 1
            """, conn);
        cmd.Parameters.AddWithValue("e", email.Trim());

        await using var reader = await cmd.ExecuteReaderAsync(ct);
        if (!await reader.ReadAsync(ct)) return null;

        var member = new Member
        {
            Id = reader.GetGuid(0),
            Email = reader.GetString(1),
            FullName = reader.GetString(3),
            Phone = reader.IsDBNull(4) ? null : reader.GetString(4),
            CustomerCode = reader.IsDBNull(5) ? null : reader.GetString(5),
            IsActive = reader.GetBoolean(6)
        };

        return (member, reader.GetString(2));
    }

    /// <summary>
    /// Telefonla ŞİFRELİ giriş için adaylar (2026-10-05 kullanıcı isteği: "telefon veya mail şifre
    /// kombinasyonları ile giriş yapılabilsin"). Aynı numarada birden çok üye olabilir (üyesiz
    /// siparişin ayrı kayıtları, e-postayla ikinci kez üye olan); şifre hangisine uyuyorsa o
    /// girer. Sıra FindActiveByPhoneAsync ile aynı: tireli "ikinci" kayıtlar en sonda.
    /// </summary>
    public async Task<IReadOnlyList<(Member Member, string PasswordHash)>> FindForLoginByPhoneAsync(string phone, CancellationToken ct)
    {
        var digits = new string((phone ?? string.Empty).Where(char.IsDigit).ToArray());
        if (digits.Length < 10) return Array.Empty<(Member, string)>();
        var last10 = digits[^10..];

        await using var conn = await OpenAsync(ct);
        await using var cmd = new NpgsqlCommand("""
            SELECT id, email, password_hash, full_name, phone, customer_code, is_active
            FROM public.members
            WHERE is_active
              AND phone IS NOT NULL
              AND right(regexp_replace(phone, '\D', '', 'g'), 10) = @p
            ORDER BY (email ILIKE '%-%@telefon.stilsoft') ASC, last_login_at DESC NULLS LAST, created_at DESC
            LIMIT 10
            """, conn);
        cmd.Parameters.AddWithValue("p", last10);

        var list = new List<(Member, string)>();
        await using var reader = await cmd.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct))
        {
            list.Add((new Member
            {
                Id = reader.GetGuid(0),
                Email = reader.GetString(1),
                FullName = reader.GetString(3),
                Phone = reader.IsDBNull(4) ? null : reader.GetString(4),
                CustomerCode = reader.IsDBNull(5) ? null : reader.GetString(5),
                IsActive = reader.GetBoolean(6)
            }, reader.GetString(2)));
        }
        return list;
    }

    public async Task<string> StartSessionAsync(Guid memberId, string? userAgent, CancellationToken ct)
    {
        var token = PasswordHasher.NewSessionToken();

        await using var conn = await OpenAsync(ct);
        await using var cmd = new NpgsqlCommand("""
            INSERT INTO public.member_sessions (token, member_id, created_at, expires_at, user_agent)
            VALUES (@t, @m, now(), @exp, @ua);
            UPDATE public.members SET last_login_at = now() WHERE id = @m;
            """, conn);

        cmd.Parameters.AddWithValue("t", token);
        cmd.Parameters.AddWithValue("m", memberId);
        cmd.Parameters.AddWithValue("exp", DateTime.UtcNow.Add(SessionLifetime));
        cmd.Parameters.AddWithValue("ua", (object?)userAgent ?? DBNull.Value);

        await cmd.ExecuteNonQueryAsync(ct);
        return token;
    }

    public async Task<Member?> FindBySessionAsync(string token, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(token)) return null;

        await using var conn = await OpenAsync(ct);
        await using var cmd = new NpgsqlCommand("""
            SELECT m.id, m.email, m.full_name, m.phone, m.customer_code, m.is_active
            FROM public.member_sessions s
            JOIN public.members m ON m.id = s.member_id
            WHERE s.token = @t AND s.expires_at > now() AND m.is_active
            LIMIT 1
            """, conn);
        cmd.Parameters.AddWithValue("t", token);

        await using var reader = await cmd.ExecuteReaderAsync(ct);
        if (!await reader.ReadAsync(ct)) return null;

        return new Member
        {
            Id = reader.GetGuid(0),
            Email = reader.GetString(1),
            FullName = reader.GetString(2),
            Phone = reader.IsDBNull(3) ? null : reader.GetString(3),
            CustomerCode = reader.IsDBNull(4) ? null : reader.GetString(4),
            IsActive = reader.GetBoolean(5)
        };
    }

    public async Task EndSessionAsync(string token, CancellationToken ct)
    {
        await using var conn = await OpenAsync(ct);
        await using var cmd = new NpgsqlCommand("DELETE FROM public.member_sessions WHERE token = @t", conn);
        cmd.Parameters.AddWithValue("t", token);
        await cmd.ExecuteNonQueryAsync(ct);
    }

    public async Task UpdateProfileAsync(Guid memberId, string fullName, string? phone, CancellationToken ct, bool? smsOptOut = null)
    {
        await using var conn = await OpenAsync(ct);
        await using var cmd = new NpgsqlCommand(
            "UPDATE public.members SET full_name = @n, phone = @p, sms_opt_out = COALESCE(@o, sms_opt_out) WHERE id = @id", conn);
        cmd.Parameters.AddWithValue("n", fullName.Trim());
        cmd.Parameters.AddWithValue("p", (object?)phone?.Trim() ?? DBNull.Value);
        cmd.Parameters.AddWithValue("o", (object?)smsOptOut ?? DBNull.Value);
        cmd.Parameters.AddWithValue("id", memberId);
        await cmd.ExecuteNonQueryAsync(ct);
    }

    public async Task<bool> GetSmsOptOutAsync(Guid memberId, CancellationToken ct)
    {
        await using var conn = await OpenAsync(ct);
        await using var cmd = new NpgsqlCommand("SELECT COALESCE(sms_opt_out, false) FROM public.members WHERE id = @id", conn);
        cmd.Parameters.AddWithValue("id", memberId);
        var v = await cmd.ExecuteScalarAsync(ct);
        return v is bool b && b;
    }

    // -----------------------------------------------------------------------------------------
    // BAYİ PANELİNDEN YÖNETİM
    //
    // Buradaki işlemlerin hepsi bir personelin BAŞKASININ hesabına dokunması demek. O yüzden iki
    // kural var ve ikisi de aşağıda kodla tutuluyor:
    //  1. Şifre OKUNAMAZ. Panel yalnızca YENİ şifre belirleyebilir; var olanı gösteremez.
    //  2. Hesaba müdahale eden her işlem AÇIK OTURUMLARI DÜŞÜRÜR. Pasife alınan ya da şifresi
    //     değiştirilen bir hesabın telefonda açık kalması, işlemi anlamsız kılardı.
    // -----------------------------------------------------------------------------------------

    public async Task<Member?> FindByIdAsync(Guid memberId, CancellationToken ct)
    {
        await using var conn = await OpenAsync(ct);
        await using var cmd = new NpgsqlCommand("""
            SELECT id, email, full_name, phone, customer_code, is_active
            FROM public.members WHERE id = @id LIMIT 1
            """, conn);
        cmd.Parameters.AddWithValue("id", memberId);

        await using var reader = await cmd.ExecuteReaderAsync(ct);
        if (!await reader.ReadAsync(ct)) return null;

        return new Member
        {
            Id = reader.GetGuid(0),
            Email = reader.GetString(1),
            FullName = reader.GetString(2),
            Phone = reader.IsDBNull(3) ? null : reader.GetString(3),
            CustomerCode = reader.IsDBNull(4) ? null : reader.GetString(4),
            IsActive = reader.GetBoolean(5)
        };
    }

    /// <summary>Cari koduna göre aktif üye (havale onayında bayi yalnız sipariş/cari bilir).</summary>
    public async Task<Member?> FindByCustomerCodeAsync(string customerCode, CancellationToken ct)
    {
        var code = (customerCode ?? string.Empty).Trim();
        if (code.Length == 0) return null;

        await using var conn = await OpenAsync(ct);
        await using var cmd = new NpgsqlCommand("""
            SELECT id, email, full_name, phone, customer_code, is_active
            FROM public.members WHERE customer_code = @c AND is_active ORDER BY created_at DESC LIMIT 1
            """, conn);
        cmd.Parameters.AddWithValue("c", code);

        await using var reader = await cmd.ExecuteReaderAsync(ct);
        if (!await reader.ReadAsync(ct)) return null;

        return new Member
        {
            Id = reader.GetGuid(0),
            Email = reader.GetString(1),
            FullName = reader.GetString(2),
            Phone = reader.IsDBNull(3) ? null : reader.GetString(3),
            CustomerCode = reader.IsDBNull(4) ? null : reader.GetString(4),
            IsActive = reader.GetBoolean(5)
        };
    }

    /// <summary>E-postanın başka bir üyede kullanılıp kullanılmadığı — düzenleme sırasındaki kontrol.</summary>
    public async Task<bool> EmailExistsForOtherAsync(string email, Guid memberId, CancellationToken ct)
    {
        await using var conn = await OpenAsync(ct);
        await using var cmd = new NpgsqlCommand(
            "SELECT 1 FROM public.members WHERE lower(email) = lower(@e) AND id <> @id LIMIT 1", conn);
        cmd.Parameters.AddWithValue("e", email.Trim());
        cmd.Parameters.AddWithValue("id", memberId);
        return await cmd.ExecuteScalarAsync(ct) is not null;
    }

    /// <summary>
    /// Panelden ad / telefon / e-posta güncelleme.
    ///
    /// <c>customer_code</c> BURADAN DEĞİŞMEZ: cari, siparişin ve faturanın sahibi. Üyenin
    /// carisini elle başka bir koda çevirmek, geçmiş siparişleri başka bir cariye devretmek
    /// olurdu. Cari bağı yalnızca hiç yokken kurulabiliyor (<see cref="SetCustomerCodeAsync"/>).
    /// </summary>
    public async Task UpdateByAdminAsync(Guid memberId, string fullName, string email, string? phone, CancellationToken ct)
    {
        await using var conn = await OpenAsync(ct);
        await using var cmd = new NpgsqlCommand("""
            UPDATE public.members SET full_name = @n, email = @e, phone = @p WHERE id = @id
            """, conn);
        cmd.Parameters.AddWithValue("n", fullName.Trim());
        cmd.Parameters.AddWithValue("e", email.Trim());
        cmd.Parameters.AddWithValue("p", (object?)phone?.Trim() ?? DBNull.Value);
        cmd.Parameters.AddWithValue("id", memberId);
        await cmd.ExecuteNonQueryAsync(ct);
    }

    /// <summary>Hesabı açar/kapatır. Kapatınca açık oturumlar da düşer.</summary>
    public async Task SetActiveAsync(Guid memberId, bool isActive, CancellationToken ct)
    {
        await using var conn = await OpenAsync(ct);

        await using var cmd = new NpgsqlCommand("UPDATE public.members SET is_active = @a WHERE id = @id", conn);
        cmd.Parameters.AddWithValue("a", isActive);
        cmd.Parameters.AddWithValue("id", memberId);
        await cmd.ExecuteNonQueryAsync(ct);

        if (!isActive) await RevokeSessionsAsync(memberId, ct);
    }

    /// <summary>
    /// Yeni şifre belirler ve bütün oturumları düşürür.
    ///
    /// E-posta doğrulaması kapalı olduğu için "sıfırlama bağlantısı" gönderilemiyor (§2);
    /// müşteri şifresini unuttuğunda tek yol bayinin yeni bir şifre belirleyip müşteriye
    /// söylemesi. Bu yüzden şifre burada YAZILIYOR ama hiçbir yerde OKUNMUYOR: panel var olan
    /// şifreyi gösteremez, yalnızca yenisini koyabilir.
    /// </summary>
    public async Task SetPasswordAsync(Guid memberId, string newPassword, CancellationToken ct)
    {
        await using var conn = await OpenAsync(ct);

        await using var cmd = new NpgsqlCommand("UPDATE public.members SET password_hash = @h WHERE id = @id", conn);
        cmd.Parameters.AddWithValue("h", PasswordHasher.Hash(newPassword));
        cmd.Parameters.AddWithValue("id", memberId);
        await cmd.ExecuteNonQueryAsync(ct);

        await RevokeSessionsAsync(memberId, ct);
    }

    /// <summary>Üyenin bütün açık oturumlarını sonlandırır.</summary>
    public async Task<int> RevokeSessionsAsync(Guid memberId, CancellationToken ct)
    {
        await using var conn = await OpenAsync(ct);
        await using var cmd = new NpgsqlCommand("DELETE FROM public.member_sessions WHERE member_id = @id", conn);
        cmd.Parameters.AddWithValue("id", memberId);
        return await cmd.ExecuteNonQueryAsync(ct);
    }

    // -----------------------------------------------------------------------------------------
    // ŞİFRE SIFIRLAMA (ŞİFREMİ UNUTTUM)
    // -----------------------------------------------------------------------------------------

    /// <summary>
    /// Şifre sıfırlama için tek kullanımlık süreli (örn: 15 dk) kriptografik token üretir.
    /// Eski kullanılmamış token'ları temizler veya geçersiz kılar.
    /// </summary>
    /// <summary>
    /// Telefon numarasına göre AKTİF üye arar — şifre sıfırlamanın SMS yolu için.
    ///
    /// Karşılaştırma yalnız RAKAMLAR üzerinden ve son 10 hane ile: aynı numara veritabanına
    /// <c>0533 000 12 34</c>, <c>+90 533…</c>, <c>0090533…</c> gibi farklı biçimlerde
    /// girilmiş olabiliyor. Ham metin eşitliği arasaydı müşterinin kendi numarası
    /// "kayıtlı değil" görünürdü.
    ///
    /// Birden çok üye aynı numarayı taşıyorsa (aile hesabı) <b>en son giriş yapan</b> döner;
    /// rastgele birine şifre sıfırlama göndermek yerine kullanan hesabı seçmek daha doğru.
    /// </summary>
    public async Task<Member?> FindActiveByPhoneAsync(string phone, CancellationToken ct)
    {
        var digits = new string((phone ?? string.Empty).Where(char.IsDigit).ToArray());
        if (digits.Length < 10) return null;
        var last10 = digits[^10..];

        await using var conn = await OpenAsync(ct);
        await using var cmd = new NpgsqlCommand("""
            SELECT id, email, full_name, phone, customer_code, is_active
            FROM public.members
            WHERE is_active
              AND phone IS NOT NULL
              AND right(regexp_replace(phone, '\D', '', 'g'), 10) = @p
            -- Üyesiz siparişin "ikinci" kayıtları (tireli @telefon.stilsoft, 2026-10-05) EN SONA:
            -- numaranın gerçek sahibi SMS ile girdiğinde kendi hesabına düşsün.
            ORDER BY (email ILIKE '%-%@telefon.stilsoft') ASC, last_login_at DESC NULLS LAST, created_at DESC
            LIMIT 1
            """, conn);
        cmd.Parameters.AddWithValue("p", last10);

        await using var reader = await cmd.ExecuteReaderAsync(ct);
        if (!await reader.ReadAsync(ct)) return null;

        return new Member
        {
            Id = reader.GetGuid(0),
            Email = reader.GetString(1),
            FullName = reader.GetString(2),
            Phone = reader.IsDBNull(3) ? null : reader.GetString(3),
            CustomerCode = reader.IsDBNull(4) ? null : reader.GetString(4),
            IsActive = reader.GetBoolean(5)
        };
    }

    /// <summary>
    /// Numaraya ait BÜTÜN aktif üyelerin cari kodları (2026-10-05). Üyesiz siparişte aynı numaraya
    /// birden çok cari açılabildiği için sipariş takibi tek üyeye bakarsa siparişi bulamıyordu.
    /// </summary>
    public async Task<IReadOnlyList<string>> ListCustomerCodesByPhoneAsync(string phone, CancellationToken ct)
    {
        var digits = new string((phone ?? string.Empty).Where(char.IsDigit).ToArray());
        if (digits.Length < 10) return Array.Empty<string>();
        var last10 = digits[^10..];

        await using var conn = await OpenAsync(ct);
        await using var cmd = new NpgsqlCommand("""
            SELECT DISTINCT customer_code
            FROM public.members
            WHERE is_active
              AND phone IS NOT NULL
              AND customer_code IS NOT NULL AND customer_code <> ''
              AND right(regexp_replace(phone, '\D', '', 'g'), 10) = @p
            """, conn);
        cmd.Parameters.AddWithValue("p", last10);

        var list = new List<string>();
        await using var reader = await cmd.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct)) list.Add(reader.GetString(0));
        return list;
    }

    /// <summary>Telefonu doğrulanmış olarak işaretler (SMS kodu geçtikten sonra).</summary>
    public async Task MarkPhoneVerifiedAsync(Guid memberId, CancellationToken ct)
    {
        await using var conn = await OpenAsync(ct);
        await using var cmd = new NpgsqlCommand(
            "UPDATE public.members SET phone_verified = true WHERE id = @id", conn);
        cmd.Parameters.AddWithValue("id", memberId);
        await cmd.ExecuteNonQueryAsync(ct);
    }

    public async Task<string> CreatePasswordResetTokenAsync(Guid memberId, TimeSpan lifetime, CancellationToken ct)
    {
        var token = PasswordHasher.NewSessionToken();
        var expiresAt = DateTime.UtcNow.Add(lifetime);

        await using var conn = await OpenAsync(ct);

        // Bu üyenin önceki kullanılmamış açık token'larını geçersiz kıl
        await using var invalidateCmd = new NpgsqlCommand(
            "UPDATE public.password_reset_tokens SET used_at = now() WHERE member_id = @m AND used_at IS NULL", conn);
        invalidateCmd.Parameters.AddWithValue("m", memberId);
        await invalidateCmd.ExecuteNonQueryAsync(ct);

        await using var cmd = new NpgsqlCommand("""
            INSERT INTO public.password_reset_tokens (token, member_id, created_at, expires_at)
            VALUES (@t, @m, now(), @exp)
            """, conn);
        cmd.Parameters.AddWithValue("t", token);
        cmd.Parameters.AddWithValue("m", memberId);
        cmd.Parameters.AddWithValue("exp", expiresAt);

        await cmd.ExecuteNonQueryAsync(ct);
        return token;
    }

    /// <summary>
    /// Şifre sıfırlama token'ının geçerliliğini denetler ve ilişkili üyeyi döner.
    /// Süresi dolmuşsa veya daha önce kullanılmışsa null döner.
    /// </summary>
    public async Task<Member?> FindMemberByResetTokenAsync(string token, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(token)) return null;

        await using var conn = await OpenAsync(ct);
        await using var cmd = new NpgsqlCommand("""
            SELECT m.id, m.email, m.full_name, m.phone, m.customer_code, m.is_active
            FROM public.password_reset_tokens t
            JOIN public.members m ON m.id = t.member_id
            WHERE t.token = @t AND t.expires_at > now() AND t.used_at IS NULL AND m.is_active
            LIMIT 1
            """, conn);
        cmd.Parameters.AddWithValue("t", token.Trim());

        await using var reader = await cmd.ExecuteReaderAsync(ct);
        if (!await reader.ReadAsync(ct)) return null;

        return new Member
        {
            Id = reader.GetGuid(0),
            Email = reader.GetString(1),
            FullName = reader.GetString(2),
            Phone = reader.IsDBNull(3) ? null : reader.GetString(3),
            CustomerCode = reader.IsDBNull(4) ? null : reader.GetString(4),
            IsActive = reader.GetBoolean(5)
        };
    }

    /// <summary>
    /// Token ile şifre sıfırlar: token'ı used_at ile kapatır, yeni PBKDF2 hash'i yazar ve
    /// diğer bütün açık oturumları düşürür.
    /// </summary>
    public async Task<bool> ResetPasswordWithTokenAsync(string token, string newPassword, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(token)) return false;

        var member = await FindMemberByResetTokenAsync(token, ct);
        if (member is null) return false;

        await using var conn = await OpenAsync(ct);
        await using var tx = await conn.BeginTransactionAsync(ct);

        try
        {
            // 1. Token'ı kullanıldı olarak işaretle
            await using var markCmd = new NpgsqlCommand(
                "UPDATE public.password_reset_tokens SET used_at = now() WHERE token = @t AND used_at IS NULL", conn, tx);
            markCmd.Parameters.AddWithValue("t", token.Trim());
            var affected = await markCmd.ExecuteNonQueryAsync(ct);
            if (affected == 0)
            {
                await tx.RollbackAsync(ct);
                return false;
            }

            // 2. Yeni şifre hash'ini yaz
            await using var passCmd = new NpgsqlCommand(
                "UPDATE public.members SET password_hash = @h WHERE id = @id", conn, tx);
            passCmd.Parameters.AddWithValue("h", PasswordHasher.Hash(newPassword));
            passCmd.Parameters.AddWithValue("id", member.Id);
            await passCmd.ExecuteNonQueryAsync(ct);

            // 3. Bütün açık oturumları güvenlik için kapat
            await using var sessCmd = new NpgsqlCommand(
                "DELETE FROM public.member_sessions WHERE member_id = @id", conn, tx);
            sessCmd.Parameters.AddWithValue("id", member.Id);
            await sessCmd.ExecuteNonQueryAsync(ct);

            await tx.CommitAsync(ct);
            return true;
        }
        catch
        {
            await tx.RollbackAsync(ct);
            throw;
        }
    }

    /* ==========================================================================
       ADRES YÖNETİMİ (Kayıtlı Adresler)
       ========================================================================== */
    public async Task<IReadOnlyList<MemberAddressDto>> ListAddressesAsync(Guid memberId, CancellationToken ct)
    {
        await using var conn = await OpenAsync(ct);
        await using var cmd = new NpgsqlCommand("""
            SELECT id, title, full_name, phone, city, district, address, is_default, created_at
            FROM public.member_addresses
            WHERE member_id = @mid
            ORDER BY is_default DESC, created_at DESC
            """, conn);
        cmd.Parameters.AddWithValue("mid", memberId);

        var list = new List<MemberAddressDto>();
        await using var reader = await cmd.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct))
        {
            list.Add(new MemberAddressDto
            {
                Id = reader.GetGuid(0),
                Title = reader.GetString(1),
                FullName = reader.GetString(2),
                Phone = reader.GetString(3),
                City = reader.IsDBNull(4) ? null : reader.GetString(4),
                District = reader.IsDBNull(5) ? null : reader.GetString(5),
                Address = reader.GetString(6),
                IsDefault = reader.GetBoolean(7),
                CreatedAt = reader.GetFieldValue<DateTimeOffset>(8)
            });
        }
        return list;
    }

    public async Task<MemberAddressDto> CreateAddressAsync(
        Guid memberId, string title, string fullName, string phone, string? city, string? district, string address, bool isDefault, CancellationToken ct)
    {
        var id = Guid.NewGuid();
        await using var conn = await OpenAsync(ct);

        if (isDefault)
        {
            await using var clearCmd = new NpgsqlCommand("UPDATE public.member_addresses SET is_default = false WHERE member_id = @mid", conn);
            clearCmd.Parameters.AddWithValue("mid", memberId);
            await clearCmd.ExecuteNonQueryAsync(ct);
        }

        await using var cmd = new NpgsqlCommand("""
            INSERT INTO public.member_addresses (id, member_id, title, full_name, phone, city, district, address, is_default, created_at)
            VALUES (@id, @mid, @title, @name, @phone, @city, @district, @addr, @isDef, now())
            """, conn);

        cmd.Parameters.AddWithValue("id", id);
        cmd.Parameters.AddWithValue("mid", memberId);
        cmd.Parameters.AddWithValue("title", string.IsNullOrWhiteSpace(title) ? "Adresim" : title.Trim());
        cmd.Parameters.AddWithValue("name", fullName.Trim());
        cmd.Parameters.AddWithValue("phone", phone.Trim());
        cmd.Parameters.AddWithValue("city", (object?)city?.Trim() ?? DBNull.Value);
        cmd.Parameters.AddWithValue("district", (object?)district?.Trim() ?? DBNull.Value);
        cmd.Parameters.AddWithValue("addr", address.Trim());
        cmd.Parameters.AddWithValue("isDef", isDefault);

        await cmd.ExecuteNonQueryAsync(ct);

        return new MemberAddressDto
        {
            Id = id,
            Title = string.IsNullOrWhiteSpace(title) ? "Adresim" : title.Trim(),
            FullName = fullName.Trim(),
            Phone = phone.Trim(),
            City = city?.Trim(),
            District = district?.Trim(),
            Address = address.Trim(),
            IsDefault = isDefault,
            CreatedAt = DateTimeOffset.UtcNow
        };
    }

    public async Task<bool> UpdateAddressAsync(
        Guid memberId, Guid addressId, string title, string fullName, string phone, string? city, string? district, string address, bool isDefault, CancellationToken ct)
    {
        await using var conn = await OpenAsync(ct);

        if (isDefault)
        {
            await using var clearCmd = new NpgsqlCommand("UPDATE public.member_addresses SET is_default = false WHERE member_id = @mid", conn);
            clearCmd.Parameters.AddWithValue("mid", memberId);
            await clearCmd.ExecuteNonQueryAsync(ct);
        }

        await using var cmd = new NpgsqlCommand("""
            UPDATE public.member_addresses
            SET title = @title, full_name = @name, phone = @phone, city = @city, district = @district, address = @addr, is_default = @isDef
            WHERE id = @id AND member_id = @mid
            """, conn);

        cmd.Parameters.AddWithValue("id", addressId);
        cmd.Parameters.AddWithValue("mid", memberId);
        cmd.Parameters.AddWithValue("title", string.IsNullOrWhiteSpace(title) ? "Adresim" : title.Trim());
        cmd.Parameters.AddWithValue("name", fullName.Trim());
        cmd.Parameters.AddWithValue("phone", phone.Trim());
        cmd.Parameters.AddWithValue("city", (object?)city?.Trim() ?? DBNull.Value);
        cmd.Parameters.AddWithValue("district", (object?)district?.Trim() ?? DBNull.Value);
        cmd.Parameters.AddWithValue("addr", address.Trim());
        cmd.Parameters.AddWithValue("isDef", isDefault);

        var rows = await cmd.ExecuteNonQueryAsync(ct);
        return rows > 0;
    }

    public async Task<bool> DeleteAddressAsync(Guid memberId, Guid addressId, CancellationToken ct)
    {
        await using var conn = await OpenAsync(ct);
        await using var cmd = new NpgsqlCommand("DELETE FROM public.member_addresses WHERE id = @id AND member_id = @mid", conn);
        cmd.Parameters.AddWithValue("id", addressId);
        cmd.Parameters.AddWithValue("mid", memberId);
        var rows = await cmd.ExecuteNonQueryAsync(ct);
        return rows > 0;
    }

    /// <summary>Başarılıysa varsayılan yapılan adresi döner — çağıran bunu ERP cari kartına eşitler.</summary>
    public async Task<MemberAddressDto?> SetDefaultAddressAsync(Guid memberId, Guid addressId, CancellationToken ct)
    {
        await using var conn = await OpenAsync(ct);
        await using var clearCmd = new NpgsqlCommand("UPDATE public.member_addresses SET is_default = false WHERE member_id = @mid", conn);
        clearCmd.Parameters.AddWithValue("mid", memberId);
        await clearCmd.ExecuteNonQueryAsync(ct);

        await using var cmd = new NpgsqlCommand("""
            UPDATE public.member_addresses SET is_default = true
            WHERE id = @id AND member_id = @mid
            RETURNING id, title, full_name, phone, city, district, address, is_default, created_at
            """, conn);
        cmd.Parameters.AddWithValue("id", addressId);
        cmd.Parameters.AddWithValue("mid", memberId);

        await using var reader = await cmd.ExecuteReaderAsync(ct);
        if (!await reader.ReadAsync(ct)) return null;

        return new MemberAddressDto
        {
            Id = reader.GetGuid(0),
            Title = reader.GetString(1),
            FullName = reader.GetString(2),
            Phone = reader.GetString(3),
            City = reader.IsDBNull(4) ? null : reader.GetString(4),
            District = reader.IsDBNull(5) ? null : reader.GetString(5),
            Address = reader.GetString(6),
            IsDefault = reader.GetBoolean(7),
            CreatedAt = reader.GetFieldValue<DateTimeOffset>(8)
        };
    }
}

public sealed class MemberAddressDto
{
    public Guid Id { get; init; }
    public string Title { get; init; } = string.Empty;
    public string FullName { get; init; } = string.Empty;
    public string Phone { get; init; } = string.Empty;
    public string? City { get; init; }
    public string? District { get; init; }
    public string Address { get; init; } = string.Empty;
    public bool IsDefault { get; init; }
    public DateTimeOffset CreatedAt { get; init; }
}

