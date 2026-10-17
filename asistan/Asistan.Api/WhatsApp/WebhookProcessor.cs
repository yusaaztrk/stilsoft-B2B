using System.Text.Json;
using Asistan.Api.Ai;
using Asistan.Api.Messaging;
using Microsoft.Extensions.Options;

namespace Asistan.Api.WhatsApp;

/// <summary>
/// Doğrulanmış webhook gövdesini işler. Gerçek uç (WebhookController) ve lokal deneme ucu
/// (DevSimulatorController) AYNI yolu kullanır — denemede geçen, canlıda da geçsin.
///
/// Bir gövdede birden çok numara (dolayısıyla birden çok firma) olabilir; her firmanın verisi
/// kendi veritabanına yazılır. Tanınmayan numara (Numbers'ta yok) kaydedilemez — hangi firmaya
/// ait olduğu bilinmiyor — günlüğe uyarı düşer.
/// </summary>
public sealed class WebhookProcessor
{
    private readonly MessageStore _store;
    private readonly ErpCustomerLookup _customers;
    private readonly WhatsAppOptions _options;
    private readonly AiQueue _ai;
    private readonly ILogger<WebhookProcessor> _log;

    public WebhookProcessor(MessageStore store, ErpCustomerLookup customers, IOptions<WhatsAppOptions> options, AiQueue ai, ILogger<WebhookProcessor> log)
    {
        _store = store;
        _customers = customers;
        _ai = ai;
        _options = options.Value;
        _log = log;
    }

    public sealed record Result(int Messages, int NewMessages, int Statuses, int UnknownNumbers);

    public async Task<Result> ProcessAsync(string rawJson, CancellationToken ct)
    {
        using var doc = JsonDocument.Parse(rawJson);
        var (messages, statuses) = WebhookParser.Parse(doc.RootElement);

        var numbers = messages.Select(m => m.PhoneNumberId).Concat(statuses.Select(s => s.PhoneNumberId)).Distinct().ToList();
        var unknown = 0;
        var tenants = new Dictionary<string, string>();
        foreach (var pn in numbers)
        {
            var tenant = _options.TenantFor(pn);
            if (tenant is null)
            {
                unknown++;
                _log.LogWarning("WhatsApp webhook: tanınmayan numara {PhoneNumberId} — WhatsApp:Numbers'a eklenmeli", pn);
                continue;
            }
            tenants[pn] = tenant;
        }

        // Ham kayıt, ilgili her firmaya bir kez (mesajsız gövdeler — hesap bildirimleri — kaydedilmez).
        foreach (var tenant in tenants.Values.Distinct())
        {
            await _store.LogWebhookAsync(tenant, rawJson, null, ct);
        }

        var inserted = 0;
        foreach (var m in messages)
        {
            if (!tenants.TryGetValue(m.PhoneNumberId, out var tenant)) continue;

            var (convId, isNew, newConv) = await _store.SaveInboundAsync(tenant, m, ct);
            if (isNew) inserted++;

            if (newConv)
            {
                // Cari eşleşmesi yalnız İLK mesajda: ERP'ye her mesajda gidilmez. Sonradan
                // açılan cari için panelde "yeniden eşle" düğmesi var.
                // Webhook'u bekletmesin: en fazla 5 sn. Yetişmezse cari boş kalır, mesaj kaydı etkilenmez
                // ("Cari" düğmesi ya da asistanın kendi araması sonra bulur).
                try
                {
                    using var limit = CancellationTokenSource.CreateLinkedTokenSource(ct);
                    limit.CancelAfter(TimeSpan.FromSeconds(5));
                    var matches = await _customers.FindByPhoneAsync(tenant, m.WaId, limit.Token);
                    await _store.SetCustomerMatchAsync(tenant, convId, matches, ct);
                }
                catch (OperationCanceledException) when (!ct.IsCancellationRequested)
                {
                    _log.LogWarning("Cari eşleşmesi 5 sn'de bitmedi ({Tenant}#{Conv}); mesaj kaydedildi, cari sonra eşlenebilir.", tenant, convId);
                }
            }

            // Asistan yalnız YENİ mesajda çalışır (tekrar gelen webhook ikinci çağrı yaptırmaz).
            if (isNew) _ai.Enqueue(tenant, convId);
        }

        foreach (var s in statuses)
        {
            if (!tenants.TryGetValue(s.PhoneNumberId, out var tenant)) continue;
            await _store.ApplyStatusAsync(tenant, s, ct);
        }

        return new Result(messages.Count, inserted, statuses.Count, unknown);
    }
}
