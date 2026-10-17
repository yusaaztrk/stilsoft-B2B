using B2B.Erp.Api.Data;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace B2B.Erp.Api.Core.Services;

/// <summary>
/// OTOMATİK ÇIKIŞ (2026-10-16 kullanıcı isteği: "23.00'a kadar gün içinde personel çıkış yapmadıysa
/// 18.00'e atsın çıkışı otomatik").
///
/// <para>Her 10 dakikada bir, aktif her firmanın veritabanında açık kalmış mesai kayıtlarını kapatır:</para>
/// <list type="bullet">
/// <item>Girişi BUGÜN olan kayıt, saat 23:00'ten (Türkiye saati) sonra;</item>
/// <item>Girişi önceki bir günde kalmış kayıt hemen (sunucu kapalıyken kaçırılmış olabilir).</item>
/// </list>
/// <para>Çıkış saati = giriş gününün 18:00'i. Giriş 18:00 ya da sonrasındaysa (akşam vardiyası) o günün
/// 23:00'ü — yoksa çıkış girişten önce olurdu. Kayıt <c>CheckOutAuto = true</c> işaretlenir; takvimde ayrı
/// renkte görünür, elle düzeltilebilir. Konum yazılmaz (personel çıkış basmadı).</para>
///
/// <para>Ham SQL ile çalışır: istek dışında (HttpContext yok) firma DbContext'i çözülemez; firma listesi
/// ana veritabanından okunur, bağlantı adresi DefaultConnection'dan türetilir.</para>
/// </summary>
public sealed class AutoCheckOutWorker : BackgroundService
{
    private static readonly TimeSpan Interval = TimeSpan.FromMinutes(10);

    private readonly IServiceScopeFactory _scopeFactory;
    private readonly IConfiguration _configuration;
    private readonly ILogger<AutoCheckOutWorker> _logger;

    public AutoCheckOutWorker(IServiceScopeFactory scopeFactory, IConfiguration configuration, ILogger<AutoCheckOutWorker> logger)
    {
        _scopeFactory = scopeFactory;
        _configuration = configuration;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        // Açılışta biraz bekle: şema ve diğer açılış işleri bitsin.
        try { await Task.Delay(TimeSpan.FromSeconds(30), stoppingToken); } catch (OperationCanceledException) { return; }

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await RunOnceAsync(stoppingToken);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                _logger.LogWarning(ex, "Otomatik çıkış turu başarısız");
            }

            try { await Task.Delay(Interval, stoppingToken); } catch (OperationCanceledException) { return; }
        }
    }

    /// <summary>Tek tur — test için de çağrılabilir. Kapatılan kayıt sayısını döner.</summary>
    public async Task<int> RunOnceAsync(CancellationToken cancellationToken)
    {
        var defaultConn = _configuration.GetConnectionString("DefaultConnection");
        if (string.IsNullOrWhiteSpace(defaultConn)) return 0;

        List<string> dbNames;
        using (var scope = _scopeFactory.CreateScope())
        {
            var master = scope.ServiceProvider.GetRequiredService<MasterDbContext>();
            dbNames = await master.Tenants.AsNoTracking()
                .Where(x => x.IsActive && x.DbName != null && x.DbName != "")
                .Select(x => x.DbName)
                .Distinct()
                .ToListAsync(cancellationToken);
        }

        var total = 0;
        foreach (var db in dbNames)
        {
            try
            {
                total += await CloseOpenCheckInsAsync(new NpgsqlConnectionStringBuilder(defaultConn) { Database = db }.ConnectionString, cancellationToken);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                // Bir firmanın veritabanı erişilemezse diğerleri etkilenmesin.
                _logger.LogWarning(ex, "Otomatik çıkış: {Db} atlandı", db);
            }
        }
        return total;
    }

    private async Task<int> CloseOpenCheckInsAsync(string conn, CancellationToken cancellationToken)
    {
        await using var c = new NpgsqlConnection(conn);
        await c.OpenAsync(cancellationToken);

        // Tablo yoksa (personel modülü kurulmamış firma) dokunma.
        await using (var exists = new NpgsqlCommand("SELECT to_regclass('\"EmployeeCheckIns\"') IS NOT NULL", c))
        {
            if (!(bool)(await exists.ExecuteScalarAsync(cancellationToken) ?? false)) return 0;
        }

        await using (var ddl = new NpgsqlCommand(
            "ALTER TABLE \"EmployeeCheckIns\" ADD COLUMN IF NOT EXISTS \"CheckOutAuto\" boolean NOT NULL DEFAULT FALSE;", c))
        {
            await ddl.ExecuteNonQueryAsync(cancellationToken);
        }

        // Türkiye saatinde: giriş günü bugünden önceyse ya da (bugünse ve saat 23:00'ü geçtiyse) kapat.
        const string sql = """
            WITH yerel AS (
                SELECT "Id",
                       ("CheckInTime" AT TIME ZONE 'Europe/Istanbul') AS giris_yerel,
                       ("CheckInTime" AT TIME ZONE 'Europe/Istanbul')::date AS giris_gunu
                FROM "EmployeeCheckIns"
                WHERE "CheckOutTime" IS NULL
            ),
            simdi AS (SELECT (now() AT TIME ZONE 'Europe/Istanbul') AS t)
            UPDATE "EmployeeCheckIns" x
            SET "CheckOutTime" = (CASE WHEN y.giris_yerel::time < time '18:00'
                                       THEN y.giris_gunu + time '18:00'
                                       ELSE y.giris_gunu + time '23:00' END) AT TIME ZONE 'Europe/Istanbul',
                "CheckOutAuto" = TRUE,
                "CheckOutLatitude" = 0,
                "CheckOutLongitude" = 0,
                "EditUser" = 'otomatik-cikis',
                "EditTime" = now()
            FROM yerel y, simdi s
            WHERE x."Id" = y."Id"
              AND (y.giris_gunu < s.t::date OR (y.giris_gunu = s.t::date AND s.t::time >= time '23:00'))
            """;
        await using var cmd = new NpgsqlCommand(sql, c);
        var n = await cmd.ExecuteNonQueryAsync(cancellationToken);
        if (n > 0) _logger.LogInformation("Otomatik çıkış: {Count} kayıt kapatıldı ({Db})", n, c.Database);
        return n;
    }
}
