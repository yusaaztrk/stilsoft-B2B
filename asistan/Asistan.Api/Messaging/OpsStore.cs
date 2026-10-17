using Asistan.Api.Infrastructure;
using Npgsql;

namespace Asistan.Api.Messaging;

/// <summary>Bekleme uyarısı eşikleri (dakika). Uyarı: sarı; gecikme: kırmızı, yanıp söner, ayrıca sayılır.</summary>
public sealed record SlaSettings(int WarnMinutes, int LateMinutes)
{
    public static readonly SlaSettings Default = new(5, 15);
}

public sealed record QuickReplyRow(int Id, int? DepartmentId, string Title, string Body, int SortOrder, bool IsActive, int UseCount);

/// <summary>
/// Gelen kutusu işletme ayarları (2026-10-09): bekleme uyarısı eşikleri ve hazır cevaplar.
/// Veri firmanın asistan veritabanında (assistant_settings, quick_replies).
/// </summary>
public sealed class OpsStore
{
    public const int MaxTitle = 60;
    public const int MaxBody = 2000;

    private readonly TenantDb _db;
    private readonly AsistanSchema _schema;

    public OpsStore(TenantDb db, AsistanSchema schema)
    {
        _db = db;
        _schema = schema;
    }

    private async Task<NpgsqlConnection> OpenAsync(string tenant, CancellationToken ct)
    {
        await _schema.EnsureAsync(tenant, ct);
        var conn = new NpgsqlConnection(_db.AsistanConnectionString(tenant));
        await conn.OpenAsync(ct);
        return conn;
    }

    public async Task<SlaSettings> GetSlaAsync(string tenant, CancellationToken ct)
    {
        await using var conn = await OpenAsync(tenant, ct);
        await using var cmd = new NpgsqlCommand("SELECT warn_minutes, late_minutes FROM public.assistant_settings WHERE id = 1", conn);
        await using var r = await cmd.ExecuteReaderAsync(ct);
        return await r.ReadAsync(ct) ? new SlaSettings(r.GetInt32(0), r.GetInt32(1)) : SlaSettings.Default;
    }

    public async Task SaveSlaAsync(string tenant, SlaSettings sla, string by, CancellationToken ct)
    {
        await using var conn = await OpenAsync(tenant, ct);
        await using var cmd = new NpgsqlCommand(
            "UPDATE public.assistant_settings SET warn_minutes = @w, late_minutes = @l, updated_at = now(), updated_by = @by WHERE id = 1", conn);
        cmd.Parameters.AddWithValue("w", sla.WarnMinutes);
        cmd.Parameters.AddWithValue("l", sla.LateMinutes);
        cmd.Parameters.AddWithValue("by", by);
        await cmd.ExecuteNonQueryAsync(ct);
    }

    /// <summary>Hazır cevaplar. <paramref name="activeOnly"/>: ekran için yalnız açık olanlar; Ayarlar için hepsi.</summary>
    public async Task<List<QuickReplyRow>> ListQuickRepliesAsync(string tenant, bool activeOnly, CancellationToken ct)
    {
        await using var conn = await OpenAsync(tenant, ct);
        await using var cmd = new NpgsqlCommand($"""
            SELECT id, department_id, title, body, sort_order, is_active, use_count
            FROM public.quick_replies {(activeOnly ? "WHERE is_active" : "")}
            ORDER BY department_id NULLS FIRST, sort_order, title, id
            """, conn);
        var list = new List<QuickReplyRow>();
        await using var r = await cmd.ExecuteReaderAsync(ct);
        while (await r.ReadAsync(ct))
            list.Add(new QuickReplyRow(r.GetInt32(0), r.IsDBNull(1) ? null : r.GetInt32(1), r.GetString(2), r.GetString(3), r.GetInt32(4), r.GetBoolean(5), r.GetInt32(6)));
        return list;
    }

    public async Task<int> CreateQuickReplyAsync(string tenant, int? departmentId, string title, string body, int sortOrder, string by, CancellationToken ct)
    {
        await using var conn = await OpenAsync(tenant, ct);
        await using var cmd = new NpgsqlCommand("""
            INSERT INTO public.quick_replies (department_id, title, body, sort_order, created_by)
            VALUES (@d, @t, @b, @s, @by) RETURNING id
            """, conn);
        cmd.Parameters.AddWithValue("d", (object?)departmentId ?? DBNull.Value);
        cmd.Parameters.AddWithValue("t", title);
        cmd.Parameters.AddWithValue("b", body);
        cmd.Parameters.AddWithValue("s", sortOrder);
        cmd.Parameters.AddWithValue("by", by);
        return (int)(await cmd.ExecuteScalarAsync(ct))!;
    }

    public async Task<bool> UpdateQuickReplyAsync(string tenant, int id, int? departmentId, string title, string body, int sortOrder, bool isActive, CancellationToken ct)
    {
        await using var conn = await OpenAsync(tenant, ct);
        await using var cmd = new NpgsqlCommand("""
            UPDATE public.quick_replies
               SET department_id = @d, title = @t, body = @b, sort_order = @s, is_active = @a, updated_at = now()
             WHERE id = @id
            """, conn);
        cmd.Parameters.AddWithValue("id", id);
        cmd.Parameters.AddWithValue("d", (object?)departmentId ?? DBNull.Value);
        cmd.Parameters.AddWithValue("t", title);
        cmd.Parameters.AddWithValue("b", body);
        cmd.Parameters.AddWithValue("s", sortOrder);
        cmd.Parameters.AddWithValue("a", isActive);
        return await cmd.ExecuteNonQueryAsync(ct) > 0;
    }

    public async Task<bool> DeleteQuickReplyAsync(string tenant, int id, CancellationToken ct)
    {
        await using var conn = await OpenAsync(tenant, ct);
        await using var cmd = new NpgsqlCommand("DELETE FROM public.quick_replies WHERE id = @id", conn);
        cmd.Parameters.AddWithValue("id", id);
        return await cmd.ExecuteNonQueryAsync(ct) > 0;
    }

    /// <summary>Kullanım sayacı: Ayarlar'da hangi hazır cevabın işe yaradığı görünsün; listede çok kullanılan üste çıkmaz (sıra elle).</summary>
    public async Task MarkQuickReplyUsedAsync(string tenant, int id, CancellationToken ct)
    {
        await using var conn = await OpenAsync(tenant, ct);
        await using var cmd = new NpgsqlCommand("UPDATE public.quick_replies SET use_count = use_count + 1 WHERE id = @id AND is_active", conn);
        cmd.Parameters.AddWithValue("id", id);
        await cmd.ExecuteNonQueryAsync(ct);
    }
}
