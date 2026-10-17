using System;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace B2B.Erp.Api.Features.Currency;

/// <summary>
/// Kur geçmişini düzenli olarak doldurur.
///
/// <para>
/// Neden gerekli: <see cref="CurrencyRateService"/> kuru yalnızca BİRİ İSTEDİĞİNDE çekip
/// tabloya yazıyor. Sistem bir hafta kullanılmazsa o günlerin kuru hiç kaydedilmez ve
/// tabloda delik kalır. Muhasebe tarafı ise HER GÜNÜN kurunu ister: dönem sonu kur
/// değerlemesi, geriye dönük fiş ve açılış fişi eksik günde doğru kuru bulamaz —
/// ve o eksiklik ancak ters kayıtla düzeltilebilir.
/// </para>
///
/// <para>
/// Günde bir kez yeterli olurdu; 6 saatte bir çalışıyor ki TCMB'ye erişilemeyen bir denemeden
/// sonra aynı gün tekrar denensin. Yazma <c>(CurrencyCode, RateDate)</c> üzerinde upsert
/// olduğu için gün içinde kaç kez çalışırsa çalışsın satır çoğalmaz.
/// </para>
/// </summary>
public sealed class CurrencyRateSyncService : BackgroundService
{
    private readonly ICurrencyRateService _rates;
    private readonly ILogger<CurrencyRateSyncService> _logger;

    private static readonly TimeSpan StartupDelay = TimeSpan.FromSeconds(30);
    private static readonly TimeSpan Interval = TimeSpan.FromHours(6);

    public CurrencyRateSyncService(ICurrencyRateService rates, ILogger<CurrencyRateSyncService> logger)
    {
        _rates = rates;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        // Açılışta hemen vurma: şema drift-fix blokları ve tenant hazırlığı bitsin.
        try
        {
            await Task.Delay(StartupDelay, stoppingToken);
        }
        catch (OperationCanceledException)
        {
            return;
        }

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                // GetLatestRatesAsync başarılı çekimi ExchangeRates tablosuna yazar.
                // Önbellek süresi (varsayılan 60 dk) bu aralıktan kısa olduğu için
                // her turda taze veri çekilir.
                var rates = await _rates.GetLatestRatesAsync(stoppingToken);
                _logger.LogInformation("Kur eşitlemesi tamamlandı: {Count} para birimi.", rates.Count);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                return;
            }
            catch (Exception ex)
            {
                // Arka plan görevi ASLA uygulamayı düşürmemeli.
                _logger.LogWarning(ex, "Kur eşitlemesi başarısız; bir sonraki turda tekrar denenecek.");
            }

            try
            {
                await Task.Delay(Interval, stoppingToken);
            }
            catch (OperationCanceledException)
            {
                return;
            }
        }
    }
}
