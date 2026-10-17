using B2B.Erp.Api.Core.Accounting;
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
[Route("api/reports/cari-satis")]
[Authorize]
public sealed class CariSatisReportController : ControllerBase
{
    private readonly AppDbContext _dbContext;

    public CariSatisReportController(AppDbContext dbContext)
    {
        _dbContext = dbContext;
    }

    [HttpGet]
    [AuthorizePage("reports", "cariSatisRaporu")]
    public async Task<IActionResult> GetReport(
        [FromQuery] DateTime? startDate,
        [FromQuery] DateTime? endDate,
        [FromQuery] string? customerCode,
        CancellationToken cancellationToken = default)
    {
        // Invoices are posted on the sub accounts (-1 FATURA / -2 ACIK / -3 ASKERIYE),
        // while the dropdown sends the main cari code. Expand the selection to the whole family.
        List<string>? filterCodes = null;
        if (!string.IsNullOrWhiteSpace(customerCode))
        {
            var mainCode = CustomerAccountHelper.GetMainCodeFromInvoiceAccountCode(customerCode.Trim());

            var codeSet = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
            {
                mainCode,
                CustomerAccountHelper.BuildInvoiceAccountCode(mainCode),
                CustomerAccountHelper.BuildOpenAccountCode(mainCode),
                CustomerAccountHelper.BuildAskeriyeAccountCode(mainCode)
            };

            var subCodes = await _dbContext.Customers
                .AsNoTracking()
                .Where(x => x.MainCustomerCode == mainCode)
                .Select(x => x.CustomerCode)
                .ToListAsync(cancellationToken);

            foreach (var sub in subCodes) codeSet.Add(sub);

            filterCodes = codeSet.ToList();
        }

        // LEFT JOIN on Products: service / free-text / deleted stock lines (HİZ-TAMİR, SERVIS-BEDELI …)
        // must still appear on the report instead of being silently dropped.
        var baseQuery =
            from inv in _dbContext.Invoices.AsNoTracking()
            join line in _dbContext.InvoiceLines.AsNoTracking() on inv.Id equals line.InvoiceId
            join prod in _dbContext.Products.AsNoTracking() on line.StockCode equals prod.StockCode into prods
            from p in prods.DefaultIfEmpty()
            where inv.Type == InvoiceType.SalesInvoice || inv.Type == InvoiceType.ReturnInvoice
            select new { inv, line, p };

        if (startDate.HasValue)
        {
            var startUtc = DateTime.SpecifyKind(startDate.Value.Date, DateTimeKind.Utc);
            baseQuery = baseQuery.Where(x => x.inv.Date >= startUtc);
        }

        if (endDate.HasValue)
        {
            var endUtc = DateTime.SpecifyKind(endDate.Value.Date.AddDays(1).AddTicks(-1), DateTimeKind.Utc);
            baseQuery = baseQuery.Where(x => x.inv.Date <= endUtc);
        }

        if (filterCodes is not null)
        {
            baseQuery = baseQuery.Where(x => filterCodes.Contains(x.inv.CustomerCode));
        }

        /*
          KULLANICININ CARİ LİSTESİ RAPORU DA SINIRLAR (2026-08-20 kullanıcı kararı).

          `AuthorizePage` yalnız SAYFANIN açılıp açılmayacağını belirliyordu; hangi carilerin
          göründüğünü belirlemiyordu. `Bayi`/`AltBayi`/`AltKullanici` rollerinde bu sayfa açık
          olduğu için, tek cariye bağlı bir bayi raporu açtığında ŞİRKETİN BÜTÜN carilerinin
          satışını görebiliyordu.

          Kapsam kullanıcı eklenirken atanan cari listesinden gelir (`Users.Carikodu` →
          `Carikodu` claim'i; plasiyer portföyü virgüllü liste olarak durur). Sınırsız kapsam
          (boş / * / ALL) HİÇBİR ŞEYİ değiştirmez — yönetim ve plasiyer tarafı aynen çalışır.
          Sınırlıysa yalnız kapsamdaki cariler ve onların alt hesapları listelenir: fatura
          -1/-2/-3 alt hesabına kesildiği için genişletme şart, yoksa cari atanmış kullanıcı
          kendi faturasını bile göremezdi.

          Kardeş raporlardaki (`CariBorcAlacakReportController`, `CustomerAgeingReportController`)
          desenin birebir aynısı.
        */
        if (!CustomerScope.IsUnrestrictedFor(User))
        {
            var scopeCodes = CustomerScope.Of(User);
            var expandedScope = await CustomerScope.ExpandAsync(
                _dbContext.Customers.AsNoTracking(), scopeCodes, cancellationToken);

            baseQuery = baseQuery.Where(x => expandedScope.Contains(x.inv.CustomerCode));
        }

        var results = await baseQuery
            .OrderByDescending(x => x.inv.Date)
            .ThenBy(x => x.inv.Id)
            .ThenBy(x => x.line.LineNo)
            .Select(x => new
            {
                invType = x.inv.Type,
                tarih = x.inv.Date,
                faturaNo = x.inv.InvoiceNo,
                cariKodu = x.inv.CustomerCode,
                cariAdiOverride = x.inv.CustomerNameOverride,
                // Header level discount (already includes the campaign discount, see InvoicesController)
                invSubtotal = x.inv.Subtotal,
                invDiscount = x.inv.Discount,
                // Kalem kampanyasını kendi kalemine yazmak için (bkz. KampanyaKalemDagilimi).
                invId = x.inv.Id,
                invNet = x.inv.NetTotal,
                invVat = x.inv.VatTotal,
                invCampaign = x.inv.CampaignDiscount,
                lineId = x.line.Id,
                soLineId = x.line.SalesOrderLineId,
                // Belgenin para birimi ve donmuş kuru. Satır tutarları DAİMA TL
                // (InvoiceLine.UnitPrice TL, dövizli değer CurrencyUnitPrice'ta) — bu iki
                // alan olmadan dövizli fatura raporda TL faturadan ayırt edilemiyor.
                invCurrencyTypeId = x.inv.CurrencyTypeId,
                invExchangeRate = x.inv.ExchangeRate,
                stokKodu = x.line.StockCode,
                stokAdi = x.p != null ? x.p.Name : null,
                satirAciklama = x.line.Description,
                mainCategoryId = x.p != null ? x.p.MainCategoryId : null,
                adet = x.line.Quantity,
                fiyat = x.line.UnitPrice,
                // Kalemin BELGE PARASINDAKİ birim fiyatı. Dövizli tutar bundan kurulur;
                // TL tutarı kura bölmek yasak (bkz. aşağıdaki not).
                dovizFiyat = x.line.CurrencyUnitPrice,
                lineCurrencyTypeId = x.line.CurrencyTypeId,
                kdvOran = x.line.VatRate
            })
            .ToListAsync(cancellationToken);

        /*
          SİPARİŞTEN GELEN KAMPANYALI FATURA: KAMPANYA KENDİ KALEMİNDEN (2026-09-30).

          Satış faturası kalem kampanyasını kendi kaleminden ve kendi KDV oranıyla düşüyor
          (InvoicesController, "KAMPANYA İNDİRİMİ KDV MATRAHINDAN DÜŞER"). Aşağıdaki orantılı
          dağıtım birden fazla KDV oranlı böyle bir faturada kalem KDV'lerinin toplamını
          başlıktan saptırır (fatura basımındaki kırılımla aynı sorun). Başlığı orantılı dağıtım
          tutturamıyor ve kalem bazlı dağıtım tutturuyorsa o kullanılır; diğer bütün faturalarda
          (tek oranlı, eski, kampanyasız) hesap AYNEN kalır. Tutarlar TL: kalemin `UnitPrice`'ı ve
          başlık TL çapası; dövizli sipariş kaleminin indirimi siparişin kuruyla belgenin parasına,
          faturanın kuruyla TL'ye çevrilir (fatura oluşturmadaki `ToDocCurrency` → `ToTry`).
        */
        var kalemNetOrani = new Dictionary<int, decimal>();
        var kampanyaliFaturalar = results
            .Where(x => x.invType == InvoiceType.SalesInvoice && x.invCampaign > 0m && x.soLineId.HasValue)
            .Select(x => x.invId)
            .ToHashSet();

        if (kampanyaliFaturalar.Count > 0)
        {
            var siparisKalemIdleri = results
                .Where(x => kampanyaliFaturalar.Contains(x.invId) && x.soLineId.HasValue)
                .Select(x => x.soLineId!.Value)
                .Distinct()
                .ToList();

            var siparisKalemleri = await _dbContext.Set<SalesOrderLine>()
                .AsNoTracking()
                .Where(s => siparisKalemIdleri.Contains(s.Id))
                .Select(s => new { s.Id, s.DiscountAmount, s.Quantity, s.IsGift, s.CurrencyTypeId, s.CurrencyRate })
                .ToDictionaryAsync(s => s.Id, cancellationToken);

            foreach (var fatura in results.Where(x => kampanyaliFaturalar.Contains(x.invId)).GroupBy(x => x.invId))
            {
                var satirlar = fatura.ToList();
                var faturaKuru = satirlar[0].invExchangeRate > 0m ? satirlar[0].invExchangeRate : 1m;

                var kalemler = satirlar.Select(x =>
                {
                    var tutar = x.adet * x.fiyat;
                    var kampanya = 0m;
                    if (x.soLineId.HasValue
                        && siparisKalemleri.TryGetValue(x.soLineId.Value, out var so)
                        && !so.IsGift && so.DiscountAmount > 0m && so.Quantity > 0m && x.adet > 0m)
                    {
                        var oran = Math.Min(1m, x.adet / so.Quantity);
                        var tl = so.CurrencyTypeId > 1 && so.CurrencyRate > 0m
                            ? so.DiscountAmount / so.CurrencyRate * faturaKuru
                            : so.DiscountAmount;
                        kampanya = Math.Min(tl * oran, tutar);
                    }
                    return new KampanyaKalemDagilimi.Kalem(tutar, kampanya, x.kdvOran);
                }).ToList();

                var indirimler = KampanyaKalemDagilimi.KalemIndirimleri(kalemler, satirlar[0].invNet, satirlar[0].invVat);
                if (indirimler is null) continue;

                for (var i = 0; i < satirlar.Count; i++)
                {
                    var tutar = kalemler[i].Tutar;
                    kalemNetOrani[satirlar[i].lineId] = tutar > 0m ? (tutar - indirimler[i]) / tutar : 1m;
                }
            }
        }

        var categoriesLookup = await _dbContext.ProductCategories
            .AsNoTracking()
            .ToDictionaryAsync(c => c.Id, c => c.Name, cancellationToken);

        // Map every cari code (incl. sub accounts) to its main account, so the report shows a single cari
        var accountMap = await _dbContext.Customers
            .AsNoTracking()
            .Select(x => new { x.CustomerCode, x.MainCustomerCode, x.Name })
            .ToListAsync(cancellationToken);

        var mainCodeLookup = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        var nameLookup = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var a in accountMap)
        {
            if (string.IsNullOrWhiteSpace(a.CustomerCode)) continue;
            var code = a.CustomerCode.Trim();
            mainCodeLookup[code] = !string.IsNullOrWhiteSpace(a.MainCustomerCode)
                ? a.MainCustomerCode.Trim()
                : CustomerAccountHelper.GetMainCodeFromInvoiceAccountCode(code);
            nameLookup[code] = a.Name ?? string.Empty;
        }

        string ResolveMainCode(string? code)
        {
            var c = (code ?? string.Empty).Trim();
            if (c.Length == 0) return c;
            return mainCodeLookup.TryGetValue(c, out var mapped)
                ? mapped
                : CustomerAccountHelper.GetMainCodeFromInvoiceAccountCode(c);
        }

        var items = results.Select(x =>
        {
            bool isReturn = x.invType == InvoiceType.ReturnInvoice;
            decimal coef = isReturn ? -1m : 1m;

            decimal qty = x.adet * coef;

            // Gross line amount (pre-discount) — this is what Invoice.Subtotal is built from
            decimal grossTotal = x.adet * x.fiyat * coef;

            // Spread the header discount (manual + campaign) over the lines pro-rata,
            // so the report reconciles with the invoice NetTotal instead of overstating sales.
            decimal discountRatio = x.invSubtotal > 0m
                ? Math.Min(1m, x.invDiscount / x.invSubtotal)
                : 0m;
            // Kampanyası kendi kalemine yazılan faturada kalemin kendi net oranı (yukarıda).
            decimal netOrani = kalemNetOrani.TryGetValue(x.lineId, out var kalemOrani)
                ? kalemOrani
                : 1m - discountRatio;
            decimal netTotal = grossTotal * netOrani;

            /*
              KDV MATRAHI İSKONTOLU SATIR TUTARIDIR (2026-08-26).

              Burada KDV bilerek BRÜT satırdan hesaplanıyordu — yorumu da bunu söylüyordu:
              "fatura motoru brütten hesaplıyor, birebir taklit et". Motor 2026-08-26'da
              düzeltildi (bkz. Core/Accounting/InvoiceDiscountMath): iskonto artık KDV DAHİL
              girilmiş sayılıp net ile KDV'ye oranlı dağıtılıyor. Rapor eski varsayımda
              kalınca kalem kalem KDV şişik çıkıyor ve satırların toplamı faturanın
              başlığıyla tutmuyordu.

              Net zaten oranlı dağıtılıyordu (`grossTotal * (1 - discountRatio)`); KDV de aynı
              tabandan alınıyor. `discountRatio` faturanın `Discount` alanından geliyor ve o
              alan artık iskontonun NET karşılığını taşıyor, dolayısıyla oran doğru.
            */
            decimal kdvTutar = netTotal * (x.kdvOran / 100m);
            decimal kdvliTutar = netTotal + kdvTutar;

            /*
              SATIRIN PARA BİRİMİ BAŞLIKTAN DEĞİL, SATIRDAN OKUNUR (2026-08-20).

              Rapor `paraBirimi`yi faturanın BAŞLIĞINDAN alıyordu. Fatura başlığı tek para
              birimi taşır; oysa eski kayıtlarda tek faturaya farklı paralarda satırlar
              girebilmiş. Kanıt: DEMOTEST / A00000000415215 — başlık USD, 1. satır 2.172,41
              TL, 2. satır 1.090,91 USD. Rapor ikisine birden "USD" yazıyordu; para birimi
              süzgecinde USD seçen kullanıcı TL bir satır görüyor, dövizli tutar sütununda da
              TL tutar dolar gibi listeleniyordu.

              Kalemin kendi `CurrencyTypeId`si esas; satırda para birimi yazmıyorsa (eski
              kayıtlarda 0 kalıyor) faturanın başlığına düşülür — o satırın bilinen tek
              çapası odur. Yeni faturalarda karışık para birimi ARTIK ENGELLİ
              (`InvoicesController.CreateSalesInvoice`); burası geçmiş kayıtları doğru
              göstermek için.
            */
            var satirParaBirimi = x.lineCurrencyTypeId > 0
                ? CurrencyTypeHelper.Normalize(x.lineCurrencyTypeId)
                : CurrencyTypeHelper.Normalize(x.invCurrencyTypeId);

            // Kur da satırla tutarlı olmalı: USD başlıklı bir faturanın TL satırında belgenin
            // dolar kuru geçerli değildir, o satır TL'dir ve kuru 1'dir.
            var satirKur = CurrencyTypeHelper.IsTry(satirParaBirimi)
                ? 1m
                : (x.invExchangeRate <= 0 ? 1m : x.invExchangeRate);

            // Aynı hesap, belgenin kendi parasında: kalemin dövizli birim fiyatı yoksa
            // (eski satır) TL fiyata düşülür — kurla bölmek yerine böyle davranmak,
            // "hiç kur kullanma" kuralının gereği.
            decimal dovizBirimFiyat = x.dovizFiyat > 0m ? x.dovizFiyat : x.fiyat;
            decimal dovizGross = x.adet * dovizBirimFiyat * coef;
            decimal dovizNet = dovizGross * netOrani;
            // KDV iskontolu tutardan — TL tarafındaki `kdvTutar` ile aynı taban (2026-08-26 kuralı).
            // Brütten alınıyordu; indirimli dövizli faturada KDV'li tutar indirimin KDV'si kadar şişikti.
            decimal dovizKdvliTutarValue = dovizNet + (dovizNet * (x.kdvOran / 100m));

            var groupName = x.mainCategoryId.HasValue && categoriesLookup.TryGetValue(x.mainCategoryId.Value, out var g)
                ? g
                : "DİĞER";

            var stokAdi = !string.IsNullOrWhiteSpace(x.stokAdi)
                ? x.stokAdi
                : (!string.IsNullOrWhiteSpace(x.satirAciklama) ? x.satirAciklama : x.stokKodu);

            var mainCode = ResolveMainCode(x.cariKodu);
            var cariAdi = !string.IsNullOrWhiteSpace(x.cariAdiOverride)
                ? x.cariAdiOverride
                : (nameLookup.TryGetValue(mainCode, out var mainName) && !string.IsNullOrWhiteSpace(mainName)
                    ? mainName
                    : (nameLookup.TryGetValue(x.cariKodu ?? string.Empty, out var subName) ? subName : string.Empty));

            return new
            {
                tarih = x.tarih,
                islemTipi = isReturn ? "İADE" : "SATIŞ",
                faturaNo = x.faturaNo,
                cariKodu = mainCode,
                cariAdi = cariAdi,
                stokKodu = x.stokKodu,
                stokAdi = stokAdi,
                stokGrup = groupName,
                adet = qty,
                fiyat = Math.Round(netTotal, 2),
                iskonto = Math.Round(grossTotal - netTotal, 2),
                kdvOran = x.kdvOran,
                kdvTutar = Math.Round(kdvTutar, 2),
                kdvliTutar = Math.Round(kdvliTutar, 2),

                // Tutarlar TL; belgenin kendi para birimi ayrı sütunda duruyor.
                paraBirimi = CurrencyTypeHelper.ToCodeOrTry(satirParaBirimi),
                kur = satirKur,

                // DÖVİZLİ TUTAR KURA BÖLÜNEREK ÜRETİLMEZ (2026-08-19).
                //
                // Önceden `kdvliTutar / kur` yazıyordu. Bu, `InvoiceLine.UnitPrice`ın HER
                // ZAMAN TL olmasına dayanıyor; proformadan aktarılan faturalarda öyle
                // değildi (satıra doğrudan dolar fiyat yazılıyordu) ve bölme 1.500 $'ı
                // 31,30 $ yapıyordu. Artık kalemin kendi dövizli fiyatı
                // (`CurrencyUnitPrice`) kullanılıyor — hangi konvansiyonla yazılmış olursa
                // olsun doğru; basım ve fatura listesi de aynı kaynağı okuyor.
                dovizKdvliTutar = CurrencyTypeHelper.IsTry(satirParaBirimi)
                    ? (decimal?)null
                    : Math.Round(dovizKdvliTutarValue, 2, MidpointRounding.AwayFromZero)
            };
        }).ToList();

        return Ok(new
        {
            success = true,
            data = items
        });
    }
}
