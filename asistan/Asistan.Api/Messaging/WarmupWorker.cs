using Asistan.Api.Infrastructure;
using Asistan.Api.WhatsApp;
using Microsoft.Extensions.Options;
using Npgsql;

namespace Asistan.Api.Messaging;

/// <summary>
/// AÇILIŞ ISINMASI (2026-10-11). Site açılır açılmaz WhatsApp numarasına bağlı firmaların asistan şemasını
/// kurar/denetler ve ERP veritabanı bağlantısını açar. Böylece uykudan sonraki İLK webhook bu işleri
/// beklemez — "ilk mesaj gelmiyor" sorununun bir ayağı açılışta DDL + ERP bağlantısının ilk mesaja binmesiydi.
/// Hata olursa yalnız günlüğe yazar; site açılmaya devam eder.
/// </summary>
public sealed class WarmupWorker : BackgroundService
{
    private readonly AsistanSchema _schema;
    private readonly TenantDb _db;
    private readonly WhatsAppOptions _options;
    private readonly ILogger<WarmupWorker> _log;

    public WarmupWorker(AsistanSchema schema, TenantDb db, IOptions<WhatsAppOptions> options, ILogger<WarmupWorker> log)
    {
        _schema = schema;
        _db = db;
        _options = options.Value;
        _log = log;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var tenants = _options.Numbers.Values.Where(v => !string.IsNullOrWhiteSpace(v)).Select(v => v.Trim().ToUpperInvariant()).Distinct();
        foreach (var tenant in tenants)
        {
            var sw = System.Diagnostics.Stopwatch.StartNew();
            try
            {
                await _schema.EnsureAsync(tenant, stoppingToken);
                await using var erp = new NpgsqlConnection(_db.ErpConnectionString(tenant));
                await erp.OpenAsync(stoppingToken);
                _log.LogInformation("Açılış ısınması {Tenant}: şema + ERP bağlantısı hazır ({Ms} ms)", tenant, sw.ElapsedMilliseconds);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                return;
            }
            catch (Exception ex)
            {
                _log.LogWarning(ex, "Açılış ısınması {Tenant} yapılamadı (ilk istekte yeniden denenir)", tenant);
            }
        }
    }
}
