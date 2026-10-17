using B2B.Erp.Api.Core.Authorization;
using B2B.Erp.Api.Core.Helpers;
using B2B.Erp.Api.Data;
using B2B.Erp.Api.Entities;
using B2B.Erp.Api.Features.Currency;
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
[Route("api/reports/limit-risk")]
[Authorize]
public sealed class LimitRiskReportController : ControllerBase
{
    private readonly AppDbContext _dbContext;

    public LimitRiskReportController(AppDbContext dbContext)
    {
        _dbContext = dbContext;
    }

    // KUR SERVİSİ KALDIRILDI (2026-08-19). Rapor artık para birimi başına ayrı satır üretiyor
    // ve hiçbir tutarı çevirmiyor; TL kuru çeken yardımcı burada ölü koda dönüşmüştü. Bu
    // dosyada bir daha kur görürsen, "para birimi başına ayrı limit" kuralı delinmiş demektir.

    [HttpGet]
    [AuthorizePage("reports", "limitRiskSatisRaporu")]
    public async Task<IActionResult> GetReport(
        [FromQuery] int? currencyTypeId,
        CancellationToken cancellationToken = default)
    {
        // PARA BİRİMİ SÜZGECİ (2026-08-19). Verilmezse hepsi listelenir (her para birimi
        // kendi satırında); verilirse yalnız o paranın satırları. Hiçbir yerde çevrim yok.
        var filterCurrencyTypeId = currencyTypeId.HasValue && currencyTypeId.Value > 0
            ? CurrencyTypeHelper.Normalize(currencyTypeId.Value)
            : (int?)null;

        // 1. Fetch active customers
        var customersQuery = _dbContext.Customers
            .AsNoTracking()
            .Where(x => x.IsActive);

        /*
          KULLANICININ CARİ LİSTESİ RAPORU DA SINIRLAR (2026-08-20 kullanıcı kararı).

          `AuthorizePage` yalnız SAYFANIN açılıp açılmayacağını belirliyordu; hangi carilerin
          göründüğünü belirlemiyordu. `Bayi`/`AltBayi`/`AltKullanici` rollerinde bu sayfa açık
          olduğu için, tek cariye bağlı bir bayi raporu açtığında ŞİRKETİN BÜTÜN carilerini
          görebiliyordu.

          Kapsam kullanıcı eklenirken atanan cari listesinden gelir (`Users.Carikodu` →
          `Carikodu` claim'i; plasiyer portföyü virgüllü liste olarak durur). Sınırsız kapsam
          (boş / * / ALL) HİÇBİR ŞEYİ değiştirmez. Sınırlıysa yalnız kapsamdaki cariler ve
          onların alt hesapları görünür — belgeler -1/-2/-3 alt hesabına yazıldığı için
          genişletme şart.

          Kardeş raporlardaki (`CariBorcAlacakReportController`, `CustomerAgeingReportController`)
          desenin birebir aynısı.
        */
        if (!CustomerScope.IsUnrestrictedFor(User))
        {
            var scopeCodes = CustomerScope.Of(User);
            var expandedScope = await CustomerScope.ExpandAsync(
                _dbContext.Customers.AsNoTracking(), scopeCodes, cancellationToken);

            customersQuery = customersQuery.Where(x => expandedScope.Contains(x.CustomerCode));
        }

        var customers = await customersQuery.ToListAsync(cancellationToken);

        // 2. Fetch salesmen
        var salesmen = await _dbContext.Salesmen
            .AsNoTracking()
            .ToListAsync(cancellationToken);
        var salesmanLookup = salesmen.ToDictionary(
            x => x.SalesmanCode,
            x => x.Description,
            StringComparer.OrdinalIgnoreCase
        );

        // PARA BİRİMİ BAŞINA AYRI SATIR (2026-08-19, kullanıcı kuralı).
        //
        // Rapor tek TL limiti ve TL'ye çevrilmiş tek risk gösteriyordu. Artık her para
        // biriminin kendi limiti ve kendi riski var; hiçbir tutar kurla çevrilmiyor.
        // Bir cari birden çok para biriminde çalışıyorsa her biri AYRI satır olarak çıkar.
        //
        // ⚠️ ALT HESAPLAR ANA CARİYE TOPLANIR: mal satışları -1/-2/-3'e, tahsilat ana cariye
        // yazılıyor. Her kod ayrı satır sayıldığında alt hesap "limiti 0, borcu var" diye
        // limit aşımı, ana cari de "hep alacaklı" görünüyordu.
        static string MainCodeOf(string? code)
        {
            var c = (code ?? string.Empty).Trim();
            if (c.Length > 2 && (c.EndsWith("-1") || c.EndsWith("-2") || c.EndsWith("-3")))
            {
                return c.Substring(0, c.Length - 2);
            }
            return c;
        }

        static int Cur(int currencyTypeId) => CurrencyTypeHelper.Normalize(currencyTypeId);

        // Anahtar: (ana cari kodu, para birimi)
        var debitByKey = new Dictionary<(string Code, int Cur), decimal>();
        var creditByKey = new Dictionary<(string Code, int Cur), decimal>();
        var riskByKey = new Dictionary<(string Code, int Cur), decimal>();

        static void Bump(Dictionary<(string, int), decimal> map, string code, int cur, decimal value)
        {
            if (string.IsNullOrWhiteSpace(code)) return;
            var key = (code, cur);
            map[key] = map.TryGetValue(key, out var existing) ? existing + value : value;
        }

        // 3. Ekstre bakiyesi — satırın KENDİ para biriminde (Amount TL çapası, CurrencyAmount
        //    satırın parası; boş kalmış eski satırlar zaten TL).
        var ledgerRows = await _dbContext.CustomerLedgerEntries
            .AsNoTracking()
            .Select(x => new { x.CustomerCode, x.Direction, x.CurrencyTypeId, x.CurrencyAmount, x.Amount })
            .ToListAsync(cancellationToken);

        foreach (var row in ledgerRows)
        {
            var code = MainCodeOf(row.CustomerCode);
            var cur = Cur(row.CurrencyTypeId);
            var value = row.CurrencyAmount > 0m ? row.CurrencyAmount : row.Amount;

            if (row.Direction == CustomerLedgerEntryDirection.Debit)
            {
                Bump(debitByKey, code, cur, value);
            }
            else
            {
                Bump(creditByKey, code, cur, value);
            }
        }

        /*
          4. AÇIK SİPARİŞ RİSKİ — YALNIZCA HENÜZ FATURALANMAMIŞ MİKTAR.

          (2026-08-24, kullanıcı bildirimi: "limit ile cari ekstre tutmuyor... 2 kere mi
          hesaplamış".)

          `SalesOrder.Status` sipariş açılırken 0 yazılıyor ve BİR DAHA HİÇ DEĞİŞMİYOR — tüm
          kod tabanında onu güncelleyen tek bir satır yok. Yani "açık sipariş" ölçütü
          (`o.Status == 0`) her siparişi, faturası kesilmiş olsa bile sonsuza kadar açık
          sayıyordu. Sonuç: aynı işlem İKİ KEZ risk üretiyordu — bir kez ekstredeki fatura
          borcu, bir kez de sipariş riski olarak.

          Canlı örnek (MUSTAFA AROĞLU LTD., limit 3.000.000):
            fatura borcu (defter)      737.299,96
            sipariş riski (aynı işlem) 737.299,96
            kalan limit 3.000.000 − 781.933,85 − 737.299,96 = 1.480.766,19
          Oysa doğrusu 2.418.066,15'tir.

          Durum alanını düzeltmek yerine ölçüt FATURALANAN MİKTARA bağlandı: `InvoiceLine`
          zaten hangi sipariş kaleminden geldiğini taşıyor (`SalesOrderLineId`). Böylece KISMİ
          faturalama da doğru çalışır — 10 adetlik siparişin 4'ü faturalandıysa risk kalan
          6 adet üzerinden yürür. Durum alanına dokunmak, yazma yolunu değiştirmeyi ve tüm
          eski kayıtları geriye dönük damgalamayı gerektirirdi.
        */
        var invoicedOrderLineQty = await (
            from il in _dbContext.Set<InvoiceLine>().AsNoTracking()
            join inv in _dbContext.Set<Invoice>().AsNoTracking() on il.InvoiceId equals inv.Id
            where il.SalesOrderLineId != null && inv.Type == InvoiceType.SalesInvoice
            group il by il.SalesOrderLineId!.Value into g
            select new { LineId = g.Key, Qty = g.Sum(x => x.Quantity) }
        ).ToListAsync(cancellationToken);

        var invoicedQtyByOrderLine = invoicedOrderLineQty.ToDictionary(x => x.LineId, x => x.Qty);

        var openOrderRows = await (
            from o in _dbContext.Set<SalesOrder>().AsNoTracking()
            join l in _dbContext.Set<SalesOrderLine>().AsNoTracking() on o.Id equals l.SalesOrderId
            where o.Status == 0
            select new
            {
                o.CustomerCode, OrderId = o.Id, OrderSubtotal = o.Subtotal, OrderCampaign = o.CampaignDiscount,
                LineId = l.Id, l.CurrencyTypeId, l.CurrencyRate, l.Quantity, l.UnitPrice, l.CurrencyUnitPrice, l.VatRate, l.DiscountAmount, l.IsGift
            }
        ).ToListAsync(cancellationToken);

        /*
          AÇIK SİPARİŞ RİSKİ KAMPANYA DÜŞÜLMÜŞ TUTARDAN (2026-10-01).

          Risk kalan adet × birim fiyat × (1 + KDV) sayılıyor, kampanya hiç düşülmüyordu: 24.761,90'lık
          klimada 4.761,90 kampanya varken sipariş riski 26.000,00 görünüyordu (fatura 21.000,00
          kesilecek). Artık kesilecek faturayla aynı hesap (InvoicesController.CreateSalesInvoice):
          kalem kampanyası (`DiscountAmount`, KDV hariç, kalan adet oranında) kendi kaleminden ve kendi
          KDV'sinden düşer; sipariş geneli kampanyanın saf payı (başlık − kalem kampanyaları) kalan
          brüt oranında genel toplamdan (KDV dahil) düşer. Kampanyasız siparişte sonuç AYNEN eskisi.
        */
        // Hediye kalemleri riske GİRMEZ (eskisi gibi) ama indirimleri kalem kampanyası sayılır —
        // bkz. InvoicesController, HEDİYE KALEMİNİN İNDİRİMİ.
        var kalemKampanyasiToplami = openOrderRows
            .GroupBy(x => x.OrderId)
            .ToDictionary(g => g.Key, g => g.Sum(x => x.DiscountAmount));

        foreach (var siparis in openOrderRows.GroupBy(x => x.OrderId))
        {
            var ilk = siparis.First();
            var safGenel = ilk.OrderCampaign - kalemKampanyasiToplami[siparis.Key];
            var kalanBrutTl = 0m;
            var kalemRiskleri = new List<(string Kod, int Cur, decimal Tutar, decimal TlTaban, decimal Oran)>();

            foreach (var row in siparis)
            {
                if (row.IsGift) continue;
                invoicedQtyByOrderLine.TryGetValue(row.LineId, out var faturalanan);

                // Faturalanan miktar siparişin miktarını aşabilir (düzeltme faturaları); negatif
                // risk üretmemek için tabanı sıfır.
                var kalanMiktar = row.Quantity - faturalanan;
                if (kalanMiktar <= 0m) continue;

                var cur = Cur(row.CurrencyTypeId);
                var dovizli = !CurrencyTypeHelper.IsTry(cur);
                var unit = !dovizli
                    ? row.UnitPrice
                    : (row.CurrencyUnitPrice > 0m ? row.CurrencyUnitPrice : row.UnitPrice);

                var taban = kalanMiktar * unit;
                var kampanya = 0m;
                if (row.DiscountAmount > 0m && row.Quantity > 0m)
                {
                    var belgeParasinda = dovizli && row.CurrencyRate > 0m ? row.DiscountAmount / row.CurrencyRate : row.DiscountAmount;
                    kampanya = Math.Min(belgeParasinda * Math.Min(1m, kalanMiktar / row.Quantity), taban);
                }

                kalanBrutTl += kalanMiktar * row.UnitPrice;
                kalemRiskleri.Add((MainCodeOf(row.CustomerCode), cur, (taban - kampanya) * (1m + (row.VatRate / 100m)),
                    kalanMiktar * row.UnitPrice, dovizli && row.CurrencyRate > 0m ? row.CurrencyRate : 1m));
            }

            // Sipariş geneli kampanyanın bu kalemlere düşen payı (TL), kalemlere brütleri oranında.
            var genelPay = safGenel > 0m && ilk.OrderSubtotal > 0m
                ? safGenel * Math.Min(1m, kalanBrutTl / ilk.OrderSubtotal)
                : 0m;

            foreach (var k in kalemRiskleri)
            {
                var pay = genelPay > 0m && kalanBrutTl > 0m ? genelPay * (k.TlTaban / kalanBrutTl) / k.Oran : 0m;
                Bump(riskByKey, k.Kod, k.Cur, Math.Max(0m, k.Tutar - pay));
            }
        }

        // 5. Ekstreye düşmemiş faturaların riski — yine kalemlerden.
        var openInvoiceRows = await (
            from inv in _dbContext.Set<Invoice>().AsNoTracking()
            join l in _dbContext.Set<InvoiceLine>().AsNoTracking() on inv.Id equals l.InvoiceId
            where inv.Type == InvoiceType.SalesInvoice
                  && !_dbContext.CustomerLedgerEntries.Any(le =>
                        le.ReferenceType == CustomerLedgerEntryReferenceType.Invoice && le.ReferenceId == inv.Id)
            select new { inv.CustomerCode, l.CurrencyTypeId, l.Quantity, l.UnitPrice, l.CurrencyUnitPrice, l.VatRate }
        ).ToListAsync(cancellationToken);

        foreach (var row in openInvoiceRows)
        {
            var cur = Cur(row.CurrencyTypeId);
            var unit = CurrencyTypeHelper.IsTry(cur)
                ? row.UnitPrice
                : (row.CurrencyUnitPrice > 0m ? row.CurrencyUnitPrice : row.UnitPrice);

            Bump(riskByKey, MainCodeOf(row.CustomerCode), cur, row.Quantity * unit * (1m + (row.VatRate / 100m)));
        }

        // 6. Portföydeki çekler — ÇEVRİLMEDEN, çekin kendi para biriminde.
        var pendingChecksList = await _dbContext.CustomerChecks
            .AsNoTracking()
            .Where(x => x.PaymentStatus == CustomerCheckPaymentStatus.Pending
                        && x.Status != CustomerCheckStatus.Returned
                        && x.Status != CustomerCheckStatus.Dishonored)
            .Select(x => new
            {
                Code = x.Status == CustomerCheckStatus.EndorsedToCustomer ? x.CurrentCustomerCode : x.CustomerCode,
                x.Amount,
                x.CurrencyTypeId
            })
            .ToListAsync(cancellationToken);

        foreach (var row in pendingChecksList)
        {
            Bump(riskByKey, MainCodeOf(row.Code), Cur(row.CurrencyTypeId), row.Amount);
        }

        // 7. Satırları kur: her cari için limiti VEYA hareketi olan her para birimi.
        var items = new List<object>();

        foreach (var c in customers)
        {
            // Alt hesaplar ana cari satırında toplandığı için ayrı satır olarak listelenmez.
            if (!string.Equals(MainCodeOf(c.CustomerCode), (c.CustomerCode ?? string.Empty).Trim(), StringComparison.OrdinalIgnoreCase))
            {
                continue;
            }

            var salesmanDesc = !string.IsNullOrWhiteSpace(c.SalesmanCode) && salesmanLookup.TryGetValue(c.SalesmanCode, out var desc)
                ? desc
                : "GENEL";

            var city = c.City ?? "";
            var district = c.District ?? "";
            var bolgeLabel = !string.IsNullOrWhiteSpace(city)
                ? (!string.IsNullOrWhiteSpace(district) ? $"{city}({district})" : city)
                : district;

            var limitsByCurrency = new Dictionary<int, decimal>
            {
                [CurrencyTypeHelper.Try] = c.CreditLimit,
                [CurrencyTypeHelper.Usd] = c.CreditLimitUsd,
                [CurrencyTypeHelper.Eur] = c.CreditLimitEur,
                [CurrencyTypeHelper.Gbp] = c.CreditLimitGbp
            };

            var code = (c.CustomerCode ?? string.Empty).Trim();

            foreach (var cur in new[] { CurrencyTypeHelper.Try, CurrencyTypeHelper.Usd, CurrencyTypeHelper.Eur, CurrencyTypeHelper.Gbp })
            {
                var key = (code, cur);
                var limit = limitsByCurrency[cur];
                debitByKey.TryGetValue(key, out var debit);
                creditByKey.TryGetValue(key, out var credit);
                riskByKey.TryGetValue(key, out var extraRisk);

                // Hiç limiti ve hiç hareketi olmayan para birimi satır üretmez; aksi hâlde her
                // cari dört satıra çıkar ve rapor okunmaz olur.
                if (limit == 0m && debit == 0m && credit == 0m && extraRisk == 0m) continue;
                if (filterCurrencyTypeId.HasValue && cur != filterCurrencyTypeId.Value) continue;

                var balance = debit - credit;
                var totalExposure = balance + extraRisk;
                var remainingLimit = limit - totalExposure;

                items.Add(new
                {
                    bolge = bolgeLabel,
                    grupKodu = c.CustomerType ?? "BAYI",
                    cariKodu = code,
                    cariAdi = c.Name,
                    borc = debit,
                    alacak = credit,
                    bakiye = balance,
                    limit,
                    kalanLimit = remainingLimit,
                    // Satırın TAMAMI bu para birimindedir (borç, alacak, bakiye, limit, kalan).
                    // Öncesinde borç/alacak TL, limit carinin dövizindeydi — aynı satırda iki birim.
                    paraBirimi = cur,
                    paraBirimiKodu = ProductCurrencyHelper.MapCurrencyTypeIdToCode(cur),
                    paraBirimiSimge = ProductCurrencyHelper.MapCurrencyTypeIdToSymbol(cur),
                    limitDurum = remainingLimit >= 0m ? "Limit Müsait" : "Limit Aşımı !",
                    satisPersoneli = salesmanDesc
                });
            }
        }

        // Süzgeç düğmeleri: hangi para birimlerinde limit ya da hareket var.
        // Süzgeçten BAĞIMSIZ hesaplanır, yoksa USD seçilince diğer düğmeler kaybolurdu.
        var availableCurrencyTypeIds = new SortedSet<int>();
        foreach (var key in debitByKey.Keys) availableCurrencyTypeIds.Add(key.Cur);
        foreach (var key in creditByKey.Keys) availableCurrencyTypeIds.Add(key.Cur);
        foreach (var key in riskByKey.Keys) availableCurrencyTypeIds.Add(key.Cur);
        foreach (var c in customers)
        {
            if (c.CreditLimit != 0m) availableCurrencyTypeIds.Add(CurrencyTypeHelper.Try);
            if (c.CreditLimitUsd != 0m) availableCurrencyTypeIds.Add(CurrencyTypeHelper.Usd);
            if (c.CreditLimitEur != 0m) availableCurrencyTypeIds.Add(CurrencyTypeHelper.Eur);
            if (c.CreditLimitGbp != 0m) availableCurrencyTypeIds.Add(CurrencyTypeHelper.Gbp);
        }
        if (availableCurrencyTypeIds.Count == 0) availableCurrencyTypeIds.Add(CurrencyTypeHelper.Try);

        return Ok(new
        {
            success = true,
            currencyTypeId = filterCurrencyTypeId,
            availableCurrencyTypeIds = availableCurrencyTypeIds.ToList(),
            data = items
        });
    }
}
