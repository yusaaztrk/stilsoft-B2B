using B2B.Erp.Api.Core.Authorization;
using B2B.Erp.Api.Data;
using B2B.Erp.Api.Entities;
using B2B.Erp.Api.Features.Currency;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using System.ComponentModel.DataAnnotations;

namespace B2B.Erp.Api.Controllers;

/// <summary>
/// TOPLU FİYAT ATAMA.
///
/// Referans: "KIBRIS fiyat guncelle.xlsm" (NETSIS sayfası). Excel'deki zincir birebir
/// buraya taşındı; ekranda görünen her sayı bu kurallardan çıkar.
///
/// MALİYET (bilgi amaçlı, ekranda hesaplanır — kalıcı DEĞİL):
///   adet başı navlun = navlun USD / konteyner adedi
///   birim maliyet USD = alış USD + adet başı navlun
///   maliyet TL       = birim maliyet USD * USD kuru
///   maliyet KDV dahil = maliyet TL * (1 + KDV/100)
///
/// SATIŞ FİYATLARI — hepsi FİYAT-4'ten türer (Excel'de SATIŞ 1):
///   Fiyat 4 = kullanıcının girdiği değer (KDV DAHİL)
///   Fiyat 6 = Fiyat 4 * (1 - iskonto/100)
///   Fiyat 5 = Fiyat 6 * 1.1
///   Fiyat 1 = Fiyat 4 / (1 + KDV/100)      (KDV hariç karşılıkları)
///   Fiyat 2 = Fiyat 5 / (1 + KDV/100)
///   Fiyat 3 = Fiyat 6 / (1 + KDV/100)
///
/// KÂR ORANI = (Fiyat 6 - maliyet KDV dahil) / maliyet KDV dahil
///
/// NEDEN SUNUCUDA TEKRAR HESAPLANIYOR: ekran da aynı hesabı yapıp önizleme gösteriyor,
/// ama kaydederken istemciden gelen türev fiyatlara GÜVENİLMEZ. Sunucu yalnızca Fiyat 4'ü
/// kabul eder, kalan beş fiyatı ürünün kendi KDV ve iskonto oranından yeniden üretir.
/// Böylece ekran ile veritabanı asla ayrışmaz.
///
/// ŞEMA DEĞİŞİKLİĞİ YOK: yalnızca mevcut ProductPrices satırları güncellenir/eklenir.
/// Maliyet girdileri (alış USD, navlun, konteyner adedi, kur) ekranda tutulur, saklanmaz.
/// </summary>
[ApiController]
[Route("api/[controller]")]
[Authorize]
public sealed class BulkPricingController : ControllerBase
{
    private readonly AppDbContext _dbContext;
    private readonly ICurrencyRateService _currencyService;
    private readonly ILogger<BulkPricingController> _logger;

    /// <summary>Fiyat 5, Fiyat 6'nın bu katıdır (Excel: AJ = AK * 1.1).</summary>
    private const decimal Price5Multiplier = 1.1m;

    public BulkPricingController(
        AppDbContext dbContext,
        ICurrencyRateService currencyService,
        ILogger<BulkPricingController> logger)
    {
        _dbContext = dbContext;
        _currencyService = currencyService;
        _logger = logger;
    }

    /// <summary>
    /// Ürünün ALIŞ para birimi. 2026-08-14'ten beri sistemdeki tek kodlama:
    /// 1=TRY 2=EUR 3=USD 4=GBP (0 = TL, kolon varsayılanı).
    /// Öncesinde ürün kartı ayrı bir kodlama kullanıyordu (43=USD, 3=GBP) ve `3`
    /// iki dünyada iki farklı para birimi anlamına geliyordu.
    /// </summary>
    private static string PurchaseCurrencyOf(int currencyCode)
        => B2B.Erp.Api.Core.Helpers.ProductCurrencyHelper.MapCurrencyTypeIdToIsoCode(currencyCode);

    /// <summary>
    /// Fiyat 4'ten türeyen altı fiyatı üretir. Tek kaynak: hem önizleme hem kayıt buradan.
    /// </summary>
    public static (decimal p1, decimal p2, decimal p3, decimal p4, decimal p5, decimal p6)
        DerivePrices(decimal price4, decimal taxRate, decimal discountRate)
    {
        var kdvDivisor = 1m + (taxRate / 100m);
        if (kdvDivisor <= 0m) kdvDivisor = 1m;

        var p4 = Math.Round(price4, 2, MidpointRounding.AwayFromZero);
        var p6 = Math.Round(p4 - (p4 * discountRate / 100m), 2, MidpointRounding.AwayFromZero);
        var p5 = Math.Round(p6 * Price5Multiplier, 2, MidpointRounding.AwayFromZero);

        var p1 = Math.Round(p4 / kdvDivisor, 2, MidpointRounding.AwayFromZero);
        var p2 = Math.Round(p5 / kdvDivisor, 2, MidpointRounding.AwayFromZero);
        var p3 = Math.Round(p6 / kdvDivisor, 2, MidpointRounding.AwayFromZero);

        return (p1, p2, p3, p4, p5, p6);
    }

    [HttpGet("products")]
    public async Task<IActionResult> GetProducts(
        [FromQuery] string? q,
        [FromQuery] string? mainCategory,
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 100,
        [FromQuery] bool includeInactive = false,
        CancellationToken cancellationToken = default)
    {
        if (page < 1) page = 1;
        if (pageSize < 1 || pageSize > 1000) pageSize = 100;

        // Varsayılan yalnızca AKTİF ürünler (264 üründen 161'i). Pasif ürünlerin de fiyatı
        // güncellenebilmeli — yeniden satışa açılabilirler — o yüzden isteğe bağlı dahil edilir.
        //
        // DİKKAT: `IsActive` ile `BsyVisibleFlag` (Satışa Açık E/H) FARKLI şeylerdir.
        // Veride 2 aktif ürün "H", 5 pasif ürün "E" — biri diğerinin yerine kullanılamaz.
        var query = _dbContext.Products.AsNoTracking();
        if (!includeInactive)
        {
            query = query.Where(x => x.IsActive);
        }

        var term = (q ?? string.Empty).Trim();
        if (term.Length > 0)
        {
            var like = $"%{term}%";
            query = query.Where(x => EF.Functions.ILike(x.StockCode, like) || EF.Functions.ILike(x.Name, like));
        }

        var cat = (mainCategory ?? string.Empty).Trim();
        if (cat.Length > 0)
        {
            var categoryIds = await _dbContext.ProductCategories
                .AsNoTracking()
                .Where(c => c.Key == cat)
                .Select(c => c.Id)
                .ToListAsync(cancellationToken);

            query = query.Where(x => x.MainCategoryId.HasValue && categoryIds.Contains(x.MainCategoryId.Value));
        }

        var total = await query.CountAsync(cancellationToken);

        var products = await query
            .OrderBy(x => x.StockCode)
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .Select(x => new
            {
                x.Id,
                x.StockCode,
                x.Name,
                x.TaxRate,
                x.DiscountRate,
                x.MainCategoryId,
                x.CategoryId,
                // Maliyet girdileri ZATEN ürün kartında duruyor; ekranda elle girilmesine gerek yok.
                x.PurchasePrice,
                x.CurrencyCode,
                x.ContainerQuantity,
                x.BoxQuantity,
                // Navlun ZATEN ürün kartında; ekranda sabit 3000 varsayılmasına gerek yok.
                x.Freight,
                x.BsyVisibleFlag,
                x.IsActive,
                x.SupplierId,
                // Ürün kartındaki toplam stok: TÜM depoları kapsar (pasif olanlar dahil).
                x.Stock
            })
            .ToListAsync(cancellationToken);

        var productIds = products.Select(x => x.Id).ToList();

        var priceGroups = await _dbContext.PriceGroups
            .AsNoTracking()
            .Select(x => new { x.Id, x.Code })
            .ToListAsync(cancellationToken);
        var codeById = priceGroups.ToDictionary(x => x.Id, x => x.Code);

        var priceRows = await _dbContext.ProductPrices
            .AsNoTracking()
            .Where(x => productIds.Contains(x.ProductId))
            .Select(x => new { x.ProductId, x.PriceGroupId, x.Price })
            .ToListAsync(cancellationToken);

        var pricesByProduct = priceRows
            .GroupBy(x => x.ProductId)
            .ToDictionary(
                g => g.Key,
                g => g.Where(x => codeById.ContainsKey(x.PriceGroupId))
                      .ToDictionary(x => codeById[x.PriceGroupId], x => x.Price));

        /*
          TERMİNDEKİ MİKTAR (2026-08-31 kullanıcı isteği: "termin diye bir kolon gelsin").
          Yalnızca SAYFADAKİ ürünler için tek sorgu — ürün başına sorgu açmak 100 satırlık
          sayfada 100 gidiş dönüş olurdu. Kırılım ayrı uçta, satıra tıklanınca çekiliyor.
        */
        var terminMiktarlari = await B2B.Erp.Api.Core.Services.TerminStockQuery.ToplamlarAsync(
            _dbContext,
            products.Select(x => x.StockCode).Where(x => !string.IsNullOrWhiteSpace(x)).ToList(),
            cancellationToken);

        /*
          TOPLAM STOK — STOK HAREKETLERİNDEN, `Products.Stock`'tan DEĞİL (2026-09-03).

          `Products.Stock` bir `int` önbellek; on kadar ayrı kod yolu onu `(int)Math.Round(...)`
          ile artırıp azaltıyor, bazı yollar (depo transferi vb.) hiç dokunmuyor. Kesirli /
          yuvarlanan miktarlarda gerçek `StockMovement` toplamından kayıyor ("kart 99, gerçek
          100" şikâyeti). Bu ekran (ve Depo Stok Dağılımı penceresi) artık TÜM depoların
          (pasif dahil) ham hareket toplamını gösteriyor — depo kırılımı penceresiyle bire bir
          oturuyor, "kart sapmış" uyarısına gerek kalmıyor.
        */
        var stokKodlari = products.Select(x => x.StockCode).Where(x => !string.IsNullOrWhiteSpace(x)).Distinct().ToList();
        var hareketToplamlari = stokKodlari.Count == 0
            ? new Dictionary<string, decimal>(StringComparer.OrdinalIgnoreCase)
            : (await _dbContext.Set<StockMovement>()
                    .AsNoTracking()
                    .Where(x => stokKodlari.Contains(x.StockCode))
                    .GroupBy(x => x.StockCode)
                    .Select(g => new
                    {
                        StockCode = g.Key,
                        Net = g.Sum(x => x.Direction == StockMovementDirection.In ? x.Quantity : -x.Quantity)
                    })
                    .ToListAsync(cancellationToken))
                .ToDictionary(x => x.StockCode, x => x.Net, StringComparer.OrdinalIgnoreCase);

        // Tedarikçi adları — ürün kartındaki SupplierId üzerinden.
        var supplierIds = products.Where(x => x.SupplierId.HasValue).Select(x => x.SupplierId!.Value).Distinct().ToList();
        var suppliers = await _dbContext.Suppliers
            .AsNoTracking()
            .Where(x => supplierIds.Contains(x.Id))
            .Select(x => new { x.Id, x.SupplierCode, x.FullName })
            .ToListAsync(cancellationToken);
        var supplierById = suppliers.ToDictionary(x => x.Id, x => x);

        // ÖNCEKİ FİYAT (Fiyat 4). Ekranda "ne kadardan ne kadara + tarih" gösterilir.
        var historyRows = await _dbContext.ProductPriceHistories
            .AsNoTracking()
            .Where(x => productIds.Contains(x.ProductId) && x.PriceGroupCode == 4)
            .OrderByDescending(x => x.ChangedAt)
            .Select(x => new { x.ProductId, x.OldPrice, x.NewPrice, x.ChangedAt, x.ChangedBy })
            .ToListAsync(cancellationToken);

        // Yalnızca EN SON değişiklik tutulur: ekranda tek 'Önceki Fiyat' kolonu var.
        var historyByProduct = historyRows
            .GroupBy(x => x.ProductId)
            .ToDictionary(g => g.Key, g => g.Take(1).ToList());

        var categoryList = await _dbContext.ProductCategories
            .AsNoTracking()
            .Select(c => new { c.Id, c.Key, c.Name })
            .ToListAsync(cancellationToken);
        var catKeyById = categoryList.ToDictionary(x => x.Id, x => x.Key);
        var catNameById = categoryList.ToDictionary(x => x.Id, x => x.Name);

        // ANLIK KUR — sistemden (TCMB). Ekranda elle kur girilmiyor; alış fiyatı hangi para
        // biriminde tutuluyorsa onun güncel TL karşılığı kullanılır. TL alışta kur 1'dir.
        var rateByCurrency = new Dictionary<string, decimal>(StringComparer.OrdinalIgnoreCase)
        {
            ["TRY"] = 1m
        };
        DateTime? rateDate = null;
        string? rateWarning = null;
        string rateProvider = "-";
        var fallbackSeen = false;

        try
        {
            var rates = await _currencyService.GetLatestRatesAsync(cancellationToken);
            foreach (var rate in rates ?? new List<CurrencyRateDto>())
            {
                // Maliyet hesabında SATIŞ kuru kullanılır: ürünü almak için döviz satın alınır.
                var value = rate.SellingRate > 0 ? rate.SellingRate : rate.BuyingRate;
                if (value > 0)
                {
                    rateByCurrency[rate.CurrencyCode] = value;
                    if (rateDate is null || rate.RateDate > rateDate) rateDate = rate.RateDate;

                    // TRY'nin sağlayıcısı her zaman "System" (kur 1, dış kaynak yok). Sağlayıcıyı
                    // ondan okursak gerçek durumu kaçırırız; yalnızca DÖVİZ satırlarına bakılır.
                    if (!string.Equals(rate.CurrencyCode, "TRY", StringComparison.OrdinalIgnoreCase)
                        && !string.IsNullOrWhiteSpace(rate.Provider))
                    {
                        rateProvider = rate.Provider;
                        if (string.Equals(rate.Provider, "Fallback", StringComparison.OrdinalIgnoreCase))
                        {
                            fallbackSeen = true;
                        }
                    }
                }
            }

            // TCMB'ye ulaşılamazsa servis SESSİZCE sabit kurlara düşüyor (Provider="Fallback").
            // Bu kurlar gerçek değil ve fiyatlandırmada kullanılırsa maliyet/kâr yanlış çıkar.
            // Sessiz kalmak yerine ekrana taşınıyor.
            if (fallbackSeen)
            {
                rateWarning =
                    "TCMB'ye ulaşılamadı; SABİT YEDEK kurlar kullanılıyor. Maliyet ve kâr oranları " +
                    "gerçek kuru yansıtmaz — fiyat onaylamadan önce kurları doğrulayın.";
            }
        }
        catch (Exception ex)
        {
            // Kur alınamazsa maliyet hesaplanamaz; satırlar yine döner ama uyarı ile.
            _logger.LogWarning(ex, "Toplu fiyat atama: güncel kurlar alınamadı");
            rateWarning = "Güncel kurlar alınamadı; döviz alışlı ürünlerde maliyet hesaplanamadı.";
        }

        var items = products.Select(p =>
        {
            pricesByProduct.TryGetValue(p.Id, out var map);
            decimal Get(int code) => map != null && map.TryGetValue(code, out var v) ? v : 0m;

            var purchaseCurrency = PurchaseCurrencyOf(p.CurrencyCode);
            rateByCurrency.TryGetValue(purchaseCurrency, out var usedRate);

            // Birim maliyet: alış fiyatı + adet başı navlun. Navlun ekrandan gelir (konteyner
            // başına), burada yalnızca ürünün kendi alış maliyeti TL'ye çevrilir.
            decimal? purchaseTry = null;
            if (p.PurchasePrice > 0m && usedRate > 0m)
            {
                purchaseTry = p.PurchasePrice * usedRate;
            }

            var subCategoryName = p.CategoryId.HasValue && catNameById.TryGetValue(p.CategoryId.Value, out var sn) && !string.IsNullOrWhiteSpace(sn)
                ? sn
                : (p.CategoryId.HasValue && catKeyById.TryGetValue(p.CategoryId.Value, out var sk) ? sk : null);

            return new
            {
                id = p.Id,
                stockCode = p.StockCode,
                name = p.Name,
                taxRate = (decimal)p.TaxRate,
                discountRate = p.DiscountRate,
                mainCategory = p.MainCategoryId.HasValue && catKeyById.ContainsKey(p.MainCategoryId.Value)
                    ? catKeyById[p.MainCategoryId.Value]
                    : null,
                subCategory = subCategoryName,

                // Veritabanındaki maliyet girdileri
                purchasePrice = p.PurchasePrice,
                purchaseCurrency,
                containerQuantity = p.ContainerQuantity,
                boxQuantity = p.BoxQuantity,
                freight = p.Freight,
                isActive = p.IsActive,
                totalStock = hareketToplamlari.TryGetValue(p.StockCode ?? string.Empty, out var netStok)
                    ? netStok
                    : (decimal)p.Stock,
                // Teslim alınmamış alış siparişlerindeki miktar; stoğa henüz girmemiştir.
                terminQuantity = terminMiktarlari.TryGetValue(p.StockCode ?? string.Empty, out var trm) ? trm : 0m,
                supplierCode = p.SupplierId.HasValue && supplierById.ContainsKey(p.SupplierId.Value)
                    ? supplierById[p.SupplierId.Value].SupplierCode
                    : null,
                supplierName = p.SupplierId.HasValue && supplierById.ContainsKey(p.SupplierId.Value)
                    ? supplierById[p.SupplierId.Value].FullName
                    : null,
                // En son Fiyat 4 değişikliği (tek kayıt).
                priceHistory = historyByProduct.TryGetValue(p.Id, out var hist)
                    ? hist.Select(h => new
                      {
                          oldPrice = h.OldPrice,
                          newPrice = h.NewPrice,
                          changedAt = h.ChangedAt,
                          changedBy = h.ChangedBy
                      }).ToList<object>()
                    : new List<object>(),
                saleOpen = string.Equals((p.BsyVisibleFlag ?? string.Empty).Trim(), "E", StringComparison.OrdinalIgnoreCase) ? "E" : "H",
                // Kullanılan anlık kur ve alışın TL karşılığı
                usedRate,
                purchasePriceTry = purchaseTry,

                price1 = Get(1),
                price2 = Get(2),
                price3 = Get(3),
                price4 = Get(4),
                price5 = Get(5),
                price6 = Get(6)
            };
        }).ToList();

        return Ok(new
        {
            success = true,
            data = new
            {
                items,
                total,
                page,
                pageSize,
                rates = rateByCurrency,
                rateDate,
                rateWarning,
                rateProvider
            }
        });
    }

    /// <summary>Ekrandaki kategori süzgeci için ana kategori listesi.</summary>
    [HttpGet("categories")]
    public async Task<IActionResult> GetCategories(CancellationToken cancellationToken)
    {
        var usedIds = await _dbContext.Products
            .AsNoTracking()
            .Where(x => x.MainCategoryId.HasValue)
            .Select(x => x.MainCategoryId!.Value)
            .Distinct()
            .ToListAsync(cancellationToken);

        var cats = await _dbContext.ProductCategories
            .AsNoTracking()
            .Where(c => usedIds.Contains(c.Id))
            .OrderBy(c => c.Key)
            .Select(c => new { key = c.Key, name = c.Name })
            .ToListAsync(cancellationToken);

        return Ok(new { success = true, data = cats });
    }

    public sealed class ApplyItem
    {
        [Required]
        public Guid ProductId { get; set; }

        /// <summary>Yeni Fiyat 4 (KDV DAHİL). Diğer beş fiyat bundan türetilir.</summary>
        [Range(0, double.MaxValue)]
        public decimal Price4 { get; set; }
    }

    public sealed class ApplyRequest
    {
        [MinLength(1)]
        public List<ApplyItem> Items { get; set; } = new();
    }

    public sealed class UpdateProductCostRequest
    {
        [Range(0, double.MaxValue)] public decimal PurchasePrice { get; set; }
        /// <summary>
        /// Ürünün ALIŞ para birimi: 1=TRY 2=EUR 3=USD 4=GBP (0 = TL, eski varsayılan).
        ///
        /// <para>
        /// Burada eskiden "43=USD, 3=GBP" yazıyordu — göç ettirilmiş ESKİ kodlama. Belge
        /// güncellenmemişti ve tehlikeliydi: <c>3</c>'ü sterlin sanıp gönderen bir istemci
        /// doğrulamadan geçer ve maliyeti sessizce DOLAR olarak yazardı. Doğrulama zaten
        /// <see cref="B2B.Erp.Api.Core.Helpers.CurrencyTypeHelper"/> kodlamasını uyguluyor.
        /// </para>
        /// </summary>
        public int CurrencyCode { get; set; }
        [Range(0, int.MaxValue)] public int ContainerQuantity { get; set; }
        [Range(0, int.MaxValue)] public int BoxQuantity { get; set; }
        [Range(0, double.MaxValue)] public decimal Freight { get; set; }
        /// <summary>Satışa açık mı — "E" / "H".</summary>
        public string? SaleOpen { get; set; }
    }

    /// <summary>
    /// Ürün kartındaki MALİYET alanlarını günceller. Fiyatlara dokunmaz — onlar `apply`
    /// ucundan, kendi geçmiş kaydıyla birlikte değişir.
    /// </summary>
    [AuthorizePage("users", "topluFiyatAtama")]
    [HttpPut("product/{id:guid}/cost")]
    public async Task<IActionResult> UpdateProductCost(
        [FromRoute] Guid id,
        [FromBody] UpdateProductCostRequest request,
        CancellationToken cancellationToken)
    {
        var product = await _dbContext.Products.FirstOrDefaultAsync(x => x.Id == id, cancellationToken);
        if (product is null)
        {
            return NotFound(new { success = false, message = "Ürün bulunamadı." });
        }

        if (!B2B.Erp.Api.Core.Helpers.ProductCurrencyHelper.IsValid(request.CurrencyCode))
        {
            return BadRequest(new { success = false, message = "Geçersiz para birimi kodu." });
        }

        product.PurchasePrice = request.PurchasePrice;
        product.CurrencyCode = request.CurrencyCode;
        product.ContainerQuantity = request.ContainerQuantity;
        product.BoxQuantity = request.BoxQuantity;
        product.Freight = request.Freight;

        var flag = (request.SaleOpen ?? string.Empty).Trim().ToUpperInvariant();
        if (flag == "E" || flag == "H")
        {
            // Pasif ürün her koşulda satışa kapalıdır (kullanıcı kuralı, 2026-08-12) — ürün
            // kartındaki uçta da aynısı zorlanıyor. Bu uç IsActive'e dokunmuyor, kayıtlı
            // değere bakıyoruz: pasif bir ürüne toplu ekrandan "E" yazılabilseydi kural
            // yalnızca ürün kartından geçenler için işlerdi.
            product.BsyVisibleFlag = product.IsActive ? flag : "H";
        }

        await _dbContext.SaveChangesAsync(cancellationToken);
        return Ok(new { success = true });
    }

    [AuthorizePage("users", "topluFiyatAtama")]
    [HttpPost("apply")]
    public async Task<IActionResult> Apply([FromBody] ApplyRequest request, CancellationToken cancellationToken)
    {
        var items = (request.Items ?? new List<ApplyItem>())
            .Where(x => x.ProductId != Guid.Empty && x.Price4 > 0m)
            .GroupBy(x => x.ProductId)
            .Select(g => g.Last())
            .ToList();

        if (items.Count == 0)
        {
            return BadRequest(new { success = false, message = "Güncellenecek satır yok." });
        }

        var ids = items.Select(x => x.ProductId).ToList();

        var products = await _dbContext.Products
            .Where(x => ids.Contains(x.Id))
            .Select(x => new { x.Id, x.StockCode, x.TaxRate, x.DiscountRate, x.SalesCurrencyCode })
            .ToListAsync(cancellationToken);

        var productById = products.ToDictionary(x => x.Id, x => x);

        var missing = ids.Where(x => !productById.ContainsKey(x)).ToList();
        if (missing.Count > 0)
        {
            return BadRequest(new { success = false, message = $"{missing.Count} ürün bulunamadı." });
        }

        // SÜZGEÇ 1-6 İDİ (2026-08-20'de genişletildi).
        //
        // Kod 6'dan büyük gruplar (Askeriye = 7 ve firmaya özel diğerleri) buraya hiç
        // gelmediği için toplu fiyat atamasında ASLA güncellenmiyorlardı: Fiyat 1-6 yeni
        // değerine geçerken Askeriye eski fiyatında kalıyordu.
        var priceGroups = await _dbContext.PriceGroups
            .AsNoTracking()
            .Select(x => new { x.Id, x.Code, x.Formula, x.IsActive })
            .ToListAsync(cancellationToken);

        var groupIdByCode = priceGroups.ToDictionary(x => x.Code, x => x.Id);

        // 1-6 hesabı `DerivePrices`ta gömülü ve üç firmada da formüllerle birebir aynı —
        // dokunulmadı. Kalanlar `PriceGroups.Formula`'dan hesaplanır; formülü olmayan ya da
        // pasif gruba yazılmaz.
        var priceGroupsWithFormula = priceGroups
            .Where(x => x.Code > 6 && x.IsActive && !string.IsNullOrWhiteSpace(x.Formula))
            .ToList();

        var existing = await _dbContext.ProductPrices
            .Where(x => ids.Contains(x.ProductId))
            .ToListAsync(cancellationToken);

        var existingByKey = existing.ToDictionary(x => (x.ProductId, x.PriceGroupId), x => x);

        var updated = 0;
        var applied = new List<object>();

        await using var tx = await _dbContext.Database.BeginTransactionAsync(cancellationToken);

        foreach (var item in items)
        {
            var p = productById[item.ProductId];
            var derived = DerivePrices(item.Price4, p.TaxRate, p.DiscountRate);

            var byCode = new Dictionary<int, decimal>
            {
                [1] = derived.p1,
                [2] = derived.p2,
                [3] = derived.p3,
                [4] = derived.p4,
                [5] = derived.p5,
                [6] = derived.p6
            };

            // KOD 6'DAN SONRAKİ GRUPLAR FORMÜLDEN HESAPLANIR (2026-08-20).
            //
            // Toplu fiyat atama yalnız 1-6'yı yazıyordu; Askeriye (7) eski değerinde kalıyordu.
            // Ürün kartından tek tek düzenlerken güncelleniyor, toplu atamada güncellenmiyordu —
            // aynı ürün iki yoldan farklı sonuç veriyordu.
            //
            // 7'yi "Fiyat 3 ile aynı" diye SABİTLEMEK YANLIŞ OLURDU: formül firmaya göre değişiyor.
            // Doğrulandı — DEMO'da 7 = `F4-400`, 8 = `F4-600`, 9 = `REMOVE_KDV(...-300)`,
            // KKTC/TEST'te ise 7 = `REMOVE_KDV(F4*(1-DISCOUNT/100))`. Bu yüzden kaynak olarak
            // `PriceGroups.Formula` okunuyor.
            //
            // 1-6 formülden DEĞİL `DerivePrices`'tan geliyor: üç firmada da formülleri birebir
            // aynı ve bu yol yıllardır çalışıyor; dokunmadım.
            foreach (var pg in priceGroupsWithFormula)
            {
                if (byCode.ContainsKey(pg.Code)) continue;

                var value = B2B.Erp.Api.Core.Helpers.PriceFormulaEvaluator.Evaluate(pg.Formula, derived.p4, p.TaxRate, p.DiscountRate);
                if (value is null) continue;

                byCode[pg.Code] = Math.Round(value.Value, 2, MidpointRounding.AwayFromZero);
            }

            foreach (var (code, value) in byCode)
            {
                if (!groupIdByCode.TryGetValue(code, out var groupId))
                {
                    continue;
                }

                if (existingByKey.TryGetValue((item.ProductId, groupId), out var row))
                {
                    // Fiyat gerçekten değiştiyse geçmişe yaz. ProductPrices üzerine yazıldığı
                    // için eski değer başka hiçbir yerde kalmıyor.
                    if (row.Price != value)
                    {
                        _dbContext.ProductPriceHistories.Add(new ProductPriceHistory
                        {
                            Id = Guid.NewGuid(),
                            ProductId = item.ProductId,
                            StockCode = p.StockCode,
                            PriceGroupCode = code,
                            OldPrice = row.Price,
                            NewPrice = value,
                            ChangeRate = row.Price > 0m ? (value - row.Price) / row.Price : null,
                            ChangedAt = DateTime.UtcNow,
                            ChangedBy = User.Identity?.Name ?? "System",
                            Source = "TopluFiyatAtama"
                        });
                    }

                    row.Price = value;
                    // Para birimi de eşitlenmeli. Aşağıdaki EKLEME dalı bunu yapıyordu ama
                    // GÜNCELLEME dalı atlanmıştı: ürünün satış dövizi TL'den USD'ye çevrilip
                    // fiyat yeniden atandığında mevcut satırlar "TRY" olarak kalıyor, yani
                    // ürün kartı "USD" derken fiyat satırları TL diyordu. Sistemin kuralı:
                    // `ProductPrices.Currency` HER ZAMAN `Product.SalesCurrencyCode`'u izler.
                    row.Currency = B2B.Erp.Api.Core.Helpers.ProductCurrencyHelper
                        .MapCurrencyTypeIdToIsoCode(p.SalesCurrencyCode);
                }
                else
                {
                    // Fiyat satırının para birimi ÜRÜNÜN SATIŞ DÖVİZİNDEN gelir.
                    // Öncesinde burada sabit "TRY" yazılıydı; ürünü dövizle satmanın
                    // arayüzden hiçbir yolu yoktu ve bütün fiyat satırları TRY kalıyordu.
                    var fresh = new ProductPrice
                    {
                        Id = Guid.NewGuid(),
                        ProductId = item.ProductId,
                        PriceGroupId = groupId,
                        Price = value,
                        Currency = B2B.Erp.Api.Core.Helpers.ProductCurrencyHelper.MapCurrencyTypeIdToIsoCode(p.SalesCurrencyCode)
                    };
                    _dbContext.ProductPrices.Add(fresh);
                    existingByKey[(item.ProductId, groupId)] = fresh;
                }
            }

            updated++;
            applied.Add(new
            {
                productId = item.ProductId,
                stockCode = p.StockCode,
                price1 = derived.p1,
                price2 = derived.p2,
                price3 = derived.p3,
                price4 = derived.p4,
                price5 = derived.p5,
                price6 = derived.p6
            });
        }

        await _dbContext.SaveChangesAsync(cancellationToken);
        await tx.CommitAsync(cancellationToken);

        _logger.LogInformation("Toplu fiyat atama: {Count} ürün güncellendi ({User})", updated, User.Identity?.Name ?? "System");

        return Ok(new { success = true, data = new { updated, applied } });
    }

    /// <summary>
    /// Bir stok kodunun TERMİN kırılımı: hangi alış siparişinde ne kadar bekliyor.
    /// Kolondaki sayıya tıklanınca açılan pencere bunu gösterir.
    ///
    /// Sorgu <see cref="B2B.Erp.Api.Core.Services.TerminStockQuery"/> içinde tek yerde;
    /// yetki ise her ekranın KENDİ sayfa anahtarıyla — bu uç Toplu Fiyat Atama ekranına aittir.
    /// </summary>
    [HttpGet("termin-detay")]
    public async Task<IActionResult> TerminDetay([FromQuery] string stockCode, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(stockCode))
        {
            return BadRequest(new { success = false, message = "Stok kodu zorunludur." });
        }

        var satirlar = await B2B.Erp.Api.Core.Services.TerminStockQuery.KirilimAsync(
            _dbContext, stockCode, cancellationToken);

        // Tedarikçi adı kodla birlikte gösteriliyor: yalnız kod ekranda anlamsız kalıyor.
        var kodlar = satirlar.Select(x => x.SupplierCode).Where(x => !string.IsNullOrWhiteSpace(x)).Distinct().ToList();
        var adlar = await _dbContext.Suppliers
            .AsNoTracking()
            .Where(x => kodlar.Contains(x.SupplierCode))
            .Select(x => new { x.SupplierCode, x.FullName })
            .ToListAsync(cancellationToken);
        var adByKod = adlar
            .GroupBy(x => x.SupplierCode)
            .ToDictionary(g => g.Key, g => g.First().FullName ?? string.Empty);

        var veri = satirlar.Select(x => new
        {
            purchaseInvoiceId = x.PurchaseInvoiceId,
            documentNo = x.DocumentNo,
            date = x.Date,
            supplierCode = x.SupplierCode,
            supplierName = adByKod.TryGetValue(x.SupplierCode ?? string.Empty, out var ad) ? ad : string.Empty,
            quantity = x.Quantity,
            warehouseCode = x.WarehouseCode
        }).ToList();

        return Ok(new
        {
            success = true,
            data = new { stockCode, totalQuantity = satirlar.Sum(x => x.Quantity), items = veri }
        });
    }

}
