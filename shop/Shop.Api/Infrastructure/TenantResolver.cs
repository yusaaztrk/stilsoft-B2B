using System.Collections.Concurrent;
using Npgsql;

namespace Shop.Api.Infrastructure;

/// <summary>
/// Mağazanın hangi firmaya (tenant) ait olduğunu ve o firmanın veritabanlarını çözer.
///
/// Firma kodu KODA GÖMÜLMÜYOR. Eski e-ticarette <c>HardLockedTenantCode = "DEMO"</c> diye sabit
/// yazılmıştı ve firma bilgisi sorguların her yerine sızmıştı; ikinci bir mağaza açmak tüm koda
/// dokunmak demekti. Burada kod yapılandırmadan, istenirse isteğin alan adından geliyor:
/// bugün tek satır (<c>example.com → DEMOTEST</c>), yarın ikinci mağaza bir satır daha.
///
/// ERP veritabanının ADI da tahmin edilmiyor: master'daki Tenants.DbName ne diyorsa o. B2B'nin
/// kendi çözücüsü de aynı kaynağa bakıyor; ikisi ayrışırsa mağaza başka bir veritabanına bakar
/// ve hiçbir ürün göremezdi.
/// </summary>
public sealed class TenantResolver
{
    private readonly IConfiguration _configuration;
    private readonly IHttpContextAccessor _httpContextAccessor;

    private static readonly ConcurrentDictionary<string, string> ErpDbNames = new(StringComparer.OrdinalIgnoreCase);

    public TenantResolver(IConfiguration configuration, IHttpContextAccessor httpContextAccessor)
    {
        _configuration = configuration;
        _httpContextAccessor = httpContextAccessor;
    }

    /// <summary>İsteğin ait olduğu firma kodu.</summary>
    public string TenantCode
    {
        get
        {
            var host = _httpContextAccessor.HttpContext?.Request.Host.Host;
            if (!string.IsNullOrWhiteSpace(host))
            {
                var mapped = _configuration[$"Shop:HostTenantMap:{host}"];
                if (!string.IsNullOrWhiteSpace(mapped)) return mapped.Trim().ToUpperInvariant();
            }

            var configured = _configuration["Shop:TenantCode"];
            if (string.IsNullOrWhiteSpace(configured))
            {
                throw new InvalidOperationException("Shop:TenantCode yapılandırılmamış.");
            }

            return configured.Trim().ToUpperInvariant();
        }
    }

    /// <summary>Vitrin fiyatlarının okunacağı fiyat grubu kodu (1 = KATALOG F).</summary>
    public int CatalogPriceGroupCode
    {
        get
        {
            var raw = _configuration["Shop:CatalogPriceGroupCode"];
            return int.TryParse(raw, out var code) && code > 0 ? code : 1;
        }
    }

    /// <summary>Firmanın ERP veritabanı — SALT OKUNUR kullanılır.</summary>
    public string ErpConnectionString()
    {
        var code = TenantCode;
        var dbName = ErpDbNames.GetOrAdd(code, key =>
        {
            var masterConn = BuildConnectionString("b2b_erp_master");

            using var conn = new NpgsqlConnection(masterConn);
            conn.Open();
            using var cmd = new NpgsqlCommand("SELECT \"DbName\" FROM public.\"Tenants\" WHERE UPPER(\"Code\") = @code LIMIT 1", conn);
            cmd.Parameters.AddWithValue("code", key);
            var resolved = cmd.ExecuteScalar() as string;

            // B2B'nin TenantConnectionStringResolver'ı ile AYNI varsayılan.
            return string.IsNullOrWhiteSpace(resolved) ? $"b2b_erp_tenant_{key}" : resolved;
        });

        return BuildConnectionString(dbName);
    }

    /// <summary>Mağazanın kendi veritabanı — üyeler, favoriler, vitrin içeriği burada.</summary>
    public string ShopConnectionString() => BuildConnectionString($"b2b_shop_tenant_{TenantCode}");

    public string ShopDatabaseName() => $"b2b_shop_tenant_{TenantCode}";

    public string BuildConnectionString(string database)
    {
        var baseConn = _configuration.GetConnectionString("PostgresBase")
                       ?? "Host=localhost;Port=5434;Database=postgres;Username=b2b;Password=b2b";

        var builder = new NpgsqlConnectionStringBuilder(baseConn)
        {
            Database = database,
            Pooling = true,
            MaxPoolSize = 10,
            MinPoolSize = 0,
            ConnectionIdleLifetime = 15,
            ConnectionPruningInterval = 10,
            Timeout = 8,
            CommandTimeout = 15
        };
        return builder.ConnectionString;
    }
}
