using B2B.Erp.Api.Core.Interfaces;
using B2B.Erp.Api.Core.Http;
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
[Route("api/baskets")]
[Authorize]
public sealed class UserBasketsController : ControllerBase
{
    private readonly AppDbContext _dbContext;
    private readonly ICampaignService _campaignService;
    private readonly Core.Interfaces.IMoneyServiceClient _money;
    private readonly IUserActivityLogger _userActivityLogger;

    /// <summary>
    /// Ürünün satış dövizinin TL kuru; TL'de 1, kur alınamazsa 1.
    ///
    /// <para>
    /// <b>Kampanya motoru para birimi taşımaz.</b> Eşikler ve sabit tutarlı indirimler kuru
    /// olmayan ham sayılardır. Fatura ve sipariş yolları motora TL besliyor; burası satırın
    /// KENDİ dövizini besliyordu ve dönen indirimi <b>olduğu gibi veritabanına yazıyordu</b>.
    /// Yani 500 TL'lik sabit indirim, 500 $'lık bir satıra 500 $ olarak KAYDEDİLİYOR ve satırı
    /// sıfırlıyordu. Sepet raporu da bu alanı "satırın para biriminde" varsayarak okuyor.
    /// </para>
    /// </summary>
    private async Task<decimal> ResolveProductRateAsync(
        string? currency,
        Dictionary<string, decimal> cache,
        CancellationToken cancellationToken)
    {
        var code = (currency ?? string.Empty).Trim().ToUpperInvariant();
        if (code.Length == 0 || code == "TL" || code == "TRY") return 1m;
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

    /// <summary>
    /// SEPETTEN SİLİNEN SATIRLARIN İZİ.
    ///
    /// <para>
    /// Sepet satırı silindiğinde geriye HİÇBİR iz kalmıyordu: <c>UserBasketItem</c> merkezî
    /// hareket kaydının dışında tutulmuş (haklı olarak — sepet 500 ms'de bir ve 15 saniyelik
    /// nabızla eşitleniyor, her satır kayda düşseydi günde on binlerce satır yazardı), tabloda
    /// da soft-delete yok. 2026-09-03'te "bu carinin sepetine ürün ekliyoruz, sonra kayboluyor"
    /// şikayeti geldiğinde kimin sildiği VERİDEN CEVAPLANAMADI.
    /// </para>
    ///
    /// <para>
    /// Bu yüzden yalnız <b>SİLME</b> kayda geçer, ekleme/güncelleme geçmez: gürültü doğmaz ama
    /// "kim sildi" sorusunun cevabı kalır. Silinen satırların içeriği <c>DetailsJson</c>'a
    /// yazılır — satırlar geri getirilemediği için ne kaybedildiği ancak burada görünür.
    /// </para>
    ///
    /// <para>
    /// <b>Satırın sahibi (<c>Username</c>) ile SİLEN kullanıcı farklı olabilir</b> ve asıl
    /// aranan kanıt tam olarak budur: silme yolları kullanıcı süzgeci kullanmıyor, yani bir
    /// kullanıcı başkasının açtığı sepeti uçurabiliyor. İkisi ayrı ayrı yazılır.
    /// </para>
    /// </summary>
    private async Task LogBasketDeletionAsync(
        string kaynak,
        System.Collections.Generic.IReadOnlyCollection<UserBasketItem> silinenler,
        CancellationToken cancellationToken)
    {
        if (silinenler is null || silinenler.Count == 0) return;

        var silen = User.Identity?.Name ?? "Kullanıcı";
        var cariKodlari = silinenler
            .Select(x => (x.CustomerCode ?? string.Empty).Trim())
            .Where(x => !string.IsNullOrWhiteSpace(x))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();
        var sahipler = silinenler
            .Select(x => (x.Username ?? string.Empty).Trim())
            .Where(x => !string.IsNullOrWhiteSpace(x))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();
        var baskasininSatiri = sahipler.Any(o => !string.Equals(o, silen, StringComparison.OrdinalIgnoreCase));

        var cariMetni = cariKodlari.Count switch
        {
            0 => "cari yok",
            1 => cariKodlari[0],
            _ => $"{cariKodlari.Count} cari"
        };

        await _userActivityLogger.LogAsync(
            "fatura", "sepet", "Delete",
            $"Sepetten {silinenler.Count} kalem silindi ({cariMetni}) — {kaynak}"
                + (baskasininSatiri ? " — BAŞKA KULLANICININ SATIRLARI DA SİLİNDİ" : string.Empty),
            recordId: cariKodlari.Count == 1 ? cariKodlari[0] : null,
            details: new
            {
                kaynak,
                silen,
                satirSahipleri = sahipler,
                baskasininSatiri,
                cariKodlari,
                kalemSayisi = silinenler.Count,
                kalemler = silinenler.Select(x => new
                {
                    cari = x.CustomerCode,
                    cariAdi = x.CustomerName,
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

    public UserBasketsController(
        AppDbContext dbContext,
        ICampaignService campaignService,
        Core.Interfaces.IMoneyServiceClient money,
        IUserActivityLogger userActivityLogger)
    {
        _dbContext = dbContext;
        _campaignService = campaignService;
        _money = money;
        _userActivityLogger = userActivityLogger;
    }

    public sealed class SyncBasketLineDto
    {
        public string Key { get; set; } = string.Empty;
        public SyncBasketProductDto Product { get; set; } = new();
        public SyncBasketDealerDto Dealer { get; set; } = new();
        public string Montaj { get; set; } = string.Empty;
        public decimal Qty { get; set; }
        public string Note { get; set; } = string.Empty;
        public string? CampaignTitle { get; set; }
        public decimal? DiscountAmount { get; set; }
        public decimal? DiscountRate { get; set; }
        public bool? IsGift { get; set; }

        /// <summary>
        /// Montaj formu (ad, telefon, adres, bölge, bayi açıklaması…). 2026-10-13: eskiden yalnız
        /// tarayıcıda tutuluyordu; sepet sunucudan her yüklendiğinde, başka bilgisayarda ya da
        /// tarayıcı hafızası silinince montaj bilgileri kayboluyordu. Artık satırla birlikte saklanır.
        /// null = istemci göndermedi (eski sürüm) → mevcut kayıt korunur.
        /// </summary>
        public System.Text.Json.JsonElement? MontajDetails { get; set; }

        /// <summary>Montajlı satırın kalıcı kimliği (fatura/montaj kaydına kadar taşınır).</summary>
        public string? LineageId { get; set; }
    }

    /// <summary>Montaj formunun saklanacak JSON'u; nesne değilse ya da aşırı büyükse yazılmaz.</summary>
    private static string? MontajJsonOf(SyncBasketLineDto l)
    {
        if (l.MontajDetails is not { } md || md.ValueKind != System.Text.Json.JsonValueKind.Object) return null;
        var raw = md.GetRawText();
        return raw.Length > 8000 ? null : raw;
    }

    private static bool WantsMontaj(string? montaj) =>
        (montaj ?? string.Empty).Contains("Montaj istiyorum", StringComparison.OrdinalIgnoreCase);

    public sealed class SyncBasketProductDto
    {
        public string Id { get; set; } = string.Empty;
        public string StockCode { get; set; } = string.Empty;
        public string Name { get; set; } = string.Empty;
        public decimal UnitPrice { get; set; }
        public decimal KdvRate { get; set; }
        public string? Currency { get; set; }
    }

    public sealed class SyncBasketDealerDto
    {
        public string Id { get; set; } = string.Empty;
        public string Label { get; set; } = string.Empty;
    }

    public sealed class SyncBasketRequest
    {
        public List<SyncBasketLineDto> Lines { get; set; } = new();
        /// <summary>
        /// Only true when user explicitly clears cart. Never set by periodic/auto sync.
        /// </summary>
        public bool ClearExplicitly { get; set; }
        /// <summary>
        /// Keys that were explicitly removed by the user (single item delete or qty=0).
        /// These will be deleted from DB.
        /// </summary>
        public List<string> RemovedKeys { get; set; } = new();

        /// <summary>
        /// Temizlenecek cari kodlari. Temizlemede <c>Lines</c> BOS gidiyor, dolayisiyla hangi
        /// carinin sepetinin silinecegi baska turlu bilinemiyor; oncesinde kullanicinin
        /// `Carikodu` claim'inden tahmin ediliyordu ve o alan tek kod olmadigi icin tutmuyordu.
        /// </summary>
        public List<string>? CustomerCodes { get; set; }
    }

    /// <summary>
    /// UPSERT sync: never deletes all basket items. Only:
    /// 1. Upserts each line by Key
    /// 2. Deletes lines whose Key is in RemovedKeys
    /// 3. If ClearExplicitly=true, deletes ALL items for this customer/user
    /// </summary>
    [AtomicRequest]
    [HttpPost("sync")]
    public async Task<IActionResult> Sync([FromBody] SyncBasketRequest request, CancellationToken cancellationToken)
    {
        var username = User.Identity?.Name ?? "Kullanıcı";
        var userCariCode = User.FindFirst("Carikodu")?.Value?.Trim();

        var lines = request?.Lines ?? new List<SyncBasketLineDto>();
        var removedKeys = request?.RemovedKeys ?? new List<string>();
        var clearExplicitly = request?.ClearExplicitly ?? false;
        var now = DateTime.UtcNow;

        var basketSilinenler = new List<UserBasketItem>();

        // --- CASE 1: Explicit full clear (user pressed "Sepeti Temizle") ---
        if (clearExplicitly)
        {
            /*
              TEMIZLENECEK CARI ARTIK ISTEMCIDEN GELIYOR (2026-08-24, kullanici bildirimi:
              "plasiyerde sepeti temizliyorum, yenileyince geri geliyor").

              Eski hal: temizlemede `lines` BOS oldugu icin liste bos kaliyor ve kod
              kullanicinin `Carikodu` claim'ine dusuyordu. O alan TEK BIR KOD DEGIL —
              plasiyerde virgullu liste ("120-01-000123,120-01-000456"), yetkili kullanicida
              '*' ya da bos. `Contains` bu metnin TAMAMINI ariyor, hicbir satirla eslesmiyor
              ve silme 0 satir etkiliyordu. Ekran bosaliyor, sunucudaki sepet duruyor,
              yenileyince geri geliyordu.

              `|| x.Username == username` dali bunu kurtarmiyordu: satirin `Username`'i
              sepeti olusturan kullanicidir, plasiyerin adi degil.

              Yeni hal: istemci hangi carinin sepetini temizlediyse kodlarini gonderiyor.
              Kod geldiyse SADECE o carilerin satirlari silinir — plasiyerin baska bir
              carinin sepetini kazara silmesi de boylece imkansiz. Kod gelmediyse (eski
              surum istemci) eski davranisa dusulur.
            */
            var customerCodesToClear = (request?.CustomerCodes ?? new List<string>())
                .Select(c => (c ?? string.Empty).Trim())
                .Where(c => !string.IsNullOrWhiteSpace(c))
                .Concat(lines
                    .Select(l => (l.Dealer?.Id ?? string.Empty).Trim())
                    .Where(c => !string.IsNullOrWhiteSpace(c)))
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToList();

            var toDelete = customerCodesToClear.Count > 0
                ? await _dbContext.UserBasketItems
                    .Where(x => customerCodesToClear.Contains(x.CustomerCode))
                    .ToListAsync(cancellationToken)
                : await _dbContext.UserBasketItems
                    .Where(x => x.Username == username)
                    .ToListAsync(cancellationToken);
            if (toDelete.Count > 0)
                _dbContext.UserBasketItems.RemoveRange(toDelete);

            await _dbContext.SaveChangesAsync(cancellationToken);

            // Kayıt SİLMEDEN SONRA yazılır: `LogAsync` kendi `SaveChangesAsync`'ini çağırıyor,
            // önce çağrılsaydı bekleyen silmeyi erkenden işlerdi.
            //
            // Cari kodu GELMEDİĞİNDE silme `Username`'e düşüyor: o kullanıcının BÜTÜN
            // carilerdeki sepetleri gider. Kaynak metni bu iki dalı ayırıyor ki kayda bakan
            // kişi hangisinin işlediğini görsün.
            await LogBasketDeletionAsync(
                customerCodesToClear.Count > 0
                    ? "Sepeti Temizle (cari bazlı)"
                    : "Sepeti Temizle (kullanıcının tüm sepetleri)",
                toDelete,
                cancellationToken);

            return Ok(new { success = true, cleared = toDelete.Count });
        }

        // --- CASE 2: Delete only explicitly removed keys ---
        if (removedKeys.Count > 0)
        {
            var keysToRemove = removedKeys.Where(k => !string.IsNullOrWhiteSpace(k)).Distinct().ToList();

            /*
              SATIRI, O CARİNİN SEPETİNE ERİŞEBİLEN HERKES ÇIKARABİLİR (2026-09-27).
              Silme yalnız satırı EKLEYEN kullanıcıya (ya da kendi carisine) izin veriyordu. Şube
              sepetini birden çok personel ortak kullanıyor: A'nın eklediği ürünü B çıkarınca silme
              sessizce 0 satır etkiliyor, ürün bir sonraki yüklemede GERİ geliyordu. Sepeti okuma
              kuralı (`customer-basket`) ne ise silme kuralı da o: kapsamı sınırsız olan her şeyi,
              sınırlı olan yalnız kendi kapsamındaki carilerin satırlarını siler.
            */
            List<string>? silinebilirCariler = null;
            if (!B2B.Erp.Api.Core.Authorization.CustomerScope.IsUnrestrictedFor(User))
            {
                var kapsam = B2B.Erp.Api.Core.Authorization.CustomerScope.Of(User);
                silinebilirCariler = await B2B.Erp.Api.Core.Authorization.CustomerScope.ExpandAsync(
                    _dbContext.Customers.AsNoTracking(), kapsam, cancellationToken);
            }

            var removeQuery = _dbContext.UserBasketItems.Where(x => keysToRemove.Contains(x.Key));
            if (silinebilirCariler is not null)
            {
                removeQuery = removeQuery.Where(x => x.Username == username ||
                    (userCariCode != null && x.CustomerCode == userCariCode) ||
                    silinebilirCariler.Contains(x.CustomerCode));
            }
            var toRemove = await removeQuery.ToListAsync(cancellationToken);
            if (toRemove.Count > 0)
                _dbContext.UserBasketItems.RemoveRange(toRemove);

            basketSilinenler = toRemove;
        }

        // --- CASE 3: Upsert all lines (add or update by Key) ---
        if (lines.Count == 0)
        {
            // Nothing to upsert, just save removals if any
            if (removedKeys.Count > 0)
            {
                await _dbContext.SaveChangesAsync(cancellationToken);
                await LogBasketDeletionAsync("Sepetten kalem çıkarma", basketSilinenler, cancellationToken);
            }
            return Ok(new { success = true, count = 0 });
        }

        var validLines = lines.Where(l => l.Qty > 0).ToList();

        var customerCodes = validLines
            .Select(l => string.IsNullOrWhiteSpace(l.Dealer?.Id) ? userCariCode : l.Dealer.Id.Trim())
            .Where(code => !string.IsNullOrWhiteSpace(code))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();

        var acikCustomers = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var priceGroupCodesByCustCode = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);

        if (customerCodes.Count > 0)
        {
            var custEntities = await _dbContext.Customers
                .AsNoTracking()
                .Where(c => customerCodes.Contains(c.CustomerCode))
                .ToListAsync(cancellationToken);

            var priceGroupIds = custEntities.Where(c => c.PriceGroupId.HasValue).Select(c => c.PriceGroupId!.Value).Distinct().ToList();
            var targetPriceGroupIds = new HashSet<Guid>();
            var pgCodesById = new Dictionary<Guid, int>();

            if (priceGroupIds.Count > 0)
            {
                var pgs = await _dbContext.PriceGroups
                    .AsNoTracking()
                    .Where(pg => priceGroupIds.Contains(pg.Id))
                    .Select(pg => new { pg.Id, pg.Code })
                    .ToListAsync(cancellationToken);

                foreach (var pg in pgs)
                {
                    pgCodesById[pg.Id] = pg.Code;
                    if (pg.Code == 4 || pg.Code == 5 || pg.Code == 6)
                        targetPriceGroupIds.Add(pg.Id);
                }
            }

            foreach (var c in custEntities)
            {
                if (c.PriceGroupId.HasValue && pgCodesById.TryGetValue(c.PriceGroupId.Value, out var code))
                    priceGroupCodesByCustCode[c.CustomerCode] = code;

                var invType = (c.InvoiceType ?? string.Empty).Trim().ToUpperInvariant();
                if (invType == "ACIK" || invType == "AÇIK" || (c.PriceGroupId.HasValue && targetPriceGroupIds.Contains(c.PriceGroupId.Value)))
                    acikCustomers.Add(c.CustomerCode);
            }
        }

        // Load existing items by Key so we can upsert
        var allKeys = validLines.Select(l => l.Key).Where(k => !string.IsNullOrWhiteSpace(k)).Distinct().ToList();
        var existingByKey = await _dbContext.UserBasketItems
            .Where(x => allKeys.Contains(x.Key))
            .ToDictionaryAsync(x => x.Key, x => x, cancellationToken);

        var linesByCustCode = validLines
            .GroupBy(l => string.IsNullOrWhiteSpace(l.Dealer?.Id) ? (userCariCode ?? "") : l.Dealer.Id.Trim())
            .ToList();

        foreach (var group in linesByCustCode)
        {
            var custCode = group.Key;
            if (string.IsNullOrWhiteSpace(custCode)) continue;

            var isAcik = acikCustomers.Contains(custCode);
            int? pgCode = priceGroupCodesByCustCode.TryGetValue(custCode, out var cCode) ? cCode : null;
            var isAskeriye = pgCode == 7;

            // Motora TL besleniyor — bkz. ResolveProductRateAsync.
            var basketRateCache = new Dictionary<string, decimal>(StringComparer.OrdinalIgnoreCase);
            var rateByKey = new Dictionary<string, decimal>(StringComparer.Ordinal);
            foreach (var l in group)
            {
                var k = l.Key ?? string.Empty;
                if (rateByKey.ContainsKey(k)) continue;
                rateByKey[k] = await ResolveProductRateAsync(l.Product?.Currency, basketRateCache, cancellationToken);
            }

            decimal RateOfKey(string k)
                => rateByKey.TryGetValue(k, out var r) && r > 0m ? r : 1m;

            var evalRequest = new EvaluateSalesOrderRequest
            {
                CustomerCode = custCode,
                PriceGroupCode = pgCode,
                Lines = group.Select(l => new EvaluateSalesOrderLineRequest
                {
                    StockCode = l.Product?.StockCode ?? string.Empty,
                    Quantity = l.Qty,
                    UnitPrice = (l.Product?.UnitPrice ?? 0m) * RateOfKey(l.Key ?? string.Empty),
                    VatRate = (isAcik || isAskeriye) ? 0m : (l.Product?.KdvRate ?? 0m)
                }).ToList()
            };

            EvaluateSalesOrderResponse? evalResponse = null;
            try { evalResponse = await _campaignService.EvaluateSalesOrder(evalRequest, cancellationToken); }
            catch { evalResponse = null; }

            var campaignDetails = evalResponse?.AppliedCampaignDetails ?? new List<EvaluateSalesOrderAppliedCampaignDetail>();
            var globalCampaignTitle = string.Join(", ", campaignDetails
                .Select(c => c.CampaignName)
                .Where(n => !string.IsNullOrWhiteSpace(n))
                .Distinct());

            // Motor yanıtı istek satırlarını GÖNDERİLDİKLERİ SIRAYLA taşır (motorun eklediği
            // hediye satırları sona eklenir). `FirstOrDefault(StockCode ==)` ile eşleştirilince
            // aynı üründen ikinci kalem (farklı montaj/not seçeneğiyle) İLK kalemin indirimini
            // kopyalıyordu. Stok kodu başına sıra kuyruğu tutulup birebir eşleştiriliyor;
            // `group` aşağıda istek listesiyle aynı sırada dolaşılıyor.
            var evalLineQueues = new Dictionary<string, Queue<EvaluateSalesOrderLineResponse>>(StringComparer.OrdinalIgnoreCase);
            foreach (var el in evalResponse?.Lines ?? new List<EvaluateSalesOrderLineResponse>())
            {
                var elCode = el.StockCode ?? string.Empty;
                if (!evalLineQueues.TryGetValue(elCode, out var queue))
                {
                    queue = new Queue<EvaluateSalesOrderLineResponse>();
                    evalLineQueues[elCode] = queue;
                }
                queue.Enqueue(el);
            }

            foreach (var l in group)
            {
                var stockCode = l.Product?.StockCode ?? string.Empty;
                var key = l.Key ?? string.Empty;
                EvaluateSalesOrderLineResponse? evalLine = null;
                if (evalLineQueues.TryGetValue(stockCode, out var stockQueue) && stockQueue.Count > 0)
                {
                    evalLine = stockQueue.Dequeue();
                }

                var isGift = (evalLine?.IsGift ?? false) || (l.IsGift ?? false);

                // Motor TL döndürür; `UserBasketItem.DiscountAmount` satırın KENDİ para
                // biriminde saklanır (`UnitPrice` ile aynı birim) — sepet raporu da öyle okur.
                // İstemciden gelen `l.DiscountAmount` zaten satırın parasındadır, çevrilmez.
                var lineRate = RateOfKey(key);
                var lineDisc = !isGift && evalLine != null && evalLine.DiscountAmount > 0
                    ? evalLine.DiscountAmount / lineRate
                    : (!isGift ? (l.DiscountAmount ?? 0m) : 0m);

                string lineCampTitle = string.Empty;
                if (isGift)
                {
                    lineCampTitle = !string.IsNullOrWhiteSpace(l.CampaignTitle)
                        ? l.CampaignTitle
                        : (!string.IsNullOrWhiteSpace(globalCampaignTitle) ? globalCampaignTitle : "Hediye Ürün");
                }
                else if (lineDisc > 0 || (l.DiscountRate ?? 0m) > 0)
                {
                    var matchingCampaigns = campaignDetails
                        .Where(cd =>
                        {
                            if (string.IsNullOrWhiteSpace(cd.StockCodesJson)) return false;
                            try
                            {
                                var codes = System.Text.Json.JsonSerializer.Deserialize<List<string>>(cd.StockCodesJson);
                                return codes != null && codes.Any(c =>
                                    string.Equals(c, stockCode, StringComparison.OrdinalIgnoreCase));
                            }
                            catch { return false; }
                        })
                        .Select(cd => cd.CampaignName)
                        .Where(n => !string.IsNullOrWhiteSpace(n))
                        .Distinct()
                        .ToList();

                    if (matchingCampaigns.Count > 0)
                        lineCampTitle = string.Join(", ", matchingCampaigns);
                    else if (!string.IsNullOrWhiteSpace(l.CampaignTitle))
                        lineCampTitle = l.CampaignTitle;
                    else if (!string.IsNullOrWhiteSpace(globalCampaignTitle))
                        lineCampTitle = globalCampaignTitle;
                }

                var custName = string.IsNullOrWhiteSpace(l.Dealer?.Label) ? custCode : l.Dealer.Label.Trim();
                var vatRate = (isAcik || isAskeriye) ? 0m : (l.Product?.KdvRate ?? 0m);

                if (existingByKey.TryGetValue(key, out var existing))
                {
                    // UPDATE existing row
                    existing.Quantity = l.Qty;
                    existing.UnitPrice = l.Product?.UnitPrice ?? existing.UnitPrice;
                    existing.VatRate = vatRate;
                    existing.Note = l.Note ?? existing.Note;
                    existing.CampaignTitle = lineCampTitle;
                    existing.DiscountAmount = lineDisc;
                    existing.DiscountRate = l.DiscountRate ?? existing.DiscountRate;
                    existing.IsGift = isGift;

                    // Montaj seçimi de güncellenir: satırda "Montaj istiyorum" seçilince anahtar aynı
                    // kalıyor (…::Montaj istemiyorum.) ama seçim değişiyor. Bu alan eskiden hiç
                    // güncellenmiyordu; sepet sunucudan yeniden yüklenince satır "istemiyorum"a
                    // dönüyor, montaj formu da düşüyordu.
                    if (!string.IsNullOrWhiteSpace(l.Montaj)) existing.Montaj = l.Montaj;

                    // MONTAJ BİLGİSİ (2026-10-13): montaj istenmiyorsa temizlenir; istenip form
                    // geldiyse yazılır; form gelmediyse (eski istemci) mevcut kayıt KORUNUR.
                    if (!WantsMontaj(l.Montaj))
                    {
                        existing.MontajSnapshotJson = null;
                    }
                    else if (MontajJsonOf(l) is { } montajJson)
                    {
                        existing.MontajSnapshotJson = montajJson;
                    }
                    if (Guid.TryParse(l.LineageId, out var lineageId)) existing.LineageId = lineageId;
                    /*
                      CARİ ALANLARI DA TAZELENİR (2026-08-26).

                      Bu dal `CustomerCode` ve `CustomerName` alanlarına HİÇ dokunmuyordu:
                      bir satır ilk hangi cariyle oluştuysa sonsuza kadar orada kalıyordu.
                      Şube seçilip aynı ürün yeniden eklendiğinde satır güncelleniyor ama
                      cari kodu eski değerinde donuyor, sepet o şubede görünmüyordu.

                      Anahtar (`Key`) zaten cari kodunu içeriyor, dolayısıyla normalde farklı
                      cari = farklı satır. Bu tazeleme, anahtarı eski biçimde yazılmış
                      satırların da doğru cariye taşınmasını sağlar.
                    */
                    existing.CustomerCode = custCode;
                    existing.CustomerName = custName;
                    existing.UpdateTime = now;
                    existing.Username = username;
                }
                else
                {
                    // INSERT new row
                    _dbContext.UserBasketItems.Add(new UserBasketItem
                    {
                        Id = Guid.NewGuid(),
                        CustomerCode = custCode,
                        CustomerName = custName,
                        Username = username,
                        ProductId = l.Product?.Id ?? string.Empty,
                        StockCode = stockCode,
                        ProductName = l.Product?.Name ?? string.Empty,
                        Quantity = l.Qty,
                        UnitPrice = l.Product?.UnitPrice ?? 0m,
                        VatRate = vatRate,
                        Currency = l.Product?.Currency ?? string.Empty,
                        Montaj = l.Montaj ?? string.Empty,
                        Note = l.Note ?? string.Empty,
                        Key = key,
                        CampaignTitle = lineCampTitle,
                        DiscountAmount = lineDisc,
                        DiscountRate = l.DiscountRate ?? 0m,
                        IsGift = (evalLine?.IsGift ?? false) || (l.IsGift ?? false),
                        MontajSnapshotJson = WantsMontaj(l.Montaj) ? MontajJsonOf(l) : null,
                        LineageId = Guid.TryParse(l.LineageId, out var newLineageId) ? newLineageId : null,
                        CreateTime = now,
                        UpdateTime = now
                    });
                }
            }
        }

        await _dbContext.SaveChangesAsync(cancellationToken);

        // Kullanıcının sepetten TEK TEK çıkardığı kalemler. Ana kayıttan sonra yazılır.
        await LogBasketDeletionAsync("Sepetten kalem çıkarma", basketSilinenler, cancellationToken);

        return Ok(new { success = true, count = validLines.Count });
    }

    [HttpGet("my-basket")]
    public async Task<IActionResult> GetMyBasket(CancellationToken cancellationToken)
    {
        var username = User.Identity?.Name ?? "Kullanıcı";
        var userCariCode = User.FindFirst("Carikodu")?.Value?.Trim();

        var query = _dbContext.UserBasketItems.AsNoTracking().AsQueryable();
        if (!string.IsNullOrWhiteSpace(userCariCode))
            query = query.Where(x => x.CustomerCode == userCariCode || x.Username == username);
        else
            query = query.Where(x => x.Username == username);

        var items = await query.OrderByDescending(x => x.UpdateTime).ToListAsync(cancellationToken);
        return Ok(new { success = true, data = await EnrichBasketItemsWithProductData(items, cancellationToken) });
    }

    [HttpGet("customer-basket")]
    public async Task<IActionResult> GetCustomerBasket([FromQuery] string customerCode, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(customerCode))
            return BadRequest(new { success = false, message = "CustomerCode is required" });

        var targetCode = customerCode.Trim();

        // CARİ KAPSAMI. Uç, `customerCode`u doğrudan istekten alıp hiçbir kontrol yapmıyordu:
        // bir bayi başka bir bayinin kodunu yazarak onun CANLI sepetini, ürün adetlerini ve
        // sipariş notlarını okuyabiliyordu. Sözleşme gereği kapsamı BOŞ / '*' / 'ALL' olan
        // iç personel her cariyi görmeye devam eder; yalnız kapsamlı hesaplar sınırlanır.
        if (!B2B.Erp.Api.Core.Authorization.CustomerScope.IsUnrestrictedFor(User))
        {
            var scopeCodes = B2B.Erp.Api.Core.Authorization.CustomerScope.Of(User);
            var allowedCodes = await B2B.Erp.Api.Core.Authorization.CustomerScope.ExpandAsync(
                _dbContext.Customers.AsNoTracking(), scopeCodes, cancellationToken);

            if (!allowedCodes.Contains(targetCode, StringComparer.OrdinalIgnoreCase))
            {
                return StatusCode(StatusCodes.Status403Forbidden, new
                {
                    success = false,
                    message = "Bu cariye erişim yetkiniz yok."
                });
            }
        }

        /*
          SEPET SEÇİLİ CARİYE AİTTİR — BİREBİR EŞLEŞME (2026-08-26, kullanıcı kararı:
          "her şubenin sepeti ayrı gelmeli, kim seçildiyse o gelmeli").

          Kısa süre önce burada aile bazlı (ana cari + şubeler) arama denendi; şubelerin
          sepetini tek sepette birleştirdiği için geri alındı. Sepetin sahibi TESLİM
          CARİSİDİR: şube seçiliyse şubenin sepeti gelir, ana cari seçiliyse ana carinin.

          Siparişin/faturanın nereye kesildiği BU ALANDAN OKUNMUYOR — sipariş gövdesi
          ekranın kendi `cariKodu`/`teslimCariKodu` alanlarından kuruluyor
          (SiparisCartSection). Yani sepetin anahtarı, paranın ana bayiye yazılmasını
          etkilemez; ekstredeki "Teslim Cari" ayrımı olduğu gibi kalır.
        */
        var items = await _dbContext.UserBasketItems
            .AsNoTracking()
            .Where(x => x.CustomerCode == targetCode)
            .OrderByDescending(x => x.UpdateTime)
            .ToListAsync(cancellationToken);

        return Ok(new { success = true, data = await EnrichBasketItemsWithProductData(items, cancellationToken) });
    }

    private async Task<List<object>> EnrichBasketItemsWithProductData(List<UserBasketItem> items, CancellationToken cancellationToken)
    {
        if (items.Count == 0) return new List<object>();

        var stockCodes = items.Select(x => x.StockCode).Where(x => !string.IsNullOrEmpty(x)).Distinct().ToList();

        var products = await _dbContext.Products
            .AsNoTracking()
            .Where(p => stockCodes.Contains(p.StockCode))
            .Select(p => new { p.StockCode, p.ImageUrl, p.IsInstallable, p.InstallationFee })
            .ToListAsync(cancellationToken);

        var productMap = products.ToDictionary(p => p.StockCode, p => p, StringComparer.OrdinalIgnoreCase);

        return items.Select(x =>
        {
            productMap.TryGetValue(x.StockCode, out var p);
            return (object)new
            {
                x.Id,
                x.CustomerCode,
                x.CustomerName,
                x.Username,
                x.ProductId,
                x.StockCode,
                x.ProductName,
                x.Quantity,
                x.UnitPrice,
                x.VatRate,
                x.Currency,
                x.Montaj,
                x.Note,
                x.Key,
                x.CampaignTitle,
                x.DiscountAmount,
                x.DiscountRate,
                x.IsGift,
                x.CreateTime,
                x.UpdateTime,
                // Montaj formu sunucudan da gelir: yerel kopya yoksa (başka cihaz, temizlenmiş
                // tarayıcı) istemci bunu kullanır.
                montajDetails = ParseMontaj(x.MontajSnapshotJson),
                lineageId = x.LineageId,
                imageUrl = p?.ImageUrl,
                isInstallable = p?.IsInstallable ?? false,
                installationFee = p?.InstallationFee
            };
        }).ToList();
    }

    [HttpDelete("clear")]
    public async Task<IActionResult> Clear([FromQuery] string? customerCode, CancellationToken cancellationToken)
    {
        var username = User.Identity?.Name ?? "Kullanıcı";
        var query = _dbContext.UserBasketItems.AsQueryable();

        if (!string.IsNullOrWhiteSpace(customerCode))
        {
            var targetCode = customerCode.Trim();
            // YALNIZ O CARİ (2026-09-27). `|| Username == username` bu kullanıcının BÜTÜN carilerdeki
            // sepetlerini de siliyordu. Uç bugün çağrılmıyor ama açık kalmasın.
            query = query.Where(x => x.CustomerCode == targetCode);
        }
        else
        {
            query = query.Where(x => x.Username == username);
        }

        var items = await query.ToListAsync(cancellationToken);
        if (items.Count > 0)
        {
            _dbContext.UserBasketItems.RemoveRange(items);
            await _dbContext.SaveChangesAsync(cancellationToken);
            await LogBasketDeletionAsync("Sepet temizleme ucu (/baskets/clear)", items, cancellationToken);
        }

        return Ok(new { success = true, removed = items.Count });
    }

    private static System.Text.Json.JsonElement? ParseMontaj(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return null;
        try
        {
            using var doc = System.Text.Json.JsonDocument.Parse(json);
            return doc.RootElement.Clone();
        }
        catch (System.Text.Json.JsonException)
        {
            return null;
        }
    }
}
