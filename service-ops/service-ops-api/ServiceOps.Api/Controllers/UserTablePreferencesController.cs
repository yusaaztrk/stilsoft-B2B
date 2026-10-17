using System.Collections.Concurrent;
using System.Data;
using System.Security.Claims;
using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using ServiceOps.Api.Filters;
using ServiceOps.Infrastructure.Data;

namespace ServiceOps.Api.Controllers;

/// <summary>
/// TABLO AYARLARI — KULLANICI BAZLI (2026-10-11, kullanıcı isteği; B2B'deki ucun Servis eşi).
///
/// Tabloların sol altındaki "Ayarlar" düğmesinden yapılan seçimler (gizlenen sütunlar, sütun sırası,
/// genişlikler) burada saklanır; kullanıcı sayfaya tekrar geldiğinde tablo aynı ayarla açılır.
/// Değer ekranın yazdığı küçük bir JSON'dur, sunucu içine bakmaz.
///
/// KİMLİK KULLANICI ADIDIR: B2B'den devirle gelen kullanıcı ile Servis'in kendi kullanıcısı arasında
/// ortak ve kalıcı olan tek kimlik bu (token'daki `sub` her iki yolda farklı üretiliyor).
///
/// Sayfa yetkisi aranmaz: kişinin kendi görünüm tercihi, iş verisi değil. Şema EF göçüyle değil
/// ilk kullanımda kurulur — tablo yalnız bu uçtan kullanılıyor, göç zincirine bağlamaya değmez.
/// </summary>
[ApiController]
[Route("api/user-table-preferences")]
[Authorize]
[AllowWriteWithoutPageScope("Tablo görünüm ayarı kullanıcının kendi tercihidir; iş verisi değildir ve sayfa yetkisi gerektirmez.")]
public sealed class UserTablePreferencesController : ControllerBase
{
    private const int MaxKeyLength = 300;
    private const int MaxValueLength = 20_000;
    private const int MaxRowsPerUser = 600;

    private static readonly ConcurrentDictionary<string, bool> EnsuredDatabases = new();

    private readonly ApplicationDbContext _db;

    public UserTablePreferencesController(ApplicationDbContext db)
    {
        _db = db;
    }

    private string? UserKey()
    {
        var name = (User.FindFirstValue(ClaimTypes.Name) ?? User.Identity?.Name ?? string.Empty).Trim().ToLowerInvariant();
        return name.Length is > 0 and <= 150 ? $"n:{name}" : null;
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
