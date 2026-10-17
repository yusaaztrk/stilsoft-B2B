using B2B.Erp.Api.Data;
using B2B.Erp.Api.Data.Services;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace B2B.Erp.Api.Core.Services;

/// <summary>
/// MONTAJ BEKLEYEN — Stok Giriş/Çıkış Raporu'nun kolonu (2026-10-11 yeniden yazıldı; kullanıcı:
/// "montaj bekleyenler hep bozuk").
///
/// <para><b>Eski hata:</b> rapor ERP'deki <c>Installations</c> tablosunu okuyordu. O tablo montaj
/// modülünün ESKİ hâli; montaj 2026-08'den beri ServiceOps'ta kalem + görev satırlarıyla yürüyor ve
/// ERP tablosu artık beslenmiyor (yalnız eski "api/montaj" girişi yazıyor). Eşleşme de sipariş satırı
/// ya da ÜRÜN ADI üzerindendi. Sonuç: kolon ya boş ya rastgele.</para>
///
/// <para><b>Şimdiki tanım</b> (ServiceOps <c>b2b_serviceops_tenant_*</c> veritabanı, aynı sunucu):
/// montaj kaydı (Type = Installation), kayıt İptal (6) ya da Tamamlandı/Ready (4) DEĞİL; kayıttaki
/// iptal edilmemiş her kalem için <c>kalem adedi − tamamlanmış (Completed) görev adedi</c>.
/// "Teslim edildi, montaj bekliyor" (Delivered/Postponed) ve "Ulaşılamadı" satırları BEKLEYEN sayılır.
/// Kaleme bağlanmamış eski görevleri olan kayıtlarda (2026-08-10 öncesi) bekleyen = bitmemiş/iptal
/// edilmemiş görev adedi.</para>
///
/// ServiceOps'a ulaşılamazsa (veritabanı yok/erişim yok) <c>null</c> döner; rapor yine çalışır,
/// kolon "—" gösterir — rakam uydurulmaz.
/// </summary>
public static class MontajBekleyenQuery
{
    private const string PendingCte = """
        WITH kayit AS (
            SELECT r."Id", r."ServiceNumber", r."ProductStockCode", r."CustomerName", r."CustomerPhone",
                   r."CustomerAddress", r."DealerName", r."Status", r."PlannedAt", r."CreatedAt"
            FROM "ServiceRecords" r
            WHERE r."Type" = 1 AND r."Status" NOT IN (4, 6) AND NOT COALESCE(r."IsDeleted", false)
        ),
        eski AS (   -- kaleme bağlanmamış görevi olan (eski model) kayıtlar
            SELECT DISTINCT t."ServiceId" FROM "InstallationTasks" t
            WHERE t."ServiceRecordItemId" IS NULL AND t."Status" <> 3
        ),
        kalem AS (
            SELECT k."Id" AS kid, i."Id" AS iid, upper(trim(i."ProductStockCode")) AS sc, i."ProductName" AS ad,
                   i."Quantity"
                   - COALESCE((SELECT sum(t."Quantity") FROM "InstallationTasks" t
                               WHERE t."ServiceRecordItemId" = i."Id" AND t."Status" = 2), 0) AS bekleyen,
                   COALESCE(i."CustomerName", k."CustomerName") AS musteri,
                   COALESCE(i."CustomerPhone", k."CustomerPhone") AS telefon,
                   COALESCE(i."CustomerAddress", k."CustomerAddress") AS adres
            FROM kayit k
            JOIN "ServiceRecordItems" i ON i."ServiceId" = k."Id"
            WHERE i."CancelledAt" IS NULL AND COALESCE(trim(i."ProductStockCode"), '') <> ''
              AND k."Id" NOT IN (SELECT "ServiceId" FROM eski)
            UNION ALL
            SELECT k."Id", NULL, upper(trim(COALESCE(
                       (SELECT min(i."ProductStockCode") FROM "ServiceRecordItems" i WHERE i."ServiceId" = k."Id" AND i."CancelledAt" IS NULL),
                       k."ProductStockCode"))), NULL,
                   (SELECT COALESCE(sum(t."Quantity"), 0) FROM "InstallationTasks" t
                    WHERE t."ServiceId" = k."Id" AND t."ServiceRecordItemId" IS NULL AND t."Status" NOT IN (2, 3)),
                   k."CustomerName", k."CustomerPhone", k."CustomerAddress"
            FROM kayit k
            WHERE k."Id" IN (SELECT "ServiceId" FROM eski)
        )
        """;

    /// <summary>Stok kodu (BÜYÜK harf) → bekleyen adet. Ulaşılamazsa null.</summary>
    public static async Task<Dictionary<string, decimal>?> ToplamlarAsync(
        AppDbContext db, TenantConnectionStringResolver resolver, MasterDbContext master, ILogger log, CancellationToken ct)
    {
        try
        {
            await using var conn = await OpenAsync(db, resolver, master, ct);
            if (conn is null) return null;
            await using var cmd = new NpgsqlCommand(PendingCte + """
                SELECT sc, sum(bekleyen) FROM kalem WHERE bekleyen > 0 AND COALESCE(sc, '') <> '' GROUP BY sc
                """, conn);
            var result = new Dictionary<string, decimal>(StringComparer.OrdinalIgnoreCase);
            await using var rd = await cmd.ExecuteReaderAsync(ct);
            while (await rd.ReadAsync(ct)) result[rd.GetString(0)] = Convert.ToDecimal(rd.GetValue(1));
            return result;
        }
        catch (Exception ex) when (ex is NpgsqlException or InvalidOperationException)
        {
            log.LogWarning(ex, "Montaj bekleyen okunamadı (ServiceOps veritabanı)");
            return null;
        }
    }

    public sealed record Detay(Guid Id, string ServiceNumber, string? DealerName, string? CustomerName, string? CustomerPhone,
        string? Address, DateTime? PlannedAt, DateTime CreatedAt, int Status, decimal Quantity, string? ProductName);

    /// <summary>Bir stok kodunun bekleyen montajları (pencere). Ulaşılamazsa null.</summary>
    public static async Task<List<Detay>?> DetayAsync(
        AppDbContext db, TenantConnectionStringResolver resolver, MasterDbContext master, ILogger log, string stockCode, CancellationToken ct)
    {
        try
        {
            await using var conn = await OpenAsync(db, resolver, master, ct);
            if (conn is null) return null;
            await using var cmd = new NpgsqlCommand(PendingCte + """
                SELECT k."Id", k."ServiceNumber", k."DealerName", m.musteri, m.telefon, m.adres, k."PlannedAt", k."CreatedAt",
                       k."Status", sum(m.bekleyen), max(m.ad)
                FROM kalem m JOIN kayit k ON k."Id" = m.kid
                WHERE m.bekleyen > 0 AND m.sc = upper(trim(@sc))
                GROUP BY k."Id", k."ServiceNumber", k."DealerName", m.musteri, m.telefon, m.adres, k."PlannedAt", k."CreatedAt", k."Status"
                ORDER BY k."CreatedAt"
                """, conn);
            cmd.Parameters.AddWithValue("sc", stockCode);
            var list = new List<Detay>();
            await using var rd = await cmd.ExecuteReaderAsync(ct);
            while (await rd.ReadAsync(ct))
            {
                list.Add(new Detay(
                    rd.GetGuid(0),
                    rd.IsDBNull(1) ? string.Empty : rd.GetString(1),
                    rd.IsDBNull(2) ? null : rd.GetString(2),
                    rd.IsDBNull(3) ? null : rd.GetString(3),
                    rd.IsDBNull(4) ? null : rd.GetString(4),
                    rd.IsDBNull(5) ? null : rd.GetString(5),
                    rd.IsDBNull(6) ? null : rd.GetDateTime(6),
                    rd.GetDateTime(7),
                    rd.GetInt32(8),
                    Convert.ToDecimal(rd.GetValue(9)),
                    rd.IsDBNull(10) ? null : rd.GetString(10)));
            }
            return list;
        }
        catch (Exception ex) when (ex is NpgsqlException or InvalidOperationException)
        {
            log.LogWarning(ex, "Montaj bekleyen detayı okunamadı (ServiceOps veritabanı)");
            return null;
        }
    }

    /// <summary>
    /// ServiceOps veritabanını açar. Ad önce ana veritabanındaki firma kaydından
    /// (<c>Tenants.ServiceOpsDbName</c>), yoksa ServiceOps'un kendi kuralından
    /// (<c>b2b_serviceops_tenant_</c> + normalize edilmiş firma kodu) gelir. Sunucu/kullanıcı ERP'ninkiyle aynı.
    /// </summary>
    private static async Task<NpgsqlConnection?> OpenAsync(
        AppDbContext db, TenantConnectionStringResolver resolver, MasterDbContext master, CancellationToken ct)
    {
        var erpConn = db.Database.GetConnectionString();
        if (string.IsNullOrWhiteSpace(erpConn)) return null;

        var code = resolver.GetCurrentTenantCode()?.Trim().ToUpperInvariant();
        if (string.IsNullOrWhiteSpace(code))
        {
            var erpDb = new NpgsqlConnectionStringBuilder(erpConn).Database ?? string.Empty;
            const string prefix = "b2b_erp_tenant_";
            if (!erpDb.StartsWith(prefix, StringComparison.OrdinalIgnoreCase)) return null;
            code = erpDb[prefix.Length..];
        }

        string? dbName = null;
        try
        {
            dbName = await master.Tenants.AsNoTracking()
                .Where(t => t.Code == code)
                .Select(t => t.ServiceOpsDbName)
                .FirstOrDefaultAsync(ct);
        }
        catch (Exception ex) when (ex is NpgsqlException or InvalidOperationException)
        {
            // Ana veritabanı okunamazsa kurala düşülür.
        }
        if (string.IsNullOrWhiteSpace(dbName)) dbName = "b2b_serviceops_tenant_" + Normalize(code);

        var csb = new NpgsqlConnectionStringBuilder(erpConn) { Database = dbName, Timeout = 5, CommandTimeout = 30 };
        var conn = new NpgsqlConnection(csb.ConnectionString);
        await conn.OpenAsync(ct);
        return conn;
    }

    /// <summary>ServiceOps <c>TenantConnectionStringResolver.NormalizeTenantCode</c> ile birebir.</summary>
    private static string Normalize(string code)
    {
        var sb = new System.Text.StringBuilder(code.Length);
        foreach (var ch in code.Trim().ToUpperInvariant())
            sb.Append((ch >= 'A' && ch <= 'Z') || (ch >= '0' && ch <= '9') || ch == '_' ? ch : '_');
        var n = sb.ToString();
        while (n.Contains("__")) n = n.Replace("__", "_");
        return n.Trim('_');
    }
}
