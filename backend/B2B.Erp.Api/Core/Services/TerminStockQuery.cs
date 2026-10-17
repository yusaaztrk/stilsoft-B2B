using B2B.Erp.Api.Data;
using B2B.Erp.Api.Entities;
using Microsoft.EntityFrameworkCore;

namespace B2B.Erp.Api.Core.Services;

/// <summary>
/// TERMİNDEKİ (yolda olan) stok miktarı — 2026-08-31 kullanıcı isteği.
///
/// "Termin", teslim alınmamış alış siparişidir: <see cref="PurchaseInvoiceKind.Purchase"/>
/// türündeki belge <see cref="PurchaseInvoiceTerminStatus.Waiting"/> durumundayken stoğa
/// HİÇ girmez (bkz. <c>PurchaseInvoicesController.UpsertInvoiceFromPurchase</c>). Yani bu
/// miktar "stokta yok ama sipariş edilmiş" demektir; kullanıcı fiyat verirken ve stok
/// raporuna bakarken bunu bakiyenin yanında görmek istiyor.
///
/// İki ekran kullanıyor (Toplu Fiyat Atama ve Stok Giriş/Çıkış Raporu). Sorgu burada tek
/// yerde: iki ekranın "termin" tanımı ayrışırsa aynı ürün için iki farklı sayı gösterilir.
///
/// Yetki sorgunun DEĞİL çağıran ucun işi; her uç kendi sayfa yetkisiyle korunur.
/// </summary>
public static class TerminStockQuery
{
    /// <summary>Tek satırlık kırılım: hangi belgede ne kadar bekliyor.</summary>
    public sealed record TerminSatiri(
        int PurchaseInvoiceId,
        string DocumentNo,
        DateTime Date,
        string SupplierCode,
        string StockCode,
        decimal Quantity,
        int? WarehouseCode);

    /// <summary>
    /// Stok kodu → bekleyen toplam miktar.
    ///
    /// <paramref name="stockCodes"/> verilirse yalnız o kodlar döner; boş/null ise termini
    /// olan TÜM kodlar döner. Bekleyen belge sayısı az olduğu için tam liste de küçüktür.
    /// </summary>
    public static async Task<Dictionary<string, decimal>> ToplamlarAsync(
        AppDbContext db,
        IReadOnlyCollection<string>? stockCodes,
        CancellationToken cancellationToken)
    {
        var q = BekleyenSatirlar(db);

        if (stockCodes is { Count: > 0 })
        {
            // Kod eşleşmesi büyük/küçük harf duyarsız olmalı: aynı ürün bazı belgelerde
            // küçük harfle yazılmış olabiliyor.
            var kodlar = stockCodes
                .Where(x => !string.IsNullOrWhiteSpace(x))
                .Select(x => x.Trim().ToLower())
                .Distinct()
                .ToList();

            if (kodlar.Count == 0) return new Dictionary<string, decimal>(StringComparer.OrdinalIgnoreCase);
            q = q.Where(l => kodlar.Contains(l.StockCode.ToLower()));
        }

        var satirlar = await q
            .GroupBy(l => l.StockCode.ToLower())
            .Select(g => new { Kod = g.Key, Miktar = g.Sum(x => x.Quantity) })
            .ToListAsync(cancellationToken);

        var sonuc = new Dictionary<string, decimal>(StringComparer.OrdinalIgnoreCase);
        foreach (var s in satirlar)
        {
            if (string.IsNullOrWhiteSpace(s.Kod)) continue;
            sonuc[s.Kod] = s.Miktar;
        }
        return sonuc;
    }

    /// <summary>
    /// Stok kodu → EN YAKIN tahmini geliş tarihi (2026-09-05 kullanıcı isteği).
    ///
    /// Bir üründe birden çok bekleyen sipariş olabilir; kullanıcıyı ilgilendiren "bu mal ne
    /// zaman gelecek", yani en erken tarih. Tarihi girilmemiş belgeler elenir — <c>null</c>
    /// "tarih yok" demektir, "bugün" değil.
    ///
    /// Yetki yine çağıran ucun işi: bu tarih Stok Giriş/Çıkış Raporu'nda da gösteriliyor ve
    /// oradaki kullanıcıların ayrıca <c>invoice/termin</c> yetkisi olması BEKLENMİYOR.
    /// </summary>
    public static async Task<Dictionary<string, DateTime>> EnYakinGelisTarihleriAsync(
        AppDbContext db,
        IReadOnlyCollection<string>? stockCodes,
        CancellationToken cancellationToken)
    {
        var q = BekleyenSatirlar(db).Where(l => l.PurchaseInvoice.EstimatedArrivalDate != null);

        if (stockCodes is { Count: > 0 })
        {
            var kodlar = stockCodes
                .Where(x => !string.IsNullOrWhiteSpace(x))
                .Select(x => x.Trim().ToLower())
                .Distinct()
                .ToList();

            if (kodlar.Count == 0) return new Dictionary<string, DateTime>(StringComparer.OrdinalIgnoreCase);
            q = q.Where(l => kodlar.Contains(l.StockCode.ToLower()));
        }

        var satirlar = await q
            .GroupBy(l => l.StockCode.ToLower())
            .Select(g => new { Kod = g.Key, Tarih = g.Min(x => x.PurchaseInvoice.EstimatedArrivalDate!.Value) })
            .ToListAsync(cancellationToken);

        var sonuc = new Dictionary<string, DateTime>(StringComparer.OrdinalIgnoreCase);
        foreach (var s in satirlar)
        {
            if (string.IsNullOrWhiteSpace(s.Kod)) continue;
            sonuc[s.Kod] = s.Tarih;
        }
        return sonuc;
    }

    /// <summary>
    /// Tek bir stok kodunun kırılımı: hangi alış siparişinde ne kadar bekliyor.
    /// Ekranda modal olarak gösteriliyor.
    /// </summary>
    public static async Task<List<TerminSatiri>> KirilimAsync(
        AppDbContext db,
        string stockCode,
        CancellationToken cancellationToken)
    {
        var kod = (stockCode ?? string.Empty).Trim().ToLower();
        if (kod.Length == 0) return new List<TerminSatiri>();

        return await BekleyenSatirlar(db)
            .Where(l => l.StockCode.ToLower() == kod)
            .OrderBy(l => l.PurchaseInvoice.Date)
            .Select(l => new TerminSatiri(
                l.PurchaseInvoice.Id,
                l.PurchaseInvoice.DocumentNo,
                l.PurchaseInvoice.Date,
                l.PurchaseInvoice.SupplierCode ?? string.Empty,
                l.StockCode,
                l.Quantity,
                l.WarehouseCode))
            .ToListAsync(cancellationToken);
    }

    /// <summary>
    /// Ortak süzgeç: yalnız ALIŞ türü ve yalnız BEKLİYOR durumundaki belgelerin satırları.
    /// Hizmet/iade belgeleri termin sayılmaz — stoğa da girmezler.
    /// </summary>
    private static IQueryable<PurchaseInvoiceLine> BekleyenSatirlar(AppDbContext db) =>
        db.Set<PurchaseInvoiceLine>()
            .AsNoTracking()
            .Where(l =>
                l.PurchaseInvoice.Kind == PurchaseInvoiceKind.Purchase &&
                l.PurchaseInvoice.TerminStatus == PurchaseInvoiceTerminStatus.Waiting &&
                l.Quantity > 0 &&
                l.StockCode != null && l.StockCode != "");
}
