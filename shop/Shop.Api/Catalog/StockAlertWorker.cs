namespace Shop.Api.Catalog;

/// <summary>
/// STOK BİLDİRİMİ — arka plan (2026-09-20).
///
/// Bekleyen kaydı olan stok kodlarının durumunu düzenli aralıkla soruyor; ürün yeniden
/// SATILABİLİR hâle geldiyse bekleyenlere SMS gönderiyor.
///
/// "Satılabilir" ölçüsü kataloğun kendi yayın kuralı (<see cref="CatalogQueries.GetByStockCodesAsync"/>
/// zaten uyguluyor): yalnız stok sayısına bakmak yetmez — ürün elle kapatılmış ya da kritik
/// eşiğin altında olabilir. Müşteriyi "geldi" diye çağırıp sayfada satın alamayacağı bir ürün
/// göstermek, hiç haber vermemekten kötü.
///
/// Tenant: <c>Shop:TenantCode</c> (tek mağaza) — diğer işçilerle aynı yaklaşım.
/// </summary>
public sealed class StockAlertWorker : BackgroundService
{
    private readonly IServiceScopeFactory _scopes;
    private readonly IConfiguration _configuration;
    private readonly ILogger<StockAlertWorker> _logger;

    public StockAlertWorker(IServiceScopeFactory scopes, IConfiguration configuration, ILogger<StockAlertWorker> logger)
    {
        _scopes = scopes;
        _configuration = configuration;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var minutes = _configuration.GetValue<int?>("Shop:StockAlert:IntervalMinutes") ?? 20;
        if (minutes <= 0)
        {
            _logger.LogInformation("[StokBildirimi] Kapalı (IntervalMinutes <= 0).");
            return;
        }

        try { await Task.Delay(TimeSpan.FromMinutes(4), stoppingToken); } catch (OperationCanceledException) { return; }

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                var gonderilen = await RunOnceAsync(stoppingToken);
                if (gonderilen > 0) _logger.LogInformation("[StokBildirimi] {Count} bildirim gönderildi.", gonderilen);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                return;
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "[StokBildirimi] Tur başarısız; bir sonraki turda yeniden denenecek.");
            }

            try { await Task.Delay(TimeSpan.FromMinutes(minutes), stoppingToken); } catch (OperationCanceledException) { return; }
        }
    }

    /// <summary>Bir tur; kaç SMS gittiğini döner.</summary>
    public async Task<int> RunOnceAsync(CancellationToken ct)
    {
        using var scope = _scopes.CreateScope();
        var sp = scope.ServiceProvider;

        var alerts = sp.GetRequiredService<StockAlertService>();
        var bekleyenKodlar = await alerts.PendingStockCodesAsync(ct);
        if (bekleyenKodlar.Count == 0) return 0;

        var catalog = sp.GetRequiredService<CatalogQueries>();
        var urunler = await catalog.GetByStockCodesAsync(bekleyenKodlar, ct);

        var siteUrl = (_configuration["Shop:StorefrontBaseUrl"] ?? "https://example.com").TrimEnd('/');

        var toplam = 0;
        foreach (var kod in bekleyenKodlar)
        {
            // Listede yoksa ürün hâlâ satılamaz durumda (stok yok / kapalı / eşik altında).
            if (!urunler.TryGetValue(kod, out var urun)) continue;
            if (!urun.InStock) continue;

            toplam += await alerts.NotifyAsync(kod, urun.Name, $"{siteUrl}/urun/{urun.Slug}", ct);
        }

        return toplam;
    }
}
