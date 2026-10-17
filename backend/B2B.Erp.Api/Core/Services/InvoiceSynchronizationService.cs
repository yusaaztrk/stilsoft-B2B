using B2B.Erp.Api.Data;
using B2B.Erp.Api.Entities;
using Microsoft.EntityFrameworkCore;

namespace B2B.Erp.Api.Core.Services;

public interface IInvoiceSynchronizationService
{
    Task SyncInvoiceHeaderUpdateAsync(
        Invoice invoice,
        string? previousInvoiceNo,
        string? previousCustomerCode,
        CancellationToken cancellationToken = default,
        bool dateChanged = false);
}

public sealed class InvoiceSynchronizationService : IInvoiceSynchronizationService
{
    private readonly AppDbContext _dbContext;

    public InvoiceSynchronizationService(AppDbContext dbContext)
    {
        _dbContext = dbContext;
    }

    public async Task SyncInvoiceHeaderUpdateAsync(
        Invoice invoice,
        string? previousInvoiceNo,
        string? previousCustomerCode,
        CancellationToken cancellationToken = default,
        bool dateChanged = false)
    {
        var newInvoiceNo = (invoice.InvoiceNo ?? string.Empty).Trim();
        var newCustomerCode = (invoice.CustomerCode ?? string.Empty).Trim();

        var oldInvoiceNo = (previousInvoiceNo ?? string.Empty).Trim();
        var oldCustomerCode = (previousCustomerCode ?? string.Empty).Trim();

        var invoiceNoChanged = !string.IsNullOrWhiteSpace(oldInvoiceNo) && !string.Equals(oldInvoiceNo, newInvoiceNo, StringComparison.Ordinal);
        var customerCodeChanged = !string.IsNullOrWhiteSpace(oldCustomerCode) && !string.Equals(oldCustomerCode, newCustomerCode, StringComparison.Ordinal);

        // 1. Sync StockMovements
        var movementQuery = _dbContext.StockMovements.AsQueryable();
        if (invoiceNoChanged)
        {
            movementQuery = movementQuery.Where(x => x.InvoiceNo == oldInvoiceNo);
        }
        else if (customerCodeChanged)
        {
            movementQuery = movementQuery.Where(x => x.InvoiceNo == newInvoiceNo && x.CustomerCode == oldCustomerCode);
        }
        else
        {
            movementQuery = movementQuery.Where(x => x.InvoiceNo == newInvoiceNo);
        }

        /*
          TESLİM CARİSİ CARİYİ TAKİP EDER (2026-09-03).

          Sıradan satışta teslim carisi = cari (fatura kurulurken böyle doldurulur). Üst
          bilgiden cari değiştirilince buradaki satırların teslim kodu eski cariye çakılı
          kalıyordu — ekstrenin "Teslim Cari Adı" sütunu eski cariyi yazmaya devam ediyordu.

          ŞUBE TESLİMİNE DOKUNULMAZ: teslim kodu gerçekten başka bir cariyse o gerçek teslim
          bilgisidir. Satır satır bakılır; yalnız boş olan ya da ESKİ cariye eşit olan taşınır.
          Karşılaştırma ana koda indirgenir (alt hesap eki `-1/-2/-3` iki tarafta farklı
          biçimde durabiliyor).
        */
        var yeniTeslimKodu = (invoice.DeliveryCustomerCode ?? string.Empty).Trim();
        var eskiAnaKod = string.IsNullOrWhiteSpace(oldCustomerCode)
            ? string.Empty
            : B2B.Erp.Api.Core.Helpers.CustomerAccountHelper.GetMainCodeFromInvoiceAccountCode(oldCustomerCode);

        bool TeslimTasinsinMi(string? mevcutTeslimKodu)
        {
            if (!customerCodeChanged || string.IsNullOrWhiteSpace(yeniTeslimKodu)) return false;

            var mevcut = (mevcutTeslimKodu ?? string.Empty).Trim();
            if (string.IsNullOrWhiteSpace(mevcut)) return true;
            if (string.Equals(mevcut, oldCustomerCode, StringComparison.Ordinal)) return true;

            return !string.IsNullOrWhiteSpace(eskiAnaKod)
                && string.Equals(
                    B2B.Erp.Api.Core.Helpers.CustomerAccountHelper.GetMainCodeFromInvoiceAccountCode(mevcut),
                    eskiAnaKod,
                    StringComparison.Ordinal);
        }

        var movements = await movementQuery.ToListAsync(cancellationToken);
        foreach (var m in movements)
        {
            if (invoiceNoChanged) m.InvoiceNo = newInvoiceNo;
            if (customerCodeChanged) m.CustomerCode = newCustomerCode;
            if (TeslimTasinsinMi(m.DeliveryCustomerCode)) m.DeliveryCustomerCode = yeniTeslimKodu;
            // Fatura tarihi değiştiyse stok hareketi de takip etmeli: Stok Giriş/Çıkış raporu
            // hareketi `Date.Month`'a göre grupluyor, eski tarihte kalırsa yanlış ayda görünürdü.
            if (dateChanged) m.Date = invoice.Date;
            m.EditUser = invoice.EditUser;
            m.EditTime = DateTime.UtcNow;
        }

        // 2. Sync CustomerLedgerEntries
        //
        // ESKİDEN Type='H' (ServiceInvoice) ve 'I' (ReturnInvoice) burada TAMAMEN
        // atlanıyordu ("alış tarafı, tedarikçi ekstresi kullanır" varsayımıyla). Oysa
        // servis faturası GERÇEK bir müşteriye (120-*) kesilmişse CustomerLedgerEntries
        // kullanır, tedarikçi ekstresini DEĞİL (bkz. Invoices.CustomerCode; 770-01/320-01
        // gider carisine kesilenler ayrıdır). Denetimde bulunan kanıt: bir servis
        // faturasının cari kodu "Fatura Başlığı Düzenle" ile düzeltildi, fatura kaydı
        // doğru cariyi gösterdi ama bu blok atlandığı için ekstre satırı ESKİ (yanlış)
        // cari kodunda kaldı — 6.400 TL başka bir müşterinin borcu gibi görünmeye devam
        // etti (DEMO_CANLI, A00000000071793/94, 2026-09-13 denetimi).
        //
        // Yalnız gerçek ALIŞ faturası (Type=PurchaseInvoice) bu bloğun tamamen dışında
        // kalır — o hiçbir zaman CustomerLedgerEntries'e yazmaz.
        var isPurchaseInvoice = invoice.Type == InvoiceType.PurchaseInvoice;

        // Yönü bilmediğimiz türler (Servis/İade) için YENİ satır UYDURULMAZ — yalnız
        // MEVCUT satır varsa (aşağıdaki existingLedgers) düzeltilir. Yön varsayımı
        // (Debit) yalnız Satış/Açık Hesap faturasında güvenlidir.
        var canAutoCreateLedger = invoice.Type == InvoiceType.SalesInvoice
            || invoice.Type == InvoiceType.OpenInvoice;

        if (!isPurchaseInvoice && !string.IsNullOrWhiteSpace(newCustomerCode))
        {
            var mainCode = B2B.Erp.Api.Core.Helpers.CustomerAccountHelper.GetMainCodeFromInvoiceAccountCode(newCustomerCode);
            var faturaCode = B2B.Erp.Api.Core.Helpers.CustomerAccountHelper.BuildInvoiceAccountCode(mainCode);
            var acikCode = B2B.Erp.Api.Core.Helpers.CustomerAccountHelper.BuildOpenAccountCode(mainCode);
            var askeriyeCode = B2B.Erp.Api.Core.Helpers.CustomerAccountHelper.BuildAskeriyeAccountCode(mainCode);
            var relatedCustomerCodes = new List<string> { mainCode, faturaCode, acikCode, askeriyeCode, oldCustomerCode, newCustomerCode };

            var existingLedgers = await _dbContext.CustomerLedgerEntries
                .Where(x => (x.ReferenceType == CustomerLedgerEntryReferenceType.Invoice && x.ReferenceId == invoice.Id)
                            || (!string.IsNullOrWhiteSpace(oldInvoiceNo) && x.DocumentNo == oldInvoiceNo && relatedCustomerCodes.Contains(x.CustomerCode))
                            || (!string.IsNullOrWhiteSpace(newInvoiceNo) && x.DocumentNo == newInvoiceNo && relatedCustomerCodes.Contains(x.CustomerCode)))
                .ToListAsync(cancellationToken);

            if (existingLedgers.Count > 0)
            {
                foreach (var ledger in existingLedgers)
                {
                    ledger.CustomerCode = newCustomerCode;
                    if (TeslimTasinsinMi(ledger.DeliveryCustomerCode)) ledger.DeliveryCustomerCode = yeniTeslimKodu;
                    ledger.DocumentNo = newInvoiceNo;
                    ledger.ReferenceType = CustomerLedgerEntryReferenceType.Invoice;
                    ledger.ReferenceId = invoice.Id;
                    // YÖNE DOKUNULMAZ: mevcut satırın Direction'ı zaten doğru kurulmuştu
                    // (770-01/320-01 gider carisine kesilen H faturası Credit, normal
                    // müşteriye kesilen Debit'tir — [[fatura_niteligi_siniflandirma]]).
                    // Burada zorla Debit yazmak servis/iade faturalarında yönü BOZAR.
                    ledger.Amount = invoice.GrandTotal;
                    // Döviz alanları GÜNCELLEME dalında eksikti: `CurrencyAmount`a TL toplam
                    // yazılıyor, `CurrencyTypeId`/`CurrencyRate` hiç güncellenmiyordu. Fatura
                    // no ya da cari kodu değiştirilen 1.000 $'lık bir faturada döviz tutarı
                    // 1.000'den 38.000'e fırlıyordu. EKLEME dalı (aşağıda) bunu zaten doğru
                    // yapıyor — iki dalın aynı kuralı uygulaması şart.
                    ledger.CurrencyTypeId = invoice.CurrencyTypeId;
                    ledger.CurrencyRate = invoice.ExchangeRate <= 0 ? 1m : invoice.ExchangeRate;
                    ledger.CurrencyAmount = invoice.ExchangeRate > 0
                        ? Math.Round(invoice.GrandTotal / invoice.ExchangeRate, 2, MidpointRounding.AwayFromZero)
                        : invoice.GrandTotal;

                    // ÖDEME ÜÇLÜSÜ DE YENİLENMELİ (2026-08-26).
                    //
                    // Fatura satırında ödeme yoktur; bu üçlü yalnızca (para birimi + kur + tutar)
                    // kendi içinde tutarlı olsun diye faturanın kendi değerleriyle doldurulur —
                    // `CreateSalesInvoice` de böyle yapıyor. Ama burada güncellenmiyordu:
                    // fatura toplamı değişince `PaymentCurrencyAmount` eski değerde kalıyor ve
                    // cari ekstredeki "Ödeme Tutarı" sütunu bayat rakamı gösteriyordu.
                    //
                    // Neden ekstre bunu kendi düzeltmiyor: `CustomerLedgerController` fatura
                    // satırlarında `Amount`/`CurrencyAmount`'u faturadan okuyup EZİYOR, ama
                    // ödeme üçlüsü o ezmeye girmiyor ("kayıtlı değer varsa aynen kullan" —
                    // bu kural doğru, 100 $'lık ödemenin 2,63 $ görünmesini engellemek için kondu).
                    //
                    // Canlı örnek: MEHMET KOYUNCU / 100000000000019 — Borç 25.440 iken
                    // "Ödeme Tutarı" 33.920 görünüyordu.
                    //
                    // TAHSİLAT SATIRINA ASLA DOKUNMA: orada bu üçlü GERÇEK ödeme bilgisidir
                    // (kasaya/bankaya hangi parada ne kadar girdi). Ezilirse tahsilat kaydı
                    // bozulur. Yukarıdaki seçim tahsilat satırı getirmiyor — onların
                    // `DocumentNo`'su boş ve `ReferenceType`'ı Kasa/Banka — ama bu koşul
                    // fazladan emniyet olarak duruyor.
                    var odemeSatiri = ledger.TransactionType == "Kasa"
                        || ledger.TransactionType == "Banka"
                        || ledger.TransactionType == "POS"
                        || ledger.TransactionType == "Çek/Senet";

                    if (!odemeSatiri)
                    {
                        ledger.PaymentCurrencyTypeId = ledger.CurrencyTypeId;
                        ledger.PaymentCurrencyRate = ledger.CurrencyRate;
                        ledger.PaymentCurrencyAmount = ledger.CurrencyAmount;
                    }

                    ledger.Date = invoice.Date;
                    // Cari ekstre satırları belge tarihine göre DEĞİL `CreateTime`'a göre
                    // sıralanıyor ([[ekstre-siralamasi-createtime]]). Fatura tarihi değişince
                    // `Date`'i güncellemek yetmez — satır ekstrede yine eski yerinde kalırdı.
                    // Yeni günün gece yarısına çekilir ki o günün akışında görünsün. Tahsilat
                    // satırının kendi kayıt zamanı gerçektir; ona dokunulmaz.
                    if (dateChanged && !odemeSatiri) ledger.CreateTime = invoice.Date;
                    ledger.Description = !string.IsNullOrWhiteSpace(invoice.Description)
                        ? invoice.Description
                        : $"Fatura: {newInvoiceNo}";
                    ledger.EditUser = invoice.EditUser;
                    ledger.EditTime = DateTime.UtcNow;
                    _dbContext.CustomerLedgerEntries.Update(ledger);
                }
            }
            else
            {
                var newLedger = new CustomerLedgerEntry
                {
                    CustomerCode = newCustomerCode,
                    // Yeni kurulan ekstre satırında teslim kodu hiç yazılmıyordu: satır
                    // "Teslim Cari Adı" sütununda boş kalıyordu.
                    DeliveryCustomerCode = string.IsNullOrWhiteSpace(yeniTeslimKodu) ? newCustomerCode : yeniTeslimKodu,
                    Date = invoice.Date,
                    DocumentNo = newInvoiceNo,
                    Description = !string.IsNullOrWhiteSpace(invoice.Description)
                        ? invoice.Description
                        : $"Fatura: {newInvoiceNo}",
                    Direction = CustomerLedgerEntryDirection.Debit,
                    Amount = invoice.GrandTotal,
                    // Fatura başlığı artık para birimi ve DONMUŞ kuru taşıyor (2026-08-14).
                    // Öncesinde burada sabit TL yazılıyordu: fatura numarası veya cari kodu
                    // değiştiğinde ekstre satırı yeniden kurulurken dövizli fatura TL'ye dönüyordu.
                    CurrencyTypeId = invoice.CurrencyTypeId,
                    CurrencyRate = invoice.ExchangeRate <= 0 ? 1m : invoice.ExchangeRate,
                    CurrencyAmount = invoice.ExchangeRate > 0
                        ? Math.Round(invoice.GrandTotal / invoice.ExchangeRate, 2, MidpointRounding.AwayFromZero)
                        : invoice.GrandTotal,
                    ReferenceType = CustomerLedgerEntryReferenceType.Invoice,
                    ReferenceId = invoice.Id,
                    CreateUser = invoice.EditUser ?? "System",
                    CreateTime = DateTime.UtcNow
                };
                _dbContext.CustomerLedgerEntries.Add(newLedger);
            }
        }

        // 3. Sync Directly Linked Cash & Bank Transactions
        if (invoiceNoChanged || customerCodeChanged)
        {
            var cashTrans = await _dbContext.CashAccountTransactions
                .Where(x => x.ReferenceType == CashAccountTransactionReferenceType.Invoice && x.ReferenceId == invoice.Id)
                .ToListAsync(cancellationToken);

            foreach (var c in cashTrans)
            {
                if (customerCodeChanged && c.CounterpartyType == CashAccountTransactionCounterpartyType.Customer)
                {
                    c.CounterpartyCode = newCustomerCode;
                }
                c.EditUser = invoice.EditUser;
                c.EditTime = DateTime.UtcNow;
            }

            if (invoiceNoChanged && !string.IsNullOrWhiteSpace(oldInvoiceNo))
            {
                var bankTrans = await _dbContext.BankAccountTransactions
                    .Where(x => x.DocumentNo == oldInvoiceNo)
                    .ToListAsync(cancellationToken);

                foreach (var b in bankTrans)
                {
                    b.DocumentNo = newInvoiceNo;
                    if (customerCodeChanged && b.CounterpartyType == BankAccountTransactionCounterpartyType.Customer)
                    {
                        b.CounterpartyCode = newCustomerCode;
                    }
                    b.EditUser = invoice.EditUser;
                    b.EditTime = DateTime.UtcNow;
                }
            }
        }

        await _dbContext.SaveChangesAsync(cancellationToken);
    }
}
