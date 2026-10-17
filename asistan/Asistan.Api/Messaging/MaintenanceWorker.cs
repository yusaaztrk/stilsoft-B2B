using Asistan.Api.WhatsApp;
using Microsoft.Extensions.Options;

namespace Asistan.Api.Messaging;

/// <summary>Günde bir: 30 günden eski ham webhook kayıtlarını siler. Mesajlara dokunmaz.</summary>
public sealed class MaintenanceWorker : BackgroundService
{
    private readonly IServiceScopeFactory _scopes;
    private readonly WhatsAppOptions _options;
    private readonly ILogger<MaintenanceWorker> _log;

    public MaintenanceWorker(IServiceScopeFactory scopes, IOptions<WhatsAppOptions> options, ILogger<MaintenanceWorker> log)
    {
        _scopes = scopes;
        _options = options.Value;
        _log = log;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        // Açılışın hemen ardından değil: servis ayağa kalkarken veritabanını meşgul etmesin.
        try { await Task.Delay(TimeSpan.FromMinutes(5), stoppingToken); } catch (OperationCanceledException) { return; }

        while (!stoppingToken.IsCancellationRequested)
        {
            foreach (var tenant in _options.Numbers.Values.Where(v => !string.IsNullOrWhiteSpace(v)).Select(v => v.Trim().ToUpperInvariant()).Distinct())
            {
                try
                {
                    using var scope = _scopes.CreateScope();
                    var store = scope.ServiceProvider.GetRequiredService<MessageStore>();
                    var n = await store.PruneWebhookEventsAsync(tenant, stoppingToken);
                    if (n > 0) _log.LogInformation("{Tenant}: {Count} eski webhook kaydı silindi", tenant, n);
                }
                catch (Exception ex) when (ex is not OperationCanceledException)
                {
                    // Bir firmanın hatası diğerlerini durdurmaz.
                    _log.LogWarning(ex, "{Tenant}: bakım yapılamadı", tenant);
                }
            }

            try { await Task.Delay(TimeSpan.FromHours(24), stoppingToken); } catch (OperationCanceledException) { return; }
        }
    }
}
