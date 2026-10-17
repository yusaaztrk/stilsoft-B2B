using System.Text.Json;
using Asistan.Api.Infrastructure;
using Asistan.Api.WhatsApp;
using Npgsql;
using NpgsqlTypes;

namespace Asistan.Api.Messaging;

public sealed record ConversationRow(
    long Id, string PhoneNumberId, string WaId, string? ContactName, string? CustomerCode, string? CustomerName,
    int CustomerMatchCount, string Status, int UnreadCount, DateTimeOffset? LastMessageAt, string? LastMessagePreview,
    string? LastMessageDirection, DateTimeOffset? LastInboundAt, string? AssignedTo,
    int? DepartmentId, string? DepartmentName, string Priority, bool AwaitingReply, DateTimeOffset? WaitingSince,
    string? LastReplyBy, DateTimeOffset? LastReplyAt,
    string? AiSummary, string? AiTopic, bool AiNeedsHuman, string? AiReason, string? AiError, long? AiLastMessageId, DateTimeOffset? AiUpdatedAt);

public sealed record EventRow(long Id, string Kind, string Actor, string? DataJson, DateTimeOffset CreatedAt);

public sealed record DepartmentRow(int Id, string Code, string Name, int SortOrder, bool IsActive);

/// <summary>Gelen kutusu klasörleri.</summary>
public static class Folders
{
    public const string Waiting = "waiting";       // cevap bekleyen (açık + son mesaj cevapsız)
    public const string Important = "important";   // önemli ya da ACİL işaretli, açık
    public const string Answered = "answered";     // açık ama cevaplanmış
    public const string Unassigned = "unassigned"; // birimi yok (yalnız hepsini görenler)
    public const string Closed = "closed";
    public const string All = "all";
}

public sealed record MessageRow(
    long Id, long ConversationId, string? Wamid, string Direction, string MsgType, string? Body, string? MediaId,
    string? MediaMime, string? MediaFilename, string Status, string? ErrorText, string? SentBy,
    DateTimeOffset? WaTimestamp, DateTimeOffset CreatedAt, long? AiDraftId = null);

/// <summary>Konuşma ve mesaj kaydı (asistanın kendi veritabanı, firma başına).</summary>
public sealed class MessageStore
{
    private readonly TenantDb _db;
    private readonly AsistanSchema _schema;

    public MessageStore(TenantDb db, AsistanSchema schema)
    {
        _db = db;
        _schema = schema;
    }

    /// <summary>
    /// WhatsApp'ın "müşteri hizmeti penceresi": müşterinin SON mesajından sonraki 24 saat içinde
    /// serbest metin gönderilebilir. Pencere kapanınca yalnız onaylı şablon gönderilebilir;
    /// serbest metni Meta reddeder (hata 131047).
    /// </summary>
    public static readonly TimeSpan CustomerServiceWindow = TimeSpan.FromHours(24);

    private async Task<NpgsqlConnection> OpenAsync(string tenant, CancellationToken ct)
    {
        await _schema.EnsureAsync(tenant, ct);
        var conn = new NpgsqlConnection(_db.AsistanConnectionString(tenant));
        await conn.OpenAsync(ct);
        return conn;
    }

    private static string Preview(string? text, string type)
    {
        var t = string.IsNullOrWhiteSpace(text) ? TypeLabel(type) : text.Trim().Replace('\n', ' ');
        return t.Length > 120 ? t[..117] + "…" : t;
    }

    public static string TypeLabel(string type) => type switch
    {
        "image" => "📷 Fotoğraf",
        "video" => "🎬 Video",
        "audio" => "🎤 Ses kaydı",
        "document" => "📄 Belge",
        "sticker" => "Çıkartma",
        "location" => "📍 Konum",
        "contacts" => "👤 Kişi kartı",
        "reaction" => "Tepki",
        "text" => "",
        _ => "Desteklenmeyen mesaj"
    };

    public async Task LogWebhookAsync(string tenant, string payload, string? error, CancellationToken ct)
    {
        await using var conn = await OpenAsync(tenant, ct);
        await using var cmd = new NpgsqlCommand(
            "INSERT INTO public.webhook_events (payload, error_text) VALUES (@p, @e)", conn);
        cmd.Parameters.Add(new NpgsqlParameter("p", NpgsqlDbType.Jsonb) { Value = payload });
        cmd.Parameters.AddWithValue("e", (object?)error ?? DBNull.Value);
        await cmd.ExecuteNonQueryAsync(ct);
    }

    /// <summary>
    /// Gelen mesajı kaydeder. Meta aynı webhook'u tekrar gönderebilir (cevabımız geç kalırsa);
    /// mesaj kimliği (wamid) tekil olduğu için ikinci kayıt düşer ve okunmamış sayısı İKİ KEZ
    /// artmaz. Döner: (konuşma kimliği, yeni mesaj mı, konuşma yeni mi).
    /// </summary>
    public async Task<(long ConversationId, bool Inserted, bool NewConversation)> SaveInboundAsync(string tenant, InboundMessage m, CancellationToken ct)
    {
        await using var conn = await OpenAsync(tenant, ct);
        await using var tx = await conn.BeginTransactionAsync(ct);

        long convId;
        bool newConv;
        await using (var c = new NpgsqlCommand("""
            INSERT INTO public.conversations (phone_number_id, wa_id, contact_name)
            VALUES (@pn, @wa, @name)
            ON CONFLICT (phone_number_id, wa_id) DO UPDATE
               SET contact_name = COALESCE(EXCLUDED.contact_name, public.conversations.contact_name)
            RETURNING id, (xmax = 0) AS inserted
            """, conn, tx))
        {
            c.Parameters.AddWithValue("pn", m.PhoneNumberId);
            c.Parameters.AddWithValue("wa", m.WaId);
            c.Parameters.AddWithValue("name", (object?)m.ContactName ?? DBNull.Value);
            await using var r = await c.ExecuteReaderAsync(ct);
            await r.ReadAsync(ct);
            convId = r.GetInt64(0);
            newConv = r.GetBoolean(1);
        }

        var at = m.Timestamp ?? DateTimeOffset.UtcNow;
        long? msgId;
        await using (var c = new NpgsqlCommand("""
            INSERT INTO public.messages (conversation_id, wamid, direction, msg_type, body, media_id, media_mime, media_filename, status, wa_timestamp, raw)
            VALUES (@cid, @wamid, 'in', @type, @body, @mid, @mime, @fn, 'received', @ts, @raw)
            ON CONFLICT (wamid) WHERE wamid IS NOT NULL DO NOTHING
            RETURNING id
            """, conn, tx))
        {
            c.Parameters.AddWithValue("cid", convId);
            c.Parameters.AddWithValue("wamid", m.Wamid);
            c.Parameters.AddWithValue("type", m.Type);
            c.Parameters.AddWithValue("body", (object?)m.Body ?? DBNull.Value);
            c.Parameters.AddWithValue("mid", (object?)m.MediaId ?? DBNull.Value);
            c.Parameters.AddWithValue("mime", (object?)m.MediaMime ?? DBNull.Value);
            c.Parameters.AddWithValue("fn", (object?)m.MediaFilename ?? DBNull.Value);
            c.Parameters.AddWithValue("ts", at);
            c.Parameters.Add(new NpgsqlParameter("raw", NpgsqlDbType.Jsonb) { Value = m.RawJson });
            msgId = (long?)await c.ExecuteScalarAsync(ct);
        }

        if (msgId is not null)
        {
            await using var c = new NpgsqlCommand("""
                UPDATE public.conversations
                   SET unread_count = unread_count + 1,
                       status = 'open',                     -- kapalı konuşmaya yeni mesaj gelirse yeniden açılır
                       last_message_at = GREATEST(COALESCE(last_message_at, @ts), @ts),
                       last_message_preview = @pv,
                       last_message_direction = 'in',
                       last_inbound_at = GREATEST(COALESCE(last_inbound_at, @ts), @ts),
                       awaiting_reply = true,
                       waiting_since = CASE WHEN awaiting_reply AND waiting_since IS NOT NULL THEN waiting_since ELSE @ts END,
                       updated_at = now()
                 WHERE id = @cid
                """, conn, tx);
            c.Parameters.AddWithValue("cid", convId);
            c.Parameters.AddWithValue("ts", at);
            c.Parameters.AddWithValue("pv", Preview(m.Body, m.Type));
            await c.ExecuteNonQueryAsync(ct);
        }

        await tx.CommitAsync(ct);
        return (convId, msgId is not null, newConv);
    }

    public async Task SetCustomerMatchAsync(string tenant, long convId, IReadOnlyList<CustomerMatch> matches, CancellationToken ct)
    {
        await using var conn = await OpenAsync(tenant, ct);
        await using var cmd = new NpgsqlCommand("""
            UPDATE public.conversations
               SET customer_code = @code, customer_name = @name, customer_match_count = @n, updated_at = now()
             WHERE id = @id
            """, conn);
        cmd.Parameters.AddWithValue("id", convId);
        cmd.Parameters.AddWithValue("code", (object?)matches.FirstOrDefault()?.CustomerCode ?? DBNull.Value);
        cmd.Parameters.AddWithValue("name", (object?)matches.FirstOrDefault()?.Name ?? DBNull.Value);
        cmd.Parameters.AddWithValue("n", matches.Count);
        await cmd.ExecuteNonQueryAsync(ct);
    }

    /// <summary>
    /// Durum yalnız İLERİ gider: sent → delivered → read. Meta bildirimleri sırasız gelebilir;
    /// geç gelen "delivered", "read" olmuş mesajı geri çekmemeli. 'failed' her zaman yazılır.
    /// </summary>
    public async Task<int> ApplyStatusAsync(string tenant, StatusUpdate s, CancellationToken ct)
    {
        await using var conn = await OpenAsync(tenant, ct);
        await using var cmd = new NpgsqlCommand("""
            UPDATE public.messages
               SET status = @st, error_text = COALESCE(@err, error_text), updated_at = now()
             WHERE wamid = @w AND direction = 'out'
               AND (@st = 'failed'
                    OR (CASE status WHEN 'queued' THEN 0 WHEN 'sent' THEN 1 WHEN 'delivered' THEN 2 WHEN 'read' THEN 3 ELSE -1 END)
                     < (CASE @st    WHEN 'queued' THEN 0 WHEN 'sent' THEN 1 WHEN 'delivered' THEN 2 WHEN 'read' THEN 3 ELSE -1 END))
            """, conn);
        cmd.Parameters.AddWithValue("st", s.Status);
        cmd.Parameters.AddWithValue("err", (object?)s.ErrorText ?? DBNull.Value);
        cmd.Parameters.AddWithValue("w", s.Wamid);
        return await cmd.ExecuteNonQueryAsync(ct);
    }

    /// <summary>
    /// Giden mesajı önce 'queued' yazar: Meta'ya gitmeden çöken gönderim de ekranda görünür.
    /// Bekleyen asistan taslağı kapanır: <paramref name="draftId"/> verildiyse 'sent' (metin aynıysa) ya da
    /// 'edited'; personel kendisi yazdıysa 'superseded'. Böylece taslak eski mesaja asılı kalmaz.
    /// </summary>
    public async Task<long> InsertOutboundAsync(string tenant, long convId, string text, string sentBy, CancellationToken ct, long? draftId = null)
    {
        await using var conn = await OpenAsync(tenant, ct);
        await using var tx = await conn.BeginTransactionAsync(ct);
        long id;
        await using (var cmd = new NpgsqlCommand("""
            INSERT INTO public.messages (conversation_id, direction, msg_type, body, status, sent_by, ai_draft_id)
            VALUES (@cid, 'out', 'text', @body, 'queued', @by, @draft) RETURNING id
            """, conn, tx))
        {
            cmd.Parameters.AddWithValue("cid", convId);
            cmd.Parameters.AddWithValue("body", text);
            cmd.Parameters.AddWithValue("by", sentBy);
            cmd.Parameters.AddWithValue("draft", (object?)draftId ?? DBNull.Value);
            id = (long)(await cmd.ExecuteScalarAsync(ct))!;
        }
        await using (var cmd = new NpgsqlCommand("""
            UPDATE public.ai_drafts
               SET status = CASE WHEN id = @draft THEN (CASE WHEN body = @body THEN 'sent' ELSE 'edited' END) ELSE 'superseded' END,
                   decided_by = @by, decided_at = now(),
                   sent_message_id = CASE WHEN id = @draft THEN @mid ELSE NULL END
             WHERE conversation_id = @cid AND status = 'pending'
            """, conn, tx))
        {
            cmd.Parameters.AddWithValue("cid", convId);
            cmd.Parameters.AddWithValue("body", text);
            cmd.Parameters.AddWithValue("by", sentBy);
            cmd.Parameters.AddWithValue("mid", id);
            cmd.Parameters.Add(new NpgsqlParameter("draft", NpgsqlDbType.Bigint) { Value = (object?)draftId ?? DBNull.Value });
            await cmd.ExecuteNonQueryAsync(ct);
        }
        await using (var cmd = new NpgsqlCommand("""
            UPDATE public.conversations
               SET last_message_at = now(), last_message_preview = @pv, last_message_direction = 'out',
                   unread_count = 0, awaiting_reply = false, waiting_since = NULL,
                   last_reply_by = @by, last_reply_at = now(), updated_at = now()
             WHERE id = @cid
            """, conn, tx))
        {
            cmd.Parameters.AddWithValue("cid", convId);
            cmd.Parameters.AddWithValue("pv", Preview(text, "text"));
            cmd.Parameters.AddWithValue("by", sentBy);
            await cmd.ExecuteNonQueryAsync(ct);
        }
        await tx.CommitAsync(ct);
        return id;
    }

    public async Task CompleteOutboundAsync(string tenant, long messageId, SendResult result, CancellationToken ct)
    {
        await using var conn = await OpenAsync(tenant, ct);
        await using var cmd = new NpgsqlCommand("""
            UPDATE public.messages
               SET wamid = @w, status = CASE WHEN @ok THEN 'sent' ELSE 'failed' END, error_text = @e, updated_at = now()
             WHERE id = @id
            """, conn);
        cmd.Parameters.AddWithValue("id", messageId);
        cmd.Parameters.AddWithValue("w", (object?)result.Wamid ?? DBNull.Value);
        cmd.Parameters.AddWithValue("ok", result.Ok);
        cmd.Parameters.AddWithValue("e", (object?)result.Error ?? DBNull.Value);
        await cmd.ExecuteNonQueryAsync(ct);
    }

    private const string ConversationColumns = """
        c.id, c.phone_number_id, c.wa_id, c.contact_name, c.customer_code, c.customer_name, c.customer_match_count, c.status,
        c.unread_count, c.last_message_at, c.last_message_preview, c.last_message_direction, c.last_inbound_at, c.assigned_to,
        c.department_id, d.name, c.priority, c.awaiting_reply, c.waiting_since, c.last_reply_by, c.last_reply_at,
        c.ai_summary, c.ai_topic, c.ai_needs_human, c.ai_reason, c.ai_error, c.ai_last_message_id, c.ai_updated_at
        """;

    private const string ConversationFrom = "public.conversations c LEFT JOIN public.departments d ON d.id = c.department_id";
    private const int ConversationColumnCount = 28;

    private static ConversationRow ReadConversation(NpgsqlDataReader r) => new(
        r.GetInt64(0), r.GetString(1), r.GetString(2), N(r, 3), N(r, 4), N(r, 5), r.GetInt32(6), r.GetString(7),
        r.GetInt32(8), T(r, 9), N(r, 10), N(r, 11), T(r, 12), N(r, 13),
        r.IsDBNull(14) ? null : r.GetInt32(14), N(r, 15), r.GetString(16), r.GetBoolean(17), T(r, 18), N(r, 19), T(r, 20),
        N(r, 21), N(r, 22), r.GetBoolean(23), N(r, 24), N(r, 25), r.IsDBNull(26) ? null : r.GetInt64(26), T(r, 27));

    public async Task<ConversationRow?> GetConversationAsync(string tenant, long id, CancellationToken ct)
    {
        await using var conn = await OpenAsync(tenant, ct);
        await using var cmd = new NpgsqlCommand($"SELECT {ConversationColumns} FROM {ConversationFrom} WHERE c.id = @id", conn);
        cmd.Parameters.AddWithValue("id", id);
        await using var r = await cmd.ExecuteReaderAsync(ct);
        return await r.ReadAsync(ct) ? ReadConversation(r) : null;
    }

    /// <summary>
    /// Gelen kutusu listesi. <paramref name="scope"/> kişinin kapsamı: "hepsini gör" değilse yalnız
    /// birimlerinin konuşmaları gelir (birimsiz/atanmamış konuşmalar da gelmez).
    /// "Cevap bekleyen" klasöründe önce önemliler, sonra EN ESKİ bekleyen; diğerleri son mesaja göre.
    /// </summary>
    public async Task<(List<ConversationRow> Items, int Total)> ListConversationsAsync(
        string tenant, AgentScope scope, string? folder, int? departmentId, string? query, int page, int pageSize, CancellationToken ct)
    {
        await using var conn = await OpenAsync(tenant, ct);

        var where = new List<string>();
        var cmd = new NpgsqlCommand { Connection = conn };

        if (!scope.CanSeeAll)
        {
            where.Add("c.department_id = ANY(@deps)");
            cmd.Parameters.AddWithValue("deps", scope.DepartmentIds.ToArray());
        }

        switch (folder)
        {
            case Folders.Waiting: where.Add("c.status = 'open' AND c.awaiting_reply"); break;
            case Folders.Important: where.Add("c.status = 'open' AND c.priority IN ('important', 'urgent')"); break;
            case Folders.Answered: where.Add("c.status = 'open' AND NOT c.awaiting_reply"); break;
            case Folders.Unassigned: where.Add("c.status = 'open' AND c.department_id IS NULL"); break;
            case Folders.Closed: where.Add("c.status = 'closed'"); break;
            case "open": where.Add("c.status = 'open'"); break;
            case "unread": where.Add("c.unread_count > 0"); break;
        }

        if (departmentId is int dep)
        {
            where.Add("c.department_id = @dep");
            cmd.Parameters.AddWithValue("dep", dep);
        }

        if (!string.IsNullOrWhiteSpace(query))
        {
            where.Add("(c.wa_id ILIKE @q OR c.contact_name ILIKE @q OR c.customer_code ILIKE @q OR c.customer_name ILIKE @q OR c.last_message_preview ILIKE @q)");
            cmd.Parameters.AddWithValue("q", "%" + query.Trim() + "%");
        }
        var whereSql = where.Count == 0 ? "" : "WHERE " + string.Join(" AND ", where);
        // Birim görünümü ("open"): önce cevap bekleyenler (önemli + en eski bekleyen üstte), sonra
        // cevaplanmış açık konuşmalar son mesaja göre. 2026-10-09: birime tıklayınca yalnız bekleyenler
        // geliyordu; elle devredilip cevaplanmış konuşma "bu klasörde konuşma yok" diye kayboluyordu.
        var orderSql = folder switch
        {
            Folders.Waiting => "ORDER BY (CASE c.priority WHEN 'urgent' THEN 2 WHEN 'important' THEN 1 ELSE 0 END) DESC, c.waiting_since ASC NULLS LAST, c.id",
            "open" => """
                ORDER BY c.awaiting_reply DESC, (CASE WHEN c.awaiting_reply THEN (CASE c.priority WHEN 'urgent' THEN 2 WHEN 'important' THEN 1 ELSE 0 END) ELSE 0 END) DESC,
                         CASE WHEN c.awaiting_reply THEN c.waiting_since END ASC NULLS LAST,
                         c.last_message_at DESC NULLS LAST, c.id DESC
                """,
            Folders.Important => "ORDER BY (CASE c.priority WHEN 'urgent' THEN 2 WHEN 'important' THEN 1 ELSE 0 END) DESC, c.last_message_at DESC NULLS LAST, c.id DESC",
            _ => "ORDER BY c.last_message_at DESC NULLS LAST, c.id DESC"
        };

        cmd.CommandText = $"""
            SELECT {ConversationColumns}, COUNT(*) OVER() AS total
            FROM {ConversationFrom} {whereSql}
            {orderSql}
            LIMIT @take OFFSET @skip
            """;
        cmd.Parameters.AddWithValue("take", pageSize);
        cmd.Parameters.AddWithValue("skip", (page - 1) * pageSize);

        var items = new List<ConversationRow>();
        var total = 0;
        await using (cmd)
        await using (var r = await cmd.ExecuteReaderAsync(ct))
        {
            while (await r.ReadAsync(ct))
            {
                items.Add(ReadConversation(r));
                total = (int)r.GetInt64(ConversationColumnCount);
            }
        }
        return (items, total);
    }

    /// <summary>Mesajlar eskiden yeniye. <paramref name="afterId"/> verilirse yalnız yenileri (yoklama).</summary>
    public async Task<List<MessageRow>> ListMessagesAsync(string tenant, long convId, long? afterId, int take, CancellationToken ct)
    {
        await using var conn = await OpenAsync(tenant, ct);
        await using var cmd = new NpgsqlCommand(afterId is null
            ? """
              SELECT * FROM (
                SELECT id, conversation_id, wamid, direction, msg_type, body, media_id, media_mime, media_filename,
                       status, error_text, sent_by, wa_timestamp, created_at, ai_draft_id
                FROM public.messages WHERE conversation_id = @cid ORDER BY id DESC LIMIT @take
              ) x ORDER BY id
              """
            : """
              SELECT id, conversation_id, wamid, direction, msg_type, body, media_id, media_mime, media_filename,
                     status, error_text, sent_by, wa_timestamp, created_at, ai_draft_id
              FROM public.messages WHERE conversation_id = @cid AND id > @after ORDER BY id LIMIT @take
              """, conn);
        cmd.Parameters.AddWithValue("cid", convId);
        cmd.Parameters.AddWithValue("take", take);
        if (afterId is not null) cmd.Parameters.AddWithValue("after", afterId.Value);

        var list = new List<MessageRow>();
        await using var r = await cmd.ExecuteReaderAsync(ct);
        while (await r.ReadAsync(ct))
        {
            list.Add(new MessageRow(r.GetInt64(0), r.GetInt64(1), N(r, 2), r.GetString(3), r.GetString(4), N(r, 5), N(r, 6),
                N(r, 7), N(r, 8), r.GetString(9), N(r, 10), N(r, 11), T(r, 12), r.GetFieldValue<DateTimeOffset>(13), r.IsDBNull(14) ? null : r.GetInt64(14)));
        }
        return list;
    }

    /// <summary>Durumu değişen mesajlar (ekranda tik güncellemesi için).</summary>
    public async Task<List<(long Id, string Status, string? Error)>> StatusesSinceAsync(string tenant, long convId, DateTimeOffset since, CancellationToken ct)
    {
        await using var conn = await OpenAsync(tenant, ct);
        await using var cmd = new NpgsqlCommand("""
            SELECT id, status, error_text FROM public.messages
             WHERE conversation_id = @cid AND direction = 'out' AND updated_at > @since
            """, conn);
        cmd.Parameters.AddWithValue("cid", convId);
        cmd.Parameters.AddWithValue("since", since);
        var list = new List<(long, string, string?)>();
        await using var r = await cmd.ExecuteReaderAsync(ct);
        while (await r.ReadAsync(ct)) list.Add((r.GetInt64(0), r.GetString(1), N(r, 2)));
        return list;
    }

    public async Task<MessageRow?> GetMessageAsync(string tenant, long id, CancellationToken ct)
    {
        await using var conn = await OpenAsync(tenant, ct);
        await using var cmd = new NpgsqlCommand("""
            SELECT id, conversation_id, wamid, direction, msg_type, body, media_id, media_mime, media_filename,
                   status, error_text, sent_by, wa_timestamp, created_at, ai_draft_id
            FROM public.messages WHERE id = @id
            """, conn);
        cmd.Parameters.AddWithValue("id", id);
        await using var r = await cmd.ExecuteReaderAsync(ct);
        if (!await r.ReadAsync(ct)) return null;
        return new MessageRow(r.GetInt64(0), r.GetInt64(1), N(r, 2), r.GetString(3), r.GetString(4), N(r, 5), N(r, 6),
            N(r, 7), N(r, 8), r.GetString(9), N(r, 10), N(r, 11), T(r, 12), r.GetFieldValue<DateTimeOffset>(13), r.IsDBNull(14) ? null : r.GetInt64(14));
    }

    /// <summary>Okundu işaretler; Meta'ya gönderilecek son gelen mesajın kimliğini döner.</summary>
    public async Task<string?> MarkReadAsync(string tenant, long convId, CancellationToken ct)
    {
        await using var conn = await OpenAsync(tenant, ct);
        await using (var upd = new NpgsqlCommand(
            "UPDATE public.conversations SET unread_count = 0, updated_at = now() WHERE id = @id", conn))
        {
            upd.Parameters.AddWithValue("id", convId);
            await upd.ExecuteNonQueryAsync(ct);
        }
        await using var sel = new NpgsqlCommand(
            "SELECT wamid FROM public.messages WHERE conversation_id = @id AND direction = 'in' AND wamid IS NOT NULL ORDER BY id DESC LIMIT 1", conn);
        sel.Parameters.AddWithValue("id", convId);
        return await sel.ExecuteScalarAsync(ct) as string;
    }

    public async Task<bool> SetStatusAsync(string tenant, long convId, string status, CancellationToken ct)
    {
        await using var conn = await OpenAsync(tenant, ct);
        await using var cmd = new NpgsqlCommand("""
            UPDATE public.conversations
               SET status = @s,
                   awaiting_reply = CASE WHEN @s = 'closed' THEN false ELSE awaiting_reply END,
                   waiting_since  = CASE WHEN @s = 'closed' THEN NULL ELSE waiting_since END,
                   updated_at = now()
             WHERE id = @id
            """, conn);
        cmd.Parameters.AddWithValue("id", convId);
        cmd.Parameters.AddWithValue("s", status);
        return await cmd.ExecuteNonQueryAsync(ct) > 0;
    }

    /// <param name="Late">Cevap bekleme süresi gecikme eşiğini (Ayarlar → bekleme uyarısı, varsayılan 15 dk) aşan konuşma.</param>
    public sealed record FolderCounts(int Waiting, int Important, int Answered, int Unassigned, int Unread, DateTimeOffset? OldestWaitingSince,
        int Urgent = 0, int Late = 0);
    public sealed record DepartmentCount(int DepartmentId, int Waiting, int Important, int Open, int Late = 0);

    /// <summary>Kapsam içindeki klasör sayıları ve birim bazında bekleyen/önemli/açık/geciken sayıları.</summary>
    public async Task<(FolderCounts Folders, List<DepartmentCount> Departments)> SummaryAsync(string tenant, AgentScope scope, CancellationToken ct,
        int lateMinutes = 15)
    {
        await using var conn = await OpenAsync(tenant, ct);
        var scopeSql = scope.CanSeeAll ? "true" : "c.department_id = ANY(@deps)";

        FolderCounts folders;
        await using (var cmd = new NpgsqlCommand($"""
            SELECT COUNT(*) FILTER (WHERE c.status = 'open' AND c.awaiting_reply),
                   COUNT(*) FILTER (WHERE c.status = 'open' AND c.priority IN ('important', 'urgent')),
                   COUNT(*) FILTER (WHERE c.status = 'open' AND NOT c.awaiting_reply),
                   COUNT(*) FILTER (WHERE c.status = 'open' AND c.department_id IS NULL),
                   COUNT(*) FILTER (WHERE c.unread_count > 0),
                   MIN(c.waiting_since) FILTER (WHERE c.status = 'open' AND c.awaiting_reply),
                   COUNT(*) FILTER (WHERE c.status = 'open' AND c.priority = 'urgent'),
                   COUNT(*) FILTER (WHERE c.status = 'open' AND c.awaiting_reply AND c.waiting_since < now() - make_interval(mins => @late))
            FROM public.conversations c WHERE {scopeSql}
            """, conn))
        {
            if (!scope.CanSeeAll) cmd.Parameters.AddWithValue("deps", scope.DepartmentIds.ToArray());
            cmd.Parameters.AddWithValue("late", Math.Max(1, lateMinutes));
            await using var r = await cmd.ExecuteReaderAsync(ct);
            await r.ReadAsync(ct);
            folders = new FolderCounts((int)r.GetInt64(0), (int)r.GetInt64(1), (int)r.GetInt64(2), (int)r.GetInt64(3), (int)r.GetInt64(4), T(r, 5),
                (int)r.GetInt64(6), (int)r.GetInt64(7));
        }

        var deps = new List<DepartmentCount>();
        await using (var cmd = new NpgsqlCommand($"""
            SELECT c.department_id,
                   COUNT(*) FILTER (WHERE c.status = 'open' AND c.awaiting_reply),
                   COUNT(*) FILTER (WHERE c.status = 'open' AND c.priority IN ('important', 'urgent')),
                   COUNT(*) FILTER (WHERE c.status = 'open'),
                   COUNT(*) FILTER (WHERE c.status = 'open' AND c.awaiting_reply AND c.waiting_since < now() - make_interval(mins => @late))
            FROM public.conversations c
            WHERE c.department_id IS NOT NULL AND {scopeSql}
            GROUP BY c.department_id
            """, conn))
        {
            if (!scope.CanSeeAll) cmd.Parameters.AddWithValue("deps", scope.DepartmentIds.ToArray());
            cmd.Parameters.AddWithValue("late", Math.Max(1, lateMinutes));
            await using var r = await cmd.ExecuteReaderAsync(ct);
            while (await r.ReadAsync(ct)) deps.Add(new DepartmentCount(r.GetInt32(0), (int)r.GetInt64(1), (int)r.GetInt64(2), (int)r.GetInt64(3), (int)r.GetInt64(4)));
        }
        return (folders, deps);
    }

    public async Task<List<DepartmentRow>> ListDepartmentsAsync(string tenant, bool includeInactive, CancellationToken ct)
    {
        await using var conn = await OpenAsync(tenant, ct);
        await using var cmd = new NpgsqlCommand(
            $"SELECT id, code, name, sort_order, is_active FROM public.departments {(includeInactive ? "" : "WHERE is_active")} ORDER BY sort_order, id", conn);
        var list = new List<DepartmentRow>();
        await using var r = await cmd.ExecuteReaderAsync(ct);
        while (await r.ReadAsync(ct)) list.Add(new DepartmentRow(r.GetInt32(0), r.GetString(1), r.GetString(2), r.GetInt32(3), r.GetBoolean(4)));
        return list;
    }

    /// <summary>Birime yönlendir (null = atanmamış). Hareket kaydına yazılır.</summary>
    public async Task<bool> RouteAsync(string tenant, long convId, int? departmentId, string actor, CancellationToken ct)
    {
        await using var conn = await OpenAsync(tenant, ct);
        await using var tx = await conn.BeginTransactionAsync(ct);
        int? previous;
        await using (var sel = new NpgsqlCommand("SELECT department_id FROM public.conversations WHERE id = @id FOR UPDATE", conn, tx))
        {
            sel.Parameters.AddWithValue("id", convId);
            var v = await sel.ExecuteScalarAsync(ct);
            if (v is null) return false;
            previous = v is DBNull ? null : (int)v;
        }
        if (previous == departmentId)
        {
            await tx.CommitAsync(ct);
            return true;
        }

        await using (var upd = new NpgsqlCommand("UPDATE public.conversations SET department_id = @d, updated_at = now() WHERE id = @id", conn, tx))
        {
            upd.Parameters.AddWithValue("id", convId);
            upd.Parameters.AddWithValue("d", (object?)departmentId ?? DBNull.Value);
            await upd.ExecuteNonQueryAsync(ct);
        }
        await AddEventAsync(conn, tx, convId, "routed", actor, new { from = previous, to = departmentId }, ct);
        await tx.CommitAsync(ct);
        return true;
    }

    public async Task SetPriorityAsync(string tenant, long convId, string priority, string actor, CancellationToken ct)
    {
        await using var conn = await OpenAsync(tenant, ct);
        await using var tx = await conn.BeginTransactionAsync(ct);
        int changed;
        await using (var upd = new NpgsqlCommand(
            "UPDATE public.conversations SET priority = @p, updated_at = now() WHERE id = @id AND priority <> @p", conn, tx))
        {
            upd.Parameters.AddWithValue("id", convId);
            upd.Parameters.AddWithValue("p", priority);
            changed = await upd.ExecuteNonQueryAsync(ct);
        }
        if (changed > 0) await AddEventAsync(conn, tx, convId, "priority", actor, new { priority }, ct);
        await tx.CommitAsync(ct);
    }

    /// <summary>Hareket kaydı (durum değişikliği vb.).</summary>
    public async Task LogEventAsync(string tenant, long convId, string kind, string actor, object? data, CancellationToken ct)
    {
        await using var conn = await OpenAsync(tenant, ct);
        await AddEventAsync(conn, null, convId, kind, actor, data, ct);
    }

    /// <summary>İç not: müşteriye GİTMEZ, yalnız personel görür.</summary>
    public Task AddNoteAsync(string tenant, long convId, string text, string actor, CancellationToken ct) =>
        LogEventAsync(tenant, convId, "note", actor, new { text }, ct);

    private static async Task AddEventAsync(NpgsqlConnection conn, NpgsqlTransaction? tx, long convId, string kind, string actor, object? data, CancellationToken ct)
    {
        await using var cmd = new NpgsqlCommand(
            "INSERT INTO public.conversation_events (conversation_id, kind, actor, data) VALUES (@c, @k, @a, @d)", conn, tx);
        cmd.Parameters.AddWithValue("c", convId);
        cmd.Parameters.AddWithValue("k", kind);
        cmd.Parameters.AddWithValue("a", actor);
        cmd.Parameters.Add(new NpgsqlParameter("d", NpgsqlDbType.Jsonb) { Value = data is null ? DBNull.Value : JsonSerializer.Serialize(data) });
        await cmd.ExecuteNonQueryAsync(ct);
    }

    public async Task<List<EventRow>> ListEventsAsync(string tenant, long convId, long? afterId, CancellationToken ct)
    {
        await using var conn = await OpenAsync(tenant, ct);
        await using var cmd = new NpgsqlCommand(
            "SELECT id, kind, actor, data::text, created_at FROM public.conversation_events WHERE conversation_id = @c AND id > @after ORDER BY id", conn);
        cmd.Parameters.AddWithValue("c", convId);
        cmd.Parameters.AddWithValue("after", afterId ?? 0L);
        var list = new List<EventRow>();
        await using var r = await cmd.ExecuteReaderAsync(ct);
        while (await r.ReadAsync(ct)) list.Add(new EventRow(r.GetInt64(0), r.GetString(1), r.GetString(2), N(r, 3), r.GetFieldValue<DateTimeOffset>(4)));
        return list;
    }

    /// <summary>"Şu an bakıyor" kaydı yenilenir; dönüşte kendisi dışında son 30 sn'de bakanlar.</summary>
    public async Task<List<string>> TouchViewerAsync(string tenant, long convId, string userName, CancellationToken ct)
    {
        await using var conn = await OpenAsync(tenant, ct);
        await using (var up = new NpgsqlCommand("""
            INSERT INTO public.conversation_viewers (conversation_id, user_name, seen_at) VALUES (@c, @u, now())
            ON CONFLICT (conversation_id, user_name) DO UPDATE SET seen_at = now()
            """, conn))
        {
            up.Parameters.AddWithValue("c", convId);
            up.Parameters.AddWithValue("u", userName);
            await up.ExecuteNonQueryAsync(ct);
        }
        await using var sel = new NpgsqlCommand("""
            SELECT user_name FROM public.conversation_viewers
             WHERE conversation_id = @c AND user_name <> @u AND seen_at > now() - interval '30 seconds'
             ORDER BY user_name
            """, conn);
        sel.Parameters.AddWithValue("c", convId);
        sel.Parameters.AddWithValue("u", userName);
        var list = new List<string>();
        await using var r = await sel.ExecuteReaderAsync(ct);
        while (await r.ReadAsync(ct)) list.Add(r.GetString(0));
        return list;
    }

    /// <summary>30 günden eski ham webhook kayıtlarını siler (mesajlar SİLİNMEZ).</summary>
    public async Task<int> PruneWebhookEventsAsync(string tenant, CancellationToken ct)
    {
        await using var conn = await OpenAsync(tenant, ct);
        await using var cmd = new NpgsqlCommand(
            "DELETE FROM public.webhook_events WHERE received_at < now() - interval '30 days'", conn);
        return await cmd.ExecuteNonQueryAsync(ct);
    }

    private static string? N(NpgsqlDataReader r, int i) => r.IsDBNull(i) ? null : r.GetString(i);
    private static DateTimeOffset? T(NpgsqlDataReader r, int i) => r.IsDBNull(i) ? null : r.GetFieldValue<DateTimeOffset>(i);
}
