using System.Collections.Concurrent;
using System.Threading.Channels;
using Asistan.Api.Messaging;
using Microsoft.Extensions.Options;

namespace Asistan.Api.Ai;

public sealed record AiJob(string Tenant, long ConversationId, bool Force);

/// <summary>Webhook'tan asistana iş bırakma kuyruğu. Webhook asistanı BEKLEMEZ (Meta 20 sn içinde 200 ister).</summary>
public sealed class AiQueue
{
    private readonly Channel<AiJob> _channel = Channel.CreateUnbounded<AiJob>(new UnboundedChannelOptions { SingleReader = true });

    public ChannelReader<AiJob> Reader => _channel.Reader;

    public void Enqueue(string tenant, long conversationId, bool force = false) =>
        _channel.Writer.TryWrite(new AiJob(tenant, conversationId, force));
}

/// <summary>
/// Asistanı çalıştıran arka plan işçisi.
///
///  - Bekletme (debounce): müşteri "merhaba" / "siparişim" / "ne zaman gelir" diye art arda yazınca
///    üç ayrı çağrı değil, son mesajdan birkaç saniye sonra TEK çağrı yapılır.
///  - Aynı konuşma aynı anda iki kez işlenmez; işlenirken yeni mesaj gelirse iş bitince yeniden işlenir.
///  - Aynı anda en fazla Ai:MaxParallel konuşma.
///  - Hata konuşmaya yazılır (ekranda görünür); mesaj kaybolmaz, personel her zaman elle cevaplayabilir.
/// </summary>
public sealed class AiWorker : BackgroundService
{
    private readonly AiQueue _queue;
    private readonly IServiceScopeFactory _scopes;
    private readonly IAiClassifier _classifier;
    private readonly Tools.AiToolbox _toolbox;
    private readonly AiOptions _options;
    private readonly ILogger<AiWorker> _log;

    private readonly ConcurrentDictionary<(string, long), (DateTime Due, bool Force)> _pending = new();
    private readonly ConcurrentDictionary<(string, long), bool> _inFlight = new();
    private readonly SemaphoreSlim _gate;

    public AiWorker(AiQueue queue, IServiceScopeFactory scopes, IAiClassifier classifier, Tools.AiToolbox toolbox,
        IOptions<AiOptions> options, ILogger<AiWorker> log)
    {
        _queue = queue;
        _toolbox = toolbox;
        _scopes = scopes;
        _classifier = classifier;
        _options = options.Value;
        _log = log;
        _gate = new SemaphoreSlim(Math.Max(1, _options.MaxParallel));
    }

    protected override async Task ExecuteAsync(CancellationToken stop)
    {
        if (_classifier.Provider is null)
        {
            _log.LogInformation("Asistan (yapay zekâ) kapalı: Ai:Provider seçilmedi. Gelen kutusu normal çalışır.");
        }
        else
        {
            _log.LogInformation("Asistan (yapay zekâ) açık: sağlayıcı {Provider}, model {Model}, araçlar: {Tools}", _classifier.Provider, _classifier.Model,
                _toolbox.Definitions.Count == 0 ? "yok (Tools anahtarları boş)" : string.Join(", ", _toolbox.Definitions.Select(d => d.Name)));
        }

        var reader = Task.Run(async () =>
        {
            try
            {
                await foreach (var job in _queue.Reader.ReadAllAsync(stop))
                {
                    var now = DateTime.UtcNow;
                    var due = job.Force ? now : now.AddSeconds(Math.Max(0, _options.DebounceSeconds));
                    _pending.AddOrUpdate((job.Tenant, job.ConversationId), (due, job.Force),
                        (_, old) => (job.Force ? now : due, old.Force || job.Force));
                }
            }
            catch (OperationCanceledException) { }
        }, stop);

        while (!stop.IsCancellationRequested)
        {
            try { await Task.Delay(250, stop); } catch (OperationCanceledException) { break; }

            var now = DateTime.UtcNow;
            foreach (var (key, value) in _pending)
            {
                if (value.Due > now || _inFlight.ContainsKey(key)) continue;
                if (!_gate.Wait(0)) break;
                if (!_pending.TryRemove(key, out var taken))
                {
                    _gate.Release();
                    continue;
                }
                _inFlight[key] = true;
                _ = Task.Run(async () =>
                {
                    try { await ProcessAsync(key.Item1, key.Item2, taken.Force, stop); }
                    finally
                    {
                        _inFlight.TryRemove(key, out _);
                        _gate.Release();
                    }
                }, CancellationToken.None);
            }
        }

        await reader;
    }

    private async Task ProcessAsync(string tenant, long convId, bool force, CancellationToken stop)
    {
        if (_classifier.Provider is null) return;

        long? lastIn = null;
        using var scope = _scopes.CreateScope();
        var ai = scope.ServiceProvider.GetRequiredService<AiStore>();
        try
        {
            var store = scope.ServiceProvider.GetRequiredService<MessageStore>();

            var settings = await ai.GetSettingsAsync(tenant, stop);
            if (!settings.Enabled) return;

            var conv = await store.GetConversationAsync(tenant, convId, stop);
            if (conv is null || !conv.AwaitingReply) return;   // personel bu arada cevapladı

            lastIn = await ai.LastInboundIdAsync(tenant, convId, stop);
            if (lastIn is null) return;
            if (!force && conv.AiLastMessageId is long seen && seen >= lastIn) return;   // bu mesaj zaten okundu

            var messages = await store.ListMessagesAsync(tenant, convId, null, Math.Clamp(_options.HistoryMessages, 2, 100), stop);
            var departments = await ai.ListDepartmentsAsync(tenant, stop);

            // Araçlar: cari eşleşmesi HER çalıştırmada tazelenir (konuşmada yalnız ilk cari tutuluyor,
            // numara sonradan cariye eklenmiş olabilir). Kimin kaydına bakılacağını bu liste belirler.
            Tools.IAiToolSession? tools = null;
            var customers = new List<Tools.AiCustomer>();
            if (settings.ToolsEnabled && _toolbox.Definitions.Count > 0)
            {
                var lookup = scope.ServiceProvider.GetRequiredService<ErpCustomerLookup>();
                customers = (await lookup.FindByPhoneAsync(tenant, conv.WaId, stop)).Select(m => new Tools.AiCustomer(m.CustomerCode, m.Name)).ToList();
                tools = _toolbox.CreateSession(tenant, conv.WaId, customers);
            }

            var input = new AiInput(
                tenant, conv.ContactName, "+" + conv.WaId, conv.CustomerCode, conv.CustomerName, conv.DepartmentName,
                messages.Select(ToLine).Where(l => l is not null).Select(l => l!).ToList(),
                departments, settings, DateTimeOffset.UtcNow, customers, tools);

            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(stop);
            timeout.CancelAfter(TimeSpan.FromSeconds(120));
            var decision = await _classifier.ClassifyAsync(input, timeout.Token);

            var result = await ai.ApplyAsync(tenant, convId, lastIn.Value, decision, settings.AutoRoute, departments, stop);
            _log.LogInformation(
                "Asistan {Tenant}#{Conv}: birim={Dep} önemli={Imp} insan={Human} taslak={Draft} eski={Stale} jeton={In}/{Out} araç={Tools}",
                tenant, convId, decision.DepartmentCode ?? "-", decision.Important, decision.NeedsHuman, result.DraftId, result.Stale,
                decision.InputTokens, decision.OutputTokens,
                decision.ToolCalls.Count == 0 ? "-" : string.Join(", ", decision.ToolCalls.Select(c => $"{c.Name}:{(c.Ok ? "ok" : "hata")}")));
        }
        catch (AiException ex)
        {
            _log.LogWarning(ex, "Asistan {Tenant}#{Conv}: {Message}", tenant, convId, ex.Message);
            await TrySetErrorAsync(ai, tenant, convId, lastIn, ex.Message);
        }
        catch (OperationCanceledException) when (stop.IsCancellationRequested)
        {
        }
        catch (OperationCanceledException)
        {
            await TrySetErrorAsync(ai, tenant, convId, lastIn, "Asistan zamanında cevap vermedi (2 dk).");
        }
        catch (Exception ex)
        {
            _log.LogError(ex, "Asistan {Tenant}#{Conv}: beklenmeyen hata", tenant, convId);
            await TrySetErrorAsync(ai, tenant, convId, lastIn, "Asistan beklenmeyen bir hata aldı; kayıtlara yazıldı.");
        }
    }

    private async Task TrySetErrorAsync(AiStore ai, string tenant, long convId, long? lastIn, string message)
    {
        try { await ai.SetErrorAsync(tenant, convId, lastIn, message, CancellationToken.None); }
        catch (Exception ex) { _log.LogError(ex, "Asistan hatası konuşmaya yazılamadı ({Tenant}#{Conv})", tenant, convId); }
    }

    /// <summary>Mesajı asistanın okuyacağı satıra çevirir. Medya için tür etiketi + açıklama (görsel içeriği okunmaz).</summary>
    private static AiTranscriptLine? ToLine(MessageRow m)
    {
        var label = MessageStore.TypeLabel(m.MsgType);
        var text = m.MsgType == "text"
            ? m.Body
            : string.IsNullOrWhiteSpace(m.Body) ? $"[{label}]" : $"[{label}] {m.Body}";
        if (string.IsNullOrWhiteSpace(text)) return null;
        if (m.Direction == "out" && m.Status == "failed") text += " (iletilemedi)";
        return new AiTranscriptLine(m.WaTimestamp ?? m.CreatedAt, m.Direction, m.SentBy, text.Trim());
    }
}
