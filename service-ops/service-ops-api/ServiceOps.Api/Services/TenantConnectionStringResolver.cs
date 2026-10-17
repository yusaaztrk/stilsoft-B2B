using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Security.Claims;
using System.Text;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Npgsql;
using ServiceOps.Infrastructure.Data;

namespace ServiceOps.Api.Services;

public sealed class TenantConnectionStringResolver : ITenantConnectionStringResolver
{
    private readonly IHttpContextAccessor _httpContextAccessor;
    private readonly IConfiguration _configuration;
    private static readonly ConcurrentDictionary<string, bool> MigratedDatabases = new(StringComparer.OrdinalIgnoreCase);

    public TenantConnectionStringResolver(IHttpContextAccessor httpContextAccessor, IConfiguration configuration)
    {
        _httpContextAccessor = httpContextAccessor;
        _configuration = configuration;
    }

    public string Resolve()
    {
        var baseConnStr = _configuration.GetConnectionString("ServiceOpsBase") 
                          ?? _configuration.GetConnectionString("DefaultConnection") 
                          ?? "Host=localhost;Port=5434;Database=serviceops_dev;Username=b2b;Password=b2b;";

        var tenantCode = GetTenantCodeFromRequest();
        if (string.IsNullOrWhiteSpace(tenantCode))
        {
            var csb = new NpgsqlConnectionStringBuilder(baseConnStr);
            if (string.IsNullOrWhiteSpace(csb.Database))
            {
                csb.Database = "serviceops_dev";
            }
            EnsureDatabaseMigrated(csb.ConnectionString, csb.Database);
            return csb.ConnectionString;
        }

        var normalized = NormalizeTenantCode(tenantCode);
        var dbName = $"b2b_serviceops_tenant_{normalized}";

        var tenantCsb = new NpgsqlConnectionStringBuilder(baseConnStr)
        {
            Database = dbName
        };

        EnsureDatabaseMigrated(tenantCsb.ConnectionString, dbName);
        return tenantCsb.ConnectionString;
    }

    public static void MigrateAllTenantDatabases(IConfiguration configuration)
    {
        var baseConnStr = configuration.GetConnectionString("ServiceOpsBase") 
                          ?? configuration.GetConnectionString("DefaultConnection") 
                          ?? "Host=localhost;Port=5434;Database=serviceops_dev;Username=b2b;Password=b2b;";

        var masterCsb = new NpgsqlConnectionStringBuilder(baseConnStr)
        {
            Database = "b2b_erp_master"
        };

        var tenantCodes = new List<string>();
        try
        {
            using (var conn = new NpgsqlConnection(masterCsb.ConnectionString))
            {
                conn.Open();
                using var cmd = conn.CreateCommand();
                cmd.CommandText = "SELECT \"Code\" FROM public.\"Tenants\"";
                using var reader = cmd.ExecuteReader();
                while (reader.Read())
                {
                    var code = reader["Code"]?.ToString();
                    if (!string.IsNullOrWhiteSpace(code))
                    {
                        tenantCodes.Add(code);
                    }
                }
            }
        }
        catch (Exception ex)
        {
            Console.WriteLine($"[ServiceOps DB Auto-Heal Startup] Failed to read tenants: {ex.Message}");
            return;
        }

        // Always migrate serviceops_dev
        var devCsb = new NpgsqlConnectionStringBuilder(baseConnStr);
        if (string.IsNullOrWhiteSpace(devCsb.Database))
        {
            devCsb.Database = "serviceops_dev";
        }
        EnsureDatabaseMigratedStatic(devCsb.ConnectionString, devCsb.Database);

        // Migrate all tenants
        foreach (var code in tenantCodes)
        {
            var normalized = NormalizeTenantCode(code);
            var dbName = $"b2b_serviceops_tenant_{normalized}";
            var tenantCsb = new NpgsqlConnectionStringBuilder(baseConnStr)
            {
                Database = dbName
            };
            EnsureDatabaseMigratedStatic(tenantCsb.ConnectionString, dbName);
        }
    }

    private void EnsureDatabaseMigrated(string connectionString, string dbName)
    {
        EnsureDatabaseMigratedStatic(connectionString, dbName);
    }

    private static void EnsureDatabaseMigratedStatic(string connectionString, string dbName)
    {
        if (MigratedDatabases.ContainsKey(dbName))
            return;

        try
        {
            var masterCsb = new NpgsqlConnectionStringBuilder(connectionString)
            {
                Database = "postgres"
            };

            using (var conn = new NpgsqlConnection(masterCsb.ConnectionString))
            {
                conn.Open();
                using var cmd = conn.CreateCommand();
                cmd.CommandText = "SELECT COUNT(1) FROM pg_database WHERE datname = @dbName";
                cmd.Parameters.AddWithValue("dbName", dbName);
                var exists = Convert.ToInt32(cmd.ExecuteScalar()) > 0;

                if (!exists)
                {
                    using var createCmd = conn.CreateCommand();
                    createCmd.CommandText = $"CREATE DATABASE \"{dbName}\"";
                    createCmd.ExecuteNonQuery();
                }
            }

            // Clean up legacy incompatible tables if present
            using (var conn = new NpgsqlConnection(connectionString))
            {
                conn.Open();
                
                bool isLegacy = false;
                using (var checkCmd = conn.CreateCommand())
                {
                    checkCmd.CommandText = @"
                        SELECT data_type FROM information_schema.columns 
                        WHERE table_name = 'ServiceUsers' AND column_name = 'Id'";
                    var dataType = checkCmd.ExecuteScalar() as string;
                    if (dataType != null && (dataType.Contains("int") || dataType.Contains("serial")))
                    {
                        isLegacy = true;
                    }
                }

                if (isLegacy)
                {
                    Console.WriteLine($"[ServiceOps DB Auto-Heal] Legacy ServiceUsers table with integer ID detected in '{dbName}'. Dropping legacy tables to allow EF migrations.");
                    using (var dropCmd = conn.CreateCommand())
                    {
                        dropCmd.CommandText = @"
                            DROP TABLE IF EXISTS public.""ServiceUserRoles"" CASCADE;
                            DROP TABLE IF EXISTS public.""ServiceRoles"" CASCADE;
                            DROP TABLE IF EXISTS public.""ServiceUsers"" CASCADE;";
                        dropCmd.ExecuteNonQuery();
                    }
                }
            }

            var options = new DbContextOptionsBuilder<ApplicationDbContext>()
                .UseNpgsql(connectionString, npgsqlOptions =>
                {
                    npgsqlOptions.MigrationsAssembly("ServiceOps.Infrastructure");
                })
                .Options;

            using (var db = new ApplicationDbContext(options))
            {
                db.Database.Migrate();
            }

            SeedRegions(connectionString, dbName);

            MigratedDatabases.TryAdd(dbName, true);
            Console.WriteLine($"[ServiceOps DB Auto-Heal] Successfully migrated database '{dbName}'");
        }
        catch (Exception ex)
        {
            Console.WriteLine($"[ServiceOps DB Auto-Heal] Failed to migrate database '{dbName}': {ex.Message}");
        }
    }

    /// <summary>
    /// KKTC ilceleri. B2B'deki montaj formunun bolge listesiyle ayni (MontajFormModal): montaj
    /// girilirken secilen bolge, ServiceOps tarafinda ayni isimle bulunabilmeli.
    ///
    /// Regions tablosu hicbir tenant'ta doldurulmuyordu — elle calistirilmasi gereken bir
    /// seed_regions.sql vardi ve calistirilmamisti, dolayisiyla Montaj Kabul'deki bolge secimi
    /// hep bos geliyordu.
    ///
    /// Isme gore ekler, var olani ellemez: bir bolgenin koordinati/teknisyeni elle duzenlenmisse
    /// yeniden baslatma onu geri almaz. (Eski seed_regions.sql once DELETE FROM "Regions" yapiyor,
    /// yani calistirilmasi mevcut atamalari ucururdu.)
    /// </summary>
    private static readonly (string Name, string Description, double Lat, double Lon, int RadiusKm)[] DefaultRegions =
    {
        ("Lefkoşa",    "Lefkoşa ilçesi - Başkent",                35.1856, 33.3823, 15),
        ("Gazimağusa", "Gazimağusa ilçesi - Doğu bölgesi",        35.1257, 33.9415, 25),
        ("Girne",      "Girne ilçesi - Kuzey kıyı şeridi",        35.3364, 33.3190, 20),
        ("Güzelyurt",  "Güzelyurt ilçesi - Batı bölgesi",         35.1988, 32.9927, 20),
        ("İskele",     "İskele ilçesi - Karpaz yarımadası girişi", 35.2847, 33.8864, 25),
        ("Lefke",      "Lefke ilçesi - Batı kıyı şeridi",         35.1114, 32.8519, 15)
    };

    private static void SeedRegions(string connectionString, string dbName)
    {
        try
        {
            using var conn = new NpgsqlConnection(connectionString);
            conn.Open();

            var inserted = 0;
            foreach (var region in DefaultRegions)
            {
                using var cmd = conn.CreateCommand();
                cmd.CommandText = @"
                    INSERT INTO ""Regions""
                        (""Id"", ""Name"", ""Description"", ""CenterLatitude"", ""CenterLongitude"",
                         ""RadiusKm"", ""IsActive"", ""CreatedAt"", ""TechnicianCount"",
                         ""ActiveServiceCount"", ""TotalServiceCount"")
                    SELECT gen_random_uuid(), @name, @description, @lat, @lon, @radius, true, NOW(), 0, 0, 0
                    WHERE NOT EXISTS (SELECT 1 FROM ""Regions"" WHERE ""Name"" = @name);";

                cmd.Parameters.AddWithValue("name", region.Name);
                cmd.Parameters.AddWithValue("description", region.Description);
                cmd.Parameters.AddWithValue("lat", region.Lat);
                cmd.Parameters.AddWithValue("lon", region.Lon);
                cmd.Parameters.AddWithValue("radius", region.RadiusKm);

                inserted += cmd.ExecuteNonQuery();
            }

            if (inserted > 0)
            {
                Console.WriteLine($"[ServiceOps Seed] '{dbName}' icin {inserted} bolge eklendi.");
            }
        }
        catch (Exception ex)
        {
            // Bolgesiz calismak mumkun; basligi dusurup devam etmek, acilisi patlatmaktan iyi.
            Console.WriteLine($"[ServiceOps Seed] '{dbName}' bolge seed hatasi: {ex.Message}");
        }
    }

    private string? GetTenantCodeFromRequest()
    {
        var ctx = _httpContextAccessor.HttpContext;
        if (ctx is null) return null;

        if (ctx.Items.TryGetValue("TenantCode", out var itemObj) && itemObj is string itemCode && !string.IsNullOrWhiteSpace(itemCode))
        {
            return itemCode;
        }

        if (ctx.Request.Headers.TryGetValue("X-Tenant-Code", out var codeValues))
        {
            var code = codeValues.ToString();
            if (!string.IsNullOrWhiteSpace(code)) return code;
        }

        var tenantClaim = ctx.User.FindFirst("tenant")?.Value 
                          ?? ctx.User.FindFirst("tenantCode")?.Value;
        if (!string.IsNullOrWhiteSpace(tenantClaim)) return tenantClaim;

        if (ctx.Request.Query.TryGetValue("tenant", out var tenantQueryValues))
        {
            var tenant = tenantQueryValues.ToString();
            if (!string.IsNullOrWhiteSpace(tenant)) return tenant;
        }

        return null;
    }

    private static string NormalizeTenantCode(string tenantCode)
    {
        var code = tenantCode.Trim().ToUpperInvariant();
        if (code.Length == 0) return string.Empty;

        var sb = new StringBuilder(code.Length);
        foreach (var ch in code)
        {
            if ((ch >= 'A' && ch <= 'Z') || (ch >= '0' && ch <= '9') || ch == '_')
            {
                sb.Append(ch);
            }
            else
            {
                sb.Append('_');
            }
        }

        var normalized = sb.ToString();
        while (normalized.Contains("__")) 
            normalized = normalized.Replace("__", "_");
        
        return normalized.Trim('_');
    }
}
