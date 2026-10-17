using B2B.Erp.Api.Data;
using B2B.Erp.Api.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Hosting;
using Npgsql;
using System.Collections.Concurrent;

namespace B2B.Erp.Api.Data.Services.ReverseGeocode;

public sealed class EmployeeCheckInReverseGeocodeWorker : BackgroundService
{
    private readonly IServiceProvider _serviceProvider;
    private readonly IConfiguration _configuration;

    private static readonly ConcurrentDictionary<string, bool> TenantHasCityDistrictCache = new(StringComparer.OrdinalIgnoreCase);

    public EmployeeCheckInReverseGeocodeWorker(IServiceProvider serviceProvider, IConfiguration configuration)
    {
        _serviceProvider = serviceProvider;
        _configuration = configuration;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await ProcessOnceAsync(stoppingToken);
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine("[WARN] ReverseGeocode worker failed: " + ex);
            }

            try
            {
                await Task.Delay(TimeSpan.FromSeconds(10), stoppingToken);
            }
            catch
            {
                return;
            }
        }
    }

    private async Task ProcessOnceAsync(CancellationToken cancellationToken)
    {
        using var scope = _serviceProvider.CreateScope();
        var masterDb = scope.ServiceProvider.GetRequiredService<MasterDbContext>();
        var httpClientFactory = scope.ServiceProvider.GetRequiredService<IHttpClientFactory>();

        var baseConnStr = _configuration.GetConnectionString("DefaultConnection") ?? string.Empty;
        if (string.IsNullOrWhiteSpace(baseConnStr)) return;

        // YALNIZ AKTIF KIRACILAR (2026-08-23).
        //
        // Burasi eskiden master daki BUTUN kiraci satirlarini doluyordu, pasif olanlari ve
        // veritabani artik var olmayanlari dahil. Canlida iki olu satir vardi
        // (DEMO -> silinmis veritabani, DEMO -> varsayilan taban) ve her calisma
        // dongusunde 3D000 "veritabani mevcut degil" uyarisi uretiliyordu. Uyari zararsizdi
        // ama log u kirletip gercek hatalarin gorulmesini zorlastiriyordu.
        //
        // Pasif kiraci satirlari SILINMIYOR (GlobalUserTenants / TenantEnabledPages onlara
        // bagli); yalnizca burada atlaniyorlar.
        var tenantDbNames = await masterDb.Tenants
            .AsNoTracking()
            .Where(x => x.IsActive && x.DbName != null && x.DbName != "")
            .Select(x => x.DbName)
            .ToListAsync(cancellationToken);

        var http = httpClientFactory.CreateClient(nameof(NominatimClient));
        var nominatim = new NominatimClient(http);

        foreach (var tenantDbName in tenantDbNames)
        {
            cancellationToken.ThrowIfCancellationRequested();

            try
            {
                var csb = new Npgsql.NpgsqlConnectionStringBuilder(baseConnStr)
                {
                    Database = tenantDbName
                };

                var options = new DbContextOptionsBuilder<AppDbContext>()
                    .UseNpgsql(csb.ConnectionString)
                    .Options;

                await using var tenantDb = new AppDbContext(options);

                if (!await TenantSupportsCityDistrictAsync(tenantDb, tenantDbName, cancellationToken))
                {
                    continue;
                }

                await ProcessTenantDbAsync(tenantDb, nominatim, cancellationToken);
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine($"[WARN] ReverseGeocode tenant processing failed for '{tenantDbName}': {ex}");
            }
        }
    }

    private static async Task<bool> TenantSupportsCityDistrictAsync(AppDbContext db, string tenantDbName, CancellationToken cancellationToken)
    {
        if (TenantHasCityDistrictCache.TryGetValue(tenantDbName, out var cached)) return cached;

        try
        {
            var conn = db.Database.GetDbConnection();
            var wasClosed = conn.State == System.Data.ConnectionState.Closed;
            if (wasClosed)
            {
                await conn.OpenAsync(cancellationToken);
            }

            try
            {
                await using var cmd = conn.CreateCommand();
                cmd.CommandText = @"
SELECT COUNT(*)
FROM information_schema.columns
WHERE table_schema='public'
  AND table_name='EmployeeCheckIns'
  AND (column_name='City' OR column_name='District');
";

                var countObj = await cmd.ExecuteScalarAsync(cancellationToken);
                var count = 0;
                if (countObj is not null && int.TryParse(Convert.ToString(countObj), out var parsed)) count = parsed;

                var ok = count >= 2;
                TenantHasCityDistrictCache[tenantDbName] = ok;
                return ok;
            }
            finally
            {
                if (wasClosed)
                {
                    await conn.CloseAsync();
                }
            }
        }
        catch
        {
            // If we cannot inspect schema, do not block the worker entirely.
            TenantHasCityDistrictCache[tenantDbName] = true;
            return true;
        }
    }

    private static decimal Round2(decimal v) => Math.Round(v, 2, MidpointRounding.AwayFromZero);

    private static async Task ProcessTenantDbAsync(AppDbContext db, NominatimClient nominatim, CancellationToken cancellationToken)
    {
        var items = await db.EmployeeCheckIns
            .AsNoTracking()
            .Where(x => (x.City == null || x.City == "") && (x.District == null || x.District == ""))
            .OrderByDescending(x => x.CheckInTime)
            .Select(x => new
            {
                x.Id,
                x.Latitude,
                x.Longitude
            })
            .Take(50)
            .ToListAsync(cancellationToken);

        if (items.Count == 0) return;

        foreach (var ci in items)
        {
            cancellationToken.ThrowIfCancellationRequested();

            try
            {
                var rLat = Round2(ci.Latitude);
                var rLng = Round2(ci.Longitude);

                var cache = await db.Set<ReverseGeocodeCache>()
                    .FirstOrDefaultAsync(x => x.RoundedLatitude == rLat && x.RoundedLongitude == rLng, cancellationToken);

                if (cache is not null)
                {
                    if (!string.IsNullOrWhiteSpace(cache.City) || !string.IsNullOrWhiteSpace(cache.District))
                    {
                        var stub = new EmployeeCheckIn { Id = ci.Id };
                        db.EmployeeCheckIns.Attach(stub);

                        if (!string.IsNullOrWhiteSpace(cache.City))
                        {
                            stub.City = cache.City;
                            db.Entry(stub).Property(x => x.City).IsModified = true;
                        }

                        if (!string.IsNullOrWhiteSpace(cache.District))
                        {
                            stub.District = cache.District;
                            db.Entry(stub).Property(x => x.District).IsModified = true;
                        }

                        await db.SaveChangesAsync(cancellationToken);
                    }
                    continue;
                }

                var result = await nominatim.ReverseAsync(ci.Latitude, ci.Longitude, cancellationToken);

                db.Set<ReverseGeocodeCache>().Add(new ReverseGeocodeCache
                {
                    RoundedLatitude = rLat,
                    RoundedLongitude = rLng,
                    City = result?.City,
                    District = result?.District,
                    LastFetchedUtc = DateTime.UtcNow
                });

                if (!string.IsNullOrWhiteSpace(result?.City) || !string.IsNullOrWhiteSpace(result?.District))
                {
                    var stub = new EmployeeCheckIn { Id = ci.Id };
                    db.EmployeeCheckIns.Attach(stub);

                    if (!string.IsNullOrWhiteSpace(result?.City))
                    {
                        stub.City = result!.City;
                        db.Entry(stub).Property(x => x.City).IsModified = true;
                    }

                    if (!string.IsNullOrWhiteSpace(result?.District))
                    {
                        stub.District = result!.District;
                        db.Entry(stub).Property(x => x.District).IsModified = true;
                    }
                }

                await db.SaveChangesAsync(cancellationToken);

                await Task.Delay(1100, cancellationToken);
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine("[WARN] ReverseGeocode item failed: " + ex);
            }
        }
    }
}
