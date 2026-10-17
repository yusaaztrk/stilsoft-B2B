using Shop.Api.Storefront;

namespace Shop.Api.Payments;

/// <summary>
/// HAVALE BAKIMI — arka plan (2026-09-20).
///
/// SORUN: süre aşımı "tembel" çalışıyordu; yalnızca bayi panelde havale listesini AÇTIĞINDA
/// devreye giriyordu. Bayi bir hafta paneli açmazsa:
/// <list type="bullet">
/// <item>"Gönderdim" demeyen siparişler açık kalıyor, stok ve sipariş listesi şişiyor,</item>
/// <item>müşteriye "siparişiniz iptal edildi" SMS'i hiç gitmiyor — müşteri beklemeye devam ediyor,</item>
/// <item>hatırlatma SMS'i de hiç gitmiyor, yani kurtarılabilecek sipariş kurtarılamıyor.</item>
/// </list>
/// Bir kapanışın, birinin bir ekranı açmasına bağlı olması güvenilir değil.
///
/// ÇÖZÜM: aynı bakım turu düzenli aralıkla arka planda koşuyor. Panel çağrısı kaldırılmadı —
/// bayi listeyi açtığında da çalışmaya devam ediyor; iki yol da aynı metodu çağırıyor ve
/// SMS'ler olay kaydıyla tekil olduğu için ikinci çağrı ikinci SMS üretmiyor.
///
/// Tenant: HTTP bağlamı olmadığı için <c>Shop:TenantCode</c> (tek mağaza) —
/// <see cref="Marketing.CartReminderWorker"/> ile aynı yaklaşım.
/// </summary>
public sealed class BankTransferWorker : BackgroundService
{
    private readonly IServiceScopeFactory _scopes;
    private readonly IConfiguration _configuration;
    private readonly ILogger<BankTransferWorker> _logger;

    public BankTransferWorker(IServiceScopeFactory scopes, IConfiguration configuration, ILogger<BankTransferWorker> logger)
    {
        _scopes = scopes;
        _configuration = configuration;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var minutes = _configuration.GetValue<int?>("Shop:BankTransfer:MaintenanceIntervalMinutes") ?? 30;
        if (minutes <= 0)
        {
            _logger.LogInformation("[Havale] Arka plan bakımı kapalı (MaintenanceIntervalMinutes <= 0).");
            return;
        }

        // Açılışta hemen koşmasın: ERP ve veritabanı ayağa kalkarken gürültü çıkarmasın.
        try { await Task.Delay(TimeSpan.FromMinutes(3), stoppingToken); } catch (OperationCanceledException) { return; }

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await RunOnceAsync(stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                return;
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "[Havale] Bakım turu başarısız; bir sonraki turda yeniden denenecek.");
            }

            try { await Task.Delay(TimeSpan.FromMinutes(minutes), stoppingToken); } catch (OperationCanceledException) { return; }
        }
    }

    /// <summary>
    /// Bir bakım turu: süresi dolanları kapatır (+ "iptal edildi" SMS'i) ve bekleyenlere
    /// hatırlatma gönderir. İkisi de <see cref="BankTransferService.ListOpenAsync"/> içinde.
    /// </summary>
    public async Task RunOnceAsync(CancellationToken ct)
    {
        using var scope = _scopes.CreateScope();
        var sp = scope.ServiceProvider;

        var storefront = sp.GetRequiredService<StorefrontStore>();
        var settings = await storefront.GetAsync(ct);

        // Havale hiç kurulmamışsa (IBAN yok) bakacak bir şey yok; ERP'yi boşuna yormayalım.
        if (!settings.BankTransferAccounts.Any(a => !string.IsNullOrWhiteSpace(a.Iban))) return;

        var service = sp.GetRequiredService<BankTransferService>();
        await service.ListOpenAsync(ct);
    }
}
