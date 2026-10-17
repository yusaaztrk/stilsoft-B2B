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
[Route("api/reports/sales-marketing")]
[Authorize]
public sealed class SalesMarketingReportController : ControllerBase
{
    private readonly AppDbContext _dbContext;
    private readonly CompanyClock _clock;

    public SalesMarketingReportController(AppDbContext dbContext, CompanyClock clock)
    {
        _dbContext = dbContext;
        _clock = clock;
    }

    [HttpGet]
    [AuthorizePage("reports", "satisPazarlamaRaporu")]
    public async Task<IActionResult> GetReport(
        [FromQuery] string? salesmanCode,
        [FromQuery] string? islemTipi,
        [FromQuery] int? currencyTypeId,
        [FromQuery] int? year,
        [FromQuery] int? month,
        [FromQuery] DateTime? startDate,
        [FromQuery] DateTime? endDate,
        CancellationToken cancellationToken = default)
    {
        /*
          AY SÜZGECİ (2026-08-20 kullanıcı isteği).

          Rapor hiç tarih süzgeci taşımıyordu: her açılışta BÜTÜN geçmiş çekiliyor, ekranda
          binlerce satır birikiyor ve "bu ay ne sattık" sorusu cevaplanamıyordu.

          Verilmezse FİRMANIN takvim ayı seçilir — sunucunun UTC ayı değil. KKTC (UTC+3)
          örneğinde ayın 1'i saat 01:00'de açılan rapor, UTC'ye göre hâlâ önceki aydadır ve
          bomboş açılırdı.

          `Invoice.Date` saat taşımayan bir BELGE TARİHİdir (gece yarısı, Kind=Utc); bu yüzden
          sınırlar doğrudan karşılaştırılır, ayrıca saat dilimi çevrimi yapılmaz.
        */
        var today = _clock.TodayCompanyDate();
        var selectedYear = year is >= 2000 and <= 2100 ? year.Value : today.Year;
        var selectedMonth = month is >= 1 and <= 12 ? month.Value : today.Month;

        var monthStart = DateTime.SpecifyKind(new DateTime(selectedYear, selectedMonth, 1), DateTimeKind.Utc);
        var monthEnd = monthStart.AddMonths(1);

        /*
          İKİ TARİH ARASI (2026-09-30 kullanıcı isteği: "Eylül seçimi yerine 2 tarih arası").
          Verilirse ay seçiminin YERİNE geçer; bitiş günü DAHİL. Belge tarihi gece yarısı
          (Kind=Utc) tutulduğu için sınırlar gün başlarıyla karşılaştırılır. Tek tarih verilirse
          o tek gün; ters verilirse yer değiştirilir. Aralık 3 yılla sınırlı (bütün geçmişi
          çekmek raporu kilitlerdi — ay süzgecinin eklenme sebebi de buydu).
        */
        if (startDate.HasValue || endDate.HasValue)
        {
            var bas = (startDate ?? endDate)!.Value.Date;
            var bit = (endDate ?? startDate)!.Value.Date;
            if (bit < bas) (bas, bit) = (bit, bas);
            if ((bit - bas).TotalDays > 366 * 3)
            {
                return BadRequest(new { success = false, message = "Tarih aralığı en fazla 3 yıl olabilir." });
            }

            monthStart = DateTime.SpecifyKind(bas, DateTimeKind.Utc);
            monthEnd = DateTime.SpecifyKind(bit.AddDays(1), DateTimeKind.Utc);
        }

        var baseQuery = _dbContext.Invoices.AsNoTracking()
            .Where(x => x.Date >= monthStart && x.Date < monthEnd);

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

            baseQuery = baseQuery.Where(x => expandedScope.Contains(x.CustomerCode));
        }

        /*
          RAPOR SATIŞ + İADE (2026-08-20 kullanıcı kararı) + TAMİR geliri (2026-09-30, aşağıda).

          Öncesinde ALIŞ ve HİZMET belgeleri de ciroya giriyordu. Bu bir SATIŞ PAZARLAMA
          raporu; tedarikçiden alınan mal ve su/elektrik gibi gider faturaları ciro değildir.
          Somut hâli: 320-01-000045 (tedarikçi) alışı 52.500 ₺ ve 770-01-000001 "SU FATURASI"
          16.000 ₺, plasiyeri atanmamış oldukları için "GENEL" diliminde ciro gibi duruyordu.

          İade rapordan atılmaz, EKSİ girer: satılan mal geri döndüğünde plasiyerin cirosu o
          kadar azalmalı. (Muhasebe Satış raporundaki kuralın aynısı.)
        */
        /*
          SERVİS GELİRİ (TAMİR) DE CİRODUR (2026-09-30 kullanıcı kararı: "serviste girsin").

          20.08'de ALIŞ ve HİZMET çıkarılırken `ServiceInvoice` ('H') türünün TAMAMI çıkmıştı;
          ama bu tür İKİ şeyi taşıyor (bkz. `InvoicesController` İşlem Tipi notu): alış
          faturasından türeyen HİZMET gideri (`SourcePurchaseInvoiceId` dolu) ve servisin kestiği
          TAMİR geliri (boş). Eylül'de 190 servis geliri faturası (245.056,77 ₺ net) rapora hiç
          girmiyordu. TAMİR artık artı girer; alış kaynaklı HİZMET ve ALIŞ yine dışarıda.

          İŞLEM TİPİ ÇOKLU SEÇİM: `islemTipi` virgülle ayrılmış liste ("SATIŞ,İADE,TAMİR").
          Boş = üçü birden. Türkçe harf/büyük-küçük farkı eşleşmeyi bozmasın diye normalize edilir.
        */
        static string TipNorm(string s) => s.Trim().ToUpperInvariant().Replace("İ", "I").Replace("Ş", "S");
        var secilenTipler = (islemTipi ?? string.Empty)
            .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Select(TipNorm)
            .ToHashSet();
        var tipHepsi = secilenTipler.Count == 0;
        var tipSatis = tipHepsi || secilenTipler.Contains("SATIS");
        var tipIade = tipHepsi || secilenTipler.Contains("IADE");
        var tipTamir = tipHepsi || secilenTipler.Contains("TAMIR");

        baseQuery = baseQuery.Where(x =>
            (tipSatis && x.Type == InvoiceType.SalesInvoice)
            || (tipIade && x.Type == InvoiceType.ReturnInvoice)
            || (tipTamir && x.Type == InvoiceType.ServiceInvoice
                && (x.SourcePurchaseInvoiceId == null || x.SourcePurchaseInvoiceId <= 0)));

        // 2. Filter by SalesmanCode
        //
        // PLASİYER YALNIZCA KENDİNİ GÖRÜR (kullanıcı kuralı, 2026-08-13).
        //
        // Kısıt İSTEMCİDEN GELEN DEĞERE GÖRE DEĞİL, KOŞULSUZ uygulanır. Uç eskiden yalnızca
        // `?salesmanCode=` parametresini süzgeç olarak kullanıyordu; plasiyer kodu atanmış bir
        // kullanıcı adres çubuğuna başkasının kodunu yazarak (ya da hiç yazmayarak) tüm
        // plasiyerlerin cirosunu okuyabiliyordu.
        //
        // Aynı hata bu kod tabanında daha önce ServiceOps'ta yaşandı: kapsam süzgeci
        // "istemci boş bıraktıysa uygula" diye yazılmıştı ve `?technicianId=<başkası>`
        // göndermek kısıtı tamamen atlıyordu. Kural: kapsam üzerine YAZILIR, varsayılan olarak
        // atanmaz.
        //
        // Süper admin muaf: yönetim bu raporu bütün plasiyerler için okuyabilmeli. Plasiyer
        // kodu olmayan (ofis/muhasebe) kullanıcılar da eskisi gibi serbest — kural yalnızca
        // "plasiyer koduna SAHİP" kişileri bağlar, kullanıcı bunu böyle tarif etti.
        var isSsa = User.FindFirst("IsSuperSuperAdmin")?.Value == "1";
        var isSuperAdmin = User.FindFirst("IsSuperAdmin")?.Value == "1";
        var ownSalesmanCode = User.FindFirst("SalesmanCode")?.Value?.Trim();

        var isRestrictedSalesman = !isSsa && !isSuperAdmin && !string.IsNullOrWhiteSpace(ownSalesmanCode);
        if (isRestrictedSalesman)
        {
            salesmanCode = ownSalesmanCode;
        }

        if (!string.IsNullOrWhiteSpace(salesmanCode))
        {
            var code = salesmanCode.Trim();
            if (code == "00" || code.ToUpper() == "GENEL")
            {
                baseQuery = baseQuery.Where(x => string.IsNullOrEmpty(x.SalesmanCode) || x.SalesmanCode == "00" || x.SalesmanCode.ToUpper() == "GENEL");
            }
            else
            {
                baseQuery = baseQuery.Where(x => x.SalesmanCode == code);
            }
        }

        // PARA BİRİMİ SÜZGECİ (2026-08-19). Ciro/hedef karşılaştırması tek ölçüde anlamlı
        // olduğu için varsayılan "hepsi"dir (tutarlar TL çapası). Bir para birimi seçilirse
        // yalnız o paradaki faturalar toplanır — çevrim YOK, ölçü yine TL çapasıdır.
        var filterCurrencyTypeId = currencyTypeId.HasValue && currencyTypeId.Value > 0
            ? CurrencyTypeHelper.Normalize(currencyTypeId.Value)
            : (int?)null;

        // DÜĞME LİSTESİ SÜZGEÇTEN BAĞIMSIZ KAPSAMDAN ÇIKAR. Süzgeç uygulandıktan SONRA
        // hesaplansaydı USD seçildiği anda diğer para birimi düğmeleri kaybolur, kullanıcı
        // geri dönemezdi (aynı hata Muhasebe Satış raporunda yaşandı).
        var availableCurrencyTypeIds = await baseQuery
            .Select(x => x.CurrencyTypeId)
            .Distinct()
            .ToListAsync(cancellationToken);

        var normalizedAvailableCurrencies = availableCurrencyTypeIds
            .Select(CurrencyTypeHelper.Normalize)
            .Distinct()
            .OrderBy(x => x)
            .ToList();

        if (filterCurrencyTypeId.HasValue)
        {
            var wanted = filterCurrencyTypeId.Value;
            baseQuery = CurrencyTypeHelper.IsTry(wanted)
                ? baseQuery.Where(x => x.CurrencyTypeId == 0 || x.CurrencyTypeId == 1)
                : baseQuery.Where(x => x.CurrencyTypeId == wanted);
        }

        var results = await baseQuery
            .Select(x => new
            {
                x.Id,
                x.Type,
                x.Date,
                x.SalesmanCode,
                x.Subtotal,
                x.Discount,
                x.CampaignDiscount,
                x.NetTotal,
                x.GrandTotal,
                // Faturanın kendi para birimi — süzgeç buna göre çalışır (2026-08-19).
                x.CurrencyTypeId,
                // Fatura bazlı satır için: belgeyi ve müşteriyi TANIMLAYAN alanlar.
                x.InvoiceNo,
                x.CustomerCode,
                x.CustomerNameOverride
            })
            .ToListAsync(cancellationToken);

        // ═══════════════════════════════════════════════════════════════════════════
        // BELGENİN KENDİ PARASINDAKİ CİRO (2026-08-19).
        //
        // `NetTotal`/`GrandTotal` TL çapasıdır. Dövizli tutarı elde etmek için TL'yi KURA
        // BÖLMEK YASAK (rapor döviz kuralı) — kalemin `CurrencyUnitPrice`ı okunur.
        // İndirim ve KDV başlıktan ORAN olarak alınır; oran para biriminden bağımsız
        // olduğu için bu yol başlığın hangi konvansiyonda yazıldığından etkilenmez.
        // Aynı yöntem `InvoicePrintModelBuilder`da da kullanılıyor.
        // ═══════════════════════════════════════════════════════════════════════════
        var invoiceIds = results.Select(x => x.Id).ToList();

        var lineGrossByInvoice = new Dictionary<int, decimal>();
        if (invoiceIds.Count > 0)
        {
            var lineRows = await _dbContext.Set<InvoiceLine>()
                .AsNoTracking()
                .Where(l => invoiceIds.Contains(l.InvoiceId))
                .Select(l => new { l.InvoiceId, l.Quantity, l.UnitPrice, l.CurrencyTypeId, l.CurrencyUnitPrice })
                .ToListAsync(cancellationToken);

            foreach (var group in lineRows.GroupBy(l => l.InvoiceId))
            {
                lineGrossByInvoice[group.Key] = group.Sum(l =>
                {
                    var docPrice = !CurrencyTypeHelper.IsTry(l.CurrencyTypeId) && l.CurrencyUnitPrice > 0m
                        ? l.CurrencyUnitPrice
                        : l.UnitPrice;
                    return l.Quantity * docPrice;
                });
            }
        }

        decimal DocNetOf(int invoiceId, decimal subtotal, decimal netTotal)
        {
            if (!lineGrossByInvoice.TryGetValue(invoiceId, out var lineGross) || lineGross <= 0m) return netTotal;
            var netRatio = subtotal > 0m ? netTotal / subtotal : 1m;
            return Math.Round(lineGross * netRatio, 2, MidpointRounding.AwayFromZero);
        }

        // Belge parasına çevirme katsayısı: kalem brütü / TL brüt. Kalemi yoksa (ya da TL
        // faturada) 1 — TL faturada belge parası = TL çapası (canlıda 0 sapma doğrulandı).
        decimal DocFactorOf(int invoiceId, decimal subtotal)
            => lineGrossByInvoice.TryGetValue(invoiceId, out var g) && g > 0m && subtotal > 0m ? g / subtotal : 1m;

        decimal DocGrossOf(decimal docNet, decimal netTotal, decimal grandTotal)
        {
            var vatRatio = netTotal > 0m ? grandTotal / netTotal : 1m;
            return Math.Round(docNet * vatRatio, 2, MidpointRounding.AwayFromZero);
        }

        var salesmenList = await _dbContext.Salesmen.AsNoTracking().ToListAsync(cancellationToken);
        var salesmanLookup = salesmenList.ToDictionary(
            x => x.SalesmanCode,
            x => x.Description,
            StringComparer.OrdinalIgnoreCase
        );

        /*
          FATURA BAZLI SATIR (2026-08-20 kullanıcı isteği).

          Rapor gün + plasiyer + tip + para birimi bazında GRUPLUYORDU. Bunun görünen sonucu:
          "ATLEKS'e fatura kestim, raporda yok" — fatura kayıp değildi, o günün plasiyer
          toplamının içinde eriyordu. Fatura numarası ve cari kolonu olmadığı için hangi
          belgenin nereye gittiği okunamıyordu.

          Artık her satır BİR FATURA. Özet kartlar ve plasiyer dağılımı bu satırlardan
          toplanarak kurulur; toplamlar değişmez, yalnız kırılım açılır.
        */
        var customerCodes = results
            .Select(x => (x.CustomerCode ?? string.Empty).Trim())
            .Where(x => x.Length > 0)
            .Distinct()
            .ToList();

        var customerNames = await _dbContext.Customers.AsNoTracking()
            .Where(c => customerCodes.Contains(c.CustomerCode))
            .Select(c => new { c.CustomerCode, c.Name })
            .ToDictionaryAsync(x => x.CustomerCode, x => x.Name, StringComparer.OrdinalIgnoreCase, cancellationToken);

        var rows = results
            .Select(x =>
            {
                var code = (x.CustomerCode ?? string.Empty).Trim();

                // Belgeler -1/-2/-3 ALT HESABINA yazılır (bkz. cari alt hesap kuralı); kullanıcı
                // ise ana kodu tanır. Ham kod da veriliyor: ekstreyle karşılaştıran biri hangi
                // alt hesaba düştüğünü görebilmeli.
                var mainCode = CustomerAccountHelper.GetMainCodeFromInvoiceAccountCode(code);

                var name = !string.IsNullOrWhiteSpace(x.CustomerNameOverride)
                    ? x.CustomerNameOverride!
                    : customerNames.TryGetValue(code, out var n) && !string.IsNullOrWhiteSpace(n)
                        ? n
                        : customerNames.TryGetValue(mainCode, out var mn) ? (mn ?? string.Empty) : string.Empty;

                var salesmanCodeOfRow = (x.SalesmanCode ?? string.Empty).Trim();
                var salesmanName = !string.IsNullOrWhiteSpace(salesmanCodeOfRow)
                                   && salesmanLookup.TryGetValue(salesmanCodeOfRow, out var desc)
                    ? desc
                    : "GENEL";

                var isReturn = x.Type == InvoiceType.ReturnInvoice;
                var isService = x.Type == InvoiceType.ServiceInvoice;
                var coef = isReturn ? -1m : 1m;

                var docNet = DocNetOf(x.Id, x.Subtotal, x.NetTotal);
                var docGross = DocGrossOf(docNet, x.NetTotal, x.GrandTotal);
                var docFactor = DocFactorOf(x.Id, x.Subtotal);

                /*
                  BRÜT / İSKONTO / KAMPANYA (2026-09-30 kullanıcı isteği: "kampanyayı satış pazarlama
                  raporuna da koy, tablolar fatura döküm gibi olsun"). Fatura Döküm'ün kuralıyla aynı:
                  İskonto = ELLE girilen iskonto (`Discount` kampanyayı İÇERİR, o yüzden düşülür),
                  Kampanya ayrı sütun. Satırda Brüt − İskonto − Kampanya = Net tutar.
                */
                var elleIskonto = x.Discount - x.CampaignDiscount;

                return new
                {
                    id = x.Id,
                    faturaNo = x.InvoiceNo ?? string.Empty,
                    tarih = x.Date.Date,
                    cariKodu = mainCode,
                    cariHesapKodu = code,
                    cariAdi = name,
                    plasiyerKodu = salesmanCodeOfRow,
                    plasiyer = salesmanName,
                    islemTipi = isReturn ? "İADE" : isService ? "TAMİR" : "SATIŞ",
                    // TL çapası — plasiyer dağılımı ve özet kartlar bu ölçüde.
                    brut = Math.Round(x.Subtotal * coef, 2),
                    iskonto = Math.Round(elleIskonto * coef, 2),
                    kampanya = Math.Round(x.CampaignDiscount * coef, 2),
                    dovizBrut = Math.Round(x.Subtotal * docFactor * coef, 2),
                    dovizIskonto = Math.Round(elleIskonto * docFactor * coef, 2),
                    dovizKampanya = Math.Round(x.CampaignDiscount * docFactor * coef, 2),
                    toplamSatisNet = Math.Round(x.NetTotal * coef, 2),
                    toplamSatisKdvli = Math.Round(x.GrandTotal * coef, 2),
                    // Belgenin kendi parası.
                    currencyTypeId = CurrencyTypeHelper.Normalize(x.CurrencyTypeId),
                    currencyCode = CurrencyTypeHelper.ToCodeOrTry(CurrencyTypeHelper.Normalize(x.CurrencyTypeId)),
                    dovizNet = Math.Round(docNet * coef, 2),
                    dovizKdvli = Math.Round(docGross * coef, 2)
                };
            })
            .OrderByDescending(x => x.tarih)
            .ThenByDescending(x => x.id)
            .ToList();

        return Ok(new
        {
            success = true,
            data = rows,
            // Ekranın ay seçicisi bunları geri okur: kullanıcı hiçbir şey seçmeden açtığında
            // hangi ayın gösterildiğini bilmeli (varsayılan firmanın içinde bulunduğu ay).
            year = selectedYear,
            month = selectedMonth,
            // Uygulanan aralık (bitiş DAHİL) — ekran seçicisi bunu geri okur.
            startDate = monthStart.ToString("yyyy-MM-dd"),
            endDate = monthEnd.AddDays(-1).ToString("yyyy-MM-dd"),
            // İstemci plasiyer seçicisini kilitleyebilsin diye: kısıt sunucuda zaten uygulandı,
            // bu alan yalnızca ekranın "başkasını seçebiliyormuş" gibi görünmesini engelliyor.
            // Yetki kararı BURADA verilir; istemci bu değeri değiştirse hiçbir şey değişmez.
            restrictedSalesmanCode = isRestrictedSalesman ? ownSalesmanCode : null,
            // Ekrandaki para birimi düğmeleri bu listeden kurulur; seçili süzgeç
            // listeyi DARALTMAZ (yukarıdaki nota bakınız).
            availableCurrencyTypeIds = normalizedAvailableCurrencies,
            selectedCurrencyTypeId = filterCurrencyTypeId
        });
    }
}
