using B2B.Erp.Api.Core.Enums;
using B2B.Erp.Api.Core.Interfaces;
using B2B.Erp.Api.Data;
using B2B.Erp.Api.Dtos.Campaigns;
using B2B.Erp.Api.Entities;
using B2B.Erp.Api.ViewModels.Campaigns;
using Microsoft.EntityFrameworkCore;
using System.Text.Json;

namespace B2B.Erp.Api.Data.Services;

public sealed class CampaignService : ICampaignService
{
    private static readonly JsonSerializerOptions _jsonOptions = new() { PropertyNameCaseInsensitive = true };
    private readonly AppDbContext _dbContext;
    private readonly IHttpContextAccessor _httpContextAccessor;
    private readonly B2B.Erp.Api.Features.Currency.ICurrencyRateService _currencyRates;

    public CampaignService(
        AppDbContext dbContext,
        IHttpContextAccessor httpContextAccessor,
        B2B.Erp.Api.Features.Currency.ICurrencyRateService currencyRates)
    {
        _dbContext = dbContext;
        _httpContextAccessor = httpContextAccessor;
        _currencyRates = currencyRates;
    }

    /// <summary>
    /// İsteği yapan kullanıcının rolü kampanyalardan yararlanabiliyor mu.
    ///
    /// Kapatma KAYNAĞI roldür (<see cref="Role.CampaignsEnabled"/>), kullanıcı değil: kullanıcı
    /// bazlı olsaydı role yeni biri eklendiğinde tek tek kapatmak gerekirdi.
    ///
    /// Rol çözülemiyorsa (kimliksiz istek, arka plan işi, servis hesabı) AÇIK kabul edilir —
    /// bu kapı bir yetki sınırı değil ticari bir tercih; belirsizlikte mevcut davranışı
    /// bozmamak, sessizce indirim kaybettirmekten iyidir.
    /// </summary>
    private async Task<bool> AreCampaignsEnabledForCurrentUserAsync(CancellationToken cancellationToken)
    {
        var user = _httpContextAccessor.HttpContext?.User;
        if (user?.Identity?.IsAuthenticated != true) return true;

        var roleIdClaim = user.Claims
            .FirstOrDefault(c => string.Equals(c.Type, "RoleId", StringComparison.OrdinalIgnoreCase))
            ?.Value;

        if (string.IsNullOrWhiteSpace(roleIdClaim) || !int.TryParse(roleIdClaim, out var roleId))
        {
            return true;
        }

        var enabled = await _dbContext.Roles
            .AsNoTracking()
            .Where(r => r.Id == roleId)
            .Select(r => (bool?)r.CampaignsEnabled)
            .FirstOrDefaultAsync(cancellationToken);

        return enabled ?? true;
    }

    public async Task<CampaignDetailsViewModel?> GetDetails(Guid campaignId, CancellationToken cancellationToken = default)
    {
        var campaign = await _dbContext.Campaigns
            .AsNoTracking()
            .Include(x => x.CampaignConditions)
            .Include(x => x.CampaignActions)
            .Include(x => x.CampaignTargets)
            .FirstOrDefaultAsync(x => x.Id == campaignId, cancellationToken);

        if (campaign is null)
        {
            return null;
        }

        static string ConditionText(CampaignCondition c)
        {
            return c.ConditionType switch
            {
                CampaignConditionType.MinQuantity => $"MinQuantity {c.Operator} {c.Value}",
                CampaignConditionType.MinAmount => $"MinAmount {c.Operator} {c.Value}",
                CampaignConditionType.CategoryBased => $"CategoryBased: {(c.TargetId ?? "-")} ",
                CampaignConditionType.ProductBased => $"ProductBased: {(c.TargetId ?? "-")} ",
                CampaignConditionType.CustomerGroupBased => $"CustomerGroupBased: {(c.TargetId ?? "-")} ",
                _ => c.ConditionType.ToString()
            };
        }

        static string ActionText(CampaignAction a)
        {
            return a.ActionType switch
            {
                CampaignActionType.PercentageDiscount => $"PercentageDiscount {a.Value}",
                CampaignActionType.FixedAmountDiscount => $"FixedAmountDiscount {a.Value}",
                CampaignActionType.GiftProduct => $"GiftProduct {(a.TargetProductId?.ToString() ?? "-")} x{a.Quantity}",
                CampaignActionType.FreeShipping => "FreeShipping",
                CampaignActionType.PriceGroupShift => $"PriceGroupShift {(a.TargetPriceGroupId?.ToString() ?? "-")}",
                _ => a.ActionType.ToString()
            };
        }

        static string TargetText(CampaignTarget t)
        {
            return t.TargetType switch
            {
                CampaignTargetType.AllCustomers => "AllCustomers",
                CampaignTargetType.SpecificCustomer => $"SpecificCustomer: {(t.TargetId ?? "-")}",
                CampaignTargetType.Region => $"Region: {(t.TargetId ?? "-")}",
                CampaignTargetType.CustomerPriceGroup => $"CustomerPriceGroup: {(t.TargetId ?? "-")}",
                _ => t.TargetType.ToString()
            };
        }

        var conditions = campaign.CampaignConditions
            .OrderBy(x => x.CreateTime)
            .Select(x => new CampaignConditionRowViewModel
            {
                Id = x.Id,
                ConditionType = x.ConditionType,
                Operator = x.Operator,
                Value = x.Value,
                TargetId = x.TargetId,
                DisplayText = ConditionText(x)
            })
            .ToList();

        var actions = campaign.CampaignActions
            .OrderBy(x => x.CreateTime)
            .Select(x => new CampaignActionRowViewModel
            {
                Id = x.Id,
                ActionType = x.ActionType,
                Value = x.Value,
                Quantity = x.Quantity,
                TargetProductId = x.TargetProductId,
                TargetPriceGroupId = x.TargetPriceGroupId,
                DisplayText = ActionText(x)
            })
            .ToList();

        var targets = campaign.CampaignTargets
            .OrderBy(x => x.CreateTime)
            .Select(x => new CampaignTargetRowViewModel
            {
                Id = x.Id,
                TargetType = x.TargetType,
                TargetId = x.TargetId,
                DisplayText = TargetText(x)
            })
            .ToList();

        return new CampaignDetailsViewModel
        {
            Id = campaign.Id,
            Name = campaign.Name,
            Description = campaign.Description,
            StartDate = campaign.StartDate,
            EndDate = campaign.EndDate,
            IsIndefinite = campaign.IsIndefinite,
            Priority = campaign.Priority,
            IsActive = campaign.IsActive,
            StopNext = campaign.StopNext,
            Conditions = conditions,
            Actions = actions,
            Targets = targets,
            ConditionSummary = string.Join(" | ", conditions.Select(x => x.DisplayText)),
            ActionSummary = string.Join(" | ", actions.Select(x => x.DisplayText)),
            TargetSummary = string.Join(" | ", targets.Select(x => x.DisplayText))
        };
    }

    public async Task<EvaluateSalesOrderResponse> EvaluateSalesOrder(EvaluateSalesOrderRequest request, CancellationToken cancellationToken = default)
    {
        if (request is null)
        {
            throw new InvalidOperationException("Request body is required.");
        }

        var customerCode = (request.CustomerCode ?? string.Empty).Trim();
        if (string.IsNullOrWhiteSpace(customerCode))
        {
            throw new InvalidOperationException("CustomerCode is required.");
        }

        if (request.Lines is null || request.Lines.Count == 0)
        {
            throw new InvalidOperationException("At least one line is required.");
        }

        var customer = await _dbContext.Customers
            .AsNoTracking()
            .Include(x => x.PriceGroupEntity)
            .FirstOrDefaultAsync(x => x.CustomerCode == customerCode, cancellationToken);

        if (customer is null)
        {
            throw new InvalidOperationException("Customer not found.");
        }

        var stockCodes = request.Lines
            .Select(x => (x.StockCode ?? string.Empty).Trim())
            .Where(x => !string.IsNullOrWhiteSpace(x))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();

        if (stockCodes.Count == 0)
        {
            throw new InvalidOperationException("At least one valid StockCode is required.");
        }

        var products = await _dbContext.Products
            .AsNoTracking()
            .Where(x => stockCodes.Contains(x.StockCode))
            .Select(x => new
            {
                x.Id,
                x.StockCode,
                x.Name,
                x.MainCategoryId,
                x.CategoryId,
                x.Kod4,
                x.Kod5,
                x.TaxRate,
                x.DiscountRate
            })
            .ToListAsync(cancellationToken);

        var categories = await _dbContext.ProductCategories.AsNoTracking().ToListAsync(cancellationToken);
        var catKeyMap = categories.ToDictionary(c => c.Id, c => c.Key);

        var productByStockCode = products
            .Where(x => !string.IsNullOrWhiteSpace(x.StockCode))
            .ToDictionary(x => x.StockCode, x => x, StringComparer.OrdinalIgnoreCase);

        var missing = stockCodes.Where(sc => !productByStockCode.ContainsKey(sc)).ToList();
        if (missing.Count > 0)
        {
            throw new InvalidOperationException($"Product not found for stock code(s): {string.Join(", ", missing)}");
        }

        Guid? overridePriceGroupId = null;
        if (request.PriceGroupCode.HasValue && request.PriceGroupCode.Value > 0)
        {
            overridePriceGroupId = await _dbContext.PriceGroups
                .AsNoTracking()
                .Where(x => x.Code == request.PriceGroupCode.Value && x.IsActive)
                .Select(x => (Guid?)x.Id)
                .FirstOrDefaultAsync(cancellationToken);
        }

        var order = new OrderContext
        {
            Customer = customer,
            CustomerCode = customerCode,
            AppliedPriceGroupId = overridePriceGroupId ?? customer.PriceGroupId
        };

        /*
          KAMPANYA İNDİRİMİ KATALOG FİYATINA (F4) UYGULANIR — bkz. CampaignCatalogDiscount.

          Bunun için satıra ürünün F4'ü, siparişe de carinin fiyat grubu FORMÜLÜ gerekir. F4
          `ProductPrices`ta kod 4 satırıdır; para birimi TL değilse motor sözleşmesi gereği
          (satır fiyatları TL) aynı kurdan TL'ye çevrilir. F4'ü olmayan üründe eski davranış
          (birim fiyattan doğrudan düşme) sürer.
        */
        if (order.AppliedPriceGroupId.HasValue)
        {
            order.PriceGroupFormula = await _dbContext.PriceGroups
                .AsNoTracking()
                .Where(x => x.Id == order.AppliedPriceGroupId.Value)
                .Select(x => x.Formula)
                .FirstOrDefaultAsync(cancellationToken);
        }

        var productIds = products.Select(x => x.Id).ToList();
        var catalogRows = await _dbContext.ProductPrices
            .AsNoTracking()
            .Where(pp => productIds.Contains(pp.ProductId) && pp.PriceGroup.Code == 4)
            .Select(pp => new { pp.ProductId, pp.Price, pp.Currency })
            .ToListAsync(cancellationToken);

        var catalogTryByProductId = new Dictionary<Guid, decimal>();
        // F4'ü TL'ye çeviren kur (TL ürünlerde 1). Kampanyalı hedef fiyat F4 para biriminde
        // yazılıyor; satırın TL F4'ü ile karşılaştırılmadan önce AYNI kurla çevrilmeli.
        var catalogRateByProductId = new Dictionary<Guid, decimal>();
        var tryRateByCurrency = new Dictionary<string, decimal>(StringComparer.OrdinalIgnoreCase);
        foreach (var row in catalogRows)
        {
            if (row.Price <= 0m || catalogTryByProductId.ContainsKey(row.ProductId)) continue;

            var cur = (row.Currency ?? string.Empty).Trim().ToUpperInvariant();
            if (cur.Length == 0 || cur == "TL" || cur == "TRY")
            {
                catalogTryByProductId[row.ProductId] = row.Price;
                catalogRateByProductId[row.ProductId] = 1m;
                continue;
            }

            if (!tryRateByCurrency.TryGetValue(cur, out var rate))
            {
                rate = 0m;
                try
                {
                    rate = await _currencyRates.GetLatestTryRateAsync(cur, cancellationToken);
                }
                catch
                {
                    rate = 0m;
                }
                tryRateByCurrency[cur] = rate;
            }

            // Kur alınamazsa F4 bilinmiyor sayılır; yanlış para biriminde indirim hesaplamaktansa
            // o satır eski davranışa düşer.
            if (rate > 0m)
            {
                catalogTryByProductId[row.ProductId] = Math.Round(row.Price * rate, 4, MidpointRounding.AwayFromZero);
                catalogRateByProductId[row.ProductId] = rate;
            }
        }

        var isAskeriye = (customer.InvoiceType != null && customer.InvoiceType.Trim().ToUpper() is "ASKERIYE" or "ASKERİYE")
            || (customer.PriceGroupEntity != null && customer.PriceGroupEntity.Code == 7)
            || (request.PriceGroupCode.HasValue && request.PriceGroupCode.Value == 7);

        foreach (var line in request.Lines)
        {
            var sc = (line.StockCode ?? string.Empty).Trim();
            if (string.IsNullOrWhiteSpace(sc)) continue;
            if (!productByStockCode.TryGetValue(sc, out var p)) continue;

            var gKey = p.MainCategoryId.HasValue && catKeyMap.TryGetValue(p.MainCategoryId.Value, out var gk) ? gk : null;
            var sKey = p.CategoryId.HasValue && catKeyMap.TryGetValue(p.CategoryId.Value, out var sk) ? sk : null;

            order.Lines.Add(new OrderLineContext
            {
                ProductId = p.Id,
                StockCode = p.StockCode,
                ProductName = p.Name,
                MainCategoryId = p.MainCategoryId,
                CategoryId = p.CategoryId,
                GroupCode = gKey,
                SubGroupCode = sKey,
                Kod4 = p.Kod4,
                Kod5 = p.Kod5,
                Quantity = line.Quantity,
                UnitPrice = line.UnitPrice,
                VatRate = isAskeriye ? 0m : line.VatRate,
                IsGift = false,
                DiscountAmount = 0m,
                CatalogPrice = catalogTryByProductId.TryGetValue(p.Id, out var f4) ? f4 : (decimal?)null,
                CatalogRateToTry = catalogRateByProductId.TryGetValue(p.Id, out var f4Rate) ? f4Rate : 0m,
                TaxRate = p.TaxRate,
                DiscountRate = p.DiscountRate
            });
        }

        if (order.Lines.Count == 0)
        {
            throw new InvalidOperationException("At least one valid line is required.");
        }

        var effectivePriceGroupCode = await GetEffectivePriceGroupCode(order.AppliedPriceGroupId, cancellationToken);

        var settings = await _dbContext.Set<JwtSessionSetting>()
            .AsNoTracking()
            .OrderBy(x => x.Id)
            .FirstOrDefaultAsync(cancellationToken);
        var giftAccountingMode = settings?.CampaignGiftAccountingMode ?? 2;
        var giftSymbolicPrice = (settings?.CampaignGiftSymbolicPrice ?? 0m) > 0m ? settings!.CampaignGiftSymbolicPrice : 0.01m;

        var now = DateTime.UtcNow;

        // Rolün kampanya anahtarı kapalıysa aday listesi BOŞ bırakılır; hesabın geri kalanı
        // (ara toplam, KDV, genel toplam) normal akışında yürür. Erken dönüp boş bir yanıt
        // üretmek toplamları da sıfırlardı — istenen "indirim yok", "tutar yok" değil.
        var campaignsEnabled = await AreCampaignsEnabledForCurrentUserAsync(cancellationToken);

        var campaigns = campaignsEnabled
            ? await _dbContext.Campaigns
                .AsNoTracking()
                /*
                  SEPETTE KAMPANYA GEÇ GELİYORDU (2026-10-04 kullanıcı bildirimi).

                  Beş Include TEK sorguda JOIN'leniyordu; satır sayısı alt tabloların ÇARPIMI
                  oluyordu: "tüm bayiler" tek tek seçilmiş bir kampanyada 5.744 hedef × 7 fiyat
                  grubu = kampanya başına ~40 bin satır, her sepet değişikliğinde. Üstüne her
                  düzenleme eski hedefleri soft-delete edip yenilerini yazdığı için SİLİNMİŞ
                  satırlar da çekilip bellekte eleniyordu — tablo büyüdükçe sepet yavaşlıyordu.

                  Artık: (1) silinmiş alt satırlar sorguda elenir, (2) her koleksiyon ayrı sorgu
                  (AsSplitQuery) — satırlar toplanır, çarpılmaz.
                */
                .AsSplitQuery()
                .Include(x => x.CampaignConditions.Where(c => !c.IsDeleted))
                .Include(x => x.CampaignActions.Where(a => !a.IsDeleted))
                .Include(x => x.CampaignTargets.Where(t => !t.IsDeleted))
                .Include(x => x.CampaignDiscounts.Where(d => !d.IsDeleted))
                    .ThenInclude(d => d.PriceGroups)
                .Where(x => !x.IsDeleted && x.IsActive)
                // TARİH ARALIĞI — iki hata birden düzeltildi.
                //
                // 1) BİTİŞ GÜNÜ SAYILMIYORDU. Tarih seçici gün gönderiyor ('2026-08-11'), bu da
                //    gece yarısı olarak saklanıyor (00:00). Eski koşul `EndDate >= now` idi;
                //    11 Ağustos'ta biten bir kampanya 11 Ağustos 00:00'dan itibaren ölüyordu,
                //    yani KENDİ SON GÜNÜNDE hiç çalışmıyordu. Bayi "kampanya bugün bitiyor" diye
                //    satış yapmaya çalışırken indirimi göremiyordu.
                //    Yeni koşul bitiş gününün TAMAMINI kapsıyor: EndDate'in ertesi gününden önce.
                //
                // 2) TEK UÇLU ARALIK HİÇ ÇALIŞMIYORDU. Eski koşul iki tarihin de dolu olmasını
                //    şart koşuyordu (`StartDate.HasValue && EndDate.HasValue`). Yalnızca başlangıcı
                //    olan (bitişi açık) bir kampanya, süresiz işaretlenmediyse sessizce hiç
                //    uygulanmıyordu. Artık her uç kendi başına değerlendiriliyor: boş uç "sınır
                //    yok" demek.
                .Where(x =>
                    x.IsIndefinite ||
                    (
                        (!x.StartDate.HasValue || x.StartDate.Value <= now) &&
                        (!x.EndDate.HasValue || now < x.EndDate.Value.Date.AddDays(1))
                    ))
                // SIRA BELİRLEYİCİ OLMAK ZORUNDA.
                //
                // Tek başına Priority'ye göre sıralamak yetmiyordu: eşit öncelikli kampanyaların
                // sırasını veritabanı belirliyor ve bu sıra garanti edilmiyor (plan değişince
                // değişebilir). Kampanyalar sırayla uygulandığı, biri diğerinin fiyatını
                // düşürebildiği ve StopNext sonrakileri tamamen kesebildiği için sıra SONUCU
                // DEĞİŞTİRİYOR — aynı sepet iki çalıştırmada farklı indirim alabiliyordu.
                //
                // Bu, pratikte HER SEPETİ etkiliyordu: altı kampanya tipinin altısı da varlığı
                // `Priority = 0` ile yaratıyordu, yani bütün kampanyalar eşit öncelikliydi.
                //
                // Bağ bozucular: önce daha yeni kampanya (son tanımlanan kural genelde günceldir),
                // sonra ad, en sonda Id. Üçü birlikte sırayı tamamen belirli kılıyor.
                .OrderByDescending(x => x.Priority)
                .ThenByDescending(x => x.CreateTime)
                .ThenBy(x => x.Name)
                .ThenBy(x => x.Id)
                .ToListAsync(cancellationToken)
            : new List<Campaign>();

        var appliedCampaignIds = new List<Guid>();
        var appliedCampaignDetails = new List<EvaluateSalesOrderAppliedCampaignDetail>();
        decimal orderLevelDiscountTotal = 0m;

        foreach (var campaign in campaigns)
        {
            // Use only active rows (soft deleted rows must not affect evaluation)
            campaign.CampaignTargets = campaign.CampaignTargets.Where(x => !x.IsDeleted).ToList();
            campaign.CampaignConditions = campaign.CampaignConditions.Where(x => !x.IsDeleted).ToList();
            campaign.CampaignActions = campaign.CampaignActions.Where(x => !x.IsDeleted).ToList();
            campaign.CampaignDiscounts = campaign.CampaignDiscounts.Where(x => !x.IsDeleted).ToList();

            if (!IsTargetMatch(campaign, order.Customer))
            {
                continue;
            }

            if (campaign.KampanyaTipi == KampanyaTipi.AdetBazliKademeliIndirim)
            {
                if (!TryApplyQuantityTieredDiscountFixedAmount(campaign, order, effectivePriceGroupCode, ref orderLevelDiscountTotal, appliedCampaignDetails))
                {
                    continue;
                }
            }
            else
            {
                if (!AreConditionsSatisfied(campaign.CampaignConditions, order, out var eligibleLineIndexes))
                {
                    continue;
                }

                if (!await ApplyActions(campaign, order, eligibleLineIndexes, effectivePriceGroupCode, giftAccountingMode, giftSymbolicPrice, cancellationToken))
                {
                    continue;
                }
            }

            appliedCampaignIds.Add(campaign.Id);

            if (campaign.StopNext)
            {
                break;
            }
        }

        return BuildResponse(order, appliedCampaignIds, orderLevelDiscountTotal, appliedCampaignDetails);
    }

    private sealed class OrderContext
    {
        public string CustomerCode { get; set; } = string.Empty;
        public Customer Customer { get; set; } = null!;
        public Guid? AppliedPriceGroupId { get; set; }
        /// <summary>Carinin fiyat grubu formülü (<c>PriceGroups.Formula</c>); F4 tabanlı indirim için.</summary>
        public string? PriceGroupFormula { get; set; }
        public List<OrderLineContext> Lines { get; set; } = new();
    }

    private sealed class QuantityTierTargets
    {
        public List<string>? GroupCodes { get; set; }
        public List<string>? ProductStockCodes { get; set; }
    }

    private sealed class OrderLineContext
    {
        public Guid ProductId { get; set; }
        public string StockCode { get; set; } = string.Empty;
        public string ProductName { get; set; } = string.Empty;
        public Guid? MainCategoryId { get; set; }
        public Guid? CategoryId { get; set; }
        public string? GroupCode { get; set; }
        public string? SubGroupCode { get; set; }
        public string? Kod4 { get; set; }
        public string? Kod5 { get; set; }

        public decimal Quantity { get; set; }
        public decimal UnitPrice { get; set; }
        public decimal VatRate { get; set; }

        public bool IsGift { get; set; }
        public decimal DiscountAmount { get; set; }

        /// <summary>Fiyat 4 (katalog) birim fiyatı, TL. Yoksa indirim birim fiyattan düşer.</summary>
        public decimal? CatalogPrice { get; set; }

        /// <summary>F4'ün TL'ye çevrildiği kur (TL ürünlerde 1, kur yoksa 0). Kampanyalı hedef
        /// fiyat F4 para biriminde olduğu için TL karşılığı bu kurla bulunur.</summary>
        public decimal CatalogRateToTry { get; set; }
        public decimal TaxRate { get; set; }
        public decimal DiscountRate { get; set; }
    }

    /// <summary>
    /// Ürün/kategori indiriminde bir birimin indirimi: F4 varsa katalog tabanlı
    /// (<see cref="B2B.Erp.Api.Core.Helpers.CampaignCatalogDiscount"/>), yoksa eski hesap.
    /// </summary>
    private static decimal ResolveUnitDiscount(OrderContext order, OrderLineContext line, IskontoTipi type, decimal value)
    {
        if (line.CatalogPrice.HasValue && line.CatalogPrice.Value > 0m)
        {
            var viaCatalog = B2B.Erp.Api.Core.Helpers.CampaignCatalogDiscount.UnitDiscount(
                line.CatalogPrice.Value, order.PriceGroupFormula, line.TaxRate, line.DiscountRate, type, value);
            if (viaCatalog.HasValue) return viaCatalog.Value;
        }

        return type == IskontoTipi.Oran
            ? (line.UnitPrice * value) / 100m
            : value;
    }

    private async Task<int?> GetEffectivePriceGroupCode(Guid? priceGroupId, CancellationToken cancellationToken)
    {
        if (!priceGroupId.HasValue)
        {
            return null;
        }

        return await _dbContext.PriceGroups
            .AsNoTracking()
            .Where(x => x.Id == priceGroupId.Value)
            .Select(x => (int?)x.Code)
            .FirstOrDefaultAsync(cancellationToken);
    }

    /// <summary>
    /// Kampanya bu müşteriyi kapsıyor mu? Hedef yoksa herkesi kapsar.
    ///
    /// PUBLIC olmasının sebebi: aynı kuralı vitrindeki kampanya rozeti de kullanmak zorunda.
    /// Rozetin beslendiği /api/Campaigns/active ucu hedefi HİÇ SORMUYORDU (customerCode
    /// parametresini alıyor ama kullanmıyordu), dolayısıyla bayi başka bir cariye ya da
    /// bölgeye tanımlı kampanyanın hediye ikonunu görüyor, ürünü sepete atıyor ve indirim
    /// gelmiyordu. Kural iki yerde ayrı ayrı yazılırsa er geç yine ayrışır; tek kaynak burası.
    /// </summary>
    /// <summary>
    /// Bir indirimin VERİLEN FİYAT GRUBU İÇİN geçerli değerini döndürür; grup kapsam dışıysa
    /// null (= indirim yok).
    ///
    /// İKİ HATA BİRDEN düzeltildi:
    ///
    /// 1) FİYAT GRUBU SEÇİMİ HİÇ KISITLAMIYORDU. Eski kod, seçilmeyen grup için kolonu null
    ///    bulunca `d.Deger`'e düşüyordu; yani "sadece grup 2" diye kurulmuş kampanya grup 1 ve
    ///    3'e de aynı indirimi veriyordu. Canlı testte doğrulandı: grup 2 için kurulan %40,
    ///    üç grupta da uygulanıyordu. Seçim artık gerçekten kısıtlıyor.
    ///
    /// 2) ALTIDAN FAZLA FİYAT GRUBU YOKTU. Değerler IskontoFiyat1..6 diye sabit altı kolondu.
    ///    Artık önce <see cref="CampaignDiscountPriceGroup"/> satırlarına bakılıyor; orada kaç
    ///    grup olursa olsun (7 = Askeriye Tipi Fatura) değer bulunur.
    ///
    /// GERİYE DÖNÜK UYUM: alt tabloda hiç satırı olmayan ESKİ kayıtlar için IskontoFiyat1..6
    /// okunmaya devam eder. Hiçbir fiyat grubu bilgisi taşımayan kayıtlar (hepsi null) eskisi
    /// gibi herkese uygulanır — o kayıtlarda kısıtlama niyeti hiç ifade edilmemiş demektir.
    /// Müşterinin fiyat grubu belirsizse (pgCode null) yine eski davranış korunur; aksi halde
    /// grubu olmayan cariler bütün kampanyaları kaybederdi.
    /// </summary>
    private static decimal? ResolveDiscountValueForPriceGroup(CampaignDiscount d, int? pgCode)
    {
        var groups = d.PriceGroups?.Where(x => !x.IsDeleted).ToList();

        if (groups is { Count: > 0 })
        {
            if (!pgCode.HasValue)
            {
                return d.Deger;
            }

            var match = groups.FirstOrDefault(x => x.PriceGroupCode == pgCode.Value);
            return match?.Deger;
        }

        var legacy = new[]
        {
            d.IskontoFiyat1, d.IskontoFiyat2, d.IskontoFiyat3,
            d.IskontoFiyat4, d.IskontoFiyat5, d.IskontoFiyat6
        };

        if (legacy.Any(x => x.HasValue))
        {
            if (!pgCode.HasValue)
            {
                return d.Deger;
            }

            return pgCode.Value is >= 1 and <= 6 ? legacy[pgCode.Value - 1] : null;
        }

        return d.Deger;
    }

    public static bool IsTargetMatch(Campaign campaign, Customer customer)
    {
        if (campaign.CampaignTargets.Count == 0)
        {
            return true;
        }

        foreach (var target in campaign.CampaignTargets)
        {
            switch (target.TargetType)
            {
                case CampaignTargetType.AllCustomers:
                    return true;
                case CampaignTargetType.SpecificCustomer:
                    if (!string.IsNullOrWhiteSpace(target.TargetId) &&
                        string.Equals(target.TargetId.Trim(), customer.CustomerCode, StringComparison.OrdinalIgnoreCase))
                    {
                        return true;
                    }
                    break;
                case CampaignTargetType.Region:
                    if (!string.IsNullOrWhiteSpace(target.TargetId) &&
                        !string.IsNullOrWhiteSpace(customer.City) &&
                        string.Equals(target.TargetId.Trim(), customer.City.Trim(), StringComparison.OrdinalIgnoreCase))
                    {
                        return true;
                    }
                    break;
                case CampaignTargetType.CustomerPriceGroup:
                    if (!string.IsNullOrWhiteSpace(target.TargetId) &&
                        Guid.TryParse(target.TargetId.Trim(), out var priceGroupId) &&
                        customer.PriceGroupId.HasValue &&
                        customer.PriceGroupId.Value == priceGroupId)
                    {
                        return true;
                    }
                    break;
            }
        }

        return false;
    }

    /// <summary>
    /// Koşullar İKİ AŞAMADA değerlendirilir ve sıra önemlidir.
    ///
    /// Önce KAPSAM DARALTAN koşullar (ürün, kategori/marka, paket) çalışır ve kampanyanın hangi
    /// satırları kapsadığını belirler. Ancak ondan sonra EŞİK koşulları (asgari adet / asgari
    /// tutar) ölçülür — ve artık sepetin tamamını değil, kampanyanın kapsadığı satırları ölçer.
    ///
    /// Eskiden koşullar geldikleri sırayla tek geçişte işleniyordu ve eşik koşulları her zaman
    /// SEPETİN TAMAMINI topluyordu. İki sonucu vardı:
    ///
    ///   1) "X kategorisinden 5 adet alana indirim" kuralı, sepette X'ten hiç olmasa bile
    ///      başka ürünlerden 5 adet varken tetikleniyordu — kampanya hak edilmeden veriliyordu.
    ///   2) Sonuç koşulların KAYIT SIRASINA bağlıydı: eşik koşulu kategoriden önce yazılmışsa
    ///      farklı, sonra yazılmışsa farklı davranıyordu. Aynı kurgu, kaydediliş sırasına göre
    ///      farklı indirim üretiyordu.
    ///
    /// Yalnızca eşik koşulu olan kampanyalarda (klasik sepet indirimi) kapsam zaten bütün
    /// sepettir, dolayısıyla davranış değişmez.
    /// </summary>
    private static bool AreConditionsSatisfied(ICollection<CampaignCondition> conditions, OrderContext order, out HashSet<int> eligibleLineIndexes)
    {
        eligibleLineIndexes = Enumerable.Range(0, order.Lines.Count).ToHashSet();

        static bool IsThreshold(CampaignCondition c) =>
            c.ConditionType is CampaignConditionType.MinQuantity or CampaignConditionType.MinAmount;

        // 1. aşama: kapsamı daraltanlar.
        foreach (var condition in conditions.Where(c => !IsThreshold(c)))
        {
            if (!IsConditionSatisfied(condition, order, ref eligibleLineIndexes))
            {
                return false;
            }
        }

        // 2. aşama: eşikler, daralmış kapsam üzerinde.
        foreach (var condition in conditions.Where(IsThreshold))
        {
            if (!IsConditionSatisfied(condition, order, ref eligibleLineIndexes))
            {
                return false;
            }
        }

        return eligibleLineIndexes.Count > 0;
    }

    private static bool IsConditionSatisfied(CampaignCondition condition, OrderContext order, ref HashSet<int> eligibleLineIndexes)
    {


        var op = (condition.Operator ?? string.Empty).Trim();

        switch (condition.ConditionType)
        {
            // Eşikler KAMPANYANIN KAPSADIĞI satırlar üzerinden ölçülür, sepetin tamamı üzerinden
            // değil (gerekçe: AreConditionsSatisfied özeti). Hediye satırları hiçbir eşiğe
            // sayılmaz — hediyeyi hediyenin kendisi hak ettiremez.
            case CampaignConditionType.MinQuantity:
            {
                var indexes = eligibleLineIndexes;
                var qty = order.Lines
                    .Where((x, i) => indexes.Contains(i) && !x.IsGift)
                    .Sum(x => x.Quantity);
                return CompareDecimal(qty, condition.Value, op);
            }
            case CampaignConditionType.MinAmount:
            {
                var indexes = eligibleLineIndexes;
                var amount = order.Lines
                    .Where((x, i) => indexes.Contains(i) && !x.IsGift)
                    .Sum(x => x.UnitPrice * x.Quantity);
                return CompareDecimal(amount, condition.Value, op);
            }
            case CampaignConditionType.ProductBased:
            {
                if (string.IsNullOrWhiteSpace(condition.TargetId) || !Guid.TryParse(condition.TargetId.Trim(), out var productId))
                {
                    return false;
                }

                var matching = order.Lines
                    .Select((line, idx) => new { line, idx })
                    .Where(x => x.line.ProductId == productId)
                    .Select(x => x.idx)
                    .ToHashSet();

                eligibleLineIndexes.IntersectWith(matching);
                return eligibleLineIndexes.Count > 0;
            }
            case CampaignConditionType.CategoryBased:
            {
                var key = ToKey(condition.CategoryCode ?? condition.TargetId ?? string.Empty);

                var brandFieldKey = ToKey(condition.BrandField ?? string.Empty);
                var brandCodeKey = ToKey(condition.BrandCode ?? string.Empty);
                var hasBrandFilter = brandFieldKey.Length > 0 && brandCodeKey.Length > 0;

                HashSet<string>? stockCodes = null;
                if (!string.IsNullOrWhiteSpace(condition.ProductStockCodesJson))
                {
                    try
                    {
                        var arr = JsonSerializer.Deserialize<string[]>(condition.ProductStockCodesJson);
                        if (arr is { Length: > 0 })
                        {
                            stockCodes = arr
                                .Where(x => !string.IsNullOrWhiteSpace(x))
                                .Select(x => x.Trim())
                                .ToHashSet(StringComparer.OrdinalIgnoreCase);
                        }
                    }
                    catch
                    {
                        return false;
                    }
                }

                // Kategori boşsa yalnız ürün listesi belirler (2026-10-07: ürüne özel kampanyalı
                // fiyatta ürünler farklı kategorilerden seçilebiliyor). İkisi de yoksa koşul tutmaz.
                if (key.Length == 0 && stockCodes is null)
                {
                    return false;
                }

                var matching = order.Lines
                    .Select((line, idx) => new { line, idx })
                    .Where(x =>
                    {
                        var categoryOk = stockCodes != null
                            ? stockCodes.Contains(x.line.StockCode)
                            : (string.Equals(ToKey(x.line.GroupCode ?? string.Empty), key, StringComparison.OrdinalIgnoreCase) ||
                               string.Equals(ToKey(x.line.SubGroupCode ?? string.Empty), key, StringComparison.OrdinalIgnoreCase));

                        if (!categoryOk) return false;

                        if (!hasBrandFilter) return true;

                        if (brandFieldKey == "SUBCATEGORY")
                        {
                            return string.Equals(ToKey(x.line.SubGroupCode ?? string.Empty), brandCodeKey, StringComparison.OrdinalIgnoreCase);
                        }

                        if (brandFieldKey == "KOD4")
                        {
                            return string.Equals(ToKey(x.line.Kod4 ?? string.Empty), brandCodeKey, StringComparison.OrdinalIgnoreCase);
                        }

                        if (brandFieldKey == "KOD5")
                        {
                            return string.Equals(ToKey(x.line.Kod5 ?? string.Empty), brandCodeKey, StringComparison.OrdinalIgnoreCase);
                        }

                        return false;
                    })
                    .Select(x => x.idx)
                    .ToHashSet();

                eligibleLineIndexes.IntersectWith(matching);
                if (eligibleLineIndexes.Count == 0)
                {
                    return false;
                }

                if (!condition.Metric.HasValue || !condition.Minimum.HasValue)
                {
                    return true;
                }

                var eligible = eligibleLineIndexes;
                var lines = order.Lines
                    .Select((line, idx) => new { line, idx })
                    .Where(x => eligible.Contains(x.idx) && !x.line.IsGift)
                    .Select(x => x.line)
                    .ToList();

                if (lines.Count == 0)
                {
                    return false;
                }

                decimal actual;
                if (condition.Metric.Value == CampaignConditionMetric.Quantity)
                {
                    actual = lines.Sum(x => x.Quantity);
                }
                else
                {
                    actual = lines.Sum(x => x.UnitPrice * x.Quantity);
                }

                var min = condition.Minimum.Value;
                var max = condition.Maximum;
                if (actual < min)
                {
                    return false;
                }

                if (max.HasValue && actual > max.Value)
                {
                    return false;
                }

                return true;
            }
            case CampaignConditionType.CustomerGroupBased:
            {
                if (string.IsNullOrWhiteSpace(condition.TargetId))
                {
                    return false;
                }

                if (Guid.TryParse(condition.TargetId.Trim(), out var pg))
                {
                    var match = order.Customer.PriceGroupId.HasValue && order.Customer.PriceGroupId.Value == pg;
                    return CompareBool(match, op);
                }

                var typeMatch = string.Equals(order.Customer.CustomerType, condition.TargetId.Trim(), StringComparison.OrdinalIgnoreCase);
                return CompareBool(typeMatch, op);
            }
            case CampaignConditionType.PackageProducts:
            {
                if (string.IsNullOrWhiteSpace(condition.PackageItemsJson))
                {
                    return false;
                }

                PackageItem[] items;
                try
                {
                    items = JsonSerializer.Deserialize<PackageItem[]>(condition.PackageItemsJson, _jsonOptions) ?? Array.Empty<PackageItem>();
                }
                catch
                {
                    return false;
                }

                var required = items
                    .Where(x => !string.IsNullOrWhiteSpace(x.StockCode))
                    .Select(x => new PackageItem { StockCode = x.StockCode!.Trim(), Quantity = x.Quantity })
                    .Where(x => x.Quantity > 0)
                    .GroupBy(x => x.StockCode, StringComparer.OrdinalIgnoreCase)
                    .Select(g => new { StockCode = g.Key, Quantity = g.Sum(x => x.Quantity) })
                    .ToList();

                if (required.Count == 0)
                {
                    return false;
                }

                var matchedIndexes = new HashSet<int>();

                foreach (var req in required)
                {
                    var matchingLines = order.Lines
                        .Select((line, idx) => new { line, idx })
                        .Where(x => !x.line.IsGift)
                        .Where(x => string.Equals(x.line.StockCode, req.StockCode, StringComparison.OrdinalIgnoreCase))
                        .ToList();

                    var qty = matchingLines.Sum(x => x.line.Quantity);
                    if (qty < req.Quantity)
                    {
                        return false;
                    }

                    foreach (var l in matchingLines)
                    {
                        matchedIndexes.Add(l.idx);
                    }
                }

                eligibleLineIndexes.IntersectWith(matchedIndexes);
                return eligibleLineIndexes.Count > 0;
            }
            default:
                return false;
        }
    }

    private sealed class PackageItem
    {
        public string? StockCode { get; set; }

        public int Quantity { get; set; }
    }

    private async Task<bool> ApplyActions(
        Campaign campaign,
        OrderContext order,
        HashSet<int> eligibleLineIndexes,
        int? effectivePriceGroupCode,
        int giftAccountingMode,
        decimal giftSymbolicPrice,
        CancellationToken cancellationToken)
    {
        var eligibleLines = eligibleLineIndexes
            .Where(i => i >= 0 && i < order.Lines.Count)
            .Select(i => order.Lines[i])
            .ToList();

        if (eligibleLines.Count == 0)
        {
            return false;
        }

        var anyApplied = false;
        var pgCode = effectivePriceGroupCode;

        decimal? PickDiscountValue(CampaignDiscount d) => ResolveDiscountValueForPriceGroup(d, pgCode);

        decimal multiplier = 1;
        if (campaign.KampanyaTipi == KampanyaTipi.XAlanaYHediyeVeyaIndirimliUrun)
        {
            var triggerCond = campaign.CampaignConditions.FirstOrDefault(c => c.ConditionType == CampaignConditionType.CategoryBased);
            if (triggerCond != null && triggerCond.Minimum.HasValue && triggerCond.Minimum.Value > 0)
            {
                // Re-calculate the total quantity of products matching the trigger condition
                var triggerQty = eligibleLines.Where(x => !x.IsGift).Sum(x => x.Quantity);
                multiplier = Math.Floor(triggerQty / triggerCond.Minimum.Value);
                if (multiplier < 1) multiplier = 1;
            }
        }

        if (campaign.KampanyaTipi == KampanyaTipi.SepetIndirimi)
        {
            var discountLines = eligibleLines.Where(x => !x.IsGift).ToList();
            if (discountLines.Count > 0)
            {
                var basketTotal = discountLines.Sum(x => x.UnitPrice * x.Quantity);
                if (basketTotal > 0m)
                {
                    var stockSet = discountLines
                        .Select(x => (x.StockCode ?? string.Empty).Trim())
                        .Where(x => !string.IsNullOrWhiteSpace(x))
                        .ToHashSet(StringComparer.OrdinalIgnoreCase);

                    var best = campaign.CampaignDiscounts
                        .Where(x => !x.IsDeleted)
                        .Where(x => x.MinSepetTutari <= basketTotal)
                        .Where(x => x.StokKodu is null || stockSet.Contains(x.StokKodu))
                        .OrderByDescending(x => x.MinSepetTutari)
                        .FirstOrDefault();

                    if (best is not null)
                    {
                        var v = PickDiscountValue(best);
                        if (v.HasValue && v.Value > 0m)
                        {
                            decimal discountTotal;
                            if (best.IskontoTipi == IskontoTipi.Oran)
                            {
                                discountTotal = (basketTotal * v.Value) / 100m;
                            }
                            else
                            {
                                discountTotal = v.Value;
                            }

                            if (discountTotal > 0m)
                            {
                                if (discountTotal > basketTotal) discountTotal = basketTotal;

                                foreach (var line in discountLines)
                                {
                                    var lineTotal = line.UnitPrice * line.Quantity;
                                    if (lineTotal <= 0m) continue;

                                    var share = lineTotal / basketTotal;
                                    var pieceDiscount = discountTotal * share;
                                    if (pieceDiscount <= 0m) continue;
                                    if (pieceDiscount > lineTotal) pieceDiscount = lineTotal;

                                    line.DiscountAmount += pieceDiscount;
                                    anyApplied = true;
                                }
                            }
                        }
                    }

                    if (anyApplied && campaign.StopNext)
                    {
                        return true;
                    }
                }
            }
        }

        foreach (var action in campaign.CampaignActions)
        {
            switch (action.ActionType)
            {
                case CampaignActionType.PercentageDiscount:
                {
                    var lines = ResolveActionLines(action, eligibleLines);
                    foreach (var line in lines)
                    {
                        if (line.IsGift) continue;

                        var lineTotal = line.UnitPrice * line.Quantity;
                        var discount = lineTotal * action.Value;
                        if (discount <= 0m) continue;

                        line.DiscountAmount += discount;
                        anyApplied = true;
                    }
                    break;
                }
                case CampaignActionType.FixedAmountDiscount:
                {
                    var lines = ResolveActionLines(action, eligibleLines).Where(x => !x.IsGift).ToList();
                    var total = lines.Sum(x => x.UnitPrice * x.Quantity);
                    if (total <= 0m) break;

                    var discountTotal = action.Value;
                    if (discountTotal <= 0m) break;

                    foreach (var line in lines)
                    {
                        var lineTotal = line.UnitPrice * line.Quantity;
                        var share = lineTotal / total;
                        var discount = discountTotal * share;
                        if (discount <= 0m) continue;
                        line.DiscountAmount += discount;
                        anyApplied = true;
                    }
                    break;
                }
                case CampaignActionType.GiftProduct:
                {
                    if (!action.TargetProductId.HasValue || action.TargetProductId.Value == Guid.Empty)
                    {
                        throw new InvalidOperationException("GiftProduct action requires TargetProductId.");
                    }

                    if (action.Quantity <= 0)
                    {
                        throw new InvalidOperationException("GiftProduct action requires Quantity > 0.");
                    }

                    var productId = action.TargetProductId.Value;
                    var product = await _dbContext.Products
                        .AsNoTracking()
                        .Where(x => x.Id == productId)
                        .Select(x => new { x.Id, x.StockCode, x.Name, x.MainCategoryId, x.CategoryId, x.Kod4, x.Kod5, x.TaxRate })
                        .FirstOrDefaultAsync(cancellationToken);

                    if (product is null)
                    {
                        throw new InvalidOperationException("Gift product not found.");
                    }

                    var giftQtyNeeded = action.Quantity * (int)multiplier;

                    // Add gift items as separate gift lines (do not convert user paid lines)
                    if (giftQtyNeeded > 0)
                    {
                        var existingGift = order.Lines.FirstOrDefault(x => x.ProductId == productId && x.IsGift);
                        
                        decimal giftUnitPrice = 0m;
                        decimal giftDiscountAmount = 0m;

                        if (giftAccountingMode == 1) // Discount Row
                        {
                            decimal standardPrice = 0m;
                            if (order.AppliedPriceGroupId.HasValue)
                            {
                                standardPrice = await _dbContext.ProductPrices
                                    .AsNoTracking()
                                    .Where(x => x.ProductId == product.Id && x.PriceGroupId == order.AppliedPriceGroupId.Value)
                                    .Select(x => x.Price)
                                    .FirstOrDefaultAsync(cancellationToken);
                            }
                            if (standardPrice <= 0m)
                            {
                                standardPrice = await _dbContext.ProductPrices
                                    .AsNoTracking()
                                    .Where(x => x.ProductId == product.Id)
                                    .Select(x => x.Price)
                                    .FirstOrDefaultAsync(cancellationToken);
                            }
                            giftUnitPrice = standardPrice;
                            giftDiscountAmount = standardPrice * giftQtyNeeded;
                        }
                        else if (giftAccountingMode == 2) // Symbolic Price
                        {
                            giftUnitPrice = giftSymbolicPrice;
                            giftDiscountAmount = 0m;
                        }

                        if (existingGift is null)
                        {
                            order.Lines.Add(new OrderLineContext
                            {
                                ProductId = product.Id,
                                StockCode = product.StockCode,
                                ProductName = product.Name,
                                MainCategoryId = product.MainCategoryId,
                                CategoryId = product.CategoryId,
                                GroupCode = product.MainCategoryId.HasValue ? (await _dbContext.ProductCategories.AsNoTracking().Where(c => c.Id == product.MainCategoryId.Value).Select(c => c.Key).FirstOrDefaultAsync(cancellationToken)) : null,
                                SubGroupCode = product.CategoryId.HasValue ? (await _dbContext.ProductCategories.AsNoTracking().Where(c => c.Id == product.CategoryId.Value).Select(c => c.Key).FirstOrDefaultAsync(cancellationToken)) : null,
                                Kod4 = product.Kod4,
                                Kod5 = product.Kod5,
                                Quantity = giftQtyNeeded,
                                UnitPrice = giftUnitPrice,
                                VatRate = 0m,
                                IsGift = true,
                                DiscountAmount = giftDiscountAmount
                            });
                        }
                        else
                        {
                            existingGift.Quantity += giftQtyNeeded;
                            existingGift.UnitPrice = giftUnitPrice;
                            existingGift.IsGift = true;
                            if (giftAccountingMode == 1)
                            {
                                existingGift.DiscountAmount = giftUnitPrice * existingGift.Quantity;
                            }
                            else
                            {
                                existingGift.DiscountAmount = 0m;
                            }
                        }
                    }

                    anyApplied = true;
                    break;
                }
                case CampaignActionType.FreeShipping:
                case CampaignActionType.PriceGroupShift:
                    // No-op: these action types are not supported in the current flow
                    break;
                default:
                    break;
            }
        }

        if (campaign.KampanyaTipi == KampanyaTipi.XAlanaYHediyeVeyaIndirimliUrun)
        {
            foreach (var d in campaign.CampaignDiscounts)
            {
                if (string.IsNullOrWhiteSpace(d.StokKodu))
                {
                    continue;
                }

                var stock = d.StokKodu.Trim();
                var discountValue = PickDiscountValue(d);
                if (!discountValue.HasValue || discountValue.Value <= 0m)
                {
                    continue;
                }

                var dRewardQty = (d.RewardQuantity ?? 1m) * multiplier;
                var appliedRewardQty = 0m;

                foreach (var line in order.Lines)
                {
                    if (appliedRewardQty >= dRewardQty) break;
                    if (line.IsGift) continue;
                    if (!string.Equals(line.StockCode, stock, StringComparison.OrdinalIgnoreCase)) continue;

                    var remainingToReward = dRewardQty - appliedRewardQty;
                    var qtyToDiscount = Math.Min(line.Quantity, remainingToReward);
                    if (qtyToDiscount <= 0) break;

                    var lineUnitTotal = line.UnitPrice * qtyToDiscount;
                    if (lineUnitTotal <= 0m) continue;

                    decimal discountAmount;
                    if (d.IskontoTipi == IskontoTipi.Oran)
                    {
                        discountAmount = (lineUnitTotal * discountValue.Value) / 100m;
                    }
                    else
                    {
                        var perUnit = discountValue.Value;
                        discountAmount = perUnit * qtyToDiscount;
                    }

                    if (discountAmount <= 0m) continue;
                    if (discountAmount > (line.UnitPrice * line.Quantity)) discountAmount = (line.UnitPrice * line.Quantity);

                    line.DiscountAmount += discountAmount;
                    appliedRewardQty += qtyToDiscount;
                    anyApplied = true;
                }
            }
        }

        if (campaign.KampanyaTipi == KampanyaTipi.UrunIndirimi)
        {
            foreach (var d in campaign.CampaignDiscounts)
            {
                var discountValue = PickDiscountValue(d);
                if (!discountValue.HasValue || discountValue.Value <= 0m)
                {
                    continue;
                }

                foreach (var line in eligibleLines)
                {
                    if (line.IsGift) continue;

                    if (!string.IsNullOrWhiteSpace(d.StokKodu))
                    {
                        if (!string.Equals(line.StockCode, d.StokKodu.Trim(), StringComparison.OrdinalIgnoreCase))
                        {
                            continue;
                        }
                    }

                    var lineTotal = line.UnitPrice * line.Quantity;
                    if (lineTotal <= 0m) continue;

                    var tip = d.IskontoTipi;
                    var deger = discountValue.Value;
                    if (d.HedefFiyat.HasValue)
                    {
                        /*
                          ÜRÜNE ÖZEL KAMPANYALI FİYAT (2026-10-07): indirim = güncel F4 − hedef.
                          Hedef F4 para biriminde, satırın F4'ü TL; aynı kurla çevrilir. F4 ya da
                          kur bilinmiyorsa satır kampanyasız kalır — yanlış tutar düşmektense.
                        */
                        if (!line.CatalogPrice.HasValue || line.CatalogPrice.Value <= 0m || line.CatalogRateToTry <= 0m) continue;
                        deger = B2B.Erp.Api.Core.Helpers.CampaignTargetPrice.Difference(
                            line.CatalogPrice.Value, d.HedefFiyat.Value * line.CatalogRateToTry);
                        if (deger <= 0m) continue;
                        tip = IskontoTipi.Tutar;
                    }

                    // İndirim F4'e uygulanır, carinin grubuna formülle taşınır (CampaignCatalogDiscount).
                    var discountAmount = ResolveUnitDiscount(order, line, tip, deger) * line.Quantity;

                    if (discountAmount <= 0m) continue;
                    if (discountAmount > lineTotal) discountAmount = lineTotal;

                    line.DiscountAmount += discountAmount;
                    anyApplied = true;
                }
            }
        }

        if (campaign.KampanyaTipi == KampanyaTipi.KategoriMarkaIndirimi)
        {
            foreach (var d in campaign.CampaignDiscounts)
            {
                var discountValue = PickDiscountValue(d);
                if (!discountValue.HasValue || discountValue.Value <= 0m)
                {
                    continue;
                }

                foreach (var line in eligibleLines)
                {
                    if (line.IsGift) continue;

                    var categoryOk = string.Equals(ToKey(line.GroupCode ?? string.Empty), ToKey(d.GrupKodu ?? string.Empty), StringComparison.OrdinalIgnoreCase) ||
                                     string.Equals(ToKey(line.SubGroupCode ?? string.Empty), ToKey(d.GrupKodu ?? string.Empty), StringComparison.OrdinalIgnoreCase);

                    if (string.IsNullOrWhiteSpace(d.GrupKodu) || categoryOk)
                    {
                        var lineTotal = line.UnitPrice * line.Quantity;
                        if (lineTotal <= 0m) continue;

                        // Ürün indirimiyle aynı kural: F4'e uygula, formülle taşı.
                        var discountAmount = ResolveUnitDiscount(order, line, d.IskontoTipi, discountValue.Value) * line.Quantity;

                        if (discountAmount <= 0m) continue;
                        if (discountAmount > lineTotal) discountAmount = lineTotal;

                        line.DiscountAmount += discountAmount;
                        anyApplied = true;
                    }
                }
            }
        }

        if (campaign.KampanyaTipi == KampanyaTipi.PaketKampanya)
        {
            var d = campaign.CampaignDiscounts.FirstOrDefault();
            if (d is not null)
            {
                var v = PickDiscountValue(d);
                if (v.HasValue && v.Value > 0m)
                {
                    var packageCondition = campaign.CampaignConditions
                        .FirstOrDefault(x => x.ConditionType == CampaignConditionType.PackageProducts);
                    if (packageCondition is not null && !string.IsNullOrWhiteSpace(packageCondition.PackageItemsJson))
                    {
                        PackageItem[] items;
                        try
                        {
                            items = JsonSerializer.Deserialize<PackageItem[]>(packageCondition.PackageItemsJson, _jsonOptions) ?? Array.Empty<PackageItem>();
                        }
                        catch
                        {
                            items = Array.Empty<PackageItem>();
                        }

                        var required = items
                            .Where(x => !string.IsNullOrWhiteSpace(x.StockCode))
                            .Select(x => new PackageItem { StockCode = x.StockCode!.Trim(), Quantity = x.Quantity })
                            .Where(x => x.Quantity > 0)
                            .GroupBy(x => x.StockCode, StringComparer.OrdinalIgnoreCase)
                            .Select(g => new { StockCode = g.Key, Quantity = g.Sum(x => x.Quantity) })
                            .ToList();

                        if (required.Count > 0)
                        {
                            var baseEligibleLines = eligibleLines
                                .Where(x => !x.IsGift)
                                .OrderBy(x => x.ProductId)
                                .ToList();

                            var allocations = new List<(OrderLineContext Line, decimal AllocatedQty)>();
                            var success = true;

                            foreach (var req in required)
                            {
                                var remaining = (decimal)req.Quantity;
                                foreach (var line in baseEligibleLines.Where(x => string.Equals(x.StockCode, req.StockCode, StringComparison.OrdinalIgnoreCase)))
                                {
                                    if (remaining <= 0) break;
                                    if (line.Quantity <= 0) continue;

                                    var alloc = Math.Min(remaining, line.Quantity);
                                    if (alloc <= 0) continue;

                                    allocations.Add((line, alloc));
                                    remaining -= alloc;
                                }

                                if (remaining > 0)
                                {
                                    success = false;
                                    break;
                                }
                            }

                            if (success && allocations.Count > 0)
                            {
                                var allocatedTotal = allocations.Sum(x => x.Line.UnitPrice * x.AllocatedQty);
                                if (allocatedTotal > 0m)
                                {
                                    decimal discountTotal;
                                    if (d.IskontoTipi == IskontoTipi.Oran)
                                    {
                                        discountTotal = (allocatedTotal * v.Value) / 100m;
                                    }
                                    else
                                    {
                                        discountTotal = allocatedTotal - v.Value;
                                    }

                                    if (discountTotal > 0m)
                                    {
                                        if (discountTotal > allocatedTotal) discountTotal = allocatedTotal;

                                        foreach (var (line, allocQty) in allocations)
                                        {
                                            var pieceTotal = line.UnitPrice * allocQty;
                                            if (pieceTotal <= 0m) continue;
                                            var share = pieceTotal / allocatedTotal;
                                            var discount = discountTotal * share;
                                            if (discount <= 0m) continue;
                                            if (discount > pieceTotal) discount = pieceTotal;
                                            line.DiscountAmount += discount;
                                            anyApplied = true;
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        return anyApplied;
    }

    private static IEnumerable<OrderLineContext> ResolveActionLines(CampaignAction action, List<OrderLineContext> eligibleLines)
    {
        if (action.TargetProductId.HasValue && action.TargetProductId.Value != Guid.Empty)
        {
            return eligibleLines.Where(x => x.ProductId == action.TargetProductId.Value);
        }

        return eligibleLines;
    }

    private static bool CompareDecimal(decimal left, decimal right, string op)
    {
        return op switch
        {
            ">=" => left >= right,
            "==" => left == right,
            _ => false
        };
    }

    private static bool CompareBool(bool value, string op)
    {
        return op switch
        {
            "==" => value,
            _ => value
        };
    }

    private static bool TryApplyQuantityTieredDiscountFixedAmount(
        Campaign campaign,
        OrderContext order,
        int? effectivePriceGroupCode,
        ref decimal orderLevelDiscountTotal,
        List<EvaluateSalesOrderAppliedCampaignDetail> appliedCampaignDetails)
    {
        if (campaign.CampaignConditions.Count == 0 || campaign.CampaignDiscounts.Count == 0)
        {
            return false;
        }

        QuantityTierTargets? targets = null;
        var targetsJson = campaign.CampaignConditions.FirstOrDefault(x => !string.IsNullOrWhiteSpace(x.ProductStockCodesJson))?.ProductStockCodesJson;
        if (!string.IsNullOrWhiteSpace(targetsJson))
        {
            try
            {
                targets = JsonSerializer.Deserialize<QuantityTierTargets>(targetsJson, _jsonOptions);
            }
            catch
            {
                return false;
            }
        }

        var targetGroupCodes = (targets?.GroupCodes ?? new List<string>())
            .Where(x => !string.IsNullOrWhiteSpace(x))
            .Select(x => x.Trim())
            .ToList();

        var targetStockCodes = (targets?.ProductStockCodes ?? new List<string>())
            .Where(x => !string.IsNullOrWhiteSpace(x))
            .Select(x => x.Trim())
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();



        var targetGroupKeys = targetGroupCodes.Select(ToKey).Where(x => x.Length > 0).ToHashSet(StringComparer.OrdinalIgnoreCase);
        var targetStockSet = targetStockCodes.ToHashSet(StringComparer.OrdinalIgnoreCase);

        bool IsLineTargeted(OrderLineContext line)
        {
            if (line.IsGift) return false;

            if (targetStockSet.Count == 0 && targetGroupKeys.Count == 0)
            {
                return true;
            }

            var byStock = targetStockSet.Count > 0 && targetStockSet.Contains(line.StockCode);
            var byGroup = targetGroupKeys.Count > 0 &&
                          (targetGroupKeys.Contains(ToKey(line.GroupCode ?? string.Empty)) ||
                           targetGroupKeys.Contains(ToKey(line.SubGroupCode ?? string.Empty)));

            if (targetStockSet.Count > 0 && targetGroupKeys.Count > 0)
            {
                return byStock || byGroup;
            }

            if (targetStockSet.Count > 0)
            {
                return byStock;
            }

            if (targetGroupKeys.Count > 0)
            {
                return byGroup;
            }

            return false;
        }

        var matchingLines = order.Lines.Where(IsLineTargeted).ToList();
        if (matchingLines.Count == 0)
        {
            return false;
        }

        var matchedQty = matchingLines.Sum(x => x.Quantity);
        if (matchedQty <= 0m)
        {
            return false;
        }

        var conditions = campaign.CampaignConditions
            .Where(x => x.Minimum.HasValue)
            .OrderBy(x => x.CreateTime)
            .ToList();

        var discounts = campaign.CampaignDiscounts
            .OrderBy(x => x.CreateTime)
            .ToList();

        var pairCount = Math.Min(conditions.Count, discounts.Count);
        if (pairCount == 0)
        {
            return false;
        }

        var bestIndex = -1;
        decimal bestMin = -1m;

        // Pass 1: Look for exact tier range match (min <= matchedQty <= max)
        for (var i = 0; i < pairCount; i++)
        {
            var c = conditions[i];
            var min = c.Minimum ?? 0m;
            var max = c.Maximum;

            if (matchedQty >= min && (!max.HasValue || matchedQty <= max.Value))
            {
                if (bestIndex < 0 || min >= bestMin)
                {
                    bestIndex = i;
                    bestMin = min;
                }
            }
        }

        // Pass 2: If matchedQty exceeds max of all tiers, fallback to highest tier where matchedQty >= min
        if (bestIndex < 0)
        {
            for (var i = 0; i < pairCount; i++)
            {
                var c = conditions[i];
                var min = c.Minimum ?? 0m;

                if (matchedQty >= min)
                {
                    if (bestIndex < 0 || min >= bestMin)
                    {
                        bestIndex = i;
                        bestMin = min;
                    }
                }
            }
        }

        if (bestIndex < 0)
        {
            return false;
        }

        var bestCondition = conditions[bestIndex];
        var bestDiscount = discounts[bestIndex];
        var pgCode = effectivePriceGroupCode;

        var discountValue = ResolveDiscountValueForPriceGroup(bestDiscount, pgCode);
        if (!discountValue.HasValue || discountValue.Value <= 0m)
        {
            return false;
        }

        var matchingTotal = matchingLines.Sum(x => x.UnitPrice * x.Quantity);
        if (matchingTotal <= 0m)
        {
            return false;
        }

        decimal discountAmount;
        if (bestDiscount.IskontoTipi == IskontoTipi.Oran)
        {
            // Indirim SADECE kampanyanin hedefledigi satirlar uzerinden hesaplanir.
            //
            // Eskiden taban sepetin tamamiydi (basketTotal): kosul dogru kapsamda olculuyor ama
            // indirim alakasiz urunlere de yayiliyordu. Ornek: hedef urunden 5 + baska urunden 10
            // adet olan sepette beklenen 100 yerine 300 indirim cikiyordu. Kampanya "belirli
            // urune indirim" demek oldugu icin taban matchingTotal olmali.
            discountAmount = (matchingTotal * discountValue.Value) / 100m;
        }
        else
        {
            discountAmount = discountValue.Value;
        }

        if (discountAmount <= 0m)
        {
            return false;
        }

        // Sabit tutarli indirim de hedef satirlarin toplamini asamaz; asarsa fazlasi
        // sepetteki diger urunlerden yenirdi.
        if (discountAmount > matchingTotal)
        {
            discountAmount = matchingTotal;
        }

        orderLevelDiscountTotal += discountAmount;

        appliedCampaignDetails.Add(new EvaluateSalesOrderAppliedCampaignDetail
        {
            CampaignId = campaign.Id,
            CampaignType = (int)campaign.KampanyaTipi,
            CampaignName = campaign.Name,
            StockCodesJson = JsonSerializer.Serialize(targetStockCodes.OrderBy(x => x).ToArray()),
            MatchedQuantity = matchedQty,
            TierMinQuantity = bestCondition.Minimum,
            TierMaxQuantity = bestCondition.Maximum,
            DiscountType = bestDiscount.IskontoTipi.ToString(),
            DiscountValue = discountValue.Value,
            AppliedDiscountAmount = discountAmount
        });

        return true;
    }

    private static EvaluateSalesOrderResponse BuildResponse(
        OrderContext order,
        List<Guid> appliedCampaignIds,
        decimal orderLevelDiscountTotal,
        List<EvaluateSalesOrderAppliedCampaignDetail> appliedCampaignDetails)
    {
        var lines = order.Lines.Select(l =>
        {
            var lineTotal = l.UnitPrice * l.Quantity;
            var net = lineTotal - l.DiscountAmount;
            if (net < 0m) net = 0m;

            /*
              KDV İNDİRİMLİ SATIR ÜZERİNDEN (2026-09-18).

              Eskiden KDV indirimsiz satırdan hesaplanıyordu ("VAT on gross, pre-discount").
              Kampanya indirimi artık F4'e uygulanıp carinin grubuna formülle taşınıyor: satırın
              birim fiyatı düşüyor, KDV de düşmüş fiyatın KDV'si olmalı. Aksi hâlde grup 1'deki
              cari 26.000'den 21.000'e inen klimayı 21.238 öderdi — kullanıcı kuralı "21'e
              düştü" idi. Sipariş ve fatura kaydı toplamı buradan (TaxTotal) okuduğu için tek
              yerde değişti; sepet ekranı da aynı kuralla hesaplıyor (SiparisCartSection).
              Sipariş geneli indirimler (sepet kampanyası) satıra dağılmadığı için KDV
              tabanını değiştirmez — eski davranış.
            */
            var tax = (net * l.VatRate) / 100m;

            return new EvaluateSalesOrderLineResponse
            {
                StockCode = l.StockCode,
                ProductName = l.ProductName,
                Quantity = l.Quantity,
                UnitPrice = l.UnitPrice,
                VatRate = l.VatRate,
                IsGift = l.IsGift,
                LineTotal = lineTotal,
                DiscountAmount = l.DiscountAmount,
                TaxAmount = tax
            };
        }).ToList();

        var subtotal = lines.Sum(x => x.LineTotal);
        var discountTotal = lines.Sum(x => x.DiscountAmount) + orderLevelDiscountTotal;
        var taxTotal = lines.Sum(x => x.TaxAmount);
        var grandTotal = subtotal - discountTotal + taxTotal;
        if (grandTotal < 0m) grandTotal = 0m;

        return new EvaluateSalesOrderResponse
        {
            CustomerCode = order.CustomerCode,
            Subtotal = subtotal,
            DiscountTotal = discountTotal,
            TaxTotal = taxTotal,
            GrandTotal = grandTotal,
            AppliedPriceGroupId = order.AppliedPriceGroupId,
            Lines = lines,
            AppliedCampaignIds = appliedCampaignIds,
            AppliedCampaignDetails = appliedCampaignDetails
        };
    }

    private static string ToKey(string s)
    {
        return (s ?? string.Empty)
            .Trim()
            .ToUpperInvariant()
            .Replace('İ', 'I')
            .Replace('ı', 'I')
            .Replace('Ğ', 'G')
            .Replace('ğ', 'G')
            .Replace('Ü', 'U')
            .Replace('ü', 'U')
            .Replace('Ş', 'S')
            .Replace('ş', 'S')
            .Replace('Ö', 'O')
            .Replace('ö', 'O')
            .Replace('Ç', 'C')
            .Replace('ç', 'C')
            .Replace("_", "")
            .Replace(" ", "");
    }
}
