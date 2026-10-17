using System.Collections.Concurrent;
using Npgsql;

namespace ServiceOps.Api.Services;

/// <summary>
/// B2B ile ORTAK oturum kaydı — bkz. B2B.Erp.Api/Core/Sessions/SharedSessionStore.cs.
///
/// Aynı satır iki uygulama tarafından da okunup yazılır. Satır firmanın B2B veritabanındadır:
/// oturum süresini yöneten JwtSessionSettings zaten oradadır ve bu API o veritabanına zaten
/// bağlanıyor (sayfa yetkilerini oradan okuyor).
///
/// Sonuç:
///   - Servis token'ının bitişi bayideki ayara göre belirlenir (8 saatlik sabit süre kalktı),
///   - iki taraftaki bitiş AYNI andır: birinde süre dolarsa diğerinde de dolar,
///   - birinden çıkış diğerini de düşürür,
///   - birinde "Uzat" demek diğerinin de süresini uzatır.
///
/// Teknisyenler bayi programına hiç girmez; onlar için bu kayıt "servis oturumu"nun kendisidir ve
/// süreyi yine bayideki ayardan alır.
/// </summary>
public sealed class SharedSessionState
{
    public DateTime ExpiresAtUtc { get; init; }
    public DateTime? RevokedAtUtc { get; init; }
    public int DurationMinutes { get; init; }
    public int AlertBeforeMinutes { get; init; }

    public bool IsAlive => RevokedAtUtc is null && ExpiresAtUtc > DateTime.UtcNow;
}

public interface ISharedSessionStore
{
    Task<SharedSessionState> StartAsync(string tenantCode, string username, DateTime? expiresAtUtc = null, CancellationToken cancellationToken = default);
    Task<SharedSessionState> AdoptOrStartAsync(string tenantCode, string username, CancellationToken cancellationToken = default);
    Task<SharedSessionState?> GetAsync(string tenantCode, string username, CancellationToken cancellationToken = default);
    Task<SharedSessionState?> ExtendAsync(string tenantCode, string username, CancellationToken cancellationToken = default);
    Task RevokeAsync(string tenantCode, string username, CancellationToken cancellationToken = default);
    Task<(int DurationMinutes, int AlertBeforeMinutes)> GetSettingsAsync(string tenantCode, CancellationToken cancellationToken = default);
}

public sealed class SharedSessionStore : ISharedSessionStore
{
    public const int DefaultDurationMinutes = 60;
    public const int DefaultAlertBeforeMinutes = 3;
    private const int MaxDurationMinutes = 24 * 60;

    private readonly IConfiguration _configuration;

    /// <summary>Firma kodu → B2B veritabanı bağlantısı. Her istekte master'a sormamak için.</summary>
    private static readonly ConcurrentDictionary<string, string> ConnectionCache = new(StringComparer.OrdinalIgnoreCase);

    public SharedSessionStore(IConfiguration configuration)
    {
        _configuration = configuration;
    }

    public static string NormalizeKey(string? username) => (username ?? string.Empty).Trim().ToLowerInvariant();

    public async Task<SharedSessionState> StartAsync(string tenantCode, string username, DateTime? expiresAtUtc = null, CancellationToken cancellationToken = default)
    {
        var (duration, alert) = await GetSettingsAsync(tenantCode, cancellationToken);
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

    public async Task<SharedSessionState> AdoptOrStartAsync(string tenantCode, string username, CancellationToken cancellationToken = default)
    {
        var existing = await GetAsync(tenantCode, username, cancellationToken);
        if (existing is not null && existing.IsAlive) return existing;
        return await StartAsync(tenantCode, username, null, cancellationToken);
    }

    public async Task<SharedSessionState?> GetAsync(string tenantCode, string username, CancellationToken cancellationToken = default)
    {
        var (duration, alert) = await GetSettingsAsync(tenantCode, cancellationToken);

        await using var conn = await OpenAsync(tenantCode, cancellationToken);
        await EnsureTableAsync(conn, cancellationToken);

        await using var cmd = conn.CreateCommand();
        cmd.CommandText = @"SELECT ""ExpiresAtUtc"", ""RevokedAtUtc"" FROM public.""SharedSessions"" WHERE ""UserKey"" = @key LIMIT 1;";
        cmd.Parameters.AddWithValue("key", NormalizeKey(username));

        await using var reader = await cmd.ExecuteReaderAsync(cancellationToken);
        if (!await reader.ReadAsync(cancellationToken)) return null;

        return new SharedSessionState
        {
            ExpiresAtUtc = Normalize(reader.GetDateTime(0)),
            RevokedAtUtc = reader.IsDBNull(1) ? null : Normalize(reader.GetDateTime(1)),
            DurationMinutes = duration,
            AlertBeforeMinutes = alert
        };
    }

    public async Task<SharedSessionState?> ExtendAsync(string tenantCode, string username, CancellationToken cancellationToken = default)
    {
        var current = await GetAsync(tenantCode, username, cancellationToken);
        if (current is not null && current.RevokedAtUtc is not null)
        {
            // Diğer taraftan kapatılmış oturum uzatılmaz.
            return null;
        }

        var (duration, _) = await GetSettingsAsync(tenantCode, cancellationToken);
        var now = DateTime.UtcNow;

        var baseUtc = current is not null && current.ExpiresAtUtc > now ? current.ExpiresAtUtc : now;
        var expiry = baseUtc.AddMinutes(duration);
        var cap = now.AddMinutes(MaxDurationMinutes);

        // Tavan yalnızca oturumu UZATIRKEN geçerlidir; hâlihazırda daha uzun olan bir oturumu
        // KISALTMAZ. Teknisyen oturumları bilerek uzak bir tarihe kuruluyor (bkz. AuthController
        // ResolveSessionExpiryAsync / neverExpires) ve buradaki kırpma onları 24 saate düşürüp
        // sahadaki telefonu bir gün sonra yeniden dışarı atardı.
        if (expiry > cap) expiry = baseUtc > cap ? baseUtc : cap;

        return await StartAsync(tenantCode, username, expiry, cancellationToken);
    }

    public async Task RevokeAsync(string tenantCode, string username, CancellationToken cancellationToken = default)
    {
        var now = DateTime.UtcNow;

        await using var conn = await OpenAsync(tenantCode, cancellationToken);
        await EnsureTableAsync(conn, cancellationToken);

        await using var cmd = conn.CreateCommand();
        cmd.CommandText = @"
INSERT INTO public.""SharedSessions"" (""UserKey"", ""ExpiresAtUtc"", ""RevokedAtUtc"", ""UpdatedAtUtc"")
VALUES (@key, @now, @now, @now)
ON CONFLICT (""UserKey"") DO UPDATE
SET ""ExpiresAtUtc"" = @now,
    ""RevokedAtUtc"" = @now,
    ""UpdatedAtUtc"" = @now;";
        cmd.Parameters.AddWithValue("key", NormalizeKey(username));
        cmd.Parameters.AddWithValue("now", NpgsqlTypes.NpgsqlDbType.TimestampTz, now);
        await cmd.ExecuteNonQueryAsync(cancellationToken);
    }

    /// <summary>
    /// Süre ve uyarı ayarı TEK kaynaktan gelir: bayideki "JWT Süre Yönetimi" ekranı. Servis
    /// tarafında ayrı bir süre ayarı YOKTUR.
    /// </summary>
    public async Task<(int DurationMinutes, int AlertBeforeMinutes)> GetSettingsAsync(string tenantCode, CancellationToken cancellationToken = default)
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
        catch (Exception ex)
        {
            Console.WriteLine($"[SHARED_SESSION] settings read failed for '{tenantCode}': {ex.Message}");
        }

        return (DefaultDurationMinutes, DefaultAlertBeforeMinutes);
    }

    private async Task<NpgsqlConnection> OpenAsync(string tenantCode, CancellationToken cancellationToken)
    {
        var conn = new NpgsqlConnection(ResolveB2BConnectionString(tenantCode));
        await conn.OpenAsync(cancellationToken);
        return conn;
    }

    private string ResolveB2BConnectionString(string tenantCode)
    {
        var code = (tenantCode ?? string.Empty).Trim();
        if (string.IsNullOrWhiteSpace(code))
        {
            throw new InvalidOperationException("Ortak oturum için firma kodu gerekli.");
        }

        return ConnectionCache.GetOrAdd(code, key =>
        {
            var baseConn = _configuration.GetConnectionString("DefaultConnection")
                           ?? _configuration.GetConnectionString("ServiceOpsBase")
                           ?? "Host=localhost;Port=5434;Database=serviceops_dev;Username=b2b;Password=b2b";

            var masterConn = new NpgsqlConnectionStringBuilder(baseConn) { Database = "b2b_erp_master" }.ConnectionString;

            string? dbName = null;
            using (var conn = new NpgsqlConnection(masterConn))
            {
                conn.Open();
                using var cmd = new NpgsqlCommand("SELECT \"DbName\" FROM public.\"Tenants\" WHERE LOWER(\"Code\") = @code LIMIT 1", conn);
                cmd.Parameters.AddWithValue("code", key.ToLowerInvariant());
                dbName = cmd.ExecuteScalar() as string;
            }

            // B2B'nin TenantConnectionStringResolver'ı ile AYNI varsayılan. İkisi farklı olursa
            // iki uygulama farklı veritabanlarındaki iki ayrı satıra bakar ve ortak oturum
            // sessizce çalışmaz.
            if (string.IsNullOrWhiteSpace(dbName)) dbName = $"b2b_erp_tenant_{key.Trim().ToUpperInvariant()}";

            return new NpgsqlConnectionStringBuilder(baseConn) { Database = dbName }.ConnectionString;
        });
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
);";
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
