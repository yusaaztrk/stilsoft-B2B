using System.Text.Json;
using Asistan.Api.Infrastructure;
using Npgsql;
using NpgsqlTypes;

namespace Asistan.Api.Ai;

public sealed record AiDraftRow(
    long Id, long ConversationId, long? BasedOnMessageId, string Body, string Status, bool NeedsHuman,
    string? Topic, string? Reason, string? DepartmentCode, string? Model, DateTimeOffset CreatedAt, string? ToolCallsJson = null);

/// <summary>Asistanın sonucu uygulandığında ne oldu (günlük ve deneme için).</summary>
public sealed record AiApplyResult(bool Stale, bool Routed, bool MarkedImportant, long? DraftId);

/// <summary>Asistan verisi: ayar, birim açıklamaları, taslaklar, konuşmaya yazılan sonuç.</summary>
public sealed class AiStore
{
    public const string Actor = "asistan";

    private readonly TenantDb _db;
    private readonly AsistanSchema _schema;

    public AiStore(TenantDb db, AsistanSchema schema)
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

    public async Task<AiSettings> GetSettingsAsync(string tenant, CancellationToken ct)
    {
        await using var conn = await OpenAsync(tenant, ct);
        await using var cmd = new NpgsqlCommand(
            "SELECT ai_enabled, auto_route, instructions, initiative_topics, tools_enabled FROM public.assistant_settings WHERE id = 1", conn);
        await using var r = await cmd.ExecuteReaderAsync(ct);
        if (!await r.ReadAsync(ct)) return new AiSettings(false, false, null, null, false);
        return new AiSettings(r.GetBoolean(0), r.GetBoolean(1), r.IsDBNull(2) ? null : r.GetString(2), r.IsDBNull(3) ? null : r.GetString(3), r.GetBoolean(4));
    }

    public async Task SaveSettingsAsync(string tenant, AiSettings s, string by, CancellationToken ct)
    {
        await using var conn = await OpenAsync(tenant, ct);
        await using var cmd = new NpgsqlCommand("""
            UPDATE public.assistant_settings
               SET ai_enabled = @en, auto_route = @ar, instructions = @ins, initiative_topics = @top, tools_enabled = @tools,
                   updated_at = now(), updated_by = @by
             WHERE id = 1
            """, conn);
        cmd.Parameters.AddWithValue("en", s.Enabled);
        cmd.Parameters.AddWithValue("ar", s.AutoRoute);
        cmd.Parameters.AddWithValue("ins", (object?)s.Instructions ?? DBNull.Value);
        cmd.Parameters.AddWithValue("top", (object?)s.InitiativeTopics ?? DBNull.Value);
        cmd.Parameters.AddWithValue("tools", s.ToolsEnabled);
        cmd.Parameters.AddWithValue("by", by);
        await cmd.ExecuteNonQueryAsync(ct);
    }

    public async Task<List<AiDepartment>> ListDepartmentsAsync(string tenant, CancellationToken ct)
    {
        await using var conn = await OpenAsync(tenant, ct);
        await using var cmd = new NpgsqlCommand(
            "SELECT id, code, name, ai_description FROM public.departments WHERE is_active ORDER BY sort_order, id", conn);
        var list = new List<AiDepartment>();
        await using var r = await cmd.ExecuteReaderAsync(ct);
        while (await r.ReadAsync(ct)) list.Add(new AiDepartment(r.GetInt32(0), r.GetString(1), r.GetString(2), r.IsDBNull(3) ? null : r.GetString(3)));
        return list;
    }

    public async Task<long?> LastInboundIdAsync(string tenant, long convId, CancellationToken ct)
    {
        await using var conn = await OpenAsync(tenant, ct);
        await using var cmd = new NpgsqlCommand(
            "SELECT MAX(id) FROM public.messages WHERE conversation_id = @c AND direction = 'in'", conn);
        cmd.Parameters.AddWithValue("c", convId);
        return await cmd.ExecuteScalarAsync(ct) is long id ? id : null;
    }

    public async Task<AiDraftRow?> GetPendingDraftAsync(string tenant, long convId, CancellationToken ct)
    {
        await using var conn = await OpenAsync(tenant, ct);
        await using var cmd = new NpgsqlCommand($"SELECT {DraftColumns} FROM public.ai_drafts WHERE conversation_id = @c AND status = 'pending'", conn);
        cmd.Parameters.AddWithValue("c", convId);
        await using var r = await cmd.ExecuteReaderAsync(ct);
        return await r.ReadAsync(ct) ? ReadDraft(r) : null;
    }

    public async Task<AiDraftRow?> GetDraftAsync(string tenant, long draftId, CancellationToken ct)
    {
        await using var conn = await OpenAsync(tenant, ct);
        await using var cmd = new NpgsqlCommand($"SELECT {DraftColumns} FROM public.ai_drafts WHERE id = @id", conn);
        cmd.Parameters.AddWithValue("id", draftId);
        await using var r = await cmd.ExecuteReaderAsync(ct);
        return await r.ReadAsync(ct) ? ReadDraft(r) : null;
    }

    /// <summary>Taslağı yok say. Yalnız bekleyen taslak; değilse false (başkası gönderdi/yeni taslak geldi).</summary>
    public async Task<bool> DiscardDraftAsync(string tenant, long convId, long draftId, string by, CancellationToken ct)
    {
        await using var conn = await OpenAsync(tenant, ct);
        await using var cmd = new NpgsqlCommand("""
            UPDATE public.ai_drafts SET status = 'discarded', decided_by = @by, decided_at = now()
             WHERE id = @id AND conversation_id = @c AND status = 'pending'
            """, conn);
        cmd.Parameters.AddWithValue("id", draftId);
        cmd.Parameters.AddWithValue("c", convId);
        cmd.Parameters.AddWithValue("by", by);
        return await cmd.ExecuteNonQueryAsync(ct) > 0;
    }

    /// <summary>Asistan çalışamadı: ekranda "taslak üretilemedi: …" görünsün, mesaj kaybolmasın.</summary>
    public async Task SetErrorAsync(string tenant, long convId, long? basedOn, string error, CancellationToken ct)
    {
        await using var conn = await OpenAsync(tenant, ct);
        await using var cmd = new NpgsqlCommand("""
            UPDATE public.conversations
               SET ai_error = @e, ai_last_message_id = COALESCE(@m, ai_last_message_id), ai_updated_at = now()
             WHERE id = @c
            """, conn);
        cmd.Parameters.AddWithValue("c", convId);
        cmd.Parameters.AddWithValue("e", error.Length > 500 ? error[..500] : error);
        cmd.Parameters.Add(new NpgsqlParameter("m", NpgsqlDbType.Bigint) { Value = (object?)basedOn ?? DBNull.Value });
        await cmd.ExecuteNonQueryAsync(ct);
    }

    /// <summary>
    /// Kararı konuşmaya uygular (tek işlem):
    ///  - Bu arada müşteriden DAHA YENİ mesaj geldiyse hiçbir şey yazılmaz (Stale) — kuyruktaki sonraki tur onu da okur.
    ///  - Birim: yalnız konuşma ATANMAMIŞSA ve otomatik yönlendirme açıksa. Personelin verdiği birim ezilmez.
    ///  - Önem: yalnız normal→önemli yönünde yazar, asla önemli→normal (onu personel kaldırır).
    ///  - Taslak: personel bu arada cevap verdiyse (awaiting_reply=false) taslak yazılmaz; eski bekleyen taslak
    ///    'superseded' olur, yenisi 'pending'.
    /// </summary>
    public async Task<AiApplyResult> ApplyAsync(string tenant, long convId, long basedOn, AiDecision d, bool autoRoute,
        IReadOnlyList<AiDepartment> departments, CancellationToken ct)
    {
        await using var conn = await OpenAsync(tenant, ct);
        await using var tx = await conn.BeginTransactionAsync(ct);

        int? depId;
        string priority;
        bool awaiting;
        long? lastIn;
        await using (var sel = new NpgsqlCommand("""
            SELECT department_id, priority, awaiting_reply,
                   (SELECT MAX(id) FROM public.messages m WHERE m.conversation_id = c.id AND m.direction = 'in')
            FROM public.conversations c WHERE c.id = @c FOR UPDATE
            """, conn, tx))
        {
            sel.Parameters.AddWithValue("c", convId);
            await using var r = await sel.ExecuteReaderAsync(ct);
            if (!await r.ReadAsync(ct)) return new AiApplyResult(true, false, false, null);
            depId = r.IsDBNull(0) ? null : r.GetInt32(0);
            priority = r.GetString(1);
            awaiting = r.GetBoolean(2);
            lastIn = r.IsDBNull(3) ? null : r.GetInt64(3);
        }
        if (lastIn is long li && li > basedOn)
        {
            await tx.RollbackAsync(ct);
            return new AiApplyResult(true, false, false, null);
        }

        await using (var upd = new NpgsqlCommand("""
            UPDATE public.conversations
               SET ai_summary = @sum, ai_topic = @topic, ai_needs_human = @human, ai_reason = @reason,
                   ai_last_message_id = @m, ai_error = NULL, ai_updated_at = now()
             WHERE id = @c
            """, conn, tx))
        {
            upd.Parameters.AddWithValue("c", convId);
            upd.Parameters.AddWithValue("sum", d.Summary);
            upd.Parameters.AddWithValue("topic", d.Topic);
            upd.Parameters.AddWithValue("human", d.NeedsHuman);
            upd.Parameters.AddWithValue("reason", d.Reason);
            upd.Parameters.AddWithValue("m", basedOn);
            await upd.ExecuteNonQueryAsync(ct);
        }

        var routed = false;
        var target = departments.FirstOrDefault(x => x.Code == d.DepartmentCode);
        if (autoRoute && depId is null && target is not null)
        {
            await using (var upd = new NpgsqlCommand("UPDATE public.conversations SET department_id = @d, updated_at = now() WHERE id = @c", conn, tx))
            {
                upd.Parameters.AddWithValue("c", convId);
                upd.Parameters.AddWithValue("d", target.Id);
                await upd.ExecuteNonQueryAsync(ct);
            }
            await AddEventAsync(conn, tx, convId, "routed", new { from = (int?)null, to = target.Id, reason = d.Reason }, ct);
            routed = true;
        }

        var important = false;
        if (d.Important && priority == "normal")
        {
            await using (var upd = new NpgsqlCommand("UPDATE public.conversations SET priority = 'important', updated_at = now() WHERE id = @c", conn, tx))
            {
                upd.Parameters.AddWithValue("c", convId);
                await upd.ExecuteNonQueryAsync(ct);
            }
            await AddEventAsync(conn, tx, convId, "priority", new { priority = "important", reason = d.Reason }, ct);
            important = true;
        }

        long? draftId = null;
        await using (var sup = new NpgsqlCommand(
            "UPDATE public.ai_drafts SET status = 'superseded', decided_at = now() WHERE conversation_id = @c AND status = 'pending'", conn, tx))
        {
            sup.Parameters.AddWithValue("c", convId);
            await sup.ExecuteNonQueryAsync(ct);
        }
        if (awaiting && !string.IsNullOrWhiteSpace(d.Reply))
        {
            await using var ins = new NpgsqlCommand("""
                INSERT INTO public.ai_drafts (conversation_id, based_on_message_id, body, needs_human, topic, reason, department_code, model, input_tokens, output_tokens, tool_calls)
                VALUES (@c, @m, @body, @human, @topic, @reason, @dep, @model, @in, @out, @tools) RETURNING id
                """, conn, tx);
            ins.Parameters.AddWithValue("c", convId);
            ins.Parameters.AddWithValue("m", basedOn);
            ins.Parameters.AddWithValue("body", d.Reply.Trim());
            ins.Parameters.AddWithValue("human", d.NeedsHuman);
            ins.Parameters.AddWithValue("topic", d.Topic);
            ins.Parameters.AddWithValue("reason", d.Reason);
            ins.Parameters.AddWithValue("dep", (object?)d.DepartmentCode ?? DBNull.Value);
            ins.Parameters.AddWithValue("model", d.Model);
            ins.Parameters.AddWithValue("in", (object?)d.InputTokens ?? DBNull.Value);
            ins.Parameters.AddWithValue("out", (object?)d.OutputTokens ?? DBNull.Value);
            ins.Parameters.Add(new NpgsqlParameter("tools", NpgsqlDbType.Jsonb)
            {
                Value = d.ToolCalls.Count == 0 ? DBNull.Value : JsonSerializer.Serialize(d.ToolCalls.Select(t => new
                {
                    name = t.Name, query = t.Query, ok = t.Ok, summary = t.Summary, ms = t.Ms,
                    items = t.Items?.Select(i => new { @ref = i.Ref, kind = i.Kind, status = i.Status, date = i.Date, planned = i.Planned, product = i.Product, note = i.Note, amount = i.Amount })
                }))
            });
            draftId = (long)(await ins.ExecuteScalarAsync(ct))!;
        }

        await tx.CommitAsync(ct);
        return new AiApplyResult(false, routed, important, draftId);
    }

    private static async Task AddEventAsync(NpgsqlConnection conn, NpgsqlTransaction tx, long convId, string kind, object data, CancellationToken ct)
    {
        await using var cmd = new NpgsqlCommand(
            "INSERT INTO public.conversation_events (conversation_id, kind, actor, data) VALUES (@c, @k, @a, @d)", conn, tx);
        cmd.Parameters.AddWithValue("c", convId);
        cmd.Parameters.AddWithValue("k", kind);
        cmd.Parameters.AddWithValue("a", Actor);
        cmd.Parameters.Add(new NpgsqlParameter("d", NpgsqlDbType.Jsonb) { Value = JsonSerializer.Serialize(data) });
        await cmd.ExecuteNonQueryAsync(ct);
    }

    /// <summary>Son 30 günün taslak sonuçları: asistan ne kadar işe yarıyor (Ayarlar'da gösterilir).</summary>
    public async Task<Dictionary<string, int>> DraftStatsAsync(string tenant, CancellationToken ct)
    {
        await using var conn = await OpenAsync(tenant, ct);
        await using var cmd = new NpgsqlCommand(
            "SELECT status, COUNT(*) FROM public.ai_drafts WHERE created_at > now() - interval '30 days' GROUP BY status", conn);
        var map = new Dictionary<string, int>();
        await using var r = await cmd.ExecuteReaderAsync(ct);
        while (await r.ReadAsync(ct)) map[r.GetString(0)] = (int)r.GetInt64(1);
        return map;
    }

    private const string DraftColumns =
        "id, conversation_id, based_on_message_id, body, status, needs_human, topic, reason, department_code, model, created_at, tool_calls::text";

    private static AiDraftRow ReadDraft(NpgsqlDataReader r) => new(
        r.GetInt64(0), r.GetInt64(1), r.IsDBNull(2) ? null : r.GetInt64(2), r.GetString(3), r.GetString(4), r.GetBoolean(5),
        r.IsDBNull(6) ? null : r.GetString(6), r.IsDBNull(7) ? null : r.GetString(7), r.IsDBNull(8) ? null : r.GetString(8),
        r.IsDBNull(9) ? null : r.GetString(9), r.GetFieldValue<DateTimeOffset>(10), r.IsDBNull(11) ? null : r.GetString(11));
}
