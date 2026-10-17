using System.Collections.Concurrent;
using Npgsql;

namespace Asistan.Api.Infrastructure;

/// <summary>
/// Asistan programına GİRİŞ yetkisi — KULLANICI BAZINDA (2026-10-08, kullanıcı kararı: "rol
/// yetkisi değil; B2B Kullanıcılar sayfasında Servise giriş gibi açılsın").
///
/// Kural ERP'deki ServiceOpsAccess ile aynı: SSA, ya da B2B'de süper yönetici rolündeki kullanıcı,
/// ya da Kullanıcılar → "Asistan (WhatsApp)" kutusu işaretli aktif kullanıcı (Users.AsistanAccess).
///
/// Hem girişte hem HER istekte bakılır (1 dk önbellek): kutu kaldırılınca açık oturum da kapanır.
/// Okunamazsa çağıran KAPALI başarısız olur (503) — müşteri yazışmaları belirsizlikte açılmaz.
/// </summary>
public sealed class PageAccess
{
    /// <summary>ERP Users kolonunun adı; SettingsController'daki sorgu da bunu kullanır.</summary>
    public const string UserColumn = "AsistanAccess";

    private static readonly ConcurrentDictionary<string, (bool Allowed, DateTime At)> Cache = new();
    private static readonly TimeSpan CacheTtl = TimeSpan.FromMinutes(1);

    private readonly TenantDb _db;

    public PageAccess(TenantDb db)
    {
        _db = db;
    }

    public async Task<bool> IsAllowedAsync(string tenant, bool isSsa, string userName, CancellationToken ct)
    {
        if (isSsa) return true;
        var key = (userName ?? string.Empty).Trim().ToLowerInvariant();
        if (key.Length == 0) return false;

        var cacheKey = tenant + ":" + key;
        if (Cache.TryGetValue(cacheKey, out var hit) && DateTime.UtcNow - hit.At < CacheTtl) return hit.Allowed;

        await using var conn = new NpgsqlConnection(_db.ErpConnectionString(tenant));
        await conn.OpenAsync(ct);
        await using var cmd = new NpgsqlCommand($"""
            SELECT EXISTS (
              SELECT 1 FROM public."Users" u
              LEFT JOIN public."Roles" r ON r."Id" = u."RoleId"
              WHERE lower(u."Username") = @u AND u."IsActive" = true
                AND (u."{UserColumn}" = true OR COALESCE(r."IsSuperAdmin", false)))
            """, conn);
        cmd.Parameters.AddWithValue("u", key);
        var allowed = await cmd.ExecuteScalarAsync(ct) is true;

        Cache[cacheKey] = (allowed, DateTime.UtcNow);
        return allowed;
    }
}
