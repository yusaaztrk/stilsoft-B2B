using B2B.Erp.Api.Core.Authorization;
using B2B.Erp.Api.Core.Interfaces;
using B2B.Erp.Api.Core.Logging;
using B2B.Erp.Api.Data;
using B2B.Erp.Api.Dtos.Campaigns;
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
[Route("api/reports/active-basket")]
[Authorize]
public sealed class ActiveBasketReportController : ControllerBase
{
    private readonly AppDbContext _dbContext;
    private readonly ICampaignService _campaignService;
    private readonly Core.Interfaces.IMoneyServiceClient _money;
    private readonly Core.Helpers.CompanyClock _clock;
    private readonly IUserActivityLogger _userActivityLogger;

    public ActiveBasketReportController(
        AppDbContext dbContext,
        ICampaignService campaignService,
        Core.Interfaces.IMoneyServiceClient money,
        Core.Helpers.CompanyClock clock,
        IUserActivityLogger userActivityLogger)
    {
        _dbContext = dbContext;
        _campaignService = campaignService;
        _money = money;
        _clock = clock;
        _userActivityLogger = userActivityLogger;
    }

    /// <summary>
    /// Sepet satırının TL kuru.
    ///
    /// <para>
    /// <b>Kampanya motoru para birimi TAŞIMAZ.</b> Koşullar (<c>MinAmount</c>/<c>Maximum</c>) ve
    /// sabit tutarlı indirimler kuru olmayan ham sayılardır; motora hangi para biriminde fiyat
    /// verilirse eşik o para biriminde yorumlanır. Fatura ve sipariş yolları motora <b>TL</b>
    /// besliyor (<c>InvoicesController</c>, <c>SalesOrdersController</c>), sepet yolları ise
    /// satırın <b>kendi dövizini</b> besliyordu. İki sonucu vardı:
    /// </para>
    /// <list type="number">
    /// <item>500 $'lık sepet 10.000 TL eşiğine takılmıyor; müşteri sepette "kampanya yok"
    /// görüp faturada indirim alıyordu (ya da tersi).</item>
    /// <item>Sabit tutarlı indirim çok daha ağırdı: 500 TL'lik indirim, 500 $'lık satıra
    /// 500 "dolar" olarak uygulanıp satırı sıfırlıyordu.</item>
    /// </list>
    /// <para>
    /// Kur alınamazsa 1'e düşülür — kampanya değerlendirmesi kur servisine bağlı hâle gelmemeli.
    /// </para>
    /// </summary>
    private async Task<decimal> ResolveBasketRateAsync(
        string currency,
        Dictionary<string, decimal> cache,
        CancellationToken cancellationToken)
    {
        var code = NormalizeCurrency(currency);
        if (code == "TRY") return 1m;
        if (cache.TryGetValue(code, out var cached)) return cached;

        var rate = 1m;
        try
        {
            var fetched = await _money.GetLatestTryRateAsync(code, cancellationToken);
            if (fetched > 0m) rate = fetched;
        }
        catch
        {
            rate = 1m;
        }

        cache[code] = rate;
        return rate;
    }

    public sealed class ActiveBasketLineResult
    {
        public string SalesOrderLineId { get; set; } = string.Empty;
        public string StockCode { get; set; } = string.Empty;
        public string ProductName { get; set; } = string.Empty;
        public decimal Quantity { get; set; }
        public decimal UnitPrice { get; set; }
        /// <summary>Birim montaj bedeli (KDV dahil girilir; "Montaj istiyorum" satırında, sepetteki gibi).</summary>
        public decimal InstallationFee { get; set; }
        /// <summary>
        /// Satırın para birimi — <c>UnitPrice</c> BU paradadır, TL değil
        /// (<c>UserBasketItem.Currency</c>, ürünün satış dövizinden gelir).
        /// </summary>
        public string Currency { get; set; } = "TRY";
        public decimal VatRate { get; set; }
        public decimal VatAmount { get; set; }
        public string Montaj { get; set; } = string.Empty;
        public string Note { get; set; } = string.Empty;
        public string CampaignTitle { get; set; } = string.Empty;
        public decimal DiscountAmount { get; set; }
        public decimal DiscountRate { get; set; }
        public bool IsGift { get; set; }
        /// <summary>İndirim öncesi KDV hariç satır tutarı (montaj dahil) — raporun "Ara Toplam"ı bunun toplamı.</summary>
        public decimal NetBeforeDiscount { get; set; }
        public decimal LineNet { get; set; }
        public decimal LineTotal { get; set; }
    }

    public sealed class ActiveBasketCustomerResult
    {
        public string Id { get; set; } = string.Empty;
        public string ProcessedAt { get; set; } = string.Empty;
        public string OrderNo { get; set; } = string.Empty;
        public string CustomerCode { get; set; } = string.Empty;
        public string CustomerName { get; set; } = string.Empty;
        public decimal Subtotal { get; set; }
        public decimal DiscountTotal { get; set; }
        public decimal VatTotal { get; set; }
        public decimal GrandTotal { get; set; }

        /// <summary>
        /// Sepetin BASKIN para birimi — yukarıdaki dört toplam bu paradadır.
        ///
        /// Sepette tek para birimi varsa o, karışıksa "MIX" döner ve
        /// <see cref="TotalsByCurrency"/> okunmalıdır. Tek toplam vermek zorunda
        /// kalınmasının sebebi eski ekranların bu dört alanı okuyor olması.
        /// </summary>
        public string Currency { get; set; } = "TRY";

        /// <summary>Sepette birden fazla para birimi var mı — ekran uyarı gösterebilsin diye.</summary>
        public bool IsMixedCurrency { get; set; }

        /// <summary>
        /// PARA BİRİMİ BAŞINA toplamlar.
        ///
        /// NEDEN VAR: sepetteki fiyatlar ürünün SATIŞ dövizinden geliyor
        /// (<c>UserBasketItem.Currency</c>) ve bir sepette dolarlı ve TL'li ürün yan yana
        /// durabiliyor. Tek toplam, 100 $ ile 100 ₺'yi 200 sayıyordu.
        /// </summary>
        public List<ActiveBasketCurrencyTotal> TotalsByCurrency { get; set; } = new();

        public string ProcessedBy { get; set; } = string.Empty;
        public List<ActiveBasketLineResult> Lines { get; set; } = new();
    }

    /// <summary>
    /// Sepet satırının para birimi metnini tek biçime indirir. Boş gelen alan TL demektir
    /// (eski satırlarda <c>Currency</c> hiç doldurulmuyordu); "TL" de "TRY" sayılır ki aynı
    /// para birimi iki ayrı kovaya bölünmesin.
    /// </summary>
    private static string NormalizeCurrency(string? currency)
    {
        var c = (currency ?? string.Empty).Trim().ToUpperInvariant();
        if (c.Length == 0 || c == "TL") return "TRY";
        return c;
    }

    public sealed class ActiveBasketCurrencyTotal
    {
        public string Currency { get; set; } = "TRY";
        public decimal Subtotal { get; set; }
        public decimal DiscountTotal { get; set; }
        public decimal VatTotal { get; set; }
        public decimal GrandTotal { get; set; }
    }

    [HttpGet]
    [AuthorizePage("reports", "aktifSepetRaporu")]
    public async Task<IActionResult> GetReport([FromQuery] string? query, CancellationToken cancellationToken = default)
    {
        var q = string.IsNullOrWhiteSpace(query) ? null : query.Trim().ToLowerInvariant();

        var isSuperAdmin = User.FindFirst("IsSuperAdmin")?.Value == "1";
        var userRole = User.FindFirst("Role")?.Value ?? string.Empty;
        var currentCode = User.FindFirst("Carikodu")?.Value;
        currentCode = string.IsNullOrWhiteSpace(currentCode) ? null : currentCode.Trim();

        // ADEDİ SIFIR OLAN SEPET SATIRI RAPORA GİRMEZ (denetim md. 42).
        //
        // Sepetten çıkarılmış ya da adedi sıfırlanmış satırlar tabloda kalabiliyor ve rapor
        // bunları "aktif sepet" gibi sayıyordu: boş sepetler potansiyel sipariş olarak
        // görünüyordu. Adedi olmayan satır sepet satırı değildir.
        var itemsQuery = _dbContext.UserBasketItems.AsNoTracking()
            .Where(x => x.Quantity > 0)
            .AsQueryable();

        /*
          KAPSAM SUZGECI (2026-08-24, kullanici bildirimi: "yonetimde gormuyorum,
          superadminde goruyorum").

          Burada IKI ayri kirilma vardi:

          1) ROL ADI SABIT YAZILMISTI. "Yonetim" karsilastirmasi harfi harfine yapiliyordu;
             rol adlari firmadan firmaya degisiyor ve Turkce yazimda "Yönetim" oluyor.
             `OrdinalIgnoreCase` yalnizca buyuk/kucuk harfe bakar, 'ö' ile 'o' onun icin
             FARKLI harftir — yani "Yönetim" rolu bu listeye hic girmiyor ve muafiyeti
             kaybediyordu. Karsilastirma artik Turkce harfleri ASCII'ye indirerek yapiliyor.

          2) CARI KAPSAMI DUZ ESITLIKLE SUZULUYORDU. `Users.Carikodu` tek bir kod DEGIL:
             bos ve '*' "sinirsiz" demek, virgullu liste ise plasiyer portfoyu. Duz
             `CustomerCode == currentCode` karsilastirmasi bu ucunde de hicbir satirla
             eslesmiyor ve rapor BOS donuyordu. Depoda bunun icin ortak cozucu var
             (`CustomerScope`) ve her tuketici oradan gecmeli — bu rapor gecmiyordu.

          Yon: kapsam GENISLEMIYOR. Rolu geregi muaf olanlar eskisi gibi her sepeti goruyor;
          kisitli kullanici ise artik kendi kodlarinin TAMAMINI goruyor, hicbirini degil.
        */
        static string RolNormalize(string? value)
        {
            var v = (value ?? string.Empty).Trim().ToLowerInvariant();
            return v.Replace('ö', 'o').Replace('ü', 'u').Replace('ı', 'i')
                    .Replace('ş', 's').Replace('ç', 'c').Replace('ğ', 'g');
        }

        var rol = RolNormalize(userRole);
        var rolMuaf = rol == "admin" || rol == "yonetim" || rol == "plasiyer";

        if (!isSuperAdmin && !rolMuaf && !CustomerScope.IsUnrestrictedFor(User))
        {
            var kapsam = CustomerScope.Of(User).ToList();
            if (kapsam.Count > 0)
            {
                itemsQuery = itemsQuery.Where(x => kapsam.Contains(x.CustomerCode));
            }
        }

        var basketItems = await (
            from item in itemsQuery
            join cust in _dbContext.Customers.AsNoTracking() on item.CustomerCode equals cust.CustomerCode into custJoin
            from cust in custJoin.DefaultIfEmpty()
            select new
            {
                item.Id,
                item.CustomerCode,
                /*
                  SEPETTE SAKLANAN AD KAZANIR — CARİ TABLOSUNDAKİ AD DEĞİL (2026-08-25).

                  (Kullanıcı: "aktif sepet raporunda şubeler gözükmüyor, şube olarak yazmıyor".)

                  Şube siparişinde sepet ANA CARİ koduyla saklanır (fatura ana cariye kesilir);
                  şubenin kimliği yalnızca `UserBasketItems.CustomerName` alanındaki etikette
                  durur: "[01-000657-004] KIBRIS MANDELLA TİCARET LTD ( ZEYTİNLİK )".

                  Burada ana carinin adı her zaman kazandığı için o etiket ATILIYOR ve raporda
                  şube ile ana cari ayırt edilemiyordu — üç ayrı bayide (Mandella/Zeytinlik,
                  Boztuna/D.A.Ü, Techno Plus/Girne) aynı şey oluyordu.

                  Sıra ters çevrildi: sepete yazılan ad varsa o kullanılır. O ad, siparişi giren
                  kişinin ekranda SEÇTİĞİ carinin etiketidir — raporun göstermesi gereken de bu.

                  AMA "ETİKET = KOD" SAYILMAZ. Sepet satırı yazılırken ad
                  `l.Dealer?.Label`'dan geliyor ve etiket boşsa oraya CARİ KODU yazılıyor
                  (UserBasketsController). O satırlarda sepetteki "ad" gerçek bir ad değil;
                  olduğu gibi kullanılsaydı rapor, eskiden düzgün ad gösterdiği yerde
                  `120-01-000534` gibi bir kod göstermeye başlardı — şube düzeltmesinin
                  yan hasarı olurdu.

                  Sıra: (1) sepetteki ad, koddan farklıysa; (2) cari tablosundaki ad; (3) kod.
                */
                CustomerName = (!string.IsNullOrWhiteSpace(item.CustomerName)
                                && !string.Equals(item.CustomerName.Trim(), item.CustomerCode, StringComparison.OrdinalIgnoreCase))
                    ? item.CustomerName
                    : (cust != null ? cust.Name : item.CustomerCode),
                CustPriceGroupId = cust != null ? cust.PriceGroupId : null,
                CustInvoiceType = cust != null ? cust.InvoiceType : null,
                item.Username,
                item.ProductId,
                item.StockCode,
                item.ProductName,
                item.Quantity,
                item.UnitPrice,
                item.VatRate,
                item.Currency,
                item.Montaj,
                item.Note,
                item.Key,
                item.CampaignTitle,
                item.DiscountAmount,
                item.DiscountRate,
                item.IsGift,
                item.CreateTime,
                item.UpdateTime
            }
        ).ToListAsync(cancellationToken);

        /*
          RAPOR SEPETİN HESABIYLA BİREBİR (2026-10-14 kullanıcı bildirimi: "sepette fiyatlar düzgün
          ama aynı carinin aktif sepet raporuna girince fiyatlar farklı, saçma sapan geliyor").

          Rapor sepetin kendi hesabından üç noktada ayrılıyordu:
           1. KDV kararı CARİ KARTINDAN (InvoiceType) veriliyordu; sepet ise FİYAT GRUBUNDAN veriyor
              (`kdvKarari.ts`). Grup ile kart ayrıştığında (ör. fiyat grubu açıktan faturaya alınmış,
              kart hâlâ ACIK) sepet KDV ekliyor, rapor eklemiyordu. Askeriye (7) grubuna rapor KDV
              ekliyordu, sepet eklemiyor.
           2. MONTAJ BEDELİ yoktu: sepet "Montaj istiyorum" satırına ürünün montaj bedelini katıyor.
           3. Formülünde REMOVE_KDV olmayan FATURA grubunda fiyat KDV dahil saklanır; sepet nete
              ayrıştırıyor, rapor üstüne bir KDV daha ekliyordu.
          Kurallar artık `SiparisCartSection` ile aynı: grup → fatura tipi → KDV eklenir mi / fiyat
          net mi; KDV indirimli satır üzerinden; montaj bedeli satıra katılır.
        */
        var priceGroupIds = basketItems.Where(x => x.CustPriceGroupId.HasValue).Select(x => x.CustPriceGroupId!.Value).Distinct().ToList();
        var priceGroupsById = new Dictionary<Guid, (int Code, string InvoiceType, string Formula)>();
        if (priceGroupIds.Count > 0)
        {
            var pgs = await _dbContext.PriceGroups
                .AsNoTracking()
                .Where(pg => priceGroupIds.Contains(pg.Id))
                .Select(pg => new { pg.Id, pg.Code, pg.InvoiceType, pg.Formula })
                .ToListAsync(cancellationToken);
            foreach (var pg in pgs)
            {
                priceGroupsById[pg.Id] = (pg.Code, pg.InvoiceType ?? string.Empty, pg.Formula ?? string.Empty);
            }
        }

        // Sepet ekranı vergi oranını ve montaj bedelini ürünün GÜNCEL kartından okuyor.
        var basketStockCodes = basketItems.Select(x => x.StockCode).Where(x => !string.IsNullOrWhiteSpace(x)).Distinct().ToList();
        var productInfoByStockCode = (await _dbContext.Products
                .AsNoTracking()
                .Where(p => basketStockCodes.Contains(p.StockCode))
                .Select(p => new { p.StockCode, p.TaxRate, p.InstallationFee })
                .ToListAsync(cancellationToken))
            .GroupBy(p => p.StockCode, StringComparer.OrdinalIgnoreCase)
            .ToDictionary(g => g.Key, g => g.First(), StringComparer.OrdinalIgnoreCase);

        if (q is not null)
        {
            basketItems = basketItems.Where(x =>
                x.CustomerCode.ToLowerInvariant().Contains(q) ||
                x.CustomerName.ToLowerInvariant().Contains(q) ||
                x.StockCode.ToLowerInvariant().Contains(q) ||
                x.ProductName.ToLowerInvariant().Contains(q) ||
                x.Username.ToLowerInvariant().Contains(q) ||
                (x.CampaignTitle != null && x.CampaignTitle.ToLowerInvariant().Contains(q))
            ).ToList();
        }

        var customerGroups = basketItems.GroupBy(x => x.CustomerCode).ToList();
        var resultList = new List<ActiveBasketCustomerResult>();

        foreach (var g in customerGroups)
        {
            var first = g.First();

            // KDV kararı (kdvKarari.ts ile aynı sıra): 7 → Askeriye, 4-6 → Açık, değilse grubun
            // fatura tipi, o da boşsa FATURA. Grup yoksa FATURA ve fiyat net sayılır.
            int? pgCode = null;
            var pgInvoiceType = string.Empty;
            var pgFormula = string.Empty;
            if (first.CustPriceGroupId.HasValue && priceGroupsById.TryGetValue(first.CustPriceGroupId.Value, out var pgInfo))
            {
                pgCode = pgInfo.Code;
                pgInvoiceType = (pgInfo.InvoiceType ?? string.Empty).Trim().ToUpperInvariant();
                pgFormula = (pgInfo.Formula ?? string.Empty).Trim().ToUpperInvariant();
            }
            var faturaTipi = pgCode == 7 ? "ASKERIYE"
                : pgCode is >= 4 and <= 6 ? "ACIK"
                : pgInvoiceType is "ACIK" or "AÇIK" ? "ACIK"
                : pgInvoiceType is "ASKERIYE" or "ASKERİYE" ? "ASKERIYE"
                : "FATURA";
            var kdvEklenir = faturaTipi == "FATURA";
            var fiyatZatenNet = pgFormula.Length == 0 || pgFormula.Contains("REMOVE_KDV");

            decimal TaxRateOf(string stockCode, decimal stored)
                => productInfoByStockCode.TryGetValue(stockCode, out var pi) ? pi.TaxRate : stored;

            decimal InstallFeeOf(string stockCode, string? montaj)
            {
                if (!(montaj ?? string.Empty).Contains("montaj istiyorum", StringComparison.OrdinalIgnoreCase)) return 0m;
                return productInfoByStockCode.TryGetValue(stockCode, out var pi) && (pi.InstallationFee ?? 0m) > 0m
                    ? pi.InstallationFee!.Value
                    : 0m;
            }

            // Motora TL besleniyor (bkz. ResolveBasketRateAsync): kampanya eşikleri ve sabit
            // tutarlı indirimler para birimi taşımıyor, fatura/sipariş yolları da TL veriyor.
            var basketRateCache = new Dictionary<string, decimal>(StringComparer.OrdinalIgnoreCase);
            var rateByStockCode = new Dictionary<string, decimal>(StringComparer.OrdinalIgnoreCase);
            foreach (var x in g)
            {
                if (rateByStockCode.ContainsKey(x.StockCode)) continue;
                rateByStockCode[x.StockCode] =
                    await ResolveBasketRateAsync(x.Currency, basketRateCache, cancellationToken);
            }

            decimal RateOf(string stockCode)
                => rateByStockCode.TryGetValue(stockCode, out var r) && r > 0m ? r : 1m;

            // Para birimi koduna göre kur — hediye satırlarının stok kodu sepette olmayabilir,
            // bu yüzden toplamlar stok kodu değil PARA BİRİMİ üzerinden çevrilir.
            decimal RateOfCurrency(string currency)
            {
                var code = NormalizeCurrency(currency);
                if (code == "TRY") return 1m;
                return basketRateCache.TryGetValue(code, out var r) && r > 0m ? r : 1m;
            }

            var evalRequest = new EvaluateSalesOrderRequest
            {
                CustomerCode = first.CustomerCode,
                PriceGroupCode = pgCode,
                Lines = g.Select(x => new EvaluateSalesOrderLineRequest
                {
                    StockCode = x.StockCode,
                    Quantity = x.Quantity,
                    UnitPrice = x.UnitPrice * RateOf(x.StockCode),
                    // Sepetle aynı: KDV'siz tipte (açık/askeriye) motora 0 gider.
                    VatRate = kdvEklenir ? TaxRateOf(x.StockCode, x.VatRate) : 0m
                }).ToList()
            };

            EvaluateSalesOrderResponse? evalResponse = null;
            try
            {
                evalResponse = await _campaignService.EvaluateSalesOrder(evalRequest, cancellationToken);
            }
            catch
            {
                evalResponse = null;
            }

            var campaignDetails = evalResponse?.AppliedCampaignDetails ?? new List<EvaluateSalesOrderAppliedCampaignDetail>();
            var campaignNames = campaignDetails.Select(c => c.CampaignName).Where(n => !string.IsNullOrWhiteSpace(n)).Distinct().ToList();
            var globalCampaignTitle = string.Join(", ", campaignNames);
            var gList = g.ToList();

            var lines = new List<ActiveBasketLineResult>();

            foreach (var x in gList)
            {
                var evalLine = evalResponse?.Lines.FirstOrDefault(el =>
                    string.Equals(el.StockCode, x.StockCode, StringComparison.OrdinalIgnoreCase));
                var isGiftItem = x.IsGift || (evalLine?.IsGift ?? false);
                var unitPrice = isGiftItem ? 0.01m : x.UnitPrice;
                var installUnit = isGiftItem ? 0m : InstallFeeOf(x.StockCode, x.Montaj);
                var taxRate = TaxRateOf(x.StockCode, x.VatRate);

                // Sepetteki satır hesabının aynısı (SiparisCartSection: cartItems + totalsByCurrency).
                var shouldApplyVat = kdvEklenir && !isGiftItem;
                var factor = 1m + taxRate / 100m;
                var rawLine = (unitPrice + installUnit) * x.Quantity;
                decimal lineNetBeforeDiscount;
                decimal lineBrut;
                if (shouldApplyVat && factor > 1m)
                {
                    if (fiyatZatenNet)
                    {
                        lineNetBeforeDiscount = rawLine;
                        var brutPerUnit = Math.Round(unitPrice * factor, 2, MidpointRounding.AwayFromZero);
                        var brutInstallPerUnit = installUnit > 0m ? Math.Round(installUnit * factor, 2, MidpointRounding.AwayFromZero) : 0m;
                        lineBrut = (brutPerUnit + brutInstallPerUnit) * x.Quantity;
                    }
                    else
                    {
                        // Fiyat KDV dahil saklanmış: net'e ayrıştırılır, brüt fiyatın kendisi.
                        lineNetBeforeDiscount = rawLine / factor;
                        lineBrut = rawLine;
                    }
                }
                else
                {
                    lineNetBeforeDiscount = rawLine;
                    lineBrut = rawLine;
                }

                // Find campaign details specifically targeting this stock code
                var matchingCampaignDetails = campaignDetails
                    .Where(cd =>
                    {
                        if (string.IsNullOrWhiteSpace(cd.StockCodesJson)) return false;
                        try
                        {
                            var codes = System.Text.Json.JsonSerializer.Deserialize<List<string>>(cd.StockCodesJson);
                            return codes != null && codes.Any(c =>
                                string.Equals(c, x.StockCode, StringComparison.OrdinalIgnoreCase));
                        }
                        catch { return false; }
                    })
                    .ToList();

                decimal lineDiscount = 0m;
                string lineCampTitle = string.Empty;

                if (isGiftItem)
                {
                    lineCampTitle = !string.IsNullOrWhiteSpace(x.CampaignTitle) && !string.Equals(x.CampaignTitle, globalCampaignTitle, StringComparison.OrdinalIgnoreCase)
                        ? x.CampaignTitle
                        : (!string.IsNullOrWhiteSpace(globalCampaignTitle) ? globalCampaignTitle : "Hediye Ürün");
                }
                else
                {
                    // Motor TL ile beslendiği için indirimi de TL döndürür; satır kendi
                    // dövizinde gösterildiğinden aynı kurla geri çevriliyor. Aksi hâlde
                    // 500 TL'lik indirim dolarlı satıra 500 $ olarak yazılırdı.
                    var lineRate = RateOf(x.StockCode);

                    if (evalLine != null && evalLine.DiscountAmount > 0)
                    {
                        lineDiscount = evalLine.DiscountAmount / lineRate;
                    }
                    else if (matchingCampaignDetails.Count > 0)
                    {
                        lineDiscount = matchingCampaignDetails.Sum(cd => cd.AppliedDiscountAmount) / lineRate;
                    }
                    else if (x.DiscountAmount > 0)
                    {
                        // Sepette saklanan indirim ZATEN satırın para birimindedir; çevrilmez.
                        lineDiscount = x.DiscountAmount;
                    }

                    if (lineDiscount > lineNetBeforeDiscount) lineDiscount = lineNetBeforeDiscount;

                    if (lineDiscount > 0)
                    {
                        var matchingNames = matchingCampaignDetails
                            .Select(cd => cd.CampaignName)
                            .Where(n => !string.IsNullOrWhiteSpace(n))
                            .Distinct()
                            .ToList();

                        if (matchingNames.Count > 0)
                            lineCampTitle = string.Join(", ", matchingNames);
                        else if (!string.IsNullOrWhiteSpace(x.CampaignTitle))
                            lineCampTitle = x.CampaignTitle;
                        else if (!string.IsNullOrWhiteSpace(globalCampaignTitle))
                            lineCampTitle = globalCampaignTitle;
                    }
                }

                // KDV İNDİRİMLİ SATIR ÜZERİNDEN — sepetle aynı: satırın KDV'si (brüt − net),
                // indirimli net oranında küçülür.
                var lineNet = lineNetBeforeDiscount - lineDiscount;
                var lineKdvRaw = Math.Max(0m, lineBrut - lineNetBeforeDiscount);
                var lineVat = Math.Round(lineNetBeforeDiscount > 0m ? lineKdvRaw * (lineNet / lineNetBeforeDiscount) : lineKdvRaw, 2, MidpointRounding.AwayFromZero);
                var lineTotal = lineNet + lineVat;

                lines.Add(new ActiveBasketLineResult
                {
                    SalesOrderLineId = string.IsNullOrWhiteSpace(x.Key) ? x.Id.ToString() : x.Key,
                    StockCode = x.StockCode,
                    ProductName = x.ProductName,
                    Quantity = x.Quantity,
                    UnitPrice = unitPrice,
                    InstallationFee = installUnit,
                    Currency = NormalizeCurrency(x.Currency),
                    VatRate = shouldApplyVat ? taxRate : 0m,
                    VatAmount = lineVat,
                    Montaj = x.Montaj,
                    Note = x.Note,
                    CampaignTitle = lineCampTitle,
                    DiscountAmount = lineDiscount,
                    DiscountRate = lineDiscount > 0 && lineNetBeforeDiscount > 0
                        ? Math.Round(lineDiscount / lineNetBeforeDiscount * 100m, 2)
                        : 0m,
                    IsGift = isGiftItem,
                    NetBeforeDiscount = lineNetBeforeDiscount,
                    LineNet = lineNet,
                    LineTotal = lineTotal
                });
            } // end foreach gList

            // Also include gift lines evaluated by Campaign Engine that are not yet in gList
            if (evalResponse != null && evalResponse.Lines != null)
            {
                var existingStockCodes = lines.Select(l => l.StockCode).ToHashSet(StringComparer.OrdinalIgnoreCase);
                var newGiftLines = evalResponse.Lines.Where(el => el.IsGift && !existingStockCodes.Contains(el.StockCode)).ToList();

                // Hediye satırının parası SEPETİN kaleminden türetilir, sabit TL yazılmaz —
                // aynı hata sipariş promosyon satırlarında da vardı ve orada da böyle kapandı.
                var giftCurrency = lines.Count > 0 ? lines[0].Currency : "TRY";

                foreach (var giftEl in newGiftLines)
                {
                    var unitPrice = 0.01m;
                    var lineBase = giftEl.Quantity * unitPrice;

                    lines.Add(new ActiveBasketLineResult
                    {
                        SalesOrderLineId = Guid.NewGuid().ToString(),
                        StockCode = giftEl.StockCode,
                        ProductName = giftEl.ProductName,
                        Quantity = giftEl.Quantity,
                        UnitPrice = unitPrice,
                        Currency = giftCurrency,
                        VatRate = 0m,
                        VatAmount = 0m,
                        Montaj = string.Empty,
                        Note = string.Empty,
                        CampaignTitle = !string.IsNullOrWhiteSpace(globalCampaignTitle) ? globalCampaignTitle : "Hediye Ürün",
                        DiscountAmount = 0m,
                        DiscountRate = 0m,
                        IsGift = true,
                        NetBeforeDiscount = lineBase,
                        LineNet = lineBase,
                        LineTotal = lineBase
                    });
                }
            }

            var subtotal = lines.Sum(l => l.NetBeforeDiscount);
            var lineDiscountTotal = lines.Sum(l => l.DiscountAmount);

            // SİPARİŞ SEVİYESİ İNDİRİM — birim uyumu.
            //
            // `evalResponse.DiscountTotal` motordan gelir ve motor artık TL ile besleniyor,
            // yani bu değer **TL**'dir. Satır indirimleri ise satırın KENDİ dövizine geri
            // çevrilmiş durumda. İkisini doğrudan çıkarmak TL'den döviz çıkarmak olurdu:
            // 100 $'lık (≈3.800 ₺) sepette 400 ₺'lik sipariş indirimi, 400 $ gibi düşülüp
            // sepeti eksiye çekerdi. Karşılaştırma TL'de yapılıp sonuç sepetin parasına
            // geri çevriliyor.
            var lineDiscountTotalTry = lines.Sum(l => l.DiscountAmount * RateOfCurrency(l.Currency));
            var orderLevelDiscountTry = 0m;
            if (evalResponse != null && evalResponse.DiscountTotal > lineDiscountTotalTry)
            {
                orderLevelDiscountTry = evalResponse.DiscountTotal - lineDiscountTotalTry;
            }

            // Tek dövizli sepette sepetin parasına çevrilir; karışık sepette tek bir para
            // birimine düşürülemez (baskın para birimi yoktur) — orada TL bırakılıp yalnızca
            // eski skaler alanda kalır, doğru okuma `TotalsByCurrency`den yapılır.
            var basketCurrencies = lines.Select(l => l.Currency).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
            var basketRate = basketCurrencies.Count == 1 ? RateOfCurrency(basketCurrencies[0]) : 1m;
            var orderLevelDiscount = basketRate > 0m ? orderLevelDiscountTry / basketRate : orderLevelDiscountTry;

            var discountTotal = lineDiscountTotal + orderLevelDiscount;
            var vatTotal = lines.Sum(l => l.VatAmount);
            var grandTotal = subtotal - discountTotal + vatTotal;
            if (grandTotal < 0m) grandTotal = 0m;
            var latestTime = g.Max(x => x.UpdateTime);

            // PARA BİRİMİ BAŞINA TOPLAM.
            // Sepet fiyatları ürünün satış dövizinden geliyor; dolarlı ve TL'li kalem aynı
            // sepette olabiliyor. Yukarıdaki tek toplam bunları ayırt etmiyor — eski
            // ekranlar okuduğu için korundu, ama doğru okuma buradan yapılır.
            var currenciesInBasket = lines.Select(l => l.Currency).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
            var isMixed = currenciesInBasket.Count > 1;

            var totalsByCurrency = lines
                .GroupBy(l => l.Currency, StringComparer.OrdinalIgnoreCase)
                .Select(cg =>
                {
                    var curSubtotal = cg.Sum(l => l.NetBeforeDiscount);
                    var curDiscount = cg.Sum(l => l.DiscountAmount);
                    var curVat = cg.Sum(l => l.VatAmount);
                    var curGrand = curSubtotal - curDiscount + curVat;
                    return new ActiveBasketCurrencyTotal
                    {
                        Currency = cg.Key,
                        Subtotal = curSubtotal,
                        DiscountTotal = curDiscount,
                        VatTotal = curVat,
                        GrandTotal = curGrand < 0m ? 0m : curGrand
                    };
                })
                .OrderBy(t => t.Currency, StringComparer.OrdinalIgnoreCase)
                .ToList();

            // Sipariş seviyesi indirimi tek bir dövize düşürmek zorunda: kampanya motoru
            // dövize göre ayrıştırmıyor. Karışık sepette baskın para birimi yoktur, bu
            // yüzden oraya yazılmaz — ekranın TotalsByCurrency okuması gerekir.
            if (!isMixed && orderLevelDiscount > 0m && totalsByCurrency.Count == 1)
            {
                totalsByCurrency[0].DiscountTotal += orderLevelDiscount;
                var adjusted = totalsByCurrency[0].GrandTotal - orderLevelDiscount;
                totalsByCurrency[0].GrandTotal = adjusted < 0m ? 0m : adjusted;
            }

            var custName = first.CustomerName;
            if (custName.Contains("]"))
            {
                custName = custName.Split(']').Last().Trim();
            }

            resultList.Add(new ActiveBasketCustomerResult
            {
                Id = first.CustomerCode,
                /*
                  SAAT FİRMA SAATİNE ÇEVRİLİR (2026-08-26, kullanıcı: "saatler yanlış geliyor,
                  3 saat geriyi gösteriyor").

                  `UpdateTime` UTC olarak saklanıyor (`DateTime.UtcNow`) ve burada hiç
                  çevrilmeden basılıyordu. Kıbrıs UTC+3 olduğu için rapor her satırı 3 saat
                  geride gösteriyordu: 00:30'da eklenen ürün 21:30 görünüyordu.

                  Çevrim tek kaynaktan (`CompanyClock`, `Company:TimeZone`) yapılıyor —
                  sunucunun yerel saatinden değil; sunucu başka bir dilimde olsa da doğru kalır.
                */
                ProcessedAt = _clock.ToCompanyTime(DateTime.SpecifyKind(latestTime, DateTimeKind.Utc))
                                    .ToString("yyyy-MM-dd HH:mm"),
                OrderNo = string.Empty,
                CustomerCode = first.CustomerCode,
                CustomerName = custName,
                Subtotal = subtotal,
                DiscountTotal = discountTotal,
                VatTotal = vatTotal,
                GrandTotal = grandTotal,
                Currency = isMixed ? "MIX" : (currenciesInBasket.FirstOrDefault() ?? "TRY"),
                IsMixedCurrency = isMixed,
                TotalsByCurrency = totalsByCurrency,
                ProcessedBy = first.Username,
                Lines = lines
            });
        }

        var sortedResult = resultList.OrderByDescending(x => x.ProcessedAt).ToList();
        return Ok(new { success = true, data = sortedResult });
    }

    [HttpDelete("{customerCode}")]
    [AuthorizePage("reports", "aktifSepetRaporu")]
    public async Task<IActionResult> DeleteCustomerBasket([FromRoute] string customerCode, CancellationToken cancellationToken = default)
    {
        var targetCode = (customerCode ?? string.Empty).Trim();
        if (string.IsNullOrWhiteSpace(targetCode)) return BadRequest(new { success = false, message = "Cari kodu zorunlu" });

        var items = await _dbContext.UserBasketItems.Where(x => x.CustomerCode == targetCode).ToListAsync(cancellationToken);
        if (items.Count > 0)
        {
            _dbContext.UserBasketItems.RemoveRange(items);
            await _dbContext.SaveChangesAsync(cancellationToken);

            /*
              SİLİNENİN İZİ BIRAKILIR (2026-09-03).

              Sepet satırında soft-delete yok ve `UserBasketItem` merkezî hareket kaydının
              dışında; bu uç çağrıldığında geriye hiçbir iz kalmıyordu. Satırın sahibi
              (`Username`) bu ekranı kullanan kişi DEĞİL — bayinin kendisi olabilir; ikisi de
              kayda yazılır ki "sepetim boşaldı" şikayetinde kimin sildiği görünsün.

              Kayıt silmeden SONRA yazılır: `LogAsync` kendi `SaveChangesAsync`'ini çağırıyor.
            */
            var silen = User.Identity?.Name ?? "Kullanıcı";
            var sahipler = items
                .Select(x => (x.Username ?? string.Empty).Trim())
                .Where(x => !string.IsNullOrWhiteSpace(x))
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToList();
            var cariAdi = items.Select(x => x.CustomerName).FirstOrDefault(x => !string.IsNullOrWhiteSpace(x)) ?? targetCode;

            await _userActivityLogger.LogAsync(
                "fatura", "aktifSepetRaporu", "Delete",
                $"Aktif Sepet Raporu'ndan sepet silindi: {targetCode} ({cariAdi}) — {items.Count} kalem",
                recordId: targetCode,
                details: new
                {
                    kaynak = "Aktif Sepet Raporu",
                    silen,
                    satirSahipleri = sahipler,
                    cari = targetCode,
                    cariAdi,
                    kalemSayisi = items.Count,
                    kalemler = items.Select(x => new
                    {
                        sahibi = x.Username,
                        stok = x.StockCode,
                        urun = x.ProductName,
                        adet = x.Quantity,
                        fiyat = x.UnitPrice,
                        doviz = x.Currency,
                        eklenme = x.CreateTime
                    }).ToList()
                },
                cancellationToken: cancellationToken);
        }

        return Ok(new { success = true, removed = items.Count });
    }
}
