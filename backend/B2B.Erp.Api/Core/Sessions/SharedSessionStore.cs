using B2B.Erp.Api.Data;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using System.Collections.Concurrent;

namespace B2B.Erp.Api.Core.Sessions;

/// <summary>
/// Bir kullanıcının oturumunun TEK kaydı — B2B ve ServiceOps için ortak.
///
/// Süre, uyarı zamanı ve "bu oturum kapatıldı mı" bilgisi tek bir satırda tutulur ve iki uygulama
/// da aynı satırı okur/yazar. Böylece:
///   - iki taraftaki token'ın bitiş anı AYNI olur (birinde süre dolarsa diğerinde de dolar),
///   - birinden çıkış yapmak diğerini de düşürür (RevokedAtUtc),
///   - birinde "Uzat" demek diğerinin de süresini uzatır.
///
/// Satır, firmanın B2B veritabanında durur: JwtSessionSettings zaten oradadır (süreyi yöneten tek
/// kaynak) ve ServiceOps API'si o veritabanına zaten erişiyor (yetkileri oradan okuyor).
/// </summary>
/// <summary>Açık bir oturumun tek satırı — ekrandaki liste bunu gösterir.</summary>
public sealed class ActiveSessionRow
{
    /// <summary>Oturum anahtarı = kullanıcı adının küçük harfli hâli.</summary>
    public string UserKey { get; set; } = string.Empty;

    public DateTime ExpiresAtUtc { get; set; }

    /// <summary>Son hareket: giriş ya da son uzatma zamanı.</summary>
    public DateTime UpdatedAtUtc { get; set; }
}

public sealed class SharedSessionState
{
    public DateTime ExpiresAtUtc { get; init; }
    public DateTime? RevokedAtUtc { get; init; }
    public int DurationMinutes { get; init; }
    public int AlertBeforeMinutes { get; init; }

    /// <summary>
    /// Zamanlanmış toplu kapatma anı. Doluysa oturum o an gelince kapanır; istemci bu tarihi
    /// yoklamada görüp geri sayımlı uyarı gösterir. <c>null</c> = planlanmış kapatma yok.
    /// </summary>
    public DateTime? RevokeAtUtc { get; init; }

    /// <summary>Planlanmış kapatma vakti geldi mi (gelmişse oturum artık yaşamıyor).</summary>
    public bool ScheduledRevokeElapsed => RevokeAtUtc is not null && RevokeAtUtc.Value <= DateTime.UtcNow;

    public bool IsAlive => RevokedAtUtc is null && !ScheduledRevokeElapsed && ExpiresAtUtc > DateTime.UtcNow;
}

public interface ISharedSessionStore
{
    /// <summary>Şifreyle yapılan gerçek bir girişte çağrılır: sayaç sıfırdan başlar.</summary>
    Task<SharedSessionState> StartAsync(string? tenantCode, string username, DateTime? expiresAtUtc = null, CancellationToken cancellationToken = default);

    /// <summary>Devirde (SSO) çağrılır: açık bir oturum varsa BİTİŞİ ONDAN alınır, yoksa yenisi açılır.</summary>
    Task<SharedSessionState> AdoptOrStartAsync(string? tenantCode, string username, CancellationToken cancellationToken = default);

    Task<SharedSessionState?> GetAsync(string? tenantCode, string username, CancellationToken cancellationToken = default);

    /// <summary>Ortak bitişi uzatır. Kapatılmış bir oturum uzatılmaz (null döner).</summary>
    Task<SharedSessionState?> ExtendAsync(string? tenantCode, string username, CancellationToken cancellationToken = default);

    Task RevokeAsync(string? tenantCode, string username, CancellationToken cancellationToken = default);

    /// <summary>
    /// Açık TÜM oturumları ileri bir an için kapanmaya damgalar (işlemi yapan hariç).
    /// Kaç oturumun damgalandığını döner.
    /// </summary>
    Task<int> ScheduleRevokeAllAsync(string? tenantCode, string? exceptUsername, DateTime revokeAtUtc, CancellationToken cancellationToken = default);

    Task<(int DurationMinutes, int AlertBeforeMinutes)> GetSettingsAsync(string? tenantCode, CancellationToken cancellationToken = default);

    /// <summary>
    /// Şu an AÇIK olan oturumlar (2026-08-30 kullanıcı isteği: "programda kimler aktifse
    /// görelim").
    ///
    /// Açık sayılma ölçütü: kapatılmamış (<c>RevokedAtUtc</c> boş) VE süresi dolmamış.
    /// Süresi geçmiş satırlar tabloda kalır — silinmezler, çünkü aynı kullanıcı tekrar
    /// girdiğinde satır güncellenir. Bu yüzden listeleme zamanı da süzmek zorunda.
    /// </summary>
    Task<IReadOnlyList<ActiveSessionRow>> ListActiveAsync(string? tenantCode, CancellationToken cancellationToken = default);
}

public sealed class SharedSessionStore : ISharedSessionStore
{
    public const int DefaultDurationMinutes = 60;
    public const int DefaultAlertBeforeMinutes = 3;
    private const int MaxDurationMinutes = 24 * 60;

    private readonly IConfiguration _configuration;
    private readonly MasterDbContext _masterDbContext;

    /// <summary>Firma kodu → veritabanı adı. Her istekte master'a sormamak için.</summary>
    private static readonly ConcurrentDictionary<string, string> TenantDbNames = new(StringComparer.OrdinalIgnoreCase);

    public SharedSessionStore(IConfiguration configuration, MasterDbContext masterDbContext)
    {
        _configuration = configuration;
        _masterDbContext = masterDbContext;
    }

    public static string NormalizeKey(string? username) => (username ?? string.Empty).Trim().ToLowerInvariant();

    public async Task<SharedSessionState> StartAsync(string? tenantCode, string username, DateTime? expiresAtUtc = null, CancellationToken cancellationToken = default)
    {
        var (duration, alert) = await GetSettingsAsync(tenantCode, cancellationToken);

        // Girişte üretilen token'ın GERÇEK bitişi verilir; verilmezse ayardan hesaplanır. İkisi
        // ayrı ayrı hesaplanırsa saniyeler kayar ve istemci her yoklamada token yenilenmesi
        // gerektiğini sanır.
        var expiry = Normalize(expiresAtUtc ?? DateTime.UtcNow.AddMinutes(duration));

        await using var conn = await OpenAsync(tenantCode, cancellationToken);
        await EnsureTableAsync(conn, cancellationToken);

        await using var cmd = conn.CreateCommand();
        cmd.CommandText = @"
INSERT INTO public.""SharedSessions"" (""UserKey"", ""ExpiresAtUtc"", ""RevokedAtUtc"", ""UpdatedAtUtc"")
VALUES (@key, @expires, NULL, @now)
ON CONFLICT (""UserKey"") DO UPDATE
SET ""ExpiresAtUtc"" = EXCLUDED.""ExpiresAtUtc"",
    ""RevokedAtUtc"" = NULL,
    -- Yeniden giriş, planlanmış kapatmayı da siler; yoksa kullanıcı girer girmez tekrar atılır.
    ""RevokeAtUtc"" = NULL,
    ""UpdatedAtUtc"" = EXCLUDED.""UpdatedAtUtc"";";
        cmd.Parameters.AddWithValue("key", NormalizeKey(username));
        cmd.Parameters.AddWithValue("expires", NpgsqlTypes.NpgsqlDbType.TimestampTz, expiry);
        cmd.Parameters.AddWithValue("now", NpgsqlTypes.NpgsqlDbType.TimestampTz, DateTime.UtcNow);
        await cmd.ExecuteNonQueryAsync(cancellationToken);

        return new SharedSessionState
        {
            ExpiresAtUtc = expiry,
            RevokedAtUtc = null,
            DurationMinutes = duration,
            AlertBeforeMinutes = alert
        };
    }

    public async Task<SharedSessionState> AdoptOrStartAsync(string? tenantCode, string username, CancellationToken cancellationToken = default)
    {
        var existing = await GetAsync(tenantCode, username, cancellationToken);
        if (existing is not null && existing.IsAlive) return existing;
        return await StartAsync(tenantCode, username, null, cancellationToken);
    }

    public async Task<SharedSessionState?> GetAsync(string? tenantCode, string username, CancellationToken cancellationToken = default)
    {
        var (duration, alert) = await GetSettingsAsync(tenantCode, cancellationToken);

        await using var conn = await OpenAsync(tenantCode, cancellationToken);
        await EnsureTableAsync(conn, cancellationToken);

        await using var cmd = conn.CreateCommand();
        cmd.CommandText = @"SELECT ""ExpiresAtUtc"", ""RevokedAtUtc"", ""RevokeAtUtc"" FROM public.""SharedSessions"" WHERE ""UserKey"" = @key LIMIT 1;";
        cmd.Parameters.AddWithValue("key", NormalizeKey(username));

        await using var reader = await cmd.ExecuteReaderAsync(cancellationToken);
        if (!await reader.ReadAsync(cancellationToken)) return null;

        return new SharedSessionState
        {
            ExpiresAtUtc = Normalize(reader.GetDateTime(0)),
            RevokedAtUtc = reader.IsDBNull(1) ? null : Normalize(reader.GetDateTime(1)),
            RevokeAtUtc = reader.IsDBNull(2) ? null : Normalize(reader.GetDateTime(2)),
            DurationMinutes = duration,
            AlertBeforeMinutes = alert
        };
    }

    public async Task<SharedSessionState?> ExtendAsync(string? tenantCode, string username, CancellationToken cancellationToken = default)
    {
        var current = await GetAsync(tenantCode, username, cancellationToken);
        if (current is not null && current.RevokedAtUtc is not null)
        {
            // Kapatılmış oturum uzatılmaz: aksi halde diğer taraftan "Çıkış" demek hiçbir işe
            // yaramaz, kalan sekme oturumu kendi kendine diriltirdi.
            return null;
        }

        var (duration, _) = await GetSettingsAsync(tenantCode, cancellationToken);
        var now = DateTime.UtcNow;

        // B2B'deki davranış korunuyor: uzatma, kalan sürenin ÜSTÜNE eklenir (bitişten itibaren),
        // toplam 24 saati aşmaz.
        var baseUtc = current is not null && current.ExpiresAtUtc > now ? current.ExpiresAtUtc : now;
        var expiry = baseUtc.AddMinutes(duration);
        var cap = now.AddMinutes(MaxDurationMinutes);
        if (expiry > cap) expiry = cap;

        return await StartAsync(tenantCode, username, expiry, cancellationToken);
    }

    public async Task RevokeAsync(string? tenantCode, string username, CancellationToken cancellationToken = default)
    {
        var now = DateTime.UtcNow;

        await using var conn = await OpenAsync(tenantCode, cancellationToken);
        await EnsureTableAsync(conn, cancellationToken);

        await using var cmd = conn.CreateCommand();
        // Satır yoksa da yazılır: ServiceOps tarafından açılmış ama bu tarafta henüz görülmemiş
        // bir oturumun çıkışı da kayda geçmeli.
        cmd.CommandText = @"
INSERT INTO public.""SharedSessions"" (""UserKey"", ""ExpiresAtUtc"", ""RevokedAtUtc"", ""UpdatedAtUtc"")
VALUES (@key, @now, @now, @now)
ON CONFLICT (""UserKey"") DO UPDATE
SET ""ExpiresAtUtc"" = @now,
    ""RevokedAtUtc"" = @now,
    ""RevokeAtUtc"" = NULL,
    ""UpdatedAtUtc"" = @now;";
        cmd.Parameters.AddWithValue("key", NormalizeKey(username));
        cmd.Parameters.AddWithValue("now", NpgsqlTypes.NpgsqlDbType.TimestampTz, now);
        await cmd.ExecuteNonQueryAsync(cancellationToken);
    }

    /// <summary>
    /// HERKESİ DÜŞÜR — ama hemen değil, <paramref name="revokeAtUtc"/> anında (2026-09-05).
    ///
    /// Neden gecikmeli: istemci oturum durumunu 20 saniyede bir yokluyor. Anında kapatılsaydı
    /// kullanıcı ne olduğunu anlamadan bir sonraki isteğinde giriş ekranında bulurdu. Damga
    /// ileri bir ana atıldığı için istemci önce uyarıyı görüp geri sayımı gösterebiliyor.
    ///
    /// İşlemi yapan kişi HARİÇ tutulur: kendini de düşürüp ayarlar ekranından atılmak kaza olur
    /// (tekil düşürmede de aynı kural var).
    ///
    /// Yalnız GERÇEKTEN AÇIK oturumlar damgalanır; kapanmış/süresi dolmuş satırlara dokunmak
    /// onları yeniden "kapanacak" gibi göstermekten başka işe yaramaz.
    /// </summary>
    public async Task<int> ScheduleRevokeAllAsync(
        string? tenantCode,
        string? exceptUsername,
        DateTime revokeAtUtc,
        CancellationToken cancellationToken = default)
    {
        var haric = NormalizeKey(exceptUsername);
        var an = Normalize(revokeAtUtc);

        await using var conn = await OpenAsync(tenantCode, cancellationToken);
        await EnsureTableAsync(conn, cancellationToken);

        await using var cmd = conn.CreateCommand();
        cmd.CommandText = @"
UPDATE public.""SharedSessions""
SET ""RevokeAtUtc"" = @at,
    ""UpdatedAtUtc"" = @now
WHERE ""RevokedAtUtc"" IS NULL
  AND ""ExpiresAtUtc"" > now()
  AND (@haric = '' OR ""UserKey"" <> @haric)
  AND (""RevokeAtUtc"" IS NULL OR ""RevokeAtUtc"" > @at);";
        cmd.Parameters.AddWithValue("at", NpgsqlTypes.NpgsqlDbType.TimestampTz, an);
        cmd.Parameters.AddWithValue("now", NpgsqlTypes.NpgsqlDbType.TimestampTz, DateTime.UtcNow);
        cmd.Parameters.AddWithValue("haric", haric);

        return await cmd.ExecuteNonQueryAsync(cancellationToken);
    }

    public async Task<(int DurationMinutes, int AlertBeforeMinutes)> GetSettingsAsync(string? tenantCode, CancellationToken cancellationToken = default)
    {
        try
        {
            await using var conn = await OpenAsync(tenantCode, cancellationToken);
            await using var cmd = conn.CreateCommand();
            cmd.CommandText = @"SELECT ""AccessTokenExpirationMinutes"", ""AlertBeforeMinutes"" FROM public.""JwtSessionSettings"" ORDER BY ""Id"" LIMIT 1;";
            await using var reader = await cmd.ExecuteReaderAsync(cancellationToken);
            if (await reader.ReadAsync(cancellationToken))
            {
                var duration = Math.Max(1, Math.Min(MaxDurationMinutes, reader.GetInt32(0)));
                var alert = Math.Max(0, Math.Min(duration - 1, reader.GetInt32(1)));
                return (duration, alert);
            }
        }
        catch
        {
            // Tablo henüz yoksa (ayar ekranı hiç açılmamışsa) varsayılana düşülür.
        }

        return (DefaultDurationMinutes, DefaultAlertBeforeMinutes);
    }

    private async Task<NpgsqlConnection> OpenAsync(string? tenantCode, CancellationToken cancellationToken)
    {
        var conn = new NpgsqlConnection(ResolveConnectionString(tenantCode));
        await conn.OpenAsync(cancellationToken);
        return conn;
    }

    /// <summary>
    /// Firma veritabanı, ambient DbContext'e DEĞİL, master'daki Tenants.DbName'e göre çözülür.
    ///
    /// Sebep: giriş isteği X-Tenant-Code başlığını taşımıyor, dolayısıyla o istekte AppDbContext
    /// varsayılan veritabanına bağlanıyor. Ortak oturum satırı oraya yazılsaydı, girişten sonraki
    /// (başlığı taşıyan) istekler onu bulamazdı — ve ServiceOps de bulamazdı. İki uygulamanın
    /// AYNI satırı görmesi bu çözümün doğru olmasına bağlı.
    /// </summary>
    private string ResolveConnectionString(string? tenantCode)
    {
        var baseConn = _configuration.GetConnectionString("DefaultConnection") ?? string.Empty;
        var code = (tenantCode ?? string.Empty).Trim().ToUpperInvariant();

        // Firmasız oturum (süper süper admin girişi) ortak deftere yazılmaz; varsayılan veritabanı
        // kullanılır ve pratikte karşılığı olan bir ServiceOps oturumu da yoktur.
        if (string.IsNullOrWhiteSpace(code) || string.IsNullOrWhiteSpace(baseConn)) return baseConn;

        if (!TenantDbNames.TryGetValue(code, out var dbName))
        {
            dbName = _masterDbContext.Tenants
                .AsNoTracking()
                .Where(x => x.Code == code)
                .Select(x => x.DbName)
                .FirstOrDefault();

            // TenantConnectionStringResolver ile AYNI varsayılan: ikisi farklı olursa bu uygulama
            // oturumu bir veritabanına, geri kalan her şey başkasına bakar.
            if (string.IsNullOrWhiteSpace(dbName)) dbName = $"b2b_erp_tenant_{code}";

            TenantDbNames[code] = dbName;
        }

        return new NpgsqlConnectionStringBuilder(baseConn) { Database = dbName }.ConnectionString;
    }

    public async Task<IReadOnlyList<ActiveSessionRow>> ListActiveAsync(string? tenantCode, CancellationToken cancellationToken = default)
    {
        var sonuc = new List<ActiveSessionRow>();

        // Diğer metotlarla AYNI bağlantı yolu: firmanın B2B veritabanı, ambient DbContext
        // değil (giriş isteği X-Tenant-Code taşımadığı için o varsayılana bağlanır).
        await using var conn = await OpenAsync(tenantCode, cancellationToken);
        await EnsureTableAsync(conn, cancellationToken);

        await using var cmd = conn.CreateCommand();
        // Süresi dolmuş satırlar tabloda KALIR (aynı kullanıcı tekrar girince güncellenir),
        // bu yüzden zaman süzgeci şart; yoksa çıkmış kullanıcılar da "aktif" görünür.
        cmd.CommandText = @"
SELECT ""UserKey"", ""ExpiresAtUtc"", ""UpdatedAtUtc""
FROM public.""SharedSessions""
WHERE ""RevokedAtUtc"" IS NULL
  AND ""ExpiresAtUtc"" > now()
  -- Vakti gelmiş planlı kapatma da oturumu bitirir; liste onları ""aktif"" göstermemeli.
  AND (""RevokeAtUtc"" IS NULL OR ""RevokeAtUtc"" > now())
ORDER BY ""UpdatedAtUtc"" DESC;";

        await using var reader = await cmd.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            sonuc.Add(new ActiveSessionRow
            {
                UserKey = reader.GetString(0),
                ExpiresAtUtc = Normalize(reader.GetDateTime(1)),
                UpdatedAtUtc = Normalize(reader.GetDateTime(2))
            });
        }

        return sonuc;
    }

    private static async Task EnsureTableAsync(NpgsqlConnection conn, CancellationToken cancellationToken)
    {
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = @"
CREATE TABLE IF NOT EXISTS public.""SharedSessions"" (
  ""UserKey"" text NOT NULL,
  ""ExpiresAtUtc"" timestamp with time zone NOT NULL,
  ""RevokedAtUtc"" timestamp with time zone NULL,
  ""UpdatedAtUtc"" timestamp with time zone NOT NULL,
  CONSTRAINT ""PK_SharedSessions"" PRIMARY KEY (""UserKey"")
);
-- ZAMANLANMIŞ KAPATMA (2026-09-05): ""herkesi düşür"" anında atmaz, bir süre sonrası için
-- damgalar. İstemci yoklamada bunu görüp geri sayımlı uyarı gösterir; kullanıcı ekranın
-- ortasında habersiz kalmaz. Tablo bu sınıfın kendi eseri olduğu için kolon da burada açılır.
ALTER TABLE public.""SharedSessions"" ADD COLUMN IF NOT EXISTS ""RevokeAtUtc"" timestamp with time zone NULL;";
        await cmd.ExecuteNonQueryAsync(cancellationToken);
    }

    private static DateTime Normalize(DateTime value)
        => value.Kind switch
        {
            DateTimeKind.Utc => value,
            DateTimeKind.Local => value.ToUniversalTime(),
            _ => DateTime.SpecifyKind(value, DateTimeKind.Utc)
        };
}
