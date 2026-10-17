using B2B.Erp.Api.Core.Authorization;
using B2B.Erp.Api.Core.Helpers;
using B2B.Erp.Api.Data;
using B2B.Erp.Api.Entities;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;

namespace B2B.Erp.Api.Controllers;

[ApiController]
[Route("api/reports/cari-borc-alacak")]
[Authorize]
public sealed class CariBorcAlacakReportController : ControllerBase
{
    private readonly AppDbContext _dbContext;

    public CariBorcAlacakReportController(AppDbContext dbContext)
    {
        _dbContext = dbContext;
    }

    [HttpGet]
    [AuthorizePage("reports", "cariBorcAlacak")]
    public async Task<IActionResult> GetReport(
        [FromQuery] int? currencyTypeId,
        CancellationToken cancellationToken = default)
    {
        // RAPOR PARA BİRİMİ BAŞINA ÇALIŞIR (2026-08-17).
        // Borç/alacak/bakiye eskiden yalnız TL çapasından (`Amount`) toplanıyordu: dolarla
        // kesilen fatura ile TL tahsilat aynı kovada birbirini götürüyordu. Artık yalnız
        // seçili para birimindeki hareketler toplanır ve tutarlar o paranın kendisindedir.
        // Süzgeç verilmezse TL — eski ekranla aynı görünüm.
        var selectedCurrencyTypeId = CurrencyTypeHelper.Normalize(currencyTypeId ?? CurrencyTypeHelper.Try);
        // 1. Fetch active MAIN customers only (sub accounts -1/-2/-3 are rolled up into their main account)
        var customersQuery = _dbContext.Customers
            .AsNoTracking()
            .Where(x => x.IsActive)
            .Where(x => (x.MainCustomerCode == null || x.MainCustomerCode == "" || x.MainCustomerCode == x.CustomerCode)
                        && !x.CustomerCode.EndsWith("-1")
                        && !x.CustomerCode.EndsWith("-2")
                        && !x.CustomerCode.EndsWith("-3"));

        // CARİ KAPSAMI (denetim md. 2) — VERİ SIZINTISI DÜZELTMESİ.
        //
        // Sayfa yetkisi (`reports/cariBorcAlacak`) yalnızca ekranın AÇILABİLİRLİĞİNİ
        // belirliyor; hangi carilerin görüneceğini belirlemiyordu. Portföyü sınırlı bir
        // plasiyer ya da tek cariye bağlı bir bayi bu raporu açtığında ŞİRKETİN BÜTÜN
        // müşterilerinin borcunu, alacağını ve telefonunu görebiliyordu.
        //
        // Kardeş rapor (`CustomerAgeingReportController`) doğru deseni zaten kullanıyor;
        // birebir aynısı buraya da uygulandı: kapsam sınırsızsa (boş / * / ALL claim)
        // hiçbir şey değişmez, sınırlıysa yalnız kapsamdaki cariler ve onların alt
        // hesapları listelenir ([[b2b-carikodu-claim-yapisi]]).
        if (!CustomerScope.IsUnrestrictedFor(User))
        {
            var userScopeCodes = CustomerScope.Of(User);
            var expandedScope = await CustomerScope.ExpandAsync(
                _dbContext.Customers.AsNoTracking(), userScopeCodes, cancellationToken);

            customersQuery = customersQuery.Where(x =>
                userScopeCodes.Contains(x.CustomerCode)
                || (x.MainCustomerCode != null && userScopeCodes.Contains(x.MainCustomerCode))
                || expandedScope.Contains(x.CustomerCode));
        }

        var customers = await customersQuery.ToListAsync(cancellationToken);

        // 1b. Map every customer code (incl. sub accounts) to its main customer code
        var accountMap = await _dbContext.Customers
            .AsNoTracking()
            .Select(x => new { x.CustomerCode, x.MainCustomerCode })
            .ToListAsync(cancellationToken);

        var mainCodeLookup = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var a in accountMap)
        {
            if (string.IsNullOrWhiteSpace(a.CustomerCode)) continue;
            var mainCode = !string.IsNullOrWhiteSpace(a.MainCustomerCode)
                ? a.MainCustomerCode.Trim()
                : CustomerAccountHelper.GetMainCodeFromInvoiceAccountCode(a.CustomerCode.Trim());
            mainCodeLookup[a.CustomerCode.Trim()] = mainCode;
        }

        string ResolveMainCode(string? customerCode)
        {
            var code = (customerCode ?? string.Empty).Trim();
            if (code.Length == 0) return code;
            return mainCodeLookup.TryGetValue(code, out var mapped)
                ? mapped
                : CustomerAccountHelper.GetMainCodeFromInvoiceAccountCode(code);
        }

        // 2. Fetch salesmen
        var salesmen = await _dbContext.Salesmen
            .AsNoTracking()
            .ToListAsync(cancellationToken);
        // MÜKERRER PLASİYER KODU RAPORU ÇÖKERTMEZ (denetim md. 13).
        //
        // `ToDictionary` aynı anahtardan iki kez gelirse `ArgumentException` fırlatır ve
        // rapor 500 döner. `Salesmen.SalesmanCode` üzerinde tekil indeks YOK, yani aynı kodla
        // iki kayıt açılması veri olarak mümkün. Gruplayıp ilkini almak raporu ayakta tutar;
        // tekilliği zorlamak plasiyer tanımının işi, raporun değil.
        var salesmanLookup = salesmen
            .GroupBy(x => x.SalesmanCode, StringComparer.OrdinalIgnoreCase)
            .ToDictionary(g => g.Key, g => g.First().Description, StringComparer.OrdinalIgnoreCase);

        // 3. Fetch debit and credit sums grouped by CustomerCode — YALNIZ seçili para birimi.
        //    Tutar satırın kendi para birimindedir: TL satırında `Amount`, dövizli satırda
        //    `CurrencyAmount` (boşsa kurla üretilir, kur da yoksa TL tutarına düşülür).
        // TABLONUN TAMAMI ARTIK BELLEĞE ÇEKİLMİYOR (denetim md. 1).
        //
        // Buradaki sorgu `CustomerLedgerEntries` tablosunun BÜTÜN satırlarını süzgeçsiz
        // `ToListAsync()` ile RAM'e alıp gruplamayı C# tarafında yapıyordu. Hareket sayısı
        // yüz binlere çıktığında rapor açılışı sunucunun belleğini tüketiyordu.
        //
        // İki değişiklik: (a) para birimi listesi ayrı ve ucuz bir `DISTINCT` sorgusu,
        // (b) tutarlar YALNIZ seçili para birimi için ve sunucu tarafında gruplanarak
        // çekiliyor. Hesabın kendisi (`OwnCurrencyAmount`) aynen korundu; yalnızca hangi
        // satırların belleğe geldiği değişti — rakamlar birebir aynı kalır.
        var customerCurrencyTypeIds = await _dbContext.CustomerLedgerEntries
                .AsNoTracking()
                .Select(x => x.CurrencyTypeId)
                .Distinct()
                .ToListAsync(cancellationToken);
        var supplierCurrencyTypeIds = await _dbContext.SupplierLedgerEntries
                .AsNoTracking()
                .Where(x => x.SupplierCode.StartsWith("320"))
                .Select(x => x.CurrencyTypeId)
                .Distinct()
                .ToListAsync(cancellationToken);

        var availableCurrencyTypeIds = customerCurrencyTypeIds
            .Concat(supplierCurrencyTypeIds)
            .Select(CurrencyTypeHelper.Normalize)
            .Distinct()
            .OrderBy(x => x)
            .ToList();
        if (availableCurrencyTypeIds.Count == 0) availableCurrencyTypeIds.Add(CurrencyTypeHelper.Try);

        // 0 ve 1 aynı para birimi (TL); seçim TL ise ikisi de alınır.
        var selectedIsTry = CurrencyTypeHelper.IsTry(selectedCurrencyTypeId);

        var currencyRows = await _dbContext.CustomerLedgerEntries
            .AsNoTracking()
            .Where(x => selectedIsTry
                ? (x.CurrencyTypeId == 0 || x.CurrencyTypeId == 1)
                : x.CurrencyTypeId == selectedCurrencyTypeId)
            .Select(x => new
            {
                x.CustomerCode,
                x.Direction,
                x.Amount,
                x.CurrencyTypeId,
                x.CurrencyAmount,
                x.CurrencyRate
            })
            .ToListAsync(cancellationToken);

        static decimal OwnCurrencyAmount(int currencyTypeId, decimal amount, decimal currencyAmount, decimal currencyRate)
        {
            if (CurrencyTypeHelper.IsTry(currencyTypeId)) return amount;
            if (currencyAmount > 0m) return currencyAmount;
            return currencyRate > 0m ? Math.Round(amount / currencyRate, 2, MidpointRounding.AwayFromZero) : amount;
        }

        var balanceSums = currencyRows
            // Süzgeç zaten sorguda uygulandı; burada kalması davranışı değiştirmez, yalnızca
            // niyeti açık tutar (0/1 normalizasyonu tek yerde toplanır).
            .Where(x => CurrencyTypeHelper.Normalize(x.CurrencyTypeId) == selectedCurrencyTypeId)
            .GroupBy(x => x.CustomerCode)
            .Select(g => new
            {
                CustomerCode = g.Key,
                Debit = g.Where(x => x.Direction == CustomerLedgerEntryDirection.Debit)
                         .Sum(x => OwnCurrencyAmount(x.CurrencyTypeId, x.Amount, x.CurrencyAmount, x.CurrencyRate)),
                Credit = g.Where(x => x.Direction == CustomerLedgerEntryDirection.Credit)
                          .Sum(x => OwnCurrencyAmount(x.CurrencyTypeId, x.Amount, x.CurrencyAmount, x.CurrencyRate))
            })
            .ToList();
        // 3b. Roll the per-account sums up to the main customer code
        var balanceLookup = balanceSums
            .GroupBy(x => ResolveMainCode(x.CustomerCode), StringComparer.OrdinalIgnoreCase)
            .ToDictionary(
                g => g.Key,
                g => new { Debit = g.Sum(x => x.Debit), Credit = g.Sum(x => x.Credit) },
                StringComparer.OrdinalIgnoreCase
            );

        // 4. Fetch the last credit entry (last payment) for each customer code
        var maxDatesQuery = _dbContext.CustomerLedgerEntries
            .AsNoTracking()
            .Where(x => x.Direction == CustomerLedgerEntryDirection.Credit)
            .GroupBy(x => x.CustomerCode)
            .Select(g => new { CustomerCode = g.Key, MaxDate = g.Max(x => x.Date) });

        var lastPayments = (await _dbContext.CustomerLedgerEntries
            .AsNoTracking()
            .Where(x => x.Direction == CustomerLedgerEntryDirection.Credit)
            // Para birimi süzgeci sunucuya taşındı: aşağıdaki bellek içi `Where` ile aynı
            // sonucu verir ama ağdan yalnızca gereken satırlar geçer.
            .Where(x => selectedIsTry
                ? (x.CurrencyTypeId == 0 || x.CurrencyTypeId == 1)
                : x.CurrencyTypeId == selectedCurrencyTypeId)
            .Join(maxDatesQuery,
                e => new { e.CustomerCode, e.Date },
                m => new { m.CustomerCode, Date = m.MaxDate },
                (e, m) => new { e.CustomerCode, e.Date, e.Amount, e.CurrencyTypeId, e.CurrencyAmount, e.CurrencyRate })
            .ToListAsync(cancellationToken))
            // Son ödeme de seçili para biriminde olmalı: TL ödeme, dolar ekranında
            // "son ödeme" diye görünürse cari ödemiş sanılır.
            .Where(x => CurrencyTypeHelper.Normalize(x.CurrencyTypeId) == selectedCurrencyTypeId)
            .Select(x => new
            {
                x.CustomerCode,
                x.Date,
                Amount = OwnCurrencyAmount(x.CurrencyTypeId, x.Amount, x.CurrencyAmount, x.CurrencyRate)
            })
            .ToList();

        // 4b. Pick the newest payment across the main account and all of its sub accounts
        var lastPaymentLookup = lastPayments
            .GroupBy(x => ResolveMainCode(x.CustomerCode), StringComparer.OrdinalIgnoreCase)
            .ToDictionary(
                g => g.Key,
                g => g.OrderByDescending(x => x.Date).First(),
                StringComparer.OrdinalIgnoreCase
            );

        List<object> supplierItems = new();
        if (CustomerScope.IsUnrestrictedFor(User))
        {
            var suppliers = await _dbContext.Suppliers
                .AsNoTracking()
                .Where(x => x.SupplierCode.StartsWith("320"))
                .Select(x => new
                {
                    x.SupplierCode,
                    x.FullName,
                    x.PhoneNumber,
                    x.Region
                })
                .ToListAsync(cancellationToken);

            var supplierCurrencyRows = await _dbContext.SupplierLedgerEntries
                .AsNoTracking()
                .Where(x => x.SupplierCode.StartsWith("320"))
                .Where(x => selectedIsTry
                    ? (x.CurrencyTypeId == 0 || x.CurrencyTypeId == 1)
                    : x.CurrencyTypeId == selectedCurrencyTypeId)
                .Select(x => new
                {
                    x.SupplierCode,
                    x.Direction,
                    x.Amount,
                    x.CurrencyTypeId,
                    x.CurrencyAmount,
                    x.CurrencyRate
                })
                .ToListAsync(cancellationToken);

            var supplierBalanceLookup = supplierCurrencyRows
                .Where(x => CurrencyTypeHelper.Normalize(x.CurrencyTypeId) == selectedCurrencyTypeId)
                .GroupBy(x => x.SupplierCode, StringComparer.OrdinalIgnoreCase)
                .ToDictionary(
                    g => g.Key,
                    g => new
                    {
                        /*
                          BORÇ = Debit, ALACAK = Credit. DÜZ EŞLEME.

                          Buradaki eski kod tedarikçide Credit'i "borç", Debit'i "alacak"
                          sütununa yazıyordu ("tedarikçiye borçluyuz" varsayımıyla). Sonuç:
                          bu liste ile cari ekstre BİRBİRİNİ TUTMUYORDU. KEA örneği
                          (2026-09-02): ekstre borç 5.480.000 / alacak 2.013.312 / bakiye
                          +3.466.688 derken liste tam tersini, bakiyeyi de -3.466.688
                          gösteriyordu.

                          Ekstre (CustomerLedgerController) Debit'i doğrudan borç yazıyor;
                          tek doğru kaynak o. Ters çevirmeyi "eksik" sanıp geri koymayın:
                          avans/fazla ödeme yapılmış tedarikçinin borç bakiyesi olması
                          normaldir, nitekim devirler de öyle yüklendi.
                        */
                        Debit = g.Where(x => x.Direction == SupplierLedgerEntryDirection.Debit)
                            .Sum(x => OwnCurrencyAmount(x.CurrencyTypeId, x.Amount, x.CurrencyAmount, x.CurrencyRate)),
                        Credit = g.Where(x => x.Direction == SupplierLedgerEntryDirection.Credit)
                            .Sum(x => OwnCurrencyAmount(x.CurrencyTypeId, x.Amount, x.CurrencyAmount, x.CurrencyRate))
                    },
                    StringComparer.OrdinalIgnoreCase);

            var supplierLastPayments = await _dbContext.SupplierLedgerEntries
                .AsNoTracking()
                .Where(x => x.SupplierCode.StartsWith("320"))
                .Where(x => x.Direction == SupplierLedgerEntryDirection.Debit)
                /*
                  Ödeme = yalnız kasa/banka hareketi. Devir satırı ödeme DEĞİLDİR.
                  Devirler 2026-09-02'de Debit'e çevrilince (avans/fazla ödeme) bu süzgeç
                  olmadan "Son Ödeme" sütununa devir tutarı düşüyordu: DEMO'da
                  800.000 / 15.08.2026 yazıyordu, oysa o satır DEVIR-2026 damgalı.
                */
                .Where(x => x.ReferenceType == SupplierLedgerEntryReferenceType.BankTransaction
                         || x.ReferenceType == SupplierLedgerEntryReferenceType.CashTransaction)
                .Where(x => selectedIsTry
                    ? (x.CurrencyTypeId == 0 || x.CurrencyTypeId == 1)
                    : x.CurrencyTypeId == selectedCurrencyTypeId)
                .Select(x => new
                {
                    x.SupplierCode,
                    x.Date,
                    x.Amount,
                    x.CurrencyTypeId,
                    x.CurrencyAmount,
                    x.CurrencyRate
                })
                .ToListAsync(cancellationToken);

            var supplierLastPaymentLookup = supplierLastPayments
                .Where(x => CurrencyTypeHelper.Normalize(x.CurrencyTypeId) == selectedCurrencyTypeId)
                .GroupBy(x => x.SupplierCode, StringComparer.OrdinalIgnoreCase)
                .ToDictionary(
                    g => g.Key,
                    g => g.OrderByDescending(x => x.Date).Select(x => new
                    {
                        x.Date,
                        Amount = OwnCurrencyAmount(x.CurrencyTypeId, x.Amount, x.CurrencyAmount, x.CurrencyRate)
                    }).First(),
                    StringComparer.OrdinalIgnoreCase);

            supplierItems = suppliers.Select(s =>
            {
                decimal debit = 0;
                decimal credit = 0;
                if (supplierBalanceLookup.TryGetValue(s.SupplierCode, out var bal))
                {
                    debit = bal.Debit;
                    credit = bal.Credit;
                }

                decimal? lastPaymentAmount = null;
                DateTime? lastPaymentDate = null;
                if (supplierLastPaymentLookup.TryGetValue(s.SupplierCode, out var lp))
                {
                    lastPaymentAmount = lp.Amount;
                    lastPaymentDate = lp.Date;
                }

                return (object)new
                {
                    plasiyer = "(00) GENEL",
                    cariAdi = $"({s.SupplierCode}) {s.FullName}",
                    cariGrup = "TEDARIKCI",
                    bolge = s.Region ?? "",
                    telefon = s.PhoneNumber ?? "",
                    borc = debit,
                    alacak = credit,
                    bakiye = debit - credit,
                    sonOdeme = lastPaymentAmount,
                    sonOdemeTarihi = lastPaymentDate
                };
            }).ToList();
        }

        // 5. Map results
        var items = customers.Select(c =>
        {
            var salesmanDesc = !string.IsNullOrWhiteSpace(c.SalesmanCode) && salesmanLookup.TryGetValue(c.SalesmanCode, out var desc)
                ? desc
                : "GENEL";
            var salesmanCode = !string.IsNullOrWhiteSpace(c.SalesmanCode) ? c.SalesmanCode : "00";
            var plasiyerLabel = $"({salesmanCode}) {salesmanDesc}";

            var cariLabel = $"({c.CustomerCode}) {c.Name}";

            decimal debit = 0;
            decimal credit = 0;
            if (balanceLookup.TryGetValue(c.CustomerCode, out var bal))
            {
                debit = bal.Debit;
                credit = bal.Credit;
            }
            decimal balance = debit - credit;

            decimal? lastPaymentAmount = null;
            DateTime? lastPaymentDate = null;
            if (lastPaymentLookup.TryGetValue(c.CustomerCode, out var lp))
            {
                lastPaymentAmount = lp.Amount;
                lastPaymentDate = lp.Date;
            }

            return new
            {
                plasiyer = plasiyerLabel,
                cariAdi = cariLabel,
                cariGrup = c.CustomerType ?? "BAYI",
                bolge = c.City ?? c.District ?? "",
                telefon = c.Phone ?? "",
                borc = debit,
                alacak = credit,
                bakiye = balance,
                sonOdeme = lastPaymentAmount,
                sonOdemeTarihi = lastPaymentDate
            };
        }).Cast<object>().Concat(supplierItems).ToList();

        return Ok(new
        {
            success = true,
            data = items,
            currencyTypeId = selectedCurrencyTypeId,
            currencyCode = CurrencyTypeHelper.ToCodeOrTry(selectedCurrencyTypeId),
            availableCurrencyTypeIds
        });
    }
}
