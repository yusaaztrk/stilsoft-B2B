using B2B.Erp.Api.Core.Authorization;
using B2B.Erp.Api.Core.Helpers;
using B2B.Erp.Api.Data;
using B2B.Erp.Api.Entities;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using System;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;

namespace B2B.Erp.Api.Controllers;

[ApiController]
[Route("api/reports/accounting-sales")]
[Authorize]
public sealed class AccountingSalesReportController : ControllerBase
{
    private readonly AppDbContext _dbContext;

    public AccountingSalesReportController(AppDbContext dbContext)
    {
        _dbContext = dbContext;
    }

    [HttpGet]
    [AuthorizePage("reports", "accountingSalesReport")]
    public async Task<IActionResult> GetReport(
        [FromQuery] DateTime? startDate,
        [FromQuery] DateTime? endDate,
        [FromQuery] string? search,
        [FromQuery] int? currencyTypeId,
        CancellationToken cancellationToken = default)
    {
        var baseQuery =
            from inv in _dbContext.Invoices.AsNoTracking()
            join cust in _dbContext.Customers.AsNoTracking() on inv.CustomerCode equals cust.CustomerCode into customers
            from customer in customers.DefaultIfEmpty()
            /*
              MUAF BELGELER DE RAPORA GIRER (2026-08-29).

              Suzgec yalnizca "FATURA" damgasini aliyordu. Muaf satislar bugune kadar
              "FATURA" damgalandigi icin tesadufen iceri giriyor, muaf ayrimi asagida
              `isMuaf` ile cari kodunun "-3" ekinden yapiliyordu. Ayni degisiklikte damga
              gercege uygun hale getirildi (muaf satis artik "ASKERIYE" damgali); suzgec
              genisletilmeseydi bu belgeler rapordan TAMAMEN kaybolacakti.

              Rapordaki gorunum DEGISMEZ: muaf belge zaten `isMuaf` ile isaretlenip KDV'siz
              gosteriliyor. Degisen tek sey, belgenin rapora hangi damgayla girdigi.
            */
            where (inv.CustomerInvoiceTypeOverride == "FATURA"
                   || inv.CustomerInvoiceTypeOverride == "ASKERIYE"
                   || inv.CustomerInvoiceTypeOverride == "ASKERİYE"
                   || inv.CustomerInvoiceTypeOverride == "MUAF")
                  && (customer == null || customer.AccountRole != CustomerAccountRole.OpenMain)
            select new { inv, customer };

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

        // Süzgeç uygulanmadan önceki kapsam: düğme listesi bundan çıkar.
        var scopeQuery = baseQuery;

        // PARA BİRİMİ SÜZGECİ (2026-08-19). Verilmezse bütün para birimleri listelenir;
        // verilirse yalnız o paradaki faturalar. Süzgeç faturanın KENDİ para birimine
        // (`Invoice.CurrencyTypeId`) bakar — 0 ile 1 aynı şeydir (TL).
        var filterCurrencyTypeId = currencyTypeId.HasValue && currencyTypeId.Value > 0
            ? CurrencyTypeHelper.Normalize(currencyTypeId.Value)
            : (int?)null;

        if (filterCurrencyTypeId.HasValue)
        {
            var wanted = filterCurrencyTypeId.Value;
            baseQuery = CurrencyTypeHelper.IsTry(wanted)
                ? baseQuery.Where(x => x.inv.CurrencyTypeId == 0 || x.inv.CurrencyTypeId == 1)
                : baseQuery.Where(x => x.inv.CurrencyTypeId == wanted);
        }

        if (!string.IsNullOrWhiteSpace(search))
        {
            var s = search.Trim().ToLower();
            baseQuery = baseQuery.Where(x =>
                x.inv.InvoiceNo.ToLower().Contains(s) ||
                x.inv.CustomerCode.ToLower().Contains(s) ||
                (x.inv.CustomerNameOverride ?? (x.customer != null ? x.customer.Name : "")).ToLower().Contains(s) ||
                (x.customer != null && x.customer.City != null ? x.customer.City : "").ToLower().Contains(s) ||
                (x.customer != null && x.customer.Address != null ? x.customer.Address : "").ToLower().Contains(s)
            );
        }

        var results = await baseQuery
            .OrderByDescending(x => x.inv.Date)
            .Select(x => new
            {
                x.inv.Id,
                Type = x.inv.CustomerInvoiceTypeOverride ?? "FATURA",

                // Belgenin SATIŞ mı İADE mi olduğu ayrı bir eksendir: `Type` sütunu carinin
                // fatura tipini (FATURA/ACIK/ASKERIYE) söyler, iade olup olmadığını değil.
                BelgeTipi = x.inv.Type,
                Tarih = x.inv.Date,
                BelgeNo = x.inv.InvoiceNo,
                CariKodu = x.inv.CustomerCode,
                CustomerInvoiceTypeOverride = x.inv.CustomerInvoiceTypeOverride,
                CustomerAccountInvoiceType = x.customer != null ? x.customer.InvoiceType : null,
                CariAdi = x.inv.CustomerNameOverride ?? (x.customer != null ? x.customer.Name : string.Empty),
                Adres = x.customer != null ? x.customer.Address : string.Empty,
                Sehir = x.customer != null ? x.customer.City : string.Empty,
                Telefon = x.customer != null ? x.customer.Phone : string.Empty,
                Brut = x.inv.Subtotal,
                // İskonto BRÜT-NET farkından okunur. `Invoice.Discount` kampanya indirimini
                // ZATEN içeriyor (`discount = manualDiscount + campaignDiscount`, InvoicesController),
                // o yüzden `Discount + CampaignDiscount` kampanyayı iki kez sayıyor ve raporda
                // "Brüt − İskonto ≠ Net" çelişkisi doğuyordu. Yalnız `Discount` demek de yetmez:
                // mobil/POS yolu `Discount = 0` bırakıp indirimin tamamını `CampaignDiscount`a
                // yazıyor. Fark ise her iki yolda da toplam indirime eşit.
                Iskonto = x.inv.Subtotal - x.inv.NetTotal,
                NetTutar = x.inv.NetTotal,
                Kdv = _dbContext.InvoiceLines.AsNoTracking()
                    .Where(l => l.InvoiceId == x.inv.Id)
                    .Select(l => l.VatRate)
                    .FirstOrDefault(),
                KdvTutari = x.inv.VatTotal,
                GenelToplam = x.inv.GrandTotal,

                // BELGENİN PARA BİRİMİ VE KURU.
                // Yukarıdaki beş tutar DAİMA TL'dir (fatura başlığı TL tutar saklar, dövizli
                // tutar kalemlerdeki CurrencyUnitPrice'tan çıkar). Muhasebeci için TL değer
                // yeterli değil: KDV beyanı ve yevmiye fişi belgenin kendi para birimini ve
                // FATURA ANINDAKİ donmuş kuru ister. Bu iki alan yazılmazsa dövizli bir
                // fatura raporda TL faturadan ayırt edilemiyor.
                ParaBirimiKodu = x.inv.CurrencyTypeId,
                Kur = x.inv.ExchangeRate <= 0 ? 1m : x.inv.ExchangeRate,
                KurKaynagi = x.inv.RateSource,

                // BELGE PARASINDAKİ KDV DAHİL TOPLAM — KALEMLERDEN, kura bölerek DEĞİL.
                // Bölme, başlığın her zaman TL olmasına dayanıyordu; proformadan aktarılan
                // faturalarda başlık belgenin parasındaydı ve 1.500 $ ekranda 31,30 $
                // görünüyordu. Kalemin dövizli fiyatı (`CurrencyUnitPrice`) her iki
                // konvansiyonda da doğru; basım ve fatura listesi de aynı kaynağı okuyor.
                // KDV oranı 100'e BÖLÜNMEZ, 0,01 ile ÇARPILIR — değer aynı, ölçek değil.
                //
                // PostgreSQL'de numeric bölmesi sonucu sabit ve geniş bir ölçeğe taşır:
                // `5.00 / 100` → 0.05000000000000000000 (20 basamak). Çarpımlarla bu 25
                // basamağa çıkıyordu ve toplam `887100.0717000000000000000000000` gibi
                // 31 ANLAMLI BASAMAKLI bir sayı oluyordu. .NET decimal en fazla 28-29
                // basamak taşır: değer okunurken OverflowException ("Value was either too
                // large or too small for a Decimal") fırlıyor ve rapor komple açılmıyordu.
                //
                // Çarpmada ölçek toplanır (2+2=4), bölmede şişer. Sonuç birebir aynı
                // (veritabanında karşılaştırıldı), yalnız basamak sayısı 25'ten 9'a iner.
                DovizToplamHam = _dbContext.InvoiceLines.AsNoTracking()
                    .Where(l => l.InvoiceId == x.inv.Id)
                    .Sum(l => l.Quantity
                              * (l.CurrencyUnitPrice > 0m ? l.CurrencyUnitPrice : l.UnitPrice)
                              * (1m + (l.VatRate * 0.01m)))
            })
            .ToListAsync(cancellationToken);

        var data = results.Select(r =>
        {
            var rate = r.Kur <= 0 ? 1m : r.Kur;
            var isTry = CurrencyTypeHelper.IsTry(r.ParaBirimiKodu);

            /*
              İADE TUTARLARI EKSİYE ÇEVRİLMEZ (2026-09-02 kullanıcı kararı).

              GEÇMİŞİ: 2026-08-20'de iade satırları EKSİ işaretle giriyordu, gerekçe
              "iade matrahtan düşülmeli, yoksa beyan edilecek KDV yüksek çıkar" idi
              (denetim md. A1). Kullanıcı 2026-09-02'de bunu açıkça geri aldı: tutarlar
              Fatura Dökümü'ndeki gibi, veritabanındaki hâliyle POZİTİF görünecek.

              SONUCU BİLEREK KABUL EDİLDİ: genel toplam artık iadeleri DÜŞMÜYOR, EKLİYOR.
              İki ekranın toplamı bu sayede birbirini tutuyor; iadenin matrahtan düşülmesi
              gerekiyorsa Tip sütunundan İADE süzülüp elle çıkarılır.

              Satır İADE rozetiyle işaretli kalır, yani belge listede ayırt edilebilir.
              BUNU "HATA" SANIP EKSİYE GERİ ÇEVİRMEYİN — kullanıcının kararıdır.
            */
            var isIade = r.BelgeTipi == InvoiceType.ReturnInvoice;
            var isMuaf = (r.CariKodu != null && (r.CariKodu.EndsWith("-3") || r.CariKodu.Contains("-3]")))
                         || string.Equals(r.CustomerInvoiceTypeOverride, "ASKERIYE", StringComparison.OrdinalIgnoreCase)
                         || string.Equals(r.CustomerInvoiceTypeOverride, "ASKERİYE", StringComparison.OrdinalIgnoreCase)
                         || string.Equals(r.CustomerInvoiceTypeOverride, "MUAF", StringComparison.OrdinalIgnoreCase)
                         || string.Equals(r.CustomerAccountInvoiceType, "ASKERIYE", StringComparison.OrdinalIgnoreCase)
                         || string.Equals(r.CustomerAccountInvoiceType, "ASKERİYE", StringComparison.OrdinalIgnoreCase)
                         || string.Equals(r.CustomerAccountInvoiceType, "MUAF", StringComparison.OrdinalIgnoreCase);
            // İşaret çevirisi kaldırıldı; sabit 1 bırakılmadı, çarpımlar tamamen silindi.

            return new
            {
                r.Id,
                r.Type,

                /// <summary>SATIS | IADE — ekran satırı bu alana göre işaretler.</summary>
                BelgeNiteligi = isIade ? "IADE" : "SATIS",
                IsMuaf = isMuaf,
                r.Tarih,
                r.BelgeNo,
                r.CariKodu,
                r.CariAdi,
                r.Adres,
                r.Sehir,
                r.Telefon,
                Brut = r.Brut,
                Iskonto = r.Iskonto,
                NetTutar = r.NetTutar,
                r.Kdv,
                KdvTutari = r.KdvTutari,
                GenelToplam = r.GenelToplam,
                ParaBirimi = CurrencyTypeHelper.ToCodeOrTry(r.ParaBirimiKodu),
                Kur = rate,
                r.KurKaynagi,
                // TL faturada döviz toplamı anlamsız; null bırakılıyor ki ekran boş göstersin
                // ve "1,00 USD" gibi uydurma bir değer yazılmasın.
                DovizGenelToplam = isTry
                    ? (decimal?)null
                    : Math.Round(r.DovizToplamHam, 2, MidpointRounding.AwayFromZero)
            };
        }).ToList();

        // Ekranın süzgeç düğmelerini kurabilmesi için: bu dönemde HANGİ para birimlerinde
        // fatura var. Süzgecin kendisi uygulanmadan önceki kapsam kullanılmalı, aksi hâlde
        // USD seçilince diğer düğmeler kaybolurdu.
        var availableCurrencyTypeIds = await scopeQuery
            .Select(x => x.inv.CurrencyTypeId)
            .Distinct()
            .ToListAsync(cancellationToken);

        var availableNormalized = availableCurrencyTypeIds
            .Select(CurrencyTypeHelper.Normalize)
            .Distinct()
            .OrderBy(x => x)
            .ToList();

        if (availableNormalized.Count == 0) availableNormalized.Add(CurrencyTypeHelper.Try);

        return Ok(new
        {
            success = true,
            currencyTypeId = filterCurrencyTypeId,
            availableCurrencyTypeIds = availableNormalized,
            data
        });
    }
}
