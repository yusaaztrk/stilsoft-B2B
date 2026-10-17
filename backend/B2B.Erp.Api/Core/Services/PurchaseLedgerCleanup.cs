using B2B.Erp.Api.Data;
using B2B.Erp.Api.Entities;
using Microsoft.EntityFrameworkCore;

namespace B2B.Erp.Api.Core.Services;

/// <summary>
/// TERMİNE GERİ DÖNEN ALIŞIN EKSTRE SATIRLARINI SİLER — 2026-09-01 kullanıcı bildirimi.
///
/// <para>
/// Alış siparişi "Bekliyor" durumundayken ekstreye yazılmaz: mal gelmemiştir, borç
/// doğmamıştır (bkz. <c>PurchaseInvoicesController.SyncPurchaseInvoiceLedgerEntryAsync</c>).
/// Belge "Teslim Edildi" olduğunda satır yazılır. Durum geri "Bekliyor"a alınırsa o satır
/// SİLİNMELİDİR, yoksa ekstrede hayalet borç kalır.
/// </para>
///
/// <para>
/// Bu geri dönüş İKİ ayrı yerden tetikleniyor: terminin kendi durum ucundan ve fatura
/// dökümünden faturanın silinmesinden. İkincisi terminí "Bekliyor"a çekiyor ama ekstreyi
/// temizlemiyordu — kullanıcının bildirdiği hata buydu. Temizlik iki yerde ayrı ayrı
/// yazılırsa biri değişip diğeri kalır; bu yüzden tek yerde duruyor.
/// </para>
///
/// <para>
/// Yalnızca BELGENİN KENDİ satırlarını siler: ödeme satırları (Kasa/Banka/POS/Çek)
/// <see cref="CustomerLedgerEntryReferenceType.Cash"/> gibi başka bir referans türüyle
/// yazılır, bu süzgece takılmaz. Yine de tür adları açıkça dışarıda bırakılıyor: aynı
/// belgeye elle yazılmış bir ödeme satırı bu temizlikte kaybolmasın.
/// </para>
/// </summary>
public static class PurchaseLedgerCleanup
{
    private static readonly string[] OdemeTurleri = { "Kasa", "Banka", "POS", "Çek/Senet" };

    /// <summary>
    /// Verilen alış belgesinin tedarikçi ve müşteri ekstre satırlarını kaldırır.
    /// <c>SaveChanges</c> ÇAĞIRMAZ: çağıran, silmeyi kendi işlemiyle birlikte yazar.
    /// </summary>
    /// <returns>Kaldırılan satır sayısı (tedarikçi + müşteri).</returns>
    public static async Task<int> RemoveLedgerEntriesForPurchaseAsync(
        AppDbContext dbContext,
        int purchaseInvoiceId,
        string? documentNo,
        CancellationToken cancellationToken)
    {
        var supplierEntries = await dbContext.SupplierLedgerEntries
            .Where(x => x.ReferenceType == SupplierLedgerEntryReferenceType.Invoice
                        && x.ReferenceId == purchaseInvoiceId
                        && (x.TransactionType == null || !OdemeTurleri.Contains(x.TransactionType)))
            .ToListAsync(cancellationToken);
        if (supplierEntries.Count > 0)
        {
            dbContext.SupplierLedgerEntries.RemoveRange(supplierEntries);
        }

        /*
          Müşteri tarafında DocumentNo da aranıyor: `ReferenceType = Invoice` hem satış
          faturası hem alış belgesi için kullanılıyor ve kimlikler ayrı dizilerden geliyor,
          yani aynı sayı iki farklı belgeye denk gelebilir. Belge numarası bu çakışmayı
          ayırır. Tedarikçi defterinde satış faturası hiç bulunmadığı için orada gerekmiyor.
        */
        var customerEntries = await dbContext.CustomerLedgerEntries
            .Where(x => x.ReferenceType == CustomerLedgerEntryReferenceType.Invoice
                        && x.ReferenceId == purchaseInvoiceId
                        && x.DocumentNo == documentNo
                        && (x.TransactionType == null || !OdemeTurleri.Contains(x.TransactionType)))
            .ToListAsync(cancellationToken);
        if (customerEntries.Count > 0)
        {
            dbContext.CustomerLedgerEntries.RemoveRange(customerEntries);
        }

        return supplierEntries.Count + customerEntries.Count;
    }
}
