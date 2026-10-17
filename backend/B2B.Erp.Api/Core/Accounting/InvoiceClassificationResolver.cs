using B2B.Erp.Api.Data;
using B2B.Erp.Api.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

namespace B2B.Erp.Api.Core.Accounting;

public interface IInvoiceClassificationResolver
{
    Task<InvoiceClassification> ResolveAsync(int invoiceId, CancellationToken cancellationToken = default);

    Task<IReadOnlyDictionary<int, InvoiceClassification>> ResolveManyAsync(
        IReadOnlyCollection<int> invoiceIds,
        CancellationToken cancellationToken = default);
}

/// <summary>
/// <see cref="InvoiceClassifier"/>'ı veritabanına bağlar: faturanın kaynak alış belgesini
/// bulup <c>Kind</c> ve <c>ServiceCode</c> alanlarını çözer.
///
/// <para>
/// <b>Toplu çözümleme şart:</b> aktarım ekranları yüzlerce faturayı birden listeler.
/// Fatura başına ayrı sorgu (N+1) o ekranı kullanılmaz hale getirirdi — <see cref="ResolveManyAsync"/>
/// iki sorguyla bitirir.
/// </para>
/// </summary>
public sealed class InvoiceClassificationResolver : IInvoiceClassificationResolver
{
    private readonly AppDbContext _dbContext;
    private readonly ILogger<InvoiceClassificationResolver> _logger;

    public InvoiceClassificationResolver(AppDbContext dbContext, ILogger<InvoiceClassificationResolver> logger)
    {
        _dbContext = dbContext;
        _logger = logger;
    }

    public async Task<InvoiceClassification> ResolveAsync(int invoiceId, CancellationToken cancellationToken = default)
    {
        var map = await ResolveManyAsync(new[] { invoiceId }, cancellationToken);
        return map.TryGetValue(invoiceId, out var c)
            ? c
            : new InvoiceClassification(InvoiceNature.Unknown, false, null, null);
    }

    public async Task<IReadOnlyDictionary<int, InvoiceClassification>> ResolveManyAsync(
        IReadOnlyCollection<int> invoiceIds,
        CancellationToken cancellationToken = default)
    {
        var result = new Dictionary<int, InvoiceClassification>();
        if (invoiceIds is null || invoiceIds.Count == 0) return result;

        var ids = invoiceIds.Where(x => x > 0).Distinct().ToList();
        if (ids.Count == 0) return result;

        var invoices = await _dbContext.Set<Invoice>()
            .AsNoTracking()
            .Where(x => ids.Contains(x.Id))
            .Select(x => new { x.Id, x.Type, x.SourcePurchaseInvoiceId })
            .ToListAsync(cancellationToken);

        var sourceIds = invoices
            .Where(x => x.SourcePurchaseInvoiceId.HasValue && x.SourcePurchaseInvoiceId.Value > 0)
            .Select(x => x.SourcePurchaseInvoiceId!.Value)
            .Distinct()
            .ToList();

        // Kaynağı SİLİNMİŞ fatura burada eksik kalır ve sınıflandırıcı bunu
        // SourceMissing olarak işaretler — tahmin edilmez.
        var sources = sourceIds.Count == 0
            ? new Dictionary<int, (PurchaseInvoiceKind Kind, string? ServiceCode)>()
            : (await _dbContext.Set<PurchaseInvoice>()
                    .AsNoTracking()
                    .Where(x => sourceIds.Contains(x.Id))
                    .Select(x => new { x.Id, x.Kind, x.ServiceCode })
                    .ToListAsync(cancellationToken))
                .ToDictionary(x => x.Id, x => (x.Kind, x.ServiceCode));

        foreach (var inv in invoices)
        {
            PurchaseInvoiceKind? kind = null;
            string? serviceCode = null;

            if (inv.SourcePurchaseInvoiceId.HasValue
                && sources.TryGetValue(inv.SourcePurchaseInvoiceId.Value, out var src))
            {
                kind = src.Kind;
                serviceCode = src.ServiceCode;
            }
            else if (inv.SourcePurchaseInvoiceId.HasValue && inv.SourcePurchaseInvoiceId.Value > 0)
            {
                // KAYNAĞI SİLİNMİŞ FATURA — sessizce geçilmez.
                //
                // Sınıflandırma bunu `SourceMissing` ile işaretliyor ama hiçbir iz bırakmıyordu;
                // aktarımı yapan kişi hangi faturanın neden sınıflandırılamadığını ancak tek tek
                // bakarak bulabilirdi. Uyarı seviyesinde loglanıyor (2026-08-19 denetim maddesi 3).
                _logger.LogWarning(
                    "Fatura {InvoiceId} bir alış belgesine ({SourcePurchaseInvoiceId}) bağlı ama o belge bulunamadı; " +
                    "muhasebe niteliği çözülemedi ve 'Kaynakta Silinenler' akışına düşmesi gerekiyor.",
                    inv.Id,
                    inv.SourcePurchaseInvoiceId.Value);
            }

            result[inv.Id] = InvoiceClassifier.Classify(
                inv.Type,
                inv.SourcePurchaseInvoiceId,
                kind,
                serviceCode);
        }

        return result;
    }
}
