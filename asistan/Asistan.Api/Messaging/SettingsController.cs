using Asistan.Api.Ai;
using Asistan.Api.Infrastructure;
using Microsoft.AspNetCore.Mvc;
using Npgsql;

namespace Asistan.Api.Messaging;

/// <summary>
/// Asistan Ayarları — YALNIZ YÖNETİCİ (bkz. InboxAccess: SSA, B2B süper yönetici rolü ya da
/// burada "yönetici" işaretlenen).
///
///  - Birimler: ad, sıra, pasife alma, yeni birim.
///  - Kişiler: B2B kullanıcısına birim(ler), "hepsini gör", "yönetici", pasif.
///  - Asistan (yapay zekâ): aç/kapa, otomatik yönlendirme, firma talimatı, insan kararı gereken konular,
///    birimlerin asistana anlatılan açıklaması.
///
/// Programa GİRİŞ yetkisi burada verilmez — o B2B → Kullanıcılar → "Asistan (WhatsApp)" kutusundan
/// (kullanıcı bazında). Kişi listesinde kimin girebildiği gösterilir ki "birime ekledim ama giremiyor"
/// durumu baştan görülsün.
/// </summary>
[ApiController]
[Route("api/panel/settings")]
[PanelAuth]
public sealed class SettingsController : ControllerBase
{
    private readonly InboxAccess _access;
    private readonly AsistanSchema _schema;
    private readonly TenantDb _db;
    private readonly AiStore _ai;
    private readonly IAiClassifier _classifier;
    private readonly Ai.Tools.AiToolbox _toolbox;

    public SettingsController(InboxAccess access, AsistanSchema schema, TenantDb db, AiStore ai, IAiClassifier classifier, Ai.Tools.AiToolbox toolbox, OpsStore ops)
    {
        _access = access;
        _ops = ops;
        _toolbox = toolbox;
        _ai = ai;
        _classifier = classifier;
        _schema = schema;
        _db = db;
    }

    private readonly OpsStore _ops;

    private PanelUser Me => PanelAuthAttribute.Current(HttpContext);

    private async Task<(AgentScope Scope, IActionResult? Denied)> RequireAdminAsync(CancellationToken ct)
    {
        var scope = await _access.ResolveAsync(Me, ct);
        return scope.IsAdmin
            ? (scope, null)
            : (scope, StatusCode(StatusCodes.Status403Forbidden, new { message = "Ayarlar yalnız asistan yöneticilerine açık." }));
    }

    private async Task<NpgsqlConnection> OpenAsync(CancellationToken ct)
    {
        await _schema.EnsureAsync(Me.TenantCode, ct);
        var conn = new NpgsqlConnection(_db.AsistanConnectionString(Me.TenantCode));
        await conn.OpenAsync(ct);
        return conn;
    }

    [HttpGet]
    public async Task<IActionResult> Get(CancellationToken ct)
    {
        var (_, denied) = await RequireAdminAsync(ct);
        if (denied is not null) return denied;

        await using var conn = await OpenAsync(ct);

        var departments = new List<object>();
        await using (var cmd = new NpgsqlCommand("""
            SELECT d.id, d.code, d.name, d.sort_order, d.is_active,
                   (SELECT COUNT(*) FROM public.department_members m WHERE m.department_id = d.id), d.ai_description
            FROM public.departments d ORDER BY d.sort_order, d.id
            """, conn))
        await using (var r = await cmd.ExecuteReaderAsync(ct))
        {
            while (await r.ReadAsync(ct))
                departments.Add(new { id = r.GetInt32(0), code = r.GetString(1), name = r.GetString(2), sortOrder = r.GetInt32(3), isActive = r.GetBoolean(4), memberCount = (int)r.GetInt64(5), aiDescription = r.IsDBNull(6) ? null : r.GetString(6) });
        }

        // Ayar satırı olan + herhangi bir birime üye olan herkes (ikisi ayrı tutulabiliyor).
        var agents = new List<object>();
        var agentNames = new List<string>();
        await using (var cmd = new NpgsqlCommand("""
            WITH names AS (
              SELECT user_name FROM public.agents
              UNION SELECT user_name FROM public.department_members
            )
            SELECT n.user_name, a.display_name, COALESCE(a.can_see_all, false), COALESCE(a.is_admin, false), COALESCE(a.is_active, true),
                   COALESCE((SELECT array_agg(m.department_id ORDER BY m.department_id) FROM public.department_members m WHERE m.user_name = n.user_name), '{}')
            FROM names n LEFT JOIN public.agents a ON a.user_name = n.user_name
            ORDER BY n.user_name
            """, conn))
        await using (var r = await cmd.ExecuteReaderAsync(ct))
        {
            while (await r.ReadAsync(ct))
            {
                agentNames.Add(r.GetString(0));
                agents.Add(new
                {
                    userName = r.GetString(0),
                    displayName = r.IsDBNull(1) ? null : r.GetString(1),
                    canSeeAll = r.GetBoolean(2),
                    isAdmin = r.GetBoolean(3),
                    isActive = r.GetBoolean(4),
                    departmentIds = r.GetFieldValue<int[]>(5)
                });
            }
        }

        // Kişinin Asistan GİRİŞ yetkisi var mı (B2B → Kullanıcılar → Asistan kutusu) — "birime ekledim ama
        // giremiyor" baştan görünsün. Yalnız okuma; ERP okunamazsa bilgi boş döner, sayfa çalışır.
        var access = new Dictionary<string, bool>(StringComparer.OrdinalIgnoreCase);
        var names = agentNames.ToArray();
        if (names.Length > 0)
        {
            try
            {
                await using var erp = new NpgsqlConnection(_db.ErpConnectionString(Me.TenantCode));
                await erp.OpenAsync(ct);
                await using var cmd = new NpgsqlCommand("""
                    SELECT lower(u."Username"),
                           COALESCE(r."IsSuperAdmin", false) OR u."AsistanAccess" = true
                    FROM public."Users" u LEFT JOIN public."Roles" r ON r."Id" = u."RoleId"
                    WHERE u."IsActive" = true AND lower(u."Username") = ANY(@names)
                    """, erp);
                cmd.Parameters.AddWithValue("names", names);
                await using var r = await cmd.ExecuteReaderAsync(ct);
                while (await r.ReadAsync(ct)) access[r.GetString(0)] = r.GetBoolean(1);
            }
            catch (NpgsqlException)
            {
                access.Clear();
            }
        }

        var ai = await _ai.GetSettingsAsync(Me.TenantCode, ct);
        var stats = await _ai.DraftStatsAsync(Me.TenantCode, ct);

        // B2B'de bulunamayan (silinmiş/pasif) kullanıcı: access değeri null.
        var sla = await _ops.GetSlaAsync(Me.TenantCode, ct);
        var quick = await _ops.ListQuickRepliesAsync(Me.TenantCode, activeOnly: false, ct);

        return Ok(new
        {
            sla = new { warnMinutes = sla.WarnMinutes, lateMinutes = sla.LateMinutes },
            quickReplies = quick.Select(q => new
            {
                id = q.Id, departmentId = q.DepartmentId, title = q.Title, body = q.Body,
                sortOrder = q.SortOrder, isActive = q.IsActive, useCount = q.UseCount
            }),
            ai = new
            {
                provider = _classifier.Provider,
                model = _classifier.Model,
                enabled = ai.Enabled,
                autoRoute = ai.AutoRoute,
                instructions = ai.Instructions,
                initiativeTopics = ai.InitiativeTopics,
                draftStats30d = stats,
                // 3. aşama: kayıtlara bakış. Bağlantı = sunucuda anahtar tanımlı mı (Tools bölümü).
                toolsEnabled = ai.ToolsEnabled,
                tools = new
                {
                    erp = _toolbox.ErpReady,
                    serviceOps = _toolbox.ServiceOpsReady,
                    names = _toolbox.Definitions.Select(d => d.Name)
                }
            },
            departments,
            agents,
            access = names.ToDictionary(n => n, n => access.TryGetValue(n, out var v) ? (bool?)v : null),
            b2bChecked = access.Count > 0 || names.Length == 0
        });
    }

    public sealed class AiSettingsRequest
    {
        public bool Enabled { get; set; }
        public bool AutoRoute { get; set; }
        public string? Instructions { get; set; }
        public string? InitiativeTopics { get; set; }
        /// <summary>Eski istemci göndermezse açık kalsın (varsayılan).</summary>
        public bool ToolsEnabled { get; set; } = true;
    }

    [HttpPut("ai")]
    public async Task<IActionResult> SaveAi([FromBody] AiSettingsRequest request, CancellationToken ct)
    {
        var (scope, denied) = await RequireAdminAsync(ct);
        if (denied is not null) return denied;
        var ins = request.Instructions?.Trim();
        var top = request.InitiativeTopics?.Trim();
        if (ins?.Length > 4000) return BadRequest(new { message = "Talimat en fazla 4000 karakter olabilir." });
        if (top?.Length > 2000) return BadRequest(new { message = "Konu listesi en fazla 2000 karakter olabilir." });
        await _ai.SaveSettingsAsync(Me.TenantCode,
            new AiSettings(request.Enabled, request.AutoRoute, string.IsNullOrEmpty(ins) ? null : ins, string.IsNullOrEmpty(top) ? null : top, request.ToolsEnabled),
            scope.UserName, ct);
        return Ok(new { success = true });
    }

    public sealed class SlaRequest
    {
        public int WarnMinutes { get; set; }
        public int LateMinutes { get; set; }
    }

    /// <summary>Bekleme uyarısı eşikleri: uyarı (sarı) &lt; gecikme (kırmızı), 1-1440 dk.</summary>
    [HttpPut("sla")]
    public async Task<IActionResult> SaveSla([FromBody] SlaRequest request, CancellationToken ct)
    {
        var (scope, denied) = await RequireAdminAsync(ct);
        if (denied is not null) return denied;
        if (request.WarnMinutes is < 1 or > 1440 || request.LateMinutes is < 1 or > 1440)
            return BadRequest(new { message = "Süreler 1 ile 1440 dakika arasında olmalı." });
        if (request.WarnMinutes >= request.LateMinutes)
            return BadRequest(new { message = "Uyarı süresi gecikme süresinden kısa olmalı." });
        await _ops.SaveSlaAsync(Me.TenantCode, new SlaSettings(request.WarnMinutes, request.LateMinutes), scope.UserName, ct);
        return Ok(new { success = true });
    }

    public sealed class QuickReplyRequest
    {
        /// <summary>Birim; null = bütün birimler.</summary>
        public int? DepartmentId { get; set; }
        public string? Title { get; set; }
        public string? Body { get; set; }
        public int SortOrder { get; set; }
        public bool IsActive { get; set; } = true;
    }

    private async Task<IActionResult?> ValidateQuickReplyAsync(QuickReplyRequest r, CancellationToken ct)
    {
        var title = (r.Title ?? string.Empty).Trim();
        var body = (r.Body ?? string.Empty).Trim();
        if (title.Length is 0 or > OpsStore.MaxTitle) return BadRequest(new { message = $"Başlık 1-{OpsStore.MaxTitle} karakter olmalı." });
        if (body.Length is 0 or > OpsStore.MaxBody) return BadRequest(new { message = $"Metin 1-{OpsStore.MaxBody} karakter olmalı." });
        if (r.DepartmentId is int dep)
        {
            await using var conn = await OpenAsync(ct);
            await using var cmd = new NpgsqlCommand("SELECT COUNT(*) FROM public.departments WHERE id = @d", conn);
            cmd.Parameters.AddWithValue("d", dep);
            if ((long)(await cmd.ExecuteScalarAsync(ct))! == 0) return BadRequest(new { message = "Birim bulunamadı." });
        }
        return null;
    }

    [HttpPost("quick-replies")]
    public async Task<IActionResult> CreateQuickReply([FromBody] QuickReplyRequest request, CancellationToken ct)
    {
        var (scope, denied) = await RequireAdminAsync(ct);
        if (denied is not null) return denied;
        if (await ValidateQuickReplyAsync(request, ct) is { } bad) return bad;
        var id = await _ops.CreateQuickReplyAsync(Me.TenantCode, request.DepartmentId, request.Title!.Trim(), request.Body!.Trim(), request.SortOrder, scope.UserName, ct);
        return Ok(new { id });
    }

    [HttpPut("quick-replies/{id:int}")]
    public async Task<IActionResult> UpdateQuickReply(int id, [FromBody] QuickReplyRequest request, CancellationToken ct)
    {
        var (_, denied) = await RequireAdminAsync(ct);
        if (denied is not null) return denied;
        if (await ValidateQuickReplyAsync(request, ct) is { } bad) return bad;
        return await _ops.UpdateQuickReplyAsync(Me.TenantCode, id, request.DepartmentId, request.Title!.Trim(), request.Body!.Trim(), request.SortOrder, request.IsActive, ct)
            ? Ok(new { success = true })
            : NotFound();
    }

    [HttpDelete("quick-replies/{id:int}")]
    public async Task<IActionResult> DeleteQuickReply(int id, CancellationToken ct)
    {
        var (_, denied) = await RequireAdminAsync(ct);
        if (denied is not null) return denied;
        return await _ops.DeleteQuickReplyAsync(Me.TenantCode, id, ct) ? Ok(new { success = true }) : NotFound();
    }

    public sealed class DepartmentRequest
    {
        public string? Name { get; set; }
        /// <summary>Asistana bu birimin hangi konulara baktığını anlatan metin. Boş metin = açıklama yok (varsayılan geri gelmez).</summary>
        public string? AiDescription { get; set; }
        public int? SortOrder { get; set; }
        public bool? IsActive { get; set; }
    }

    [HttpPost("departments")]
    public async Task<IActionResult> CreateDepartment([FromBody] DepartmentRequest request, CancellationToken ct)
    {
        var (_, denied) = await RequireAdminAsync(ct);
        if (denied is not null) return denied;
        var name = (request.Name ?? string.Empty).Trim();
        if (name.Length is 0 or > 60) return BadRequest(new { message = "Birim adı 1-60 karakter olmalı." });

        await using var conn = await OpenAsync(ct);
        await using var cmd = new NpgsqlCommand("""
            INSERT INTO public.departments (code, name, sort_order, ai_description)
            VALUES (@code, @name, COALESCE(@sort, (SELECT COALESCE(MAX(sort_order), 0) + 10 FROM public.departments)), @desc)
            RETURNING id
            """, conn);
        cmd.Parameters.AddWithValue("desc", (request.AiDescription ?? string.Empty).Trim());
        cmd.Parameters.AddWithValue("code", "ozel_" + Guid.NewGuid().ToString("N")[..8]);
        cmd.Parameters.AddWithValue("name", name);
        cmd.Parameters.AddWithValue("sort", (object?)request.SortOrder ?? DBNull.Value);
        var id = (int)(await cmd.ExecuteScalarAsync(ct))!;
        return Ok(new { id });
    }

    [HttpPut("departments/{id:int}")]
    public async Task<IActionResult> UpdateDepartment(int id, [FromBody] DepartmentRequest request, CancellationToken ct)
    {
        var (_, denied) = await RequireAdminAsync(ct);
        if (denied is not null) return denied;
        var name = request.Name?.Trim();
        if (name is not null && name.Length is 0 or > 60) return BadRequest(new { message = "Birim adı 1-60 karakter olmalı." });
        var desc = request.AiDescription?.Trim();
        if (desc?.Length > 600) return BadRequest(new { message = "Birim açıklaması en fazla 600 karakter olabilir." });

        await using var conn = await OpenAsync(ct);
        await using var cmd = new NpgsqlCommand("""
            UPDATE public.departments
               SET name = COALESCE(@name, name), sort_order = COALESCE(@sort, sort_order), is_active = COALESCE(@active, is_active),
                   ai_description = CASE WHEN @descSet THEN @desc ELSE ai_description END   -- boş metin NULL değil: açılıştaki varsayılan doldurma onu ezmesin
             WHERE id = @id
            """, conn);
        cmd.Parameters.AddWithValue("descSet", desc is not null);
        cmd.Parameters.AddWithValue("desc", desc ?? string.Empty);
        cmd.Parameters.AddWithValue("id", id);
        cmd.Parameters.AddWithValue("name", (object?)name ?? DBNull.Value);
        cmd.Parameters.AddWithValue("sort", (object?)request.SortOrder ?? DBNull.Value);
        cmd.Parameters.AddWithValue("active", (object?)request.IsActive ?? DBNull.Value);
        return await cmd.ExecuteNonQueryAsync(ct) > 0 ? Ok(new { success = true }) : NotFound();
    }

    public sealed class AgentRequest
    {
        public string? DisplayName { get; set; }
        public bool CanSeeAll { get; set; }
        public bool IsAdmin { get; set; }
        public bool IsActive { get; set; } = true;
        public List<int>? DepartmentIds { get; set; }
    }

    /// <summary>Kişinin asistan ayarları (yoksa açılır). Birim listesi TAMAMEN değiştirilir.</summary>
    [HttpPut("agents/{userName}")]
    public async Task<IActionResult> SaveAgent(string userName, [FromBody] AgentRequest request, CancellationToken ct)
    {
        var (scope, denied) = await RequireAdminAsync(ct);
        if (denied is not null) return denied;

        var key = InboxAccess.Key(userName);
        if (key.Length is 0 or > 100) return BadRequest(new { message = "Kullanıcı adı geçersiz." });

        // Kendi yöneticiliğini kaldırmak, rolü süper yönetici değilse kişiyi Ayarlar'dan kilitler.
        if (key == scope.UserName && !request.IsAdmin && !Me.IsSsa && !await IsSuperRoleAsync(ct))
            return BadRequest(new { message = "Kendi yöneticiliğinizi kaldıramazsınız; başka bir yöneticiye yaptırın." });

        var deps = (request.DepartmentIds ?? new List<int>()).Distinct().ToArray();

        await using var conn = await OpenAsync(ct);
        await using var tx = await conn.BeginTransactionAsync(ct);

        if (deps.Length > 0)
        {
            await using var chk = new NpgsqlCommand("SELECT COUNT(*) FROM public.departments WHERE id = ANY(@d)", conn, tx);
            chk.Parameters.AddWithValue("d", deps);
            if ((long)(await chk.ExecuteScalarAsync(ct))! != deps.Length) return BadRequest(new { message = "Birim listesinde tanımsız birim var." });
        }

        await using (var up = new NpgsqlCommand("""
            INSERT INTO public.agents (user_name, display_name, can_see_all, is_admin, is_active, updated_at, updated_by)
            VALUES (@u, @dn, @all, @adm, @act, now(), @by)
            ON CONFLICT (user_name) DO UPDATE
               SET display_name = EXCLUDED.display_name, can_see_all = EXCLUDED.can_see_all, is_admin = EXCLUDED.is_admin,
                   is_active = EXCLUDED.is_active, updated_at = now(), updated_by = EXCLUDED.updated_by
            """, conn, tx))
        {
            up.Parameters.AddWithValue("u", key);
            up.Parameters.AddWithValue("dn", (object?)request.DisplayName?.Trim() ?? DBNull.Value);
            up.Parameters.AddWithValue("all", request.CanSeeAll);
            up.Parameters.AddWithValue("adm", request.IsAdmin);
            up.Parameters.AddWithValue("act", request.IsActive);
            up.Parameters.AddWithValue("by", scope.UserName);
            await up.ExecuteNonQueryAsync(ct);
        }
        await using (var del = new NpgsqlCommand("DELETE FROM public.department_members WHERE user_name = @u", conn, tx))
        {
            del.Parameters.AddWithValue("u", key);
            await del.ExecuteNonQueryAsync(ct);
        }
        if (deps.Length > 0)
        {
            await using var ins = new NpgsqlCommand("""
                INSERT INTO public.department_members (department_id, user_name) SELECT unnest(@d), @u
                """, conn, tx);
            ins.Parameters.AddWithValue("d", deps);
            ins.Parameters.AddWithValue("u", key);
            await ins.ExecuteNonQueryAsync(ct);
        }
        await tx.CommitAsync(ct);
        return Ok(new { success = true });
    }

    /// <summary>
    /// Kişi seçimi için B2B kullanıcıları (aktif). <c>hasAccess</c>: Asistan'a girebilir mi
    /// (B2B → Kullanıcılar → "Asistan (WhatsApp)" kutusu ya da süper yönetici rolü). Yalnız okuma.
    /// </summary>
    [HttpGet("b2b-users")]
    public async Task<IActionResult> B2BUsers([FromQuery] string? q, CancellationToken ct)
    {
        var (_, denied) = await RequireAdminAsync(ct);
        if (denied is not null) return denied;

        await using var conn = new NpgsqlConnection(_db.ErpConnectionString(Me.TenantCode));
        await conn.OpenAsync(ct);
        await using var cmd = new NpgsqlCommand("""
            SELECT u."Username", COALESCE(u."Unvan", ''), COALESCE(r."Name", ''),
                   COALESCE(r."IsSuperAdmin", false) OR u."AsistanAccess" = true
            FROM public."Users" u
            LEFT JOIN public."Roles" r ON r."Id" = u."RoleId"
            WHERE u."IsActive" = true
              AND (@q = '' OR u."Username" ILIKE @like OR u."Unvan" ILIKE @like)
            ORDER BY u."Username"
            LIMIT 50
            """, conn);
        var term = (q ?? string.Empty).Trim();
        cmd.Parameters.AddWithValue("q", term);
        cmd.Parameters.AddWithValue("like", "%" + term + "%");

        var list = new List<object>();
        await using var r = await cmd.ExecuteReaderAsync(ct);
        while (await r.ReadAsync(ct))
            list.Add(new { userName = r.GetString(0), title = r.GetString(1), role = r.GetString(2), hasAccess = r.GetBoolean(3) });
        return Ok(list);
    }

    private async Task<bool> IsSuperRoleAsync(CancellationToken ct)
    {
        if (Me.RoleId is not int roleId) return false;
        await using var conn = new NpgsqlConnection(_db.ErpConnectionString(Me.TenantCode));
        await conn.OpenAsync(ct);
        await using var cmd = new NpgsqlCommand("SELECT \"IsSuperAdmin\" FROM public.\"Roles\" WHERE \"Id\" = @id", conn);
        cmd.Parameters.AddWithValue("id", roleId);
        return await cmd.ExecuteScalarAsync(ct) is true;
    }
}
