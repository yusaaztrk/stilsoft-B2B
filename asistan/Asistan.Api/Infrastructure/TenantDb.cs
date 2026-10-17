using System.Collections.Concurrent;
using System.Text.RegularExpressions;
using Npgsql;

namespace Asistan.Api.Infrastructure;

/// <summary>
/// Firma (tenant) veritabanı bağlantıları.
///
/// Mağaza API'sinden (Shop.Api TenantResolver) farkı: firma isteğin alan adından gelmiyor.
/// WhatsApp webhook'unda hiçbir kimlik yok; firma mesajın geldiği numaradan (Phone Number ID →
/// <c>WhatsApp:Numbers</c>) bulunur. Panel isteklerinde ise B2B token'ındaki TenantCode'dan.
/// Bu yüzden firma kodu her çağrıda AÇIKÇA verilir, HttpContext'ten tahmin edilmez.
/// </summary>
public sealed partial class TenantDb
{
    private readonly IConfiguration _configuration;
    private static readonly ConcurrentDictionary<string, string> ErpDbNames = new(StringComparer.OrdinalIgnoreCase);

    public TenantDb(IConfiguration configuration)
    {
        _configuration = configuration;
    }

    [GeneratedRegex("^[A-Z0-9_-]{1,40}$")]
    private static partial Regex TenantCodePattern();

    /// <summary>
    /// Firma kodu: harf, rakam, alt çizgi ve TİRE. Tire şart: canlıdaki firmanın kodu <c>DEMO</c>
    /// (master Tenants.Code). İlk sürüm tireyi reddediyordu; canlıda her giriş "Geçersiz firma kodu"
    /// ile düşerdi (2026-10-08, yayın hazırlığında yakalandı). Kod ERP/Servis'e AYNEN gider; yalnız
    /// asistanın kendi veritabanı adında tire alt çizgiye çevrilir (<see cref="AsistanDatabaseName"/>).
    /// </summary>
    public static string Normalize(string? tenantCode)
    {
        var code = (tenantCode ?? string.Empty).Trim().ToUpperInvariant();
        if (!TenantCodePattern().IsMatch(code))
        {
            throw new InvalidOperationException("Geçersiz firma kodu.");
        }
        return code;
    }

    /// <summary>Asistanın kendi veritabanı: konuşmalar, mesajlar, webhook kaydı.</summary>
    /// <remarks>Tire alt çizgiye çevrilir — Servis'in <c>b2b_serviceops_tenant_DEMO</c> adlandırmasıyla aynı kural.</remarks>
    public string AsistanDatabaseName(string tenantCode) => $"b2b_asistan_tenant_{Normalize(tenantCode).Replace('-', '_')}";

    public string AsistanConnectionString(string tenantCode) => BuildConnectionString(AsistanDatabaseName(tenantCode));

    /// <summary>
    /// Firmanın ERP veritabanı — YALNIZ OKUMA (cari eşleşmesi, sayfa yetkisi). Adı tahmin
    /// edilmez: master'daki Tenants.DbName; B2B ve mağaza da aynı kaynağa bakıyor.
    /// </summary>
    public string ErpConnectionString(string tenantCode)
    {
        var code = Normalize(tenantCode);
        var dbName = ErpDbNames.GetOrAdd(code, key =>
        {
            using var conn = new NpgsqlConnection(BuildConnectionString("b2b_erp_master"));
            conn.Open();
            using var cmd = new NpgsqlCommand("SELECT \"DbName\" FROM public.\"Tenants\" WHERE UPPER(\"Code\") = @code LIMIT 1", conn);
            cmd.Parameters.AddWithValue("code", key);
            var resolved = cmd.ExecuteScalar() as string;
            return string.IsNullOrWhiteSpace(resolved) ? $"b2b_erp_tenant_{key}" : resolved;
        });
        return BuildConnectionString(dbName);
    }

    private static readonly ConcurrentDictionary<int, string?> CodesById = new();

    /// <summary>
    /// Master'daki Tenants.Id → firma kodu. B2B'nin gerçek token'ı firmayı KİMLİKLE taşır
    /// (<c>TenantId</c>), kodla değil — elle üretilen deneme token'larında <c>TenantCode</c> olduğu
    /// için bu ilk sürümde gözden kaçmıştı (2026-10-07, gerçek girişle yakalandı).
    /// </summary>
    public async Task<string?> TenantCodeByIdAsync(int tenantId, CancellationToken ct)
    {
        if (CodesById.TryGetValue(tenantId, out var cached)) return cached;

        await using var conn = new NpgsqlConnection(BuildConnectionString("b2b_erp_master"));
        await conn.OpenAsync(ct);
        await using var cmd = new NpgsqlCommand("SELECT \"Code\" FROM public.\"Tenants\" WHERE \"Id\" = @id", conn);
        cmd.Parameters.AddWithValue("id", tenantId);
        var code = (await cmd.ExecuteScalarAsync(ct) as string)?.Trim().ToUpperInvariant();
        if (code is not null) CodesById[tenantId] = code; // bulunamayanı önbelleğe alma: yeni firma açılabilir
        return code;
    }

    public string BuildConnectionString(string database)
    {
        var baseConn = _configuration.GetConnectionString("PostgresBase")
                       ?? "Host=localhost;Port=5434;Database=postgres;Username=b2b;Password=b2b";

        return new NpgsqlConnectionStringBuilder(baseConn)
        {
            Database = database,
            Pooling = true,
            MaxPoolSize = 10,
            MinPoolSize = 0,
            ConnectionIdleLifetime = 15,
            ConnectionPruningInterval = 10,
            Timeout = 8,
            CommandTimeout = 15
        }.ConnectionString;
    }
}
