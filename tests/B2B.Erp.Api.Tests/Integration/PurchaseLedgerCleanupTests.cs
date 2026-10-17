using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using B2B.Erp.Api.Core.Services;
using B2B.Erp.Api.Entities;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace B2B.Erp.Api.Tests.Integration;

/// <summary>
/// TERMİNE GERİ DÖNEN ALIŞIN EKSTRESİ TEMİZLENİR — 2026-09-01 kullanıcı bildirimi.
///
/// <para>
/// Kullanıcı fatura dökümünden faturayı sildiğinde alış "Bekliyor"a dönüyor ama tedarikçi
/// ekstresindeki borç satırı yerinde kalıyordu. Temizlik tek yere alındı
/// (<see cref="PurchaseLedgerCleanup"/>) ve burada GERÇEK PostgreSQL üzerinde sınanıyor:
/// sorgudaki iki incelik — NULL <c>TransactionType</c> ve NULL <c>DocumentNo</c> — bellek
/// içi sağlayıcıda üç değerli mantığı taşımaz, yani hatayı gizlerdi.
/// </para>
/// </summary>
[Collection("postgres")]
public sealed class PurchaseLedgerCleanupTests
{
    private readonly PostgresTestFixture _fixture;

    public PurchaseLedgerCleanupTests(PostgresTestFixture fixture) => _fixture = fixture;

    private bool PostgresUnavailable => !_fixture.IsAvailable;

    private static int _sayac = 7_100_000;
    private static int SonrakiId() => Interlocked.Increment(ref _sayac);

    private const string TedarikciKodu = "320-01-TEST";
    private const string CariKodu = "120-01-TEST";

    /// <summary>Ekstre satırları cari/tedarikçi kartına yabancı anahtarla bağlı; kartlar önce açılır.</summary>
    private async Task KartlariHazirlaAsync()
    {
        await using var db = _fixture.CreateContext();
        if (!await db.Suppliers.AnyAsync(x => x.SupplierCode == TedarikciKodu))
            db.Suppliers.Add(new Supplier { SupplierCode = TedarikciKodu, FullName = "TEST TEDARIKCI" });
        if (!await db.Customers.AnyAsync(x => x.CustomerCode == CariKodu))
            db.Customers.Add(new Customer { CustomerCode = CariKodu, Name = "TEST CARI" });
        await db.SaveChangesAsync();
    }

    [SkippableFact]
    public async Task TermineDonenAlisinEkstreSatiriSilinir_OdemeSatiriKalir()
    {
        Skip.If(PostgresUnavailable, _fixture.SkipReason);
        await KartlariHazirlaAsync();

        var alisId = SonrakiId();
        const string belgeNo = "ALS-TEST-1";

        await using (var db = _fixture.CreateContext())
        {
            // Teslim edildiğinde yazılan borç satırı.
            db.SupplierLedgerEntries.Add(new SupplierLedgerEntry
            {
                SupplierCode = TedarikciKodu,
                Date = System.DateTime.UtcNow,
                Direction = SupplierLedgerEntryDirection.Credit,
                Amount = 1000m,
                DocumentNo = belgeNo,
                TransactionType = "Fatura",
                ReferenceType = SupplierLedgerEntryReferenceType.Invoice,
                ReferenceId = alisId
            });

            // Aynı belgeye elle yazılmış ÖDEME satırı: silinmemeli.
            db.SupplierLedgerEntries.Add(new SupplierLedgerEntry
            {
                SupplierCode = TedarikciKodu,
                Date = System.DateTime.UtcNow,
                Direction = SupplierLedgerEntryDirection.Debit,
                Amount = 400m,
                DocumentNo = belgeNo,
                TransactionType = "Kasa",
                ReferenceType = SupplierLedgerEntryReferenceType.Invoice,
                ReferenceId = alisId
            });

            // Türü BOŞ satır: `NOT IN` bunu plandan düşürürdü, silinmeli.
            db.SupplierLedgerEntries.Add(new SupplierLedgerEntry
            {
                SupplierCode = TedarikciKodu,
                Date = System.DateTime.UtcNow,
                Direction = SupplierLedgerEntryDirection.Credit,
                Amount = 55m,
                DocumentNo = belgeNo,
                TransactionType = null,
                ReferenceType = SupplierLedgerEntryReferenceType.Invoice,
                ReferenceId = alisId
            });

            // BAŞKA belgenin satırı: dokunulmamalı.
            db.SupplierLedgerEntries.Add(new SupplierLedgerEntry
            {
                SupplierCode = TedarikciKodu,
                Date = System.DateTime.UtcNow,
                Direction = SupplierLedgerEntryDirection.Credit,
                Amount = 900m,
                DocumentNo = "ALS-TEST-BASKA",
                TransactionType = "Fatura",
                ReferenceType = SupplierLedgerEntryReferenceType.Invoice,
                ReferenceId = alisId + 1
            });

            await db.SaveChangesAsync();
        }

        await using (var db = _fixture.CreateContext())
        {
            var silinen = await PurchaseLedgerCleanup.RemoveLedgerEntriesForPurchaseAsync(
                db, alisId, belgeNo, CancellationToken.None);
            await db.SaveChangesAsync();

            Assert.Equal(2, silinen); // borç satırı + türü boş satır
        }

        await using (var db = _fixture.CreateContext())
        {
            var kalan = await db.SupplierLedgerEntries
                .Where(x => x.ReferenceId == alisId || x.ReferenceId == alisId + 1)
                .OrderBy(x => x.Amount)
                .ToListAsync();

            Assert.Equal(2, kalan.Count);
            Assert.Contains(kalan, x => x.TransactionType == "Kasa" && x.Amount == 400m);
            Assert.Contains(kalan, x => x.DocumentNo == "ALS-TEST-BASKA");
        }
    }

    /// <summary>
    /// Müşteri tarafında belge numarası eşleşmesi aranıyor. Belge numarası BOŞ olan bir alış
    /// için de satır silinebilmeli: `= NULL` hiçbir satırla eşleşmez, EF'in bunu `IS NULL`e
    /// çevirdiği doğrulanıyor.
    /// </summary>
    [SkippableFact]
    public async Task BelgeNumarasiBosOlanAlisinMusteriSatiriDaSilinir()
    {
        Skip.If(PostgresUnavailable, _fixture.SkipReason);
        await KartlariHazirlaAsync();

        var alisId = SonrakiId();

        await using (var db = _fixture.CreateContext())
        {
            db.CustomerLedgerEntries.Add(new CustomerLedgerEntry
            {
                CustomerCode = CariKodu,
                Date = System.DateTime.UtcNow,
                Direction = CustomerLedgerEntryDirection.Debit,
                Amount = 250m,
                DocumentNo = null,
                TransactionType = "Fatura",
                ReferenceType = CustomerLedgerEntryReferenceType.Invoice,
                ReferenceId = alisId
            });
            await db.SaveChangesAsync();
        }

        await using (var db = _fixture.CreateContext())
        {
            var silinen = await PurchaseLedgerCleanup.RemoveLedgerEntriesForPurchaseAsync(
                db, alisId, null, CancellationToken.None);
            await db.SaveChangesAsync();

            Assert.Equal(1, silinen);
        }

        await using (var db = _fixture.CreateContext())
        {
            Assert.False(await db.CustomerLedgerEntries.AnyAsync(x => x.ReferenceId == alisId));
        }
    }
}
