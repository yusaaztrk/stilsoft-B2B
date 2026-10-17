using System.Collections.Concurrent;
using Asistan.Api.Infrastructure;
using Npgsql;

namespace Asistan.Api.Messaging;

/// <summary>Bir personelin gelen kutusundaki kapsamı.</summary>
public sealed record AgentScope(
    string UserName,
    bool IsAdmin,
    bool CanSeeAll,
    IReadOnlyList<int> DepartmentIds)
{
    /// <summary>Konuşmayı görebilir/cevaplayabilir mi? Atanmamış (birimsiz) konuşma yalnız "hepsini gör"e açık.</summary>
    public bool CanAccess(int? departmentId) =>
        CanSeeAll || (departmentId is int d && DepartmentIds.Contains(d));
}

/// <summary>
/// GELEN KUTUSU YETKİSİ (2026-10-08).
///
/// Programa GİRİŞ yetkisi ayrı (B2B Kullanıcılar → "Asistan (WhatsApp)", bkz. PageAccess). Girdikten sonra
/// kimin NEYİ gördüğü buradan:
///  - Yönetici: SSA, B2B'de IsSuperAdmin rolündekiler, ya da Ayarlar'da "yönetici" işaretlenen.
///    Ayarlar sayfasını yönetir ve her şeyi görür.
///  - Hepsini gör: bütün konuşmalar + atanmamış kuyruk.
///  - Diğerleri: yalnız üyesi olduğu birimlerin konuşmaları.
///
/// Kapsam her istekte istemciden DEĞİL veritabanından çözülür; liste süzgeci kapı sayılmaz —
/// tek konuşma uçları da aynı kurala bakar (bkz. B2B teklif yetki açığı dersi).
/// </summary>
public sealed class InboxAccess
{
    private readonly TenantDb _db;
    private readonly AsistanSchema _schema;
    private static readonly ConcurrentDictionary<string, (bool IsSuper, DateTime At)> SuperRoleCache = new();

    public InboxAccess(TenantDb db, AsistanSchema schema)
    {
        _db = db;
        _schema = schema;
    }

    public static string Key(string userName) => (userName ?? string.Empty).Trim().ToLowerInvariant();

    public async Task<AgentScope> ResolveAsync(PanelUser user, CancellationToken ct)
    {
        await _schema.EnsureAsync(user.TenantCode, ct);
        var key = Key(user.UserName);

        var isSuperRole = user.IsSsa || (user.RoleId is int r && await IsSuperAdminRoleAsync(user.TenantCode, r, ct));

        await using var conn = new NpgsqlConnection(_db.AsistanConnectionString(user.TenantCode));
        await conn.OpenAsync(ct);

        bool agentAdmin = false, agentSeeAll = false, agentActive = true;
        await using (var cmd = new NpgsqlCommand("SELECT is_admin, can_see_all, is_active FROM public.agents WHERE user_name = @u", conn))
        {
            cmd.Parameters.AddWithValue("u", key);
            await using var rd = await cmd.ExecuteReaderAsync(ct);
            if (await rd.ReadAsync(ct))
            {
                agentAdmin = rd.GetBoolean(0);
                agentSeeAll = rd.GetBoolean(1);
                agentActive = rd.GetBoolean(2);
            }
        }

        var departments = new List<int>();
        if (agentActive)
        {
            await using var cmd = new NpgsqlCommand("""
                SELECT m.department_id FROM public.department_members m
                JOIN public.departments d ON d.id = m.department_id AND d.is_active
                WHERE m.user_name = @u ORDER BY m.department_id
                """, conn);
            cmd.Parameters.AddWithValue("u", key);
            await using var rd = await cmd.ExecuteReaderAsync(ct);
            while (await rd.ReadAsync(ct)) departments.Add(rd.GetInt32(0));
        }

        // Pasife alınan kişi (Ayarlar'da) yalnız rolü süper yöneticiyse bir şey görmeye devam eder.
        var isAdmin = isSuperRole || (agentActive && agentAdmin);
        var canSeeAll = isAdmin || (agentActive && agentSeeAll);
        return new AgentScope(key, isAdmin, canSeeAll, departments);
    }

    private async Task<bool> IsSuperAdminRoleAsync(string tenant, int roleId, CancellationToken ct)
    {
        var cacheKey = tenant + ":" + roleId;
        if (SuperRoleCache.TryGetValue(cacheKey, out var hit) && DateTime.UtcNow - hit.At < TimeSpan.FromMinutes(1)) return hit.IsSuper;

        await using var conn = new NpgsqlConnection(_db.ErpConnectionString(tenant));
        await conn.OpenAsync(ct);
        await using var cmd = new NpgsqlCommand("SELECT \"IsSuperAdmin\" FROM public.\"Roles\" WHERE \"Id\" = @id", conn);
        cmd.Parameters.AddWithValue("id", roleId);
        var isSuper = await cmd.ExecuteScalarAsync(ct) is true;
        SuperRoleCache[cacheKey] = (isSuper, DateTime.UtcNow);
        return isSuper;
    }
}
