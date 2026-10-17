using B2B.Erp.Api.Data;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace B2B.Erp.Api.Features.PosAccounts;

/// <summary>
/// Runs the daily POS sweep for every tenant.
///
/// The sweep settles a calendar day that has already closed, so the configured time is only
/// when to look — never what decides which movements belong to the run. That is why a
/// collection taken at 00:30 is simply part of the new day and needs no special handling.
///
/// Days are caught up rather than skipped: if the server was down at the configured time, the
/// next start finds the days that have no sweep record and settles them. The unique index on
/// (account, date) is what makes that safe to repeat — a day already swept cannot be swept
/// twice, whichever path reaches it.
/// </summary>
public sealed class PosAccountTransferWorker : BackgroundService
{
    /// <summary>How far back a missed day is still picked up. Beyond this it is a human decision.</summary>
    private const int CatchUpDays = 14;

    private readonly IServiceProvider _serviceProvider;
    private readonly IConfiguration _configuration;
    private readonly ILogger<PosAccountTransferWorker> _logger;

    public PosAccountTransferWorker(
        IServiceProvider serviceProvider,
        IConfiguration configuration,
        ILogger<PosAccountTransferWorker> logger)
    {
        _serviceProvider = serviceProvider;
        _configuration = configuration;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await ProcessAllTenantsAsync(stoppingToken);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "[PosAccountTransferWorker] Sweep pass failed.");
            }

            try
            {
                await Task.Delay(TimeSpan.FromMinutes(5), stoppingToken);
            }
            catch
            {
                return;
            }
        }
    }

    private async Task ProcessAllTenantsAsync(CancellationToken cancellationToken)
    {
        using var scope = _serviceProvider.CreateScope();
        var masterDb = scope.ServiceProvider.GetRequiredService<MasterDbContext>();

        var baseConnStr = _configuration.GetConnectionString("DefaultConnection") ?? string.Empty;
        if (string.IsNullOrWhiteSpace(baseConnStr)) return;

        var dbNames = await masterDb.Tenants
            .AsNoTracking()
            .Where(x => x.IsActive && x.DbName != "")
            .Select(x => x.DbName)
            .Distinct()
            .ToListAsync(cancellationToken);

        foreach (var dbName in dbNames)
        {
            if (cancellationToken.IsCancellationRequested) return;

            try
            {
                await ProcessTenantAsync(baseConnStr, dbName, cancellationToken);
            }
            catch (Exception ex)
            {
                // One tenant's bad configuration must not stop the others from settling.
                _logger.LogError(ex, "[PosAccountTransferWorker] Tenant {DbName} failed.", dbName);
            }
        }
    }

    private async Task ProcessTenantAsync(string baseConnStr, string dbName, CancellationToken cancellationToken)
    {
        var csb = new NpgsqlConnectionStringBuilder(baseConnStr) { Database = dbName };

        var options = new DbContextOptionsBuilder<AppDbContext>()
            .UseNpgsql(csb.ConnectionString)
            .Options;

        await using var db = new AppDbContext(options);

        var settings = await db.PosAccountSettings
            .AsNoTracking()
            .Where(x => x.IsActive && x.IsAutoTransferEnabled && x.TargetBankAccountDefinitionId != null)
            .ToListAsync(cancellationToken);

        if (settings.Count == 0) return;

        // Kur servisi singleton; kiracı başına elle kurulan servise oradan geçiliyor
        // (süpürme artık kaynak/hedef hesabın para birimini çözmek için kura ihtiyaç duyuyor).
        var money = _serviceProvider.GetRequiredService<B2B.Erp.Api.Features.Currency.ICurrencyRateService>();
        // Saat dilimi singleton; süpürme gününü ARTIK firmanın saatinden okuyor (denetim md. D1).
        var clock = _serviceProvider.GetRequiredService<B2B.Erp.Api.Core.Helpers.CompanyClock>();
        var service = new PosAccountTransferService(db, money, clock);

        // `SystemTime.Now` SUNUCUNUN yerel saatiydi: sunucu UTC'de çalışan bir kiralık makine
        // olduğunda hem "aktarım saati geldi mi" hem de "hangi gün süpürülecek" üç saat
        // kayıyordu. İkisi de firmanın saatinden okunur.
        var now = clock.ToCompanyTime(B2B.Erp.Api.Core.Helpers.SystemTime.UtcNow);

        foreach (var setting in settings)
        {
            // Only once the configured moment has passed today: before it, today's run for
            // yesterday has not come due yet.
            if (now.TimeOfDay < setting.TransferTime) continue;

            var alreadySwept = await db.PosAccountTransfers
                .AsNoTracking()
                .Where(x => x.PosBankAccountDefinitionId == setting.PosBankAccountDefinitionId)
                .Select(x => x.TransferDate)
                .ToListAsync(cancellationToken);

            var sweptDays = alreadySwept.Select(PosAccountTransferService.AsUtcDay).ToHashSet();

            // Oldest first, so a catch-up settles days in the order they happened.
            for (var back = CatchUpDays; back >= 1; back--)
            {
                var day = PosAccountTransferService.AsUtcDay(now.AddDays(-back));

                // Gün süpürülmüş olabilir ama o güne SONRADAN düşen tahsilat POS hesabında
                // takılı kalıyordu: burada yalnızca `continue` vardı, yani otomatik aktarım
                // o günü bir daha hiç açmıyordu. Para hesapta kalmasın diye geç gelenler
                // günün mevcut aktarımına ekleniyor (yeni aktarım açılmaz).
                if (sweptDays.Contains(day))
                {
                    var late = await service.SettleLateArrivalsAsync(
                        setting.PosBankAccountDefinitionId, day, "SYSTEM", cancellationToken);

                    if (late.Success)
                    {
                        _logger.LogInformation(
                            "[PosAccountTransferWorker] {DbName}: account {AccountId} late arrivals folded into {Day:yyyy-MM-dd}, new total {Amount}.",
                            dbName, setting.PosBankAccountDefinitionId, day, late.Amount);
                    }

                    continue;
                }

                var result = await service.RunTransferAsync(
                    setting.PosBankAccountDefinitionId, day, "SYSTEM", isAutomatic: true, cancellationToken);

                if (result.Success)
                {
                    _logger.LogInformation(
                        "[PosAccountTransferWorker] {DbName}: account {AccountId} settled {Day:yyyy-MM-dd} for {Amount}.",
                        dbName, setting.PosBankAccountDefinitionId, day, result.Amount);
                }
            }
        }
    }
}
