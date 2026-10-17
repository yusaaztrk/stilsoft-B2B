using B2B.Erp.Api.Data;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace B2B.Erp.Api.Features.Activity;

/// <summary>
/// KULLANICI HAREKETİ SAKLAMA SÜRESİ (2026-08-20 kararı 10 gündü; 2026-10-04 kullanıcı kararı:
/// <b>1 ay, daha az değil</b>).
///
/// <para>
/// <c>UserActivityLogs</c> sınırsız büyüyordu; her fatura, her sipariş, her ayar değişikliği
/// kalıcı bir satır bırakıyor ve tabloyu kimse budamıyordu. Zamanla hem disk şişiyor hem de
/// ekrandaki listeleme yavaşlıyor.
/// </para>
///
/// <para>
/// <b>Bu tablo muhasebe defteri DEĞİLDİR.</b> Silinen belgelerin geri alınabilir yedeği ayrı
/// bir tabloda (<c>DeletionLogs</c>) tutuluyor ve buradaki budama ona dokunmaz — yani 30 gün
/// önce silinmiş bir fatura hâlâ geri yüklenebilir, yalnızca "kim ne zaman tıkladı" izi düşer.
/// </para>
///
/// <para>Ayarlar (<c>appsettings.json</c>):</para>
/// <list type="bullet">
///   <item><c>Activity:RetentionDays</c> — kaç günlük geçmiş tutulacak (öntanımlı 30, en az 30).</item>
///   <item><c>Activity:RetentionIntervalHours</c> — turlar arası bekleme (öntanımlı 12).</item>
/// </list>
///
/// <para>
/// <b>0 ya da negatif gün budama YAPMAZ</b>, tabloyu boşaltmaz. Yanlış yazılmış tek bir
/// ayarın bütün denetim izini bir turda silmesi, budamanın hiç çalışmamasından çok daha
/// kötüdür; kapatmak isteyen 0 yazar ve tablo olduğu gibi kalır.
/// </para>
///
/// <para>
/// Gün sınırı <see cref="Core.Helpers.CompanyClock"/> ile FİRMANIN takvim gününden kurulur:
/// UTC gününden okunsaydı KKTC'de (UTC+3) budama sınırı üç saat kayardı.
/// </para>
/// </summary>
public sealed class UserActivityRetentionWorker : BackgroundService
{
    /// <summary>Kullanıcının seçtiği varsayılan: 1 aylık (30 gün) geçmiş.</summary>
    public const int DefaultRetentionDays = 30;

    /// <summary>
    /// ALT SINIR (2026-10-04 kullanıcı kararı: "1 ay tut, daha az süre değil"). Sunucudaki
    /// <c>appsettings.json</c> yayın paketine girmiyor ve canlıda hâlâ 10 yazıyor; ayar ne derse
    /// desin 30 günden kısa budama yapılmaz. Budamayı kapatmak (0) yine mümkün.
    /// </summary>
    public const int MinimumRetentionDays = 30;

    private readonly IServiceProvider _serviceProvider;
    private readonly IConfiguration _configuration;
    private readonly ILogger<UserActivityRetentionWorker> _logger;

    public UserActivityRetentionWorker(
        IServiceProvider serviceProvider,
        IConfiguration configuration,
        ILogger<UserActivityRetentionWorker> logger)
    {
        _serviceProvider = serviceProvider;
        _configuration = configuration;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var retentionDays = int.TryParse(_configuration["Activity:RetentionDays"], out var d)
            ? d
            : DefaultRetentionDays;

        if (retentionDays > 0 && retentionDays < MinimumRetentionDays)
        {
            _logger.LogInformation(
                "[UserActivityRetention] Ayardaki {Days} gün alt sınırın altında; {Min} gün uygulanıyor.",
                retentionDays, MinimumRetentionDays);
            retentionDays = MinimumRetentionDays;
        }

        if (retentionDays <= 0)
        {
            _logger.LogInformation(
                "[UserActivityRetention] Kapalı (Activity:RetentionDays = {Days}). Hareket kayıtları budanmayacak.",
                retentionDays);
            return;
        }

        var intervalHours = int.TryParse(_configuration["Activity:RetentionIntervalHours"], out var h) && h > 0
            ? h
            : 12;

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await RunOnceAsync(retentionDays, stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                return;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "[UserActivityRetention] Budama turu başarısız.");
            }

            try
            {
                await Task.Delay(TimeSpan.FromHours(intervalHours), stoppingToken);
            }
            catch (OperationCanceledException)
            {
                return;
            }
        }
    }

    private async Task RunOnceAsync(int retentionDays, CancellationToken cancellationToken)
    {
        using var scope = _serviceProvider.CreateScope();

        var configuration = scope.ServiceProvider.GetRequiredService<IConfiguration>();
        var clock = scope.ServiceProvider.GetRequiredService<Core.Helpers.CompanyClock>();
        var masterDb = scope.ServiceProvider.GetRequiredService<MasterDbContext>();

        var baseConnStr = configuration.GetConnectionString("DefaultConnection");
        if (string.IsNullOrWhiteSpace(baseConnStr))
        {
            _logger.LogWarning("[UserActivityRetention] DefaultConnection tanımsız, tur atlandı.");
            return;
        }

        // Sınır: firmanın bugününden N gün geriye, o günün BAŞLANGICI. Gün ortasından
        // kesilseydi budama saatine göre bir günün yarısı kalır, yarısı giderdi.
        var cutoffUtc = clock.CompanyDayStartUtc(clock.TodayCompanyDate().AddDays(-retentionDays));

        List<string> dbNames;
        try
        {
            dbNames = await masterDb.Tenants
                .AsNoTracking()
                .Select(x => x.DbName)
                .Where(x => !string.IsNullOrWhiteSpace(x))
                .Distinct()
                .ToListAsync(cancellationToken);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "[UserActivityRetention] Firma listesi okunamadı, tur atlandı.");
            return;
        }

        foreach (var dbName in dbNames)
        {
            cancellationToken.ThrowIfCancellationRequested();

            try
            {
                var csb = new NpgsqlConnectionStringBuilder(baseConnStr) { Database = dbName };
                var options = new DbContextOptionsBuilder<AppDbContext>()
                    .UseNpgsql(csb.ConnectionString)
                    .Options;

                await using var db = new AppDbContext(options);

                var deleted = await db.UserActivityLogs
                    .Where(x => x.CreateTime < cutoffUtc)
                    .ExecuteDeleteAsync(cancellationToken);

                if (deleted > 0)
                {
                    _logger.LogInformation(
                        "[UserActivityRetention] {DbName}: {Count} hareket kaydı budandı ({Cutoff:u} öncesi).",
                        dbName, deleted, cutoffUtc);
                }
            }
            catch (Exception ex)
            {
                // Bir firmanın hatası diğerlerinin budanmasını durdurmaz.
                _logger.LogError(ex, "[UserActivityRetention] {DbName} budanamadı.", dbName);
            }
        }
    }
}
