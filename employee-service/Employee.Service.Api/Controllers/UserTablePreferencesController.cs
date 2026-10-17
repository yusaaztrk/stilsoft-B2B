using System.Collections.Concurrent;
using System.Data;
using System.Security.Claims;
using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using B2B.Erp.Api.Data;

namespace B2B.Erp.Api.Controllers;

/// <summary>
/// TABLO AYARLARI — KULLANICI BAZLI, PERSONEL PROGRAMI (2026-10-14 kullanıcı isteği: "servis ve
/// b2b'deki tablo ayarlarının aynısı personel programında da olsun"). Servis'teki ucun birebir eşi.
///
/// Tabloların altındaki "Ayarlar" düğmesinden yapılan seçimler (gizlenen sütunlar, genişlikler)
/// burada saklanır. Tablo ERP ile ORTAK firma veritabanında; satırlar "p:" önekiyle ayrılır, ERP'nin
/// (u:/n:) kayıtlarına karışmaz. Sayfa yetkisi aranmaz: kişinin kendi görünüm tercihi, iş verisi değil.
/// </summary>
[ApiController]
[Route("api/user-table-preferences")]
[Authorize]
public sealed class UserTablePreferencesController : ControllerBase
{
    private const int MaxKeyLength = 300;
    private const int MaxValueLength = 20_000;
    private const int MaxRowsPerUser = 600;

    private static readonly ConcurrentDictionary<string, bool> EnsuredDatabases = new();

    private readonly AppDbContext _db;

    public UserTablePreferencesController(AppDbContext db)
    {
        _db = db;
    }

    private string? UserKey()
    {
        var name = (User.FindFirstValue(ClaimTypes.Name) ?? User.Identity?.Name ?? string.Empty).Trim().ToLowerInvariant();
        return name.Length is > 0 and <= 150 ? $"p:{name}" : null;
    }

    private async Task<NpgsqlConnection> OpenAsync(CancellationToken ct)
    {
        var conn = (NpgsqlConnection)_db.Database.GetDbConnection();
        if (conn.State != ConnectionState.Open) await conn.OpenAsync(ct);

        var key = $"{conn.Host}:{conn.Port}/{conn.Database}";
        if (!EnsuredDatabases.ContainsKey(key))
        {
            await using var ddl = new NpgsqlCommand("""
                CREATE TABLE IF NOT EXISTS "UserTablePreferences" (
                    "UserKey"   character varying(160) NOT NULL,
                    "Key"       character varying(300) NOT NULL,
                    "Value"     text NOT NULL,
                    "UpdatedAt" timestamp with time zone NOT NULL DEFAULT now(),
                    CONSTRAINT "PK_UserTablePreferences" PRIMARY KEY ("UserKey", "Key")
                );
                """, conn);
            await ddl.ExecuteNonQueryAsync(ct);
            EnsuredDatabases[key] = true;
        }
        return conn;
    }

    [HttpGet]
    public async Task<IActionResult> List(CancellationToken ct)
    {
        var userKey = UserKey();
        if (userKey is null) return Ok(new { success = true, data = new Dictionary<string, JsonElement>() });

        var conn = await OpenAsync(ct);
        await using var cmd = new NpgsqlCommand("SELECT \"Key\", \"Value\" FROM \"UserTablePreferences\" WHERE \"UserKey\" = @u", conn);
        cmd.Parameters.AddWithValue("u", userKey);

        var data = new Dictionary<string, JsonElement>();
        await using var r = await cmd.ExecuteReaderAsync(ct);
        while (await r.ReadAsync(ct))
        {
            try
            {
                using var doc = JsonDocument.Parse(r.GetString(1));
                data[r.GetString(0)] = doc.RootElement.Clone();
            }
            catch (JsonException)
            {
                // Bozuk satır ekranı kilitlemesin; o tablo varsayılanla açılır.
            }
        }
        return Ok(new { success = true, data });
    }

    public sealed class SaveRequest
    {
        public string? Key { get; set; }
        /// <summary>null / verilmemiş = bu tablonun ayarını sil (varsayılana dön).</summary>
        public JsonElement? Value { get; set; }
    }

    [HttpPut]
    public async Task<IActionResult> Save([FromBody] SaveRequest request, CancellationToken ct)
    {
        var userKey = UserKey();
        if (userKey is null) return Unauthorized();

        var key = (request.Key ?? string.Empty).Trim();
        if (key.Length is 0 or > MaxKeyLength) return BadRequest(new { success = false, message = "Tablo anahtarı geçersiz." });

        var conn = await OpenAsync(ct);

        var isEmpty = request.Value is null || request.Value.Value.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined;
        if (isEmpty)
        {
            await using var del = new NpgsqlCommand("DELETE FROM \"UserTablePreferences\" WHERE \"UserKey\" = @u AND \"Key\" = @k", conn);
            del.Parameters.AddWithValue("u", userKey);
            del.Parameters.AddWithValue("k", key);
            await del.ExecuteNonQueryAsync(ct);
            return Ok(new { success = true });
        }

        if (request.Value!.Value.ValueKind != JsonValueKind.Object)
            return BadRequest(new { success = false, message = "Ayar bir nesne olmalı." });
        var json = request.Value.Value.GetRawText();
        if (json.Length > MaxValueLength) return BadRequest(new { success = false, message = "Ayar çok büyük." });

        // Tavan yalnız YENİ anahtar için: var olan anahtarı güncellemek her zaman serbest.
        await using (var count = new NpgsqlCommand("""
            SELECT (SELECT COUNT(*) FROM "UserTablePreferences" WHERE "UserKey" = @u),
                   EXISTS (SELECT 1 FROM "UserTablePreferences" WHERE "UserKey" = @u AND "Key" = @k)
            """, conn))
        {
            count.Parameters.AddWithValue("u", userKey);
            count.Parameters.AddWithValue("k", key);
            await using var r = await count.ExecuteReaderAsync(ct);
            if (await r.ReadAsync(ct) && r.GetInt64(0) >= MaxRowsPerUser && !r.GetBoolean(1))
                return BadRequest(new { success = false, message = "Kayıtlı tablo ayarı sayısı sınırına ulaşıldı." });
        }

        await using var cmd = new NpgsqlCommand("""
            INSERT INTO "UserTablePreferences" ("UserKey", "Key", "Value", "UpdatedAt")
            VALUES (@u, @k, @v, now())
            ON CONFLICT ("UserKey", "Key") DO UPDATE SET "Value" = EXCLUDED."Value", "UpdatedAt" = now()
            """, conn);
        cmd.Parameters.AddWithValue("u", userKey);
        cmd.Parameters.AddWithValue("k", key);
        cmd.Parameters.AddWithValue("v", json);
        await cmd.ExecuteNonQueryAsync(ct);
        return Ok(new { success = true });
    }
}
