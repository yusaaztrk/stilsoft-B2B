namespace B2B.Erp.Api.Features.Uploads;

/// <summary>
/// YETİM DOSYA TEMİZLİĞİNİN PERİYODİK TURU (denetim md. E5).
///
/// <para>
/// <b>Öntanımlı olarak KAPALIDIR</b> ve açılmadan tek bir dosyaya dokunmaz. Sebebi: bu iş
/// geri alınamaz. Yönetici önce ekrandan raporu alıp neyin silineceğini görmeli, listeyi
/// tanıdığına kanaat getirdikten sonra açmalı. Kendiliğinden silmeye başlayan bir temizlik,
/// hatalıysa kimsenin fark etmediği bir yerde yıllarca dosya öğütür.
/// </para>
///
/// <para>Ayarlar (<c>appsettings.json</c>):</para>
/// <list type="bullet">
///   <item><c>Uploads:OrphanCleanup:Enabled</c> — silme yapılsın mı (öntanımlı <c>false</c>).</item>
///   <item><c>Uploads:OrphanCleanup:GraceDays</c> — bu günden yeni dosyaya dokunulmaz (öntanımlı 30).</item>
///   <item><c>Uploads:OrphanCleanup:IntervalHours</c> — turlar arası bekleme (öntanımlı 24).</item>
/// </list>
///
/// <para>
/// Tur, açık olsa bile silmeyi <see cref="OrphanUploadScanner"/>'a bırakır: firma
/// veritabanlarından biri okunamadıysa orası silmeyi kendi durdurur.
/// </para>
/// </summary>
public sealed class OrphanUploadCleanupWorker : BackgroundService
{
    private readonly IServiceProvider _serviceProvider;
    private readonly IConfiguration _configuration;
    private readonly ILogger<OrphanUploadCleanupWorker> _logger;

    public OrphanUploadCleanupWorker(
        IServiceProvider serviceProvider,
        IConfiguration configuration,
        ILogger<OrphanUploadCleanupWorker> logger)
    {
        _serviceProvider = serviceProvider;
        _configuration = configuration;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!bool.TryParse(_configuration["Uploads:OrphanCleanup:Enabled"], out var enabled) || !enabled)
        {
            _logger.LogInformation(
                "[OrphanUploadCleanupWorker] Kapalı (Uploads:OrphanCleanup:Enabled). Temizlik yalnızca yönetim ekranından elle çalıştırılabilir.");
            return;
        }

        var graceDays = int.TryParse(_configuration["Uploads:OrphanCleanup:GraceDays"], out var g) && g >= 0
            ? g
            : OrphanUploadScanner.DefaultGraceDays;

        var intervalHours = int.TryParse(_configuration["Uploads:OrphanCleanup:IntervalHours"], out var h) && h > 0
            ? h
            : 24;

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                using var scope = _serviceProvider.CreateScope();
                var scanner = scope.ServiceProvider.GetRequiredService<OrphanUploadScanner>();

                var report = await scanner.ScanAsync(deleteOrphans: true, graceDays, stoppingToken);

                if (!report.DeletePerformed)
                {
                    _logger.LogWarning(
                        "[OrphanUploadCleanupWorker] Silme yapılmadı. Uyarılar: {Warnings}",
                        string.Join(" | ", report.Warnings));
                }
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                return;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "[OrphanUploadCleanupWorker] Temizlik turu başarısız.");
            }

            try
            {
                await Task.Delay(TimeSpan.FromHours(intervalHours), stoppingToken);
            }
            catch
            {
                return;
            }
        }
    }
}
