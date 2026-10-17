using B2B.Erp.Api.Core.Authorization;
using B2B.Erp.Api.Core.Enums;
using B2B.Erp.Api.Core.Interfaces;
using B2B.Erp.Api.Data;
using B2B.Erp.Api.Data.Services;
using B2B.Erp.Api.Dtos.Campaigns;
using B2B.Erp.Api.Entities;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using System.ComponentModel.DataAnnotations;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace B2B.Erp.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
[Authorize]
public sealed class CampaignsController : ControllerBase
{
    /// <summary>
    /// İsteği yapan kullanıcının rolü kampanyalardan yararlanabiliyor mu
    /// (<see cref="B2B.Erp.Api.Entities.Role.CampaignsEnabled"/>).
    ///
    /// Kuralın ikizi <c>CampaignService</c>'te; biri listelemeyi, diğeri uygulamayı kapatıyor.
    /// Rol çözülemezse AÇIK kabul edilir: bu bir yetki sınırı değil ticari tercih.
    /// </summary>
    private async Task<bool> AreCampaignsEnabledForCurrentUserAsync(CancellationToken cancellationToken)
    {
        if (User?.Identity?.IsAuthenticated != true) return true;

        var roleIdClaim = User.Claims
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

    private readonly AppDbContext _dbContext;
    private readonly ICampaignService _campaignService;
    private readonly B2B.Erp.Api.Features.Currency.ICurrencyRateService _money;

    public CampaignsController(
        AppDbContext dbContext,
        ICampaignService campaignService,
        B2B.Erp.Api.Features.Currency.ICurrencyRateService money)
    {
        _dbContext = dbContext;
        _campaignService = campaignService;
        _money = money;
    }

    [AuthorizePage("users", "kampanya")]
    [HttpPost("category-brand-discount")]
    public async Task<IActionResult> CreateCategoryBrandDiscount([FromBody] CreateCategoryBrandDiscountRequest? request, CancellationToken cancellationToken)
    {
        if (request is null)
        {
            return BadRequest(new
            {
                success = false,
                message = "Request body boş veya geçersiz. Lütfen Content-Type: application/json ve geçerli JSON gönderildiğini kontrol edin."
            });
        }

        static DateTime NormalizeToUtc(DateTime dt)
        {
            return dt.Kind switch
            {
                DateTimeKind.Utc => dt,
                DateTimeKind.Local => dt.ToUniversalTime(),
                _ => DateTime.SpecifyKind(dt, DateTimeKind.Utc)
            };
        }

        static bool TryParseDiscountType(string raw, out IskontoTipi parsed)
        {
            parsed = default;
            var s = (raw ?? string.Empty).Trim();
            if (string.IsNullOrWhiteSpace(s)) return false;

            if (int.TryParse(s, out var i))
            {
                if (i == 1) { parsed = IskontoTipi.Tutar; return true; }
                if (i == 2) { parsed = IskontoTipi.Oran; return true; }
                return false;
            }

            if (string.Equals(s, "tutar", StringComparison.OrdinalIgnoreCase)) { parsed = IskontoTipi.Tutar; return true; }
            if (string.Equals(s, "oran", StringComparison.OrdinalIgnoreCase)) { parsed = IskontoTipi.Oran; return true; }
            return false;
        }

        var name = (request.Name ?? string.Empty).Trim();
        if (string.IsNullOrWhiteSpace(name))
        {
            ModelState.AddModelError(nameof(request.Name), "Name is required.");
        }

        var start = NormalizeToUtc(request.StartDate);
        var end = NormalizeToUtc(request.EndDate);
        if (end < start)
        {
            ModelState.AddModelError(nameof(request.EndDate), "EndDate must be greater than or equal to StartDate.");
        }

        var categoryCode = (request.CategoryCode ?? string.Empty).Trim();
        if (string.IsNullOrWhiteSpace(categoryCode))
        {
            ModelState.AddModelError(nameof(request.CategoryCode), "Kategori (CategoryCode) zorunludur.");
        }

        var brandField = string.IsNullOrWhiteSpace(request.BrandField) ? null : request.BrandField.Trim();
        var brandCode = string.IsNullOrWhiteSpace(request.BrandCode) ? null : request.BrandCode.Trim();

        if (brandField is not null)
        {
            if (!string.Equals(brandField, "KOD4", StringComparison.OrdinalIgnoreCase) &&
                !string.Equals(brandField, "KOD5", StringComparison.OrdinalIgnoreCase) &&
                !string.Equals(brandField, "SUBCATEGORY", StringComparison.OrdinalIgnoreCase))
            {
                ModelState.AddModelError(nameof(request.BrandField), "BrandField geçersiz. KOD4, KOD5 veya SUBCATEGORY olmalıdır.");
            }
        }

        if (brandCode is null && brandField is not null)
        {
            ModelState.AddModelError(nameof(request.BrandCode), "BrandField seçildiyse BrandCode zorunludur.");
        }

        if (brandCode is not null && brandField is null)
        {
            ModelState.AddModelError(nameof(request.BrandField), "BrandCode seçildiyse BrandField zorunludur.");
        }

        if (!TryParseDiscountType(request.DiscountType, out var discountType))
        {
            ModelState.AddModelError(nameof(request.DiscountType), "DiscountType is required. Allowed: Tutar, Oran, 1, 2.");
        }

        if (request.DiscountValue < 0)
        {
            ModelState.AddModelError(nameof(request.DiscountValue), "DiscountValue must be >= 0.");
        }

        var priceGroupCodes = (request.PriceGroupCodes ?? new List<int>())
            .Where(x => x >= 1)
            .Distinct()
            .ToList();
        if (priceGroupCodes.Count == 0)
        {
            priceGroupCodes = await _dbContext.PriceGroups.Where(p => p.IsActive).Select(p => (int)p.Code).ToListAsync(cancellationToken);
            if (priceGroupCodes.Count == 0) priceGroupCodes = new List<int> { 1, 2, 3, 4, 5, 6, 7 };
        }

        if (!ModelState.IsValid)
        {
            return ValidationProblem(ModelState);
        }

        var groupExists = await CheckGroupExistsAsync(categoryCode, cancellationToken);
        if (!groupExists)
        {
            return BadRequest(new { success = false, message = "Kategori bulunamadı (CategoryCode)." });
        }

        var user = User.Identity?.Name ?? "System";
        var now = DateTime.UtcNow;

        await using var tx = await _dbContext.Database.BeginTransactionAsync(cancellationToken);

        var campaign = new Campaign
        {
            Id = Guid.NewGuid(),
            Name = name,
            Description = string.IsNullOrWhiteSpace(request.Description) ? null : request.Description.Trim(),
            StartDate = start,
            EndDate = end,
            IsIndefinite = false,
            Priority = request.Priority,
            IsActive = true,
            StopNext = request.StopNext,
            KampanyaTipi = KampanyaTipi.KategoriMarkaIndirimi,
            SubeKodu = string.IsNullOrWhiteSpace(request.SubeKodu) ? null : request.SubeKodu.Trim(),
            CreateUser = user,
            CreateTime = now,
            IsDeleted = false
        };

        _dbContext.Campaigns.Add(campaign);

        // Bayi hedefleri. Bos liste = tum bayiler (IsTargetMatch hedefi olmayani herkese acik sayar).
        ApplyDealerTargets(campaign, request.DealerCodes, user, now);

        campaign.CampaignConditions.Add(new CampaignCondition
        {
            Id = Guid.NewGuid(),
            CampaignId = campaign.Id,
            ConditionType = CampaignConditionType.CategoryBased,
            TargetId = null,
            Operator = string.Empty,
            Value = 0m,
            Metric = null,
            Minimum = null,
            Maximum = null,
            CategoryCode = categoryCode,
            BrandField = brandField,
            BrandCode = brandCode,
            ProductStockCodesJson = null,
            CreateUser = user,
            CreateTime = now,
            IsDeleted = false
        });

        static decimal? PickPrice(decimal value, bool selected)
        {
            return selected ? value : null;
        }

        _dbContext.CampaignDiscounts.Add(new CampaignDiscount
        {
            Id = Guid.NewGuid(),
            CampaignId = campaign.Id,
            StokKodu = null,
            GrupKodu = categoryCode,
            MinSepetTutari = 0m,
            IskontoTipi = discountType,
            Deger = request.DiscountValue,
            IskontoFiyat1 = PickPrice(request.DiscountValue, priceGroupCodes.Contains(1)),
            IskontoFiyat2 = PickPrice(request.DiscountValue, priceGroupCodes.Contains(2)),
            IskontoFiyat3 = PickPrice(request.DiscountValue, priceGroupCodes.Contains(3)),
            IskontoFiyat4 = PickPrice(request.DiscountValue, priceGroupCodes.Contains(4)),
            IskontoFiyat5 = PickPrice(request.DiscountValue, priceGroupCodes.Contains(5)),
            IskontoFiyat6 = PickPrice(request.DiscountValue, priceGroupCodes.Contains(6)),
            // Sinirsiz fiyat grubu kaynagi. Yukaridaki IskontoFiyat1..6 GERIYE DONUK UYUM icin
            // yazilmaya devam ediyor; okuma tarafi once bu listeye bakar.
            PriceGroups = BuildPriceGroups(priceGroupCodes, request.DiscountValue, user, now),
            CreateUser = user,
            CreateTime = now,
            IsDeleted = false
        });

        await _dbContext.SaveChangesAsync(cancellationToken);
        await tx.CommitAsync(cancellationToken);

        return Ok(new { success = true, data = new { id = campaign.Id } });
    }

    public sealed class PatchCategoryBrandDiscountRequest
    {

        /// <summary>
        /// Uygulama sırası; BÜYÜK olan ÖNCE uygulanır. null gönderilirse mevcut değer korunur.
        /// Oluştururken verilebiliyordu ama düzenlerken değiştirilemiyordu.
        /// </summary>
        [Range(0, 1000)]
        public int? Priority { get; set; }

        /// <summary>
        /// Bu kampanya uygulandıysa SONRAKİ kampanyalar hiç denenmesin.
        /// Varlıkta ve değerlendiricide vardı ama hiçbir uçtan ayarlanamıyordu; her kampanya
        /// zorunlu olarak false ile kaydediliyor, yani kampanyalar her zaman üst üste biniyordu.
        /// </summary>
        public bool? StopNext { get; set; }
        public string? Name { get; set; }
        public string? Description { get; set; }
        public DateTime? StartDate { get; set; }
        public DateTime? EndDate { get; set; }
        public string? CategoryCode { get; set; }
        public string? BrandField { get; set; }
        public string? BrandCode { get; set; }
        public string? DiscountType { get; set; }
        public decimal? DiscountValue { get; set; }
        public List<int>? PriceGroupCodes { get; set; }

        /// <summary>
        /// Kampanyanın uygulanacağı bayiler (cari kodları). BOŞ/NULL = tüm bayiler.
        ///
        /// Hedefleme altyapısı (CampaignTargets + IsTargetMatch) zaten vardı ama hiçbir uç
        /// hedef almıyordu; ekrandaki bayi seçimi hiçbir yere gitmiyordu. Buradan gelen
        /// kodlar SpecificCustomer hedefi olarak yazılır.
        /// </summary>
        public List<string>? DealerCodes { get; set; }
        public string? SubeKodu { get; set; }
    }

    [HttpPatch("category-brand-discount/{id:guid}")]
    public async Task<IActionResult> PatchCategoryBrandDiscount([FromRoute] Guid id, [FromBody] PatchCategoryBrandDiscountRequest? request, CancellationToken cancellationToken)
    {
        if (request is null)
        {
            return BadRequest(new { success = false, message = "Request body boş veya geçersiz." });
        }

        static DateTime NormalizeToUtc(DateTime dt)
        {
            return dt.Kind switch
            {
                DateTimeKind.Utc => dt,
                DateTimeKind.Local => dt.ToUniversalTime(),
                _ => DateTime.SpecifyKind(dt, DateTimeKind.Utc)
            };
        }

        static bool TryParseDiscountType(string raw, out IskontoTipi parsed)
        {
            parsed = default;
            var s = (raw ?? string.Empty).Trim();
            if (string.IsNullOrWhiteSpace(s)) return false;

            if (int.TryParse(s, out var i))
            {
                if (i == 1) { parsed = IskontoTipi.Tutar; return true; }
                if (i == 2) { parsed = IskontoTipi.Oran; return true; }
                return false;
            }

            if (string.Equals(s, "tutar", StringComparison.OrdinalIgnoreCase)) { parsed = IskontoTipi.Tutar; return true; }
            if (string.Equals(s, "oran", StringComparison.OrdinalIgnoreCase)) { parsed = IskontoTipi.Oran; return true; }
            return false;
        }

        var campaign = await _dbContext.Campaigns
            .Include(x => x.CampaignConditions)
            .Include(x => x.CampaignDiscounts)
            .Include(x => x.CampaignTargets)
            .FirstOrDefaultAsync(x => x.Id == id, cancellationToken);

        if (campaign is null || campaign.IsDeleted)
        {
            return NotFound(new { success = false, message = "Campaign not found." });
        }

        if (campaign.KampanyaTipi != KampanyaTipi.KategoriMarkaIndirimi)
        {
            return BadRequest(new { success = false, message = "Campaign type mismatch." });
        }

        var user = User.Identity?.Name ?? "System";
        var now = DateTime.UtcNow;

        // Current active rows
        var currentCondition = campaign.CampaignConditions
            .Where(x => !x.IsDeleted)
            .OrderByDescending(x => x.CreateTime)
            .FirstOrDefault();

        var currentDiscount = campaign.CampaignDiscounts
            .Where(x => !x.IsDeleted)
            .OrderByDescending(x => x.CreateTime)
            .FirstOrDefault();

        if (currentCondition is null || currentDiscount is null)
        {
            return BadRequest(new { success = false, message = "Campaign detail rows not found for patch." });
        }

        // Patch base fields (null => keep, empty => clear)
        if (request.Name is not null)
        {
            var n = request.Name.Trim();
            if (string.IsNullOrWhiteSpace(n)) return BadRequest(new { success = false, message = "Name is required." });
            campaign.Name = n;
        }

        if (request.Description is not null)
        {
            var d = request.Description.Trim();
            campaign.Description = string.IsNullOrWhiteSpace(d) ? null : d;
        }

        // Öncelik ve zincir kesme, ad/açıklama ile aynı kalıpta: gönderilmezse dokunulmaz.
        // DIKKAT: bu iki satir aciklama blogunun DISINDA kalmali. Icine dusurulurse oncelik
        // ancak aciklama da gonderildiginde kaydedilir; canli testte tam boyle yakalandi.
        if (request.Priority.HasValue) campaign.Priority = request.Priority.Value;
        if (request.StopNext.HasValue) campaign.StopNext = request.StopNext.Value;

        // Bayi hedefleri. null = alan gonderilmemis = dokunma; bos dizi = kisiti kaldir.
        ApplyDealerTargets(campaign, request.DealerCodes, user, now);

        if (request.StartDate.HasValue)
        {
            campaign.StartDate = NormalizeToUtc(request.StartDate.Value);
        }

        if (request.EndDate.HasValue)
        {
            campaign.EndDate = NormalizeToUtc(request.EndDate.Value);
        }

        if (campaign.StartDate.HasValue && campaign.EndDate.HasValue && campaign.EndDate < campaign.StartDate)
        {
            return BadRequest(new { success = false, message = "EndDate must be greater than or equal to StartDate." });
        }

        if (request.SubeKodu is not null)
        {
            var sk = request.SubeKodu.Trim();
            campaign.SubeKodu = string.IsNullOrWhiteSpace(sk) ? null : sk;
        }

        // Patch condition if any condition-related field provided
        var conditionTouched = request.CategoryCode is not null || request.BrandField is not null || request.BrandCode is not null;
        if (conditionTouched)
        {
            var nextCategory = request.CategoryCode is null ? (currentCondition.CategoryCode ?? string.Empty) : request.CategoryCode.Trim();
            if (string.IsNullOrWhiteSpace(nextCategory))
            {
                return BadRequest(new { success = false, message = "Kategori (CategoryCode) zorunludur." });
            }

            var nextBrandField = request.BrandField is null ? currentCondition.BrandField : request.BrandField.Trim();
            var nextBrandCode = request.BrandCode is null ? currentCondition.BrandCode : request.BrandCode.Trim();

            // empty string => clear
            if (string.IsNullOrWhiteSpace(nextBrandField)) nextBrandField = null;
            if (string.IsNullOrWhiteSpace(nextBrandCode)) nextBrandCode = null;

            if (nextBrandField is not null)
            {
                if (!string.Equals(nextBrandField, "KOD4", StringComparison.OrdinalIgnoreCase) &&
                    !string.Equals(nextBrandField, "KOD5", StringComparison.OrdinalIgnoreCase) &&
                    !string.Equals(nextBrandField, "SUBCATEGORY", StringComparison.OrdinalIgnoreCase))
                {
                    return BadRequest(new { success = false, message = "BrandField geçersiz. KOD4, KOD5 veya SUBCATEGORY olmalıdır." });
                }
            }

            if (nextBrandField is not null && nextBrandCode is null)
            {
                return BadRequest(new { success = false, message = "BrandField seçildiyse BrandCode zorunludur." });
            }

            if (nextBrandCode is not null && nextBrandField is null)
            {
                return BadRequest(new { success = false, message = "BrandCode seçildiyse BrandField zorunludur." });
            }

            var groupExists = await CheckGroupExistsAsync(nextCategory, cancellationToken);
            if (!groupExists)
            {
                return BadRequest(new { success = false, message = "Kategori bulunamadı (CategoryCode)." });
            }

            // Replace condition row (soft-delete old, add new)
            currentCondition.IsDeleted = true;
            currentCondition.EditUser = user;
            currentCondition.EditTime = now;

            campaign.CampaignConditions.Add(new CampaignCondition
            {
                Id = Guid.NewGuid(),
                CampaignId = campaign.Id,
                ConditionType = CampaignConditionType.CategoryBased,
                TargetId = null,
                Operator = string.Empty,
                Value = 0m,
                Metric = null,
                Minimum = null,
                Maximum = null,
                CategoryCode = nextCategory,
                BrandField = nextBrandField,
                BrandCode = nextBrandCode,
                ProductStockCodesJson = null,
                CreateUser = user,
                CreateTime = now,
                IsDeleted = false
            });

            // keep discount's GrupKodu aligned with category
            currentDiscount.GrupKodu = nextCategory;
        }

        // Patch discount if any discount-related field provided
        var discountTouched = request.DiscountType is not null || request.DiscountValue.HasValue || request.PriceGroupCodes is not null;
        if (discountTouched)
        {
            var nextDiscountTypeRaw = request.DiscountType is null ? currentDiscount.IskontoTipi.ToString() : request.DiscountType;
            if (!TryParseDiscountType(nextDiscountTypeRaw, out var nextDiscountType))
            {
                return BadRequest(new { success = false, message = "DiscountType is required. Allowed: Tutar, Oran, 1, 2." });
            }

            var nextDiscountValue = request.DiscountValue ?? currentDiscount.Deger;
            if (nextDiscountValue < 0)
            {
                return BadRequest(new { success = false, message = "DiscountValue must be >= 0." });
            }
            if (nextDiscountType == IskontoTipi.Oran && nextDiscountValue > 100)
            {
                return BadRequest(new { success = false, message = "Oran (%) 100'den büyük olamaz." });
            }

            var selected = request.PriceGroupCodes;
            List<int> selectedGroups;
            if (selected is null)
            {
                selectedGroups = new List<int>();
                if (currentDiscount.IskontoFiyat1 is not null) selectedGroups.Add(1);
                if (currentDiscount.IskontoFiyat2 is not null) selectedGroups.Add(2);
                if (currentDiscount.IskontoFiyat3 is not null) selectedGroups.Add(3);
                if (currentDiscount.IskontoFiyat4 is not null) selectedGroups.Add(4);
                if (currentDiscount.IskontoFiyat5 is not null) selectedGroups.Add(5);
                if (currentDiscount.IskontoFiyat6 is not null) selectedGroups.Add(6);
            }
            else
            {
                selectedGroups = selected
                    .Where(x => x >= 1)
                    .Distinct()
                    .ToList();
            }

            if (selectedGroups.Count == 0)
            {
                selectedGroups = await _dbContext.PriceGroups.Where(p => p.IsActive).Select(p => (int)p.Code).ToListAsync(cancellationToken);
                if (selectedGroups.Count == 0) selectedGroups = new List<int> { 1, 2, 3, 4, 5, 6, 7 };
            }

            static decimal? PickPrice(decimal value, bool selectedFlag)
            {
                return selectedFlag ? value : null;
            }

            // Replace discount row (soft-delete old, add new)
            currentDiscount.IsDeleted = true;
            currentDiscount.EditUser = user;
            currentDiscount.EditTime = now;

            _dbContext.CampaignDiscounts.Add(new CampaignDiscount
            {
                Id = Guid.NewGuid(),
                CampaignId = campaign.Id,
                StokKodu = null,
                GrupKodu = (conditionTouched ? request.CategoryCode?.Trim() : currentDiscount.GrupKodu) ?? currentDiscount.GrupKodu,
                MinSepetTutari = currentDiscount.MinSepetTutari,
                IskontoTipi = nextDiscountType,
                Deger = nextDiscountValue,
                IskontoFiyat1 = PickPrice(nextDiscountValue, selectedGroups.Contains(1)),
                IskontoFiyat2 = PickPrice(nextDiscountValue, selectedGroups.Contains(2)),
                IskontoFiyat3 = PickPrice(nextDiscountValue, selectedGroups.Contains(3)),
                IskontoFiyat4 = PickPrice(nextDiscountValue, selectedGroups.Contains(4)),
                IskontoFiyat5 = PickPrice(nextDiscountValue, selectedGroups.Contains(5)),
                IskontoFiyat6 = PickPrice(nextDiscountValue, selectedGroups.Contains(6)),
                // Sinirsiz fiyat grubu kaynagi. Yukaridaki IskontoFiyat1..6 GERIYE DONUK UYUM icin
                // yazilmaya devam ediyor; okuma tarafi once bu listeye bakar.
                PriceGroups = BuildPriceGroups(selectedGroups, nextDiscountValue, user, now),
                CreateUser = user,
                CreateTime = now,
                IsDeleted = false
            });
        }

        campaign.EditUser = user;
        campaign.EditTime = now;

        await _dbContext.SaveChangesAsync(cancellationToken);
        return Ok(new { success = true, data = new { id = campaign.Id } });
    }

    [AuthorizePage("users", "kampanya")]
    [HttpPut("category-brand-discount/{id:guid}")]
    public async Task<IActionResult> UpdateCategoryBrandDiscount([FromRoute] Guid id, [FromBody] CreateCategoryBrandDiscountRequest? request, CancellationToken cancellationToken)
    {
        if (request is null)
        {
            return BadRequest(new { success = false, message = "Request body boş veya geçersiz." });
        }

        static DateTime NormalizeToUtc(DateTime dt)
        {
            return dt.Kind switch
            {
                DateTimeKind.Utc => dt,
                DateTimeKind.Local => dt.ToUniversalTime(),
                _ => DateTime.SpecifyKind(dt, DateTimeKind.Utc)
            };
        }

        static bool TryParseDiscountType(string raw, out IskontoTipi parsed)
        {
            parsed = default;
            var s = (raw ?? string.Empty).Trim();
            if (string.IsNullOrWhiteSpace(s)) return false;

            if (int.TryParse(s, out var i))
            {
                if (i == 1) { parsed = IskontoTipi.Tutar; return true; }
                if (i == 2) { parsed = IskontoTipi.Oran; return true; }
                return false;
            }

            if (string.Equals(s, "tutar", StringComparison.OrdinalIgnoreCase)) { parsed = IskontoTipi.Tutar; return true; }
            if (string.Equals(s, "oran", StringComparison.OrdinalIgnoreCase)) { parsed = IskontoTipi.Oran; return true; }
            return false;
        }

        var name = (request.Name ?? string.Empty).Trim();
        if (string.IsNullOrWhiteSpace(name))
        {
            ModelState.AddModelError(nameof(request.Name), "Name is required.");
        }

        var start = NormalizeToUtc(request.StartDate);
        var end = NormalizeToUtc(request.EndDate);
        if (end < start)
        {
            ModelState.AddModelError(nameof(request.EndDate), "EndDate must be greater than or equal to StartDate.");
        }

        var categoryCode = (request.CategoryCode ?? string.Empty).Trim();
        if (string.IsNullOrWhiteSpace(categoryCode))
        {
            ModelState.AddModelError(nameof(request.CategoryCode), "Kategori (CategoryCode) zorunludur.");
        }

        var brandField = string.IsNullOrWhiteSpace(request.BrandField) ? null : request.BrandField.Trim();
        var brandCode = string.IsNullOrWhiteSpace(request.BrandCode) ? null : request.BrandCode.Trim();

        if (brandField is not null)
        {
            if (!string.Equals(brandField, "KOD4", StringComparison.OrdinalIgnoreCase) &&
                !string.Equals(brandField, "KOD5", StringComparison.OrdinalIgnoreCase))
            {
                ModelState.AddModelError(nameof(request.BrandField), "BrandField geçersiz. KOD4 veya KOD5 olmalıdır.");
            }
        }

        if (brandCode is null && brandField is not null)
        {
            ModelState.AddModelError(nameof(request.BrandCode), "BrandField seçildiyse BrandCode zorunludur.");
        }

        if (brandCode is not null && brandField is null)
        {
            ModelState.AddModelError(nameof(request.BrandField), "BrandCode seçildiyse BrandField zorunludur.");
        }

        if (!TryParseDiscountType(request.DiscountType, out var discountType))
        {
            ModelState.AddModelError(nameof(request.DiscountType), "DiscountType is required. Allowed: Tutar, Oran, 1, 2.");
        }

        if (request.DiscountValue < 0)
        {
            ModelState.AddModelError(nameof(request.DiscountValue), "DiscountValue must be >= 0.");
        }

        var priceGroupCodes = (request.PriceGroupCodes ?? new List<int>())
            .Where(x => x >= 1)
            .Distinct()
            .ToList();
        if (priceGroupCodes.Count == 0)
        {
            priceGroupCodes = await _dbContext.PriceGroups.Where(p => p.IsActive).Select(p => (int)p.Code).ToListAsync(cancellationToken);
            if (priceGroupCodes.Count == 0) priceGroupCodes = new List<int> { 1, 2, 3, 4, 5, 6, 7 };
        }

        if (!ModelState.IsValid)
        {
            return ValidationProblem(ModelState);
        }

        var campaign = await _dbContext.Campaigns
            .Include(x => x.CampaignConditions)
            .Include(x => x.CampaignDiscounts)
            .Include(x => x.CampaignTargets)
            .FirstOrDefaultAsync(x => x.Id == id, cancellationToken);

        if (campaign is null || campaign.IsDeleted)
        {
            return NotFound(new { success = false, message = "Campaign not found." });
        }

        if (campaign.KampanyaTipi != KampanyaTipi.KategoriMarkaIndirimi)
        {
            return BadRequest(new { success = false, message = "Campaign type mismatch." });
        }

        var groupExists = await CheckGroupExistsAsync(categoryCode, cancellationToken);
        if (!groupExists)
        {
            return BadRequest(new { success = false, message = "Kategori bulunamadı (CategoryCode)." });
        }

        var user = User.Identity?.Name ?? "System";
        var now = DateTime.UtcNow;

        await using var tx = await _dbContext.Database.BeginTransactionAsync(cancellationToken);

        campaign.Name = name;
        campaign.Description = string.IsNullOrWhiteSpace(request.Description) ? null : request.Description.Trim();
        // Öncelik ve zincir kesme PUT'ta da güncellenir. Bu iki uç (kategori/marka ve paket)
        // atlanmıştı: modal değeri gönderiyor, uç sessizce yok sayıyor ve kullanıcı önceliği
        // değiştirdim sanıyordu. PUT tam değiştirme olduğu için değer koşulsuz yazılır.
        campaign.Priority = request.Priority;
        campaign.StopNext = request.StopNext;
        campaign.StartDate = start;
        campaign.EndDate = end;
        campaign.EditUser = user;
        campaign.EditTime = now;

        foreach (var existing in campaign.CampaignConditions)
        {
            existing.IsDeleted = true;
            existing.EditUser = user;
            existing.EditTime = now;
        }

        foreach (var existing in campaign.CampaignDiscounts)
        {
            existing.IsDeleted = true;
            existing.EditUser = user;
            existing.EditTime = now;
        }

        campaign.CampaignConditions.Add(new CampaignCondition
        {
            Id = Guid.NewGuid(),
            CampaignId = campaign.Id,
            ConditionType = CampaignConditionType.CategoryBased,
            TargetId = null,
            Operator = string.Empty,
            Value = 0m,
            Metric = null,
            Minimum = null,
            Maximum = null,
            CategoryCode = categoryCode,
            BrandField = brandField,
            BrandCode = brandCode,
            ProductStockCodesJson = null,
            CreateUser = user,
            CreateTime = now,
            IsDeleted = false
        });

        static decimal? PickPrice(decimal value, bool selected)
        {
            return selected ? value : null;
        }

        _dbContext.CampaignDiscounts.Add(new CampaignDiscount
        {
            Id = Guid.NewGuid(),
            CampaignId = campaign.Id,
            StokKodu = null,
            GrupKodu = categoryCode,
            MinSepetTutari = 0m,
            IskontoTipi = discountType,
            Deger = request.DiscountValue,
            IskontoFiyat1 = PickPrice(request.DiscountValue, priceGroupCodes.Contains(1)),
            IskontoFiyat2 = PickPrice(request.DiscountValue, priceGroupCodes.Contains(2)),
            IskontoFiyat3 = PickPrice(request.DiscountValue, priceGroupCodes.Contains(3)),
            IskontoFiyat4 = PickPrice(request.DiscountValue, priceGroupCodes.Contains(4)),
            IskontoFiyat5 = PickPrice(request.DiscountValue, priceGroupCodes.Contains(5)),
            IskontoFiyat6 = PickPrice(request.DiscountValue, priceGroupCodes.Contains(6)),
            // Sinirsiz fiyat grubu kaynagi. Yukaridaki IskontoFiyat1..6 GERIYE DONUK UYUM icin
            // yazilmaya devam ediyor; okuma tarafi once bu listeye bakar.
            PriceGroups = BuildPriceGroups(priceGroupCodes, request.DiscountValue, user, now),
            CreateUser = user,
            CreateTime = now,
            IsDeleted = false
        });

        await _dbContext.SaveChangesAsync(cancellationToken);
        await tx.CommitAsync(cancellationToken);

        return Ok(new { success = true, data = new { id = campaign.Id } });
    }

    [AuthorizePage("users", "kampanya")]
    [HttpPost("package-campaign")]
    public async Task<IActionResult> CreatePackageCampaign([FromBody] CreatePackageCampaignRequest? request, CancellationToken cancellationToken)
    {
        if (request is null)
        {
            return BadRequest(new
            {
                success = false,
                message = "Request body boş veya geçersiz. Lütfen Content-Type: application/json ve geçerli JSON gönderildiğini kontrol edin."
            });
        }

        static DateTime NormalizeToUtc(DateTime dt)
        {
            return dt.Kind switch
            {
                DateTimeKind.Utc => dt,
                DateTimeKind.Local => dt.ToUniversalTime(),
                _ => DateTime.SpecifyKind(dt, DateTimeKind.Utc)
            };
        }

        static bool TryParseDiscountType(string raw, out IskontoTipi parsed)
        {
            parsed = default;
            var s = (raw ?? string.Empty).Trim();
            if (string.IsNullOrWhiteSpace(s)) return false;

            if (int.TryParse(s, out var i))
            {
                if (i == 1) { parsed = IskontoTipi.Tutar; return true; }
                if (i == 2) { parsed = IskontoTipi.Oran; return true; }
                return false;
            }

            if (string.Equals(s, "tutar", StringComparison.OrdinalIgnoreCase)) { parsed = IskontoTipi.Tutar; return true; }
            if (string.Equals(s, "oran", StringComparison.OrdinalIgnoreCase)) { parsed = IskontoTipi.Oran; return true; }
            return false;
        }

        var name = (request.Name ?? string.Empty).Trim();
        if (string.IsNullOrWhiteSpace(name))
        {
            ModelState.AddModelError(nameof(request.Name), "Name is required.");
        }

        var start = NormalizeToUtc(request.StartDate);
        var end = NormalizeToUtc(request.EndDate);
        if (end < start)
        {
            ModelState.AddModelError(nameof(request.EndDate), "EndDate must be greater than or equal to StartDate.");
        }

        if (!TryParseDiscountType(request.OperationType, out var operationType))
        {
            ModelState.AddModelError(nameof(request.OperationType), "OperationType is required. Allowed: Tutar (sabit paket fiyatı), Oran (% indirim).");
        }

        if (request.OperationValue < 0)
        {
            ModelState.AddModelError(nameof(request.OperationValue), "OperationValue must be >= 0.");
        }

        var items = (request.Items ?? new List<CreatePackageItem>())
            .Where(x => x is not null)
            .Select(x => new CreatePackageItem
            {
                GroupCode = (x.GroupCode ?? string.Empty).Trim(),
                StockCode = (x.StockCode ?? string.Empty).Trim(),
                Quantity = x.Quantity
            })
            .Where(x => !string.IsNullOrWhiteSpace(x.StockCode))
            .Where(x => x.Quantity > 0)
            .ToList();

        if (items.Count == 0)
        {
            ModelState.AddModelError(nameof(request.Items), "Pakete en az 1 ürün eklenmelidir.");
        }

        var priceGroupCodes = (request.PriceGroupCodes ?? new List<int>())
            .Where(x => x >= 1)
            .Distinct()
            .ToList();
        if (priceGroupCodes.Count == 0)
        {
            priceGroupCodes = await _dbContext.PriceGroups.Where(p => p.IsActive).Select(p => (int)p.Code).ToListAsync(cancellationToken);
            if (priceGroupCodes.Count == 0) priceGroupCodes = new List<int> { 1, 2, 3, 4, 5, 6, 7 };
        }

        if (!ModelState.IsValid)
        {
            return ValidationProblem(ModelState);
        }

        var distinctStockCodes = items
            .Select(x => x.StockCode)
            .Where(x => !string.IsNullOrWhiteSpace(x))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();

        var existingStockCodes = await _dbContext.Products
            .AsNoTracking()
            .Where(x => distinctStockCodes.Contains(x.StockCode))
            .Select(x => x.StockCode)
            .ToListAsync(cancellationToken);

        var missing = distinctStockCodes
            .Where(sc => !existingStockCodes.Contains(sc, StringComparer.OrdinalIgnoreCase))
            .ToList();
        if (missing.Count > 0)
        {
            return BadRequest(new { success = false, message = $"Pakette bulunmayan stok kodu(ları) var: {string.Join(", ", missing)}" });
        }

        var user = User.Identity?.Name ?? "System";
        var now = DateTime.UtcNow;

        await using var tx = await _dbContext.Database.BeginTransactionAsync(cancellationToken);

        var campaign = new Campaign
        {
            Id = Guid.NewGuid(),
            Name = name,
            Description = string.IsNullOrWhiteSpace(request.Description) ? null : request.Description.Trim(),
            StartDate = start,
            EndDate = end,
            IsIndefinite = false,
            Priority = request.Priority,
            IsActive = true,
            StopNext = request.StopNext,
            KampanyaTipi = KampanyaTipi.PaketKampanya,
            SubeKodu = string.IsNullOrWhiteSpace(request.SubeKodu) ? null : request.SubeKodu.Trim(),
            CreateUser = user,
            CreateTime = now,
            IsDeleted = false
        };

        _dbContext.Campaigns.Add(campaign);

        // Bayi hedefleri. Bos liste = tum bayiler (IsTargetMatch hedefi olmayani herkese acik sayar).
        ApplyDealerTargets(campaign, request.DealerCodes, user, now);

        var packageJson = JsonSerializer.Serialize(items.Select(x => new { stockCode = x.StockCode, quantity = x.Quantity }));

        campaign.CampaignConditions.Add(new CampaignCondition
        {
            Id = Guid.NewGuid(),
            CampaignId = campaign.Id,
            ConditionType = CampaignConditionType.PackageProducts,
            TargetId = null,
            Operator = string.Empty,
            Value = 0m,
            Metric = null,
            Minimum = null,
            Maximum = null,
            CategoryCode = null,
            BrandField = null,
            BrandCode = null,
            PackageItemsJson = packageJson,
            ProductStockCodesJson = null,
            CreateUser = user,
            CreateTime = now,
            IsDeleted = false
        });

        static decimal? PickPrice(decimal value, bool selected)
        {
            return selected ? value : null;
        }

        _dbContext.CampaignDiscounts.Add(new CampaignDiscount
        {
            Id = Guid.NewGuid(),
            CampaignId = campaign.Id,
            StokKodu = null,
            GrupKodu = null,
            MinSepetTutari = 0m,
            IskontoTipi = operationType,
            Deger = request.OperationValue,
            IskontoFiyat1 = PickPrice(request.OperationValue, priceGroupCodes.Contains(1)),
            IskontoFiyat2 = PickPrice(request.OperationValue, priceGroupCodes.Contains(2)),
            IskontoFiyat3 = PickPrice(request.OperationValue, priceGroupCodes.Contains(3)),
            IskontoFiyat4 = PickPrice(request.OperationValue, priceGroupCodes.Contains(4)),
            IskontoFiyat5 = PickPrice(request.OperationValue, priceGroupCodes.Contains(5)),
            IskontoFiyat6 = PickPrice(request.OperationValue, priceGroupCodes.Contains(6)),
            // Sinirsiz fiyat grubu kaynagi. Yukaridaki IskontoFiyat1..6 GERIYE DONUK UYUM icin
            // yazilmaya devam ediyor; okuma tarafi once bu listeye bakar.
            PriceGroups = BuildPriceGroups(priceGroupCodes, request.OperationValue, user, now),
            CreateUser = user,
            CreateTime = now,
            IsDeleted = false
        });

        await _dbContext.SaveChangesAsync(cancellationToken);
        await tx.CommitAsync(cancellationToken);

        return Ok(new { success = true, data = new { id = campaign.Id } });
    }

    [AuthorizePage("users", "kampanya")]
    [HttpPut("package-campaign/{id:guid}")]
    public async Task<IActionResult> UpdatePackageCampaign([FromRoute] Guid id, [FromBody] CreatePackageCampaignRequest? request, CancellationToken cancellationToken)
    {
        if (request is null)
        {
            return BadRequest(new { success = false, message = "Request body boş veya geçersiz." });
        }

        static DateTime NormalizeToUtc(DateTime dt)
        {
            return dt.Kind switch
            {
                DateTimeKind.Utc => dt,
                DateTimeKind.Local => dt.ToUniversalTime(),
                _ => DateTime.SpecifyKind(dt, DateTimeKind.Utc)
            };
        }

        static bool TryParseDiscountType(string raw, out IskontoTipi parsed)
        {
            parsed = default;
            var s = (raw ?? string.Empty).Trim();
            if (string.IsNullOrWhiteSpace(s)) return false;

            if (int.TryParse(s, out var i))
            {
                if (i == 1) { parsed = IskontoTipi.Tutar; return true; }
                if (i == 2) { parsed = IskontoTipi.Oran; return true; }
                return false;
            }

            if (string.Equals(s, "tutar", StringComparison.OrdinalIgnoreCase)) { parsed = IskontoTipi.Tutar; return true; }
            if (string.Equals(s, "oran", StringComparison.OrdinalIgnoreCase)) { parsed = IskontoTipi.Oran; return true; }
            return false;
        }

        var name = (request.Name ?? string.Empty).Trim();
        if (string.IsNullOrWhiteSpace(name))
        {
            ModelState.AddModelError(nameof(request.Name), "Name is required.");
        }

        var start = NormalizeToUtc(request.StartDate);
        var end = NormalizeToUtc(request.EndDate);
        if (end < start)
        {
            ModelState.AddModelError(nameof(request.EndDate), "EndDate must be greater than or equal to StartDate.");
        }

        if (!TryParseDiscountType(request.OperationType, out var operationType))
        {
            ModelState.AddModelError(nameof(request.OperationType), "OperationType is required. Allowed: Tutar (sabit paket fiyatı), Oran (% indirim).");
        }

        if (request.OperationValue < 0)
        {
            ModelState.AddModelError(nameof(request.OperationValue), "OperationValue must be >= 0.");
        }

        var items = (request.Items ?? new List<CreatePackageItem>())
            .Where(x => x is not null)
            .Select(x => new CreatePackageItem
            {
                GroupCode = (x.GroupCode ?? string.Empty).Trim(),
                StockCode = (x.StockCode ?? string.Empty).Trim(),
                Quantity = x.Quantity
            })
            .Where(x => !string.IsNullOrWhiteSpace(x.StockCode))
            .Where(x => x.Quantity > 0)
            .ToList();

        if (items.Count == 0)
        {
            ModelState.AddModelError(nameof(request.Items), "Pakete en az 1 ürün eklenmelidir.");
        }

        var priceGroupCodes = (request.PriceGroupCodes ?? new List<int>())
            .Where(x => x >= 1)
            .Distinct()
            .ToList();
        if (priceGroupCodes.Count == 0)
        {
            priceGroupCodes = await _dbContext.PriceGroups.Where(p => p.IsActive).Select(p => (int)p.Code).ToListAsync(cancellationToken);
            if (priceGroupCodes.Count == 0) priceGroupCodes = new List<int> { 1, 2, 3, 4, 5, 6, 7 };
        }

        if (!ModelState.IsValid)
        {
            return ValidationProblem(ModelState);
        }

        var distinctStockCodes = items
            .Select(x => x.StockCode)
            .Where(x => !string.IsNullOrWhiteSpace(x))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();

        var existingStockCodes = await _dbContext.Products
            .AsNoTracking()
            .Where(x => distinctStockCodes.Contains(x.StockCode))
            .Select(x => x.StockCode)
            .ToListAsync(cancellationToken);

        var missing = distinctStockCodes
            .Where(sc => !existingStockCodes.Contains(sc, StringComparer.OrdinalIgnoreCase))
            .ToList();
        if (missing.Count > 0)
        {
            return BadRequest(new { success = false, message = $"Pakette bulunmayan stok kodu(ları) var: {string.Join(", ", missing)}" });
        }

        var campaign = await _dbContext.Campaigns
            .Include(x => x.CampaignConditions)
            .Include(x => x.CampaignDiscounts)
            .Include(x => x.CampaignTargets)
            .FirstOrDefaultAsync(x => x.Id == id, cancellationToken);

        if (campaign is null || campaign.IsDeleted)
        {
            return NotFound(new { success = false, message = "Campaign not found." });
        }

        if (campaign.KampanyaTipi != KampanyaTipi.PaketKampanya)
        {
            return BadRequest(new { success = false, message = "Campaign type mismatch." });
        }

        var user = User.Identity?.Name ?? "System";
        var now = DateTime.UtcNow;

        await using var tx = await _dbContext.Database.BeginTransactionAsync(cancellationToken);

        campaign.Name = name;
        campaign.Description = string.IsNullOrWhiteSpace(request.Description) ? null : request.Description.Trim();
        // Öncelik ve zincir kesme PUT'ta da güncellenir. Bu iki uç (kategori/marka ve paket)
        // atlanmıştı: modal değeri gönderiyor, uç sessizce yok sayıyor ve kullanıcı önceliği
        // değiştirdim sanıyordu. PUT tam değiştirme olduğu için değer koşulsuz yazılır.
        campaign.Priority = request.Priority;
        campaign.StopNext = request.StopNext;
        campaign.StartDate = start;
        campaign.EndDate = end;
        campaign.EditUser = user;
        campaign.EditTime = now;

        foreach (var existing in campaign.CampaignConditions)
        {
            existing.IsDeleted = true;
            existing.EditUser = user;
            existing.EditTime = now;
        }

        foreach (var existing in campaign.CampaignDiscounts)
        {
            existing.IsDeleted = true;
            existing.EditUser = user;
            existing.EditTime = now;
        }

        var packageJson = JsonSerializer.Serialize(items.Select(x => new { stockCode = x.StockCode, quantity = x.Quantity }));

        campaign.CampaignConditions.Add(new CampaignCondition
        {
            Id = Guid.NewGuid(),
            CampaignId = campaign.Id,
            ConditionType = CampaignConditionType.PackageProducts,
            TargetId = null,
            Operator = string.Empty,
            Value = 0m,
            Metric = null,
            Minimum = null,
            Maximum = null,
            CategoryCode = null,
            BrandField = null,
            BrandCode = null,
            PackageItemsJson = packageJson,
            ProductStockCodesJson = null,
            CreateUser = user,
            CreateTime = now,
            IsDeleted = false
        });

        static decimal? PickPrice(decimal value, bool selected)
        {
            return selected ? value : null;
        }

        _dbContext.CampaignDiscounts.Add(new CampaignDiscount
        {
            Id = Guid.NewGuid(),
            CampaignId = campaign.Id,
            StokKodu = null,
            GrupKodu = null,
            MinSepetTutari = 0m,
            IskontoTipi = operationType,
            Deger = request.OperationValue,
            IskontoFiyat1 = PickPrice(request.OperationValue, priceGroupCodes.Contains(1)),
            IskontoFiyat2 = PickPrice(request.OperationValue, priceGroupCodes.Contains(2)),
            IskontoFiyat3 = PickPrice(request.OperationValue, priceGroupCodes.Contains(3)),
            IskontoFiyat4 = PickPrice(request.OperationValue, priceGroupCodes.Contains(4)),
            IskontoFiyat5 = PickPrice(request.OperationValue, priceGroupCodes.Contains(5)),
            IskontoFiyat6 = PickPrice(request.OperationValue, priceGroupCodes.Contains(6)),
            // Sinirsiz fiyat grubu kaynagi. Yukaridaki IskontoFiyat1..6 GERIYE DONUK UYUM icin
            // yazilmaya devam ediyor; okuma tarafi once bu listeye bakar.
            PriceGroups = BuildPriceGroups(priceGroupCodes, request.OperationValue, user, now),
            CreateUser = user,
            CreateTime = now,
            IsDeleted = false
        });

        await _dbContext.SaveChangesAsync(cancellationToken);
        await tx.CommitAsync(cancellationToken);

        return Ok(new { success = true, data = new { id = campaign.Id } });
    }

    public sealed class PatchPackageCampaignRequest
    {

        /// <summary>
        /// Uygulama sırası; BÜYÜK olan ÖNCE uygulanır. null gönderilirse mevcut değer korunur.
        /// Oluştururken verilebiliyordu ama düzenlerken değiştirilemiyordu.
        /// </summary>
        [Range(0, 1000)]
        public int? Priority { get; set; }

        /// <summary>
        /// Bu kampanya uygulandıysa SONRAKİ kampanyalar hiç denenmesin.
        /// Varlıkta ve değerlendiricide vardı ama hiçbir uçtan ayarlanamıyordu; her kampanya
        /// zorunlu olarak false ile kaydediliyor, yani kampanyalar her zaman üst üste biniyordu.
        /// </summary>
        public bool? StopNext { get; set; }
        public string? Name { get; set; }
        public string? Description { get; set; }
        public DateTime? StartDate { get; set; }
        public DateTime? EndDate { get; set; }
        public List<CreatePackageItem>? Items { get; set; }
        public string? OperationType { get; set; }
        public decimal? OperationValue { get; set; }
        public List<int>? PriceGroupCodes { get; set; }

        /// <summary>
        /// Kampanyanın uygulanacağı bayiler (cari kodları). BOŞ/NULL = tüm bayiler.
        ///
        /// Hedefleme altyapısı (CampaignTargets + IsTargetMatch) zaten vardı ama hiçbir uç
        /// hedef almıyordu; ekrandaki bayi seçimi hiçbir yere gitmiyordu. Buradan gelen
        /// kodlar SpecificCustomer hedefi olarak yazılır.
        /// </summary>
        public List<string>? DealerCodes { get; set; }
        public string? SubeKodu { get; set; }
    }

    [HttpPatch("package-campaign/{id:guid}")]
    public async Task<IActionResult> PatchPackageCampaign([FromRoute] Guid id, [FromBody] PatchPackageCampaignRequest? request, CancellationToken cancellationToken)
    {
        if (request is null)
        {
            return BadRequest(new { success = false, message = "Request body boş veya geçersiz." });
        }

        static DateTime NormalizeToUtc(DateTime dt)
        {
            return dt.Kind switch
            {
                DateTimeKind.Utc => dt,
                DateTimeKind.Local => dt.ToUniversalTime(),
                _ => DateTime.SpecifyKind(dt, DateTimeKind.Utc)
            };
        }

        static bool TryParseDiscountType(string raw, out IskontoTipi parsed)
        {
            parsed = default;
            var s = (raw ?? string.Empty).Trim();
            if (string.IsNullOrWhiteSpace(s)) return false;

            if (int.TryParse(s, out var i))
            {
                if (i == 1) { parsed = IskontoTipi.Tutar; return true; }
                if (i == 2) { parsed = IskontoTipi.Oran; return true; }
                return false;
            }

            if (string.Equals(s, "tutar", StringComparison.OrdinalIgnoreCase)) { parsed = IskontoTipi.Tutar; return true; }
            if (string.Equals(s, "oran", StringComparison.OrdinalIgnoreCase)) { parsed = IskontoTipi.Oran; return true; }
            return false;
        }

        var campaign = await _dbContext.Campaigns
            .Include(x => x.CampaignConditions)
            .Include(x => x.CampaignDiscounts)
            .Include(x => x.CampaignTargets)
            .FirstOrDefaultAsync(x => x.Id == id, cancellationToken);

        if (campaign is null || campaign.IsDeleted)
        {
            return NotFound(new { success = false, message = "Campaign not found." });
        }

        if (campaign.KampanyaTipi != KampanyaTipi.PaketKampanya)
        {
            return BadRequest(new { success = false, message = "Campaign type mismatch." });
        }

        var user = User.Identity?.Name ?? "System";
        var now = DateTime.UtcNow;

        var currentCondition = campaign.CampaignConditions
            .Where(x => !x.IsDeleted)
            .OrderByDescending(x => x.CreateTime)
            .FirstOrDefault();

        var currentDiscount = campaign.CampaignDiscounts
            .Where(x => !x.IsDeleted)
            .OrderByDescending(x => x.CreateTime)
            .FirstOrDefault();

        if (currentCondition is null || currentDiscount is null)
        {
            return BadRequest(new { success = false, message = "Campaign detail rows not found for patch." });
        }

        if (request.Name is not null)
        {
            var n = request.Name.Trim();
            if (string.IsNullOrWhiteSpace(n)) return BadRequest(new { success = false, message = "Name is required." });
            campaign.Name = n;
        }

        if (request.Description is not null)
        {
            var d = request.Description.Trim();
            campaign.Description = string.IsNullOrWhiteSpace(d) ? null : d;
        }

        // Öncelik ve zincir kesme, ad/açıklama ile aynı kalıpta: gönderilmezse dokunulmaz.
        // DIKKAT: bu iki satir aciklama blogunun DISINDA kalmali. Icine dusurulurse oncelik
        // ancak aciklama da gonderildiginde kaydedilir; canli testte tam boyle yakalandi.
        if (request.Priority.HasValue) campaign.Priority = request.Priority.Value;
        if (request.StopNext.HasValue) campaign.StopNext = request.StopNext.Value;

        // Bayi hedefleri. null = alan gonderilmemis = dokunma; bos dizi = kisiti kaldir.
        ApplyDealerTargets(campaign, request.DealerCodes, user, now);

        if (request.StartDate.HasValue)
        {
            campaign.StartDate = NormalizeToUtc(request.StartDate.Value);
        }

        if (request.EndDate.HasValue)
        {
            campaign.EndDate = NormalizeToUtc(request.EndDate.Value);
        }

        if (campaign.StartDate.HasValue && campaign.EndDate.HasValue && campaign.EndDate < campaign.StartDate)
        {
            return BadRequest(new { success = false, message = "EndDate must be greater than or equal to StartDate." });
        }

        if (request.SubeKodu is not null)
        {
            var sk = request.SubeKodu.Trim();
            campaign.SubeKodu = string.IsNullOrWhiteSpace(sk) ? null : sk;
        }

        // Items changed => validate + replace condition row (soft delete)
        var itemsTouched = request.Items is not null;
        if (itemsTouched)
        {
            var items = (request.Items ?? new List<CreatePackageItem>())
                .Where(x => x is not null)
                .Select(x => new CreatePackageItem
                {
                    GroupCode = (x.GroupCode ?? string.Empty).Trim(),
                    StockCode = (x.StockCode ?? string.Empty).Trim(),
                    Quantity = x.Quantity
                })
                .Where(x => !string.IsNullOrWhiteSpace(x.StockCode))
                .Where(x => x.Quantity > 0)
                .ToList();

            if (items.Count == 0)
            {
                return BadRequest(new { success = false, message = "Pakete en az 1 ürün eklenmelidir." });
            }

            var distinctStockCodes = items
                .Select(x => x.StockCode)
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToList();

            var existingStockCodes = await _dbContext.Products
                .AsNoTracking()
                .Where(x => distinctStockCodes.Contains(x.StockCode))
                .Select(x => x.StockCode)
                .ToListAsync(cancellationToken);

            var missing = distinctStockCodes
                .Where(sc => !existingStockCodes.Contains(sc, StringComparer.OrdinalIgnoreCase))
                .ToList();
            if (missing.Count > 0)
            {
                return BadRequest(new { success = false, message = $"Pakette bulunmayan stok kodu(ları) var: {string.Join(", ", missing)}" });
            }

            var packageJson = JsonSerializer.Serialize(items.Select(x => new { stockCode = x.StockCode, quantity = x.Quantity }));

            currentCondition.IsDeleted = true;
            currentCondition.EditUser = user;
            currentCondition.EditTime = now;

            campaign.CampaignConditions.Add(new CampaignCondition
            {
                Id = Guid.NewGuid(),
                CampaignId = campaign.Id,
                ConditionType = CampaignConditionType.PackageProducts,
                TargetId = null,
                Operator = string.Empty,
                Value = 0m,
                Metric = null,
                Minimum = null,
                Maximum = null,
                CategoryCode = null,
                BrandField = null,
                BrandCode = null,
                PackageItemsJson = packageJson,
                ProductStockCodesJson = null,
                CreateUser = user,
                CreateTime = now,
                IsDeleted = false
            });
        }

        var discountTouched = request.OperationType is not null || request.OperationValue.HasValue || request.PriceGroupCodes is not null;
        if (discountTouched)
        {
            var nextOperationTypeRaw = request.OperationType is null ? currentDiscount.IskontoTipi.ToString() : request.OperationType;
            if (!TryParseDiscountType(nextOperationTypeRaw, out var nextOperationType))
            {
                return BadRequest(new { success = false, message = "OperationType is required. Allowed: Tutar, Oran, 1, 2." });
            }

            var nextOperationValue = request.OperationValue ?? currentDiscount.Deger;
            if (nextOperationValue < 0)
            {
                return BadRequest(new { success = false, message = "OperationValue must be >= 0." });
            }
            if (nextOperationType == IskontoTipi.Oran && nextOperationValue > 100)
            {
                return BadRequest(new { success = false, message = "Oran (%) 100'den büyük olamaz." });
            }

            var selected = request.PriceGroupCodes;
            List<int> selectedGroups;
            if (selected is null)
            {
                selectedGroups = new List<int>();
                if (currentDiscount.IskontoFiyat1 is not null) selectedGroups.Add(1);
                if (currentDiscount.IskontoFiyat2 is not null) selectedGroups.Add(2);
                if (currentDiscount.IskontoFiyat3 is not null) selectedGroups.Add(3);
                if (currentDiscount.IskontoFiyat4 is not null) selectedGroups.Add(4);
                if (currentDiscount.IskontoFiyat5 is not null) selectedGroups.Add(5);
                if (currentDiscount.IskontoFiyat6 is not null) selectedGroups.Add(6);
            }
            else
            {
                selectedGroups = selected
                    .Where(x => x >= 1)
                    .Distinct()
                    .ToList();
            }

            if (selectedGroups.Count == 0)
            {
                selectedGroups = await _dbContext.PriceGroups.Where(p => p.IsActive).Select(p => (int)p.Code).ToListAsync(cancellationToken);
                if (selectedGroups.Count == 0) selectedGroups = new List<int> { 1, 2, 3, 4, 5, 6, 7 };
            }

            static decimal? PickPrice(decimal value, bool selectedFlag)
            {
                return selectedFlag ? value : null;
            }

            currentDiscount.IsDeleted = true;
            currentDiscount.EditUser = user;
            currentDiscount.EditTime = now;

            _dbContext.CampaignDiscounts.Add(new CampaignDiscount
            {
                Id = Guid.NewGuid(),
                CampaignId = campaign.Id,
                StokKodu = null,
                GrupKodu = null,
                MinSepetTutari = currentDiscount.MinSepetTutari,
                IskontoTipi = nextOperationType,
                Deger = nextOperationValue,
                IskontoFiyat1 = PickPrice(nextOperationValue, selectedGroups.Contains(1)),
                IskontoFiyat2 = PickPrice(nextOperationValue, selectedGroups.Contains(2)),
                IskontoFiyat3 = PickPrice(nextOperationValue, selectedGroups.Contains(3)),
                IskontoFiyat4 = PickPrice(nextOperationValue, selectedGroups.Contains(4)),
                IskontoFiyat5 = PickPrice(nextOperationValue, selectedGroups.Contains(5)),
                IskontoFiyat6 = PickPrice(nextOperationValue, selectedGroups.Contains(6)),
                // Sinirsiz fiyat grubu kaynagi. Yukaridaki IskontoFiyat1..6 GERIYE DONUK UYUM icin
                // yazilmaya devam ediyor; okuma tarafi once bu listeye bakar.
                PriceGroups = BuildPriceGroups(selectedGroups, nextOperationValue, user, now),
                CreateUser = user,
                CreateTime = now,
                IsDeleted = false
            });
        }

        campaign.EditUser = user;
        campaign.EditTime = now;

        await _dbContext.SaveChangesAsync(cancellationToken);
        return Ok(new { success = true, data = new { id = campaign.Id } });
    }

    public sealed class PatchBasketTotalDiscountRequest
    {

        /// <summary>
        /// Uygulama sırası; BÜYÜK olan ÖNCE uygulanır. null gönderilirse mevcut değer korunur.
        /// Oluştururken verilebiliyordu ama düzenlerken değiştirilemiyordu.
        /// </summary>
        [Range(0, 1000)]
        public int? Priority { get; set; }

        /// <summary>
        /// Bu kampanya uygulandıysa SONRAKİ kampanyalar hiç denenmesin.
        /// Varlıkta ve değerlendiricide vardı ama hiçbir uçtan ayarlanamıyordu; her kampanya
        /// zorunlu olarak false ile kaydediliyor, yani kampanyalar her zaman üst üste biniyordu.
        /// </summary>
        public bool? StopNext { get; set; }
        public string? Name { get; set; }
        public string? Description { get; set; }
        public DateTime? StartDate { get; set; }
        public DateTime? EndDate { get; set; }
        public string? GroupCode { get; set; }
        public List<string>? ProductStockCodes { get; set; }
        public decimal? MinBasketTotal { get; set; }
        public string? DiscountType { get; set; }
        public decimal? DiscountValue { get; set; }
        public List<int>? PriceGroupCodes { get; set; }

        /// <summary>
        /// Kampanyanın uygulanacağı bayiler (cari kodları). BOŞ/NULL = tüm bayiler.
        ///
        /// Hedefleme altyapısı (CampaignTargets + IsTargetMatch) zaten vardı ama hiçbir uç
        /// hedef almıyordu; ekrandaki bayi seçimi hiçbir yere gitmiyordu. Buradan gelen
        /// kodlar SpecificCustomer hedefi olarak yazılır.
        /// </summary>
        public List<string>? DealerCodes { get; set; }
        public string? SubeKodu { get; set; }
    }

    [HttpPatch("basket-total-discount/{id:guid}")]
    public async Task<IActionResult> PatchBasketTotalDiscount([FromRoute] Guid id, [FromBody] PatchBasketTotalDiscountRequest? request, CancellationToken cancellationToken)
    {
        if (request is null)
        {
            return BadRequest(new { success = false, message = "Request body boş veya geçersiz." });
        }

        static DateTime NormalizeToUtc(DateTime dt)
        {
            return dt.Kind switch
            {
                DateTimeKind.Utc => dt,
                DateTimeKind.Local => dt.ToUniversalTime(),
                _ => DateTime.SpecifyKind(dt, DateTimeKind.Utc)
            };
        }

        static bool TryParseDiscountType(string raw, out IskontoTipi parsed)
        {
            parsed = default;
            var s = (raw ?? string.Empty).Trim();
            if (string.IsNullOrWhiteSpace(s)) return false;

            if (int.TryParse(s, out var i))
            {
                if (i == 1) { parsed = IskontoTipi.Tutar; return true; }
                if (i == 2) { parsed = IskontoTipi.Oran; return true; }
                return false;
            }

            if (string.Equals(s, "tutar", StringComparison.OrdinalIgnoreCase)) { parsed = IskontoTipi.Tutar; return true; }
            if (string.Equals(s, "oran", StringComparison.OrdinalIgnoreCase)) { parsed = IskontoTipi.Oran; return true; }
            return false;
        }

        var campaign = await _dbContext.Campaigns
            .Include(x => x.CampaignConditions)
            .Include(x => x.CampaignDiscounts)
            .Include(x => x.CampaignTargets)
            .FirstOrDefaultAsync(x => x.Id == id, cancellationToken);

        if (campaign is null || campaign.IsDeleted)
        {
            return NotFound(new { success = false, message = "Campaign not found." });
        }

        if (campaign.KampanyaTipi != KampanyaTipi.SepetIndirimi)
        {
            return BadRequest(new { success = false, message = "Campaign type mismatch." });
        }

        var user = User.Identity?.Name ?? "System";
        var now = DateTime.UtcNow;

        if (request.Name is not null)
        {
            var n = request.Name.Trim();
            if (string.IsNullOrWhiteSpace(n)) return BadRequest(new { success = false, message = "Name is required." });
            campaign.Name = n;
        }

        if (request.Description is not null)
        {
            var d = request.Description.Trim();
            campaign.Description = string.IsNullOrWhiteSpace(d) ? null : d;
        }

        // Öncelik ve zincir kesme, ad/açıklama ile aynı kalıpta: gönderilmezse dokunulmaz.
        // DIKKAT: bu iki satir aciklama blogunun DISINDA kalmali. Icine dusurulurse oncelik
        // ancak aciklama da gonderildiginde kaydedilir; canli testte tam boyle yakalandi.
        if (request.Priority.HasValue) campaign.Priority = request.Priority.Value;
        if (request.StopNext.HasValue) campaign.StopNext = request.StopNext.Value;

        // Bayi hedefleri. null = alan gonderilmemis = dokunma; bos dizi = kisiti kaldir.
        ApplyDealerTargets(campaign, request.DealerCodes, user, now);

        if (request.StartDate.HasValue)
        {
            campaign.StartDate = NormalizeToUtc(request.StartDate.Value);
        }

        if (request.EndDate.HasValue)
        {
            campaign.EndDate = NormalizeToUtc(request.EndDate.Value);
        }

        if (campaign.StartDate.HasValue && campaign.EndDate.HasValue && campaign.EndDate < campaign.StartDate)
        {
            return BadRequest(new { success = false, message = "EndDate must be greater than or equal to StartDate." });
        }

        if (request.SubeKodu is not null)
        {
            var sk = request.SubeKodu.Trim();
            campaign.SubeKodu = string.IsNullOrWhiteSpace(sk) ? null : sk;
        }

        var currentDiscounts = campaign.CampaignDiscounts
            .Where(x => !x.IsDeleted)
            .OrderBy(x => x.CreateTime)
            .ToList();

        if (currentDiscounts.Count == 0)
        {
            return BadRequest(new { success = false, message = "Campaign discount rows not found for patch." });
        }

        var nextGroupCode = request.GroupCode is null ? (currentDiscounts.First().GrupKodu ?? string.Empty) : request.GroupCode.Trim();

        // Only validate GroupCode existence if the client explicitly sends GroupCode.
        // This allows editing unrelated fields (e.g., discount value) even if the stored group code is no longer present.
        if (request.GroupCode is not null)
        {
            if (string.IsNullOrWhiteSpace(nextGroupCode))
            {
                return BadRequest(new { success = false, message = "GroupCode is required." });
            }

            var groupExists = await CheckGroupExistsAsync(nextGroupCode, cancellationToken);
            if (!groupExists)
            {
                return BadRequest(new { success = false, message = "Kategori bulunamadı (GroupCode)." });
            }
        }

        var nextStockCodes = request.ProductStockCodes is null
            ? currentDiscounts.Where(x => !string.IsNullOrWhiteSpace(x.StokKodu)).Select(x => x.StokKodu!).Distinct(StringComparer.OrdinalIgnoreCase).ToList()
            : (request.ProductStockCodes ?? new List<string>())
                .Where(x => !string.IsNullOrWhiteSpace(x))
                .Select(x => x.Trim())
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToList();

        if (request.ProductStockCodes is not null && nextStockCodes.Count > 0)
        {
            var foundCount = await _dbContext.Products
                .AsNoTracking()
                .Where(p => nextStockCodes.Contains(p.StockCode))
                .Select(p => p.StockCode)
                .Distinct()
                .CountAsync(cancellationToken);

            if (foundCount != nextStockCodes.Count)
            {
                return BadRequest(new { success = false, message = "One or more products not found." });
            }
        }

        var nextMinBasket = request.MinBasketTotal ?? currentDiscounts.First().MinSepetTutari;
        if (nextMinBasket < 0)
        {
            return BadRequest(new { success = false, message = "MinBasketTotal must be >= 0." });
        }

        var nextDiscountTypeRaw = request.DiscountType is null ? currentDiscounts.First().IskontoTipi.ToString() : request.DiscountType;
        if (!TryParseDiscountType(nextDiscountTypeRaw, out var nextDiscountType))
        {
            return BadRequest(new { success = false, message = "DiscountType is required. Allowed: Tutar, Oran, 1, 2." });
        }

        var nextDiscountValue = request.DiscountValue ?? currentDiscounts.First().Deger;
        if (nextDiscountValue < 0)
        {
            return BadRequest(new { success = false, message = "DiscountValue must be >= 0." });
        }
        if (nextDiscountType == IskontoTipi.Oran && nextDiscountValue > 100)
        {
            return BadRequest(new { success = false, message = "Oran (%) 100'den büyük olamaz." });
        }

        List<int> selectedGroups;
        if (request.PriceGroupCodes is null)
        {
            selectedGroups = new List<int>();
            var sample = currentDiscounts.First();
            if (sample.IskontoFiyat1 is not null) selectedGroups.Add(1);
            if (sample.IskontoFiyat2 is not null) selectedGroups.Add(2);
            if (sample.IskontoFiyat3 is not null) selectedGroups.Add(3);
            if (sample.IskontoFiyat4 is not null) selectedGroups.Add(4);
            if (sample.IskontoFiyat5 is not null) selectedGroups.Add(5);
            if (sample.IskontoFiyat6 is not null) selectedGroups.Add(6);
        }
        else
        {
            selectedGroups = (request.PriceGroupCodes ?? new List<int>())
                .Where(x => x >= 1)
                .Distinct()
                .ToList();
        }

        if (selectedGroups.Count == 0)
        {
            selectedGroups = await _dbContext.PriceGroups.Where(p => p.IsActive).Select(p => (int)p.Code).ToListAsync(cancellationToken);
            if (selectedGroups.Count == 0) selectedGroups = new List<int> { 1, 2, 3, 4, 5, 6, 7 };
        }

        var discountsTouched = request.GroupCode is not null || request.ProductStockCodes is not null || request.MinBasketTotal.HasValue || request.DiscountType is not null || request.DiscountValue.HasValue || request.PriceGroupCodes is not null;

        if (discountsTouched)
        {
            foreach (var d in currentDiscounts)
            {
                d.IsDeleted = true;
                d.EditUser = user;
                d.EditTime = now;
            }

            static decimal? PickPrice(decimal value, bool selectedFlag)
            {
                return selectedFlag ? value : null;
            }

            CampaignDiscount CreateRow(string? stokKodu)
            {
                return new CampaignDiscount
                {
                    Id = Guid.NewGuid(),
                    CampaignId = campaign.Id,
                    StokKodu = stokKodu,
                    GrupKodu = nextGroupCode,
                    MinSepetTutari = nextMinBasket,
                    IskontoTipi = nextDiscountType,
                    Deger = nextDiscountValue,
                    IskontoFiyat1 = PickPrice(nextDiscountValue, selectedGroups.Contains(1)),
                    IskontoFiyat2 = PickPrice(nextDiscountValue, selectedGroups.Contains(2)),
                    IskontoFiyat3 = PickPrice(nextDiscountValue, selectedGroups.Contains(3)),
                    IskontoFiyat4 = PickPrice(nextDiscountValue, selectedGroups.Contains(4)),
                    IskontoFiyat5 = PickPrice(nextDiscountValue, selectedGroups.Contains(5)),
                    IskontoFiyat6 = PickPrice(nextDiscountValue, selectedGroups.Contains(6)),
                    // Sinirsiz fiyat grubu kaynagi. Yukaridaki IskontoFiyat1..6 GERIYE DONUK UYUM icin
                    // yazilmaya devam ediyor; okuma tarafi once bu listeye bakar.
                    PriceGroups = BuildPriceGroups(selectedGroups, nextDiscountValue, user, now),
                    CreateUser = user,
                    CreateTime = now,
                    IsDeleted = false
                };
            }

            if (nextStockCodes.Count == 0)
            {
                _dbContext.CampaignDiscounts.Add(CreateRow(null));
            }
            else
            {
                foreach (var sc in nextStockCodes)
                {
                    _dbContext.CampaignDiscounts.Add(CreateRow(sc));
                }
            }

            var existingCond = campaign.CampaignConditions
                .Where(x => !x.IsDeleted)
                .OrderByDescending(x => x.CreateTime)
                .FirstOrDefault();

            if (existingCond is not null)
            {
                var condTouched = request.GroupCode is not null || request.ProductStockCodes is not null;
                if (condTouched)
                {
                    existingCond.IsDeleted = true;
                    existingCond.EditUser = user;
                    existingCond.EditTime = now;

                    var stockJson = nextStockCodes.Count == 0 ? null : JsonSerializer.Serialize(nextStockCodes);

                    campaign.CampaignConditions.Add(new CampaignCondition
                    {
                        Id = Guid.NewGuid(),
                        CampaignId = campaign.Id,
                        ConditionType = CampaignConditionType.CategoryBased,
                        TargetId = null,
                        Operator = string.Empty,
                        Value = 0m,
                        Metric = null,
                        Minimum = null,
                        Maximum = null,
                        CategoryCode = nextGroupCode,
                        ProductStockCodesJson = stockJson,
                        CreateUser = user,
                        CreateTime = now,
                        IsDeleted = false
                    });
                }
            }
        }

        campaign.EditUser = user;
        campaign.EditTime = now;

        await _dbContext.SaveChangesAsync(cancellationToken);
        return Ok(new { success = true, data = new { id = campaign.Id } });
    }

    public sealed class PatchProductDiscountRequest
    {

        /// <summary>
        /// Uygulama sırası; BÜYÜK olan ÖNCE uygulanır. null gönderilirse mevcut değer korunur.
        /// Oluştururken verilebiliyordu ama düzenlerken değiştirilemiyordu.
        /// </summary>
        [Range(0, 1000)]
        public int? Priority { get; set; }

        /// <summary>
        /// Bu kampanya uygulandıysa SONRAKİ kampanyalar hiç denenmesin.
        /// Varlıkta ve değerlendiricide vardı ama hiçbir uçtan ayarlanamıyordu; her kampanya
        /// zorunlu olarak false ile kaydediliyor, yani kampanyalar her zaman üst üste biniyordu.
        /// </summary>
        public bool? StopNext { get; set; }
        public string? Name { get; set; }
        public string? Description { get; set; }
        public DateTime? StartDate { get; set; }
        public DateTime? EndDate { get; set; }
        public string? GroupCode { get; set; }
        public List<string>? ProductStockCodes { get; set; }
        public string? DiscountType { get; set; }
        public decimal? DiscountValue { get; set; }
        public List<int>? PriceGroupCodes { get; set; }

        /// <summary>
        /// ÜRÜNE ÖZEL KAMPANYALI FİYAT (2026-10-07). Doluysa her ürüne kendi kampanyalı F4'ü yazılır;
        /// GroupCode / DiscountType / DiscountValue / ProductStockCodes yok sayılır. Ürünler farklı
        /// kategorilerden olabilir. Boşsa eski "seçili ürünlere aynı indirim" davranışı.
        /// </summary>
        public List<TargetPriceItem>? Items { get; set; }

        /// <summary>
        /// Kampanyanın uygulanacağı bayiler (cari kodları). BOŞ/NULL = tüm bayiler.
        ///
        /// Hedefleme altyapısı (CampaignTargets + IsTargetMatch) zaten vardı ama hiçbir uç
        /// hedef almıyordu; ekrandaki bayi seçimi hiçbir yere gitmiyordu. Buradan gelen
        /// kodlar SpecificCustomer hedefi olarak yazılır.
        /// </summary>
        public List<string>? DealerCodes { get; set; }
        public string? SubeKodu { get; set; }
    }

    /// <summary>
    /// Ürüne özel kampanyalı fiyat satırlarını doğrular ve indirim satırlarını kurar (2026-10-07).
    /// Hata varsa mesaj döner, satır üretmez. Her ürün için: ürün var, F4 tanımlı, 0 &lt; hedef &lt; F4.
    /// </summary>
    private async Task<(List<CampaignDiscount>? Rows, List<string> StockCodes, string? Error)> BuildTargetPriceRowsAsync(
        Guid campaignId, List<TargetPriceItem> items, List<int> priceGroupCodes, string user, DateTime now, CancellationToken ct)
    {
        var temiz = items
            .Where(x => x is not null && !string.IsNullOrWhiteSpace(x.StockCode))
            .Select(x => new { Code = x.StockCode.Trim(), x.TargetPrice })
            .ToList();

        if (temiz.Count == 0) return (null, new List<string>(), "En az bir ürün ekleyin.");
        if (temiz.Count > 200) return (null, new List<string>(), "Bir kampanyada en fazla 200 ürün olabilir.");

        var tekrar = temiz.GroupBy(x => x.Code, StringComparer.OrdinalIgnoreCase).FirstOrDefault(g => g.Count() > 1);
        if (tekrar is not null) return (null, new List<string>(), $"{tekrar.Key} listede birden fazla kez var.");

        var codes = temiz.Select(x => x.Code).ToList();
        var mevcut = await _dbContext.Products.AsNoTracking()
            .Where(p => codes.Contains(p.StockCode))
            .Select(p => p.StockCode)
            .ToListAsync(ct);
        var eksik = codes.Where(c => !mevcut.Contains(c, StringComparer.OrdinalIgnoreCase)).ToList();
        if (eksik.Count > 0) return (null, new List<string>(), "Ürün bulunamadı: " + string.Join(", ", eksik));

        var f4 = await B2B.Erp.Api.Core.Helpers.CampaignTargetPrice.LoadCatalogPricesAsync(_dbContext, codes, ct);

        var rows = new List<CampaignDiscount>();
        foreach (var it in temiz)
        {
            if (!f4.TryGetValue(it.Code, out var katalog))
                return (null, new List<string>(), $"{it.Code}: Fiyat 4 tanımlı değil, kampanyalı fiyat yazılamaz.");
            if (it.TargetPrice <= 0m)
                return (null, new List<string>(), $"{it.Code}: kampanyalı fiyat 0'dan büyük olmalı.");
            if (it.TargetPrice >= katalog.Price)
                return (null, new List<string>(), $"{it.Code}: kampanyalı fiyat ({it.TargetPrice:0.##}) normal Fiyat 4'ten ({katalog.Price:0.##}) küçük olmalı.");

            var fark = B2B.Erp.Api.Core.Helpers.CampaignTargetPrice.Difference(katalog.Price, it.TargetPrice);
            rows.Add(new CampaignDiscount
            {
                Id = Guid.NewGuid(),
                CampaignId = campaignId,
                StokKodu = it.Code,
                // Grup kodu YAZILMAZ: rozet yalnız bu ürünlerde çıksın (bkz. CreateProductDiscount notu).
                GrupKodu = null,
                MinSepetTutari = 0m,
                IskontoTipi = IskontoTipi.Tutar,
                Deger = fark,
                HedefFiyat = Math.Round(it.TargetPrice, 4, MidpointRounding.AwayFromZero),
                IskontoFiyat1 = priceGroupCodes.Contains(1) ? fark : null,
                IskontoFiyat2 = priceGroupCodes.Contains(2) ? fark : null,
                IskontoFiyat3 = priceGroupCodes.Contains(3) ? fark : null,
                IskontoFiyat4 = priceGroupCodes.Contains(4) ? fark : null,
                IskontoFiyat5 = priceGroupCodes.Contains(5) ? fark : null,
                IskontoFiyat6 = priceGroupCodes.Contains(6) ? fark : null,
                PriceGroups = BuildPriceGroups(priceGroupCodes, fark, user, now),
                CreateUser = user,
                CreateTime = now,
                IsDeleted = false
            });
        }
        return (rows, codes, null);
    }

    /// <summary>Fiyat grubu seçilmemişse bütün aktif gruplar (kampanyalı F4 her gruba formülle taşınır).</summary>
    private async Task<List<int>> ResolvePriceGroupsAsync(List<int>? requested, CancellationToken ct)
    {
        var list = (requested ?? new List<int>()).Where(x => x >= 1).Distinct().ToList();
        if (list.Count > 0) return list;
        list = await _dbContext.PriceGroups.Where(p => p.IsActive).Select(p => (int)p.Code).ToListAsync(ct);
        return list.Count > 0 ? list : new List<int> { 1, 2, 3, 4, 5, 6, 7 };
    }

    [HttpPatch("product-discount/{id:guid}")]
    public async Task<IActionResult> PatchProductDiscount([FromRoute] Guid id, [FromBody] PatchProductDiscountRequest? request, CancellationToken cancellationToken)
    {
        if (request is null)
        {
            return BadRequest(new { success = false, message = "Request body boş veya geçersiz." });
        }

        static DateTime NormalizeToUtc(DateTime dt)
        {
            return dt.Kind switch
            {
                DateTimeKind.Utc => dt,
                DateTimeKind.Local => dt.ToUniversalTime(),
                _ => DateTime.SpecifyKind(dt, DateTimeKind.Utc)
            };
        }

        static bool TryParseDiscountType(string raw, out IskontoTipi parsed)
        {
            parsed = default;
            var s = (raw ?? string.Empty).Trim();
            if (string.IsNullOrWhiteSpace(s)) return false;

            if (int.TryParse(s, out var i))
            {
                if (i == 1) { parsed = IskontoTipi.Tutar; return true; }
                if (i == 2) { parsed = IskontoTipi.Oran; return true; }
                return false;
            }

            if (string.Equals(s, "tutar", StringComparison.OrdinalIgnoreCase)) { parsed = IskontoTipi.Tutar; return true; }
            if (string.Equals(s, "oran", StringComparison.OrdinalIgnoreCase)) { parsed = IskontoTipi.Oran; return true; }
            return false;
        }

        var campaign = await _dbContext.Campaigns
            .Include(x => x.CampaignConditions)
            .Include(x => x.CampaignDiscounts)
            .Include(x => x.CampaignTargets)
            .FirstOrDefaultAsync(x => x.Id == id, cancellationToken);

        if (campaign is null || campaign.IsDeleted)
        {
            return NotFound(new { success = false, message = "Campaign not found." });
        }

        if (campaign.KampanyaTipi != KampanyaTipi.UrunIndirimi)
        {
            return BadRequest(new { success = false, message = "Campaign type mismatch." });
        }

        var user = User.Identity?.Name ?? "System";
        var now = DateTime.UtcNow;

        var currentCondition = campaign.CampaignConditions
            .Where(x => !x.IsDeleted)
            .OrderByDescending(x => x.CreateTime)
            .FirstOrDefault();

        var currentDiscounts = campaign.CampaignDiscounts
            .Where(x => !x.IsDeleted)
            .OrderBy(x => x.CreateTime)
            .ToList();

        if (currentCondition is null || currentDiscounts.Count == 0)
        {
            return BadRequest(new { success = false, message = "Campaign detail rows not found for patch." });
        }

        if (request.Name is not null)
        {
            var n = request.Name.Trim();
            if (string.IsNullOrWhiteSpace(n)) return BadRequest(new { success = false, message = "Name is required." });
            campaign.Name = n;
        }

        if (request.Description is not null)
        {
            var d = request.Description.Trim();
            campaign.Description = string.IsNullOrWhiteSpace(d) ? null : d;
        }

        // Öncelik ve zincir kesme, ad/açıklama ile aynı kalıpta: gönderilmezse dokunulmaz.
        // DIKKAT: bu iki satir aciklama blogunun DISINDA kalmali. Icine dusurulurse oncelik
        // ancak aciklama da gonderildiginde kaydedilir; canli testte tam boyle yakalandi.
        if (request.Priority.HasValue) campaign.Priority = request.Priority.Value;
        if (request.StopNext.HasValue) campaign.StopNext = request.StopNext.Value;

        // Bayi hedefleri. null = alan gonderilmemis = dokunma; bos dizi = kisiti kaldir.
        ApplyDealerTargets(campaign, request.DealerCodes, user, now);

        if (request.StartDate.HasValue)
        {
            campaign.StartDate = NormalizeToUtc(request.StartDate.Value);
        }

        if (request.EndDate.HasValue)
        {
            campaign.EndDate = NormalizeToUtc(request.EndDate.Value);
        }

        if (campaign.StartDate.HasValue && campaign.EndDate.HasValue && campaign.EndDate < campaign.StartDate)
        {
            return BadRequest(new { success = false, message = "EndDate must be greater than or equal to StartDate." });
        }

        if (request.SubeKodu is not null)
        {
            var sk = request.SubeKodu.Trim();
            campaign.SubeKodu = string.IsNullOrWhiteSpace(sk) ? null : sk;
        }

        /*
          ÜRÜNE ÖZEL KAMPANYALI FİYAT (2026-10-07). Liste gönderildiyse koşul ve bütün indirim
          satırları listeden yeniden kurulur; eski kategori/oran alanlarına bakılmaz.
        */
        if (request.Items is not null)
        {
            var hedefGruplar = await ResolvePriceGroupsAsync(request.PriceGroupCodes, cancellationToken);
            var (yeniSatirlar, kodlar, hata) = await BuildTargetPriceRowsAsync(campaign.Id, request.Items, hedefGruplar, user, now, cancellationToken);
            if (hata is not null) return BadRequest(new { success = false, message = hata });

            currentCondition.IsDeleted = true;
            currentCondition.EditUser = user;
            currentCondition.EditTime = now;
            campaign.CampaignConditions.Add(new CampaignCondition
            {
                Id = Guid.NewGuid(),
                CampaignId = campaign.Id,
                ConditionType = CampaignConditionType.CategoryBased,
                TargetId = null,
                Operator = string.Empty,
                Value = 0m,
                CategoryCode = null,
                ProductStockCodesJson = JsonSerializer.Serialize(kodlar),
                CreateUser = user,
                CreateTime = now,
                IsDeleted = false
            });

            foreach (var d in currentDiscounts)
            {
                d.IsDeleted = true;
                d.EditUser = user;
                d.EditTime = now;
            }
            _dbContext.CampaignDiscounts.AddRange(yeniSatirlar!);

            campaign.EditUser = user;
            campaign.EditTime = now;
            await _dbContext.SaveChangesAsync(cancellationToken);
            return Ok(new { success = true, data = new { id = campaign.Id } });
        }

        var nextGroupCode = request.GroupCode is null ? (currentCondition.CategoryCode ?? string.Empty) : request.GroupCode.Trim();
        if (string.IsNullOrWhiteSpace(nextGroupCode))
        {
            return BadRequest(new { success = false, message = "GroupCode is required." });
        }

        var groupExists = await CheckGroupExistsAsync(nextGroupCode, cancellationToken);
        if (!groupExists)
        {
            return BadRequest(new { success = false, message = "Kategori bulunamadı (GroupCode)." });
        }

        var nextStockCodes = request.ProductStockCodes is null
            ? (string.IsNullOrWhiteSpace(currentCondition.ProductStockCodesJson) ? new List<string>() : ParseProductStockCodes(currentCondition.ProductStockCodesJson).ToList())
            : (request.ProductStockCodes ?? new List<string>())
                .Where(x => !string.IsNullOrWhiteSpace(x))
                .Select(x => x.Trim())
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToList();

        if (request.ProductStockCodes is not null && nextStockCodes.Count > 0)
        {
            var foundCount = await _dbContext.Products
                .AsNoTracking()
                .Where(p => nextStockCodes.Contains(p.StockCode))
                .Select(p => p.StockCode)
                .Distinct()
                .CountAsync(cancellationToken);

            if (foundCount != nextStockCodes.Count)
            {
                return BadRequest(new { success = false, message = "One or more products not found." });
            }
        }

        var nextDiscountTypeRaw = request.DiscountType is null ? currentDiscounts.First().IskontoTipi.ToString() : request.DiscountType;
        if (!TryParseDiscountType(nextDiscountTypeRaw, out var nextDiscountType))
        {
            return BadRequest(new { success = false, message = "DiscountType is required. Allowed: Tutar, Oran, 1, 2." });
        }

        var nextDiscountValue = request.DiscountValue ?? currentDiscounts.First().Deger;
        if (nextDiscountValue < 0)
        {
            return BadRequest(new { success = false, message = "DiscountValue must be >= 0." });
        }
        if (nextDiscountType == IskontoTipi.Oran && nextDiscountValue > 100)
        {
            return BadRequest(new { success = false, message = "Oran (%) 100'den büyük olamaz." });
        }

        List<int> selectedGroups;
        if (request.PriceGroupCodes is null)
        {
            selectedGroups = new List<int>();
            var sample = currentDiscounts.First();
            if (sample.IskontoFiyat1 is not null) selectedGroups.Add(1);
            if (sample.IskontoFiyat2 is not null) selectedGroups.Add(2);
            if (sample.IskontoFiyat3 is not null) selectedGroups.Add(3);
            if (sample.IskontoFiyat4 is not null) selectedGroups.Add(4);
            if (sample.IskontoFiyat5 is not null) selectedGroups.Add(5);
            if (sample.IskontoFiyat6 is not null) selectedGroups.Add(6);
        }
        else
        {
            selectedGroups = (request.PriceGroupCodes ?? new List<int>())
                .Where(x => x >= 1)
                .Distinct()
                .ToList();
        }

        if (selectedGroups.Count == 0)
        {
            selectedGroups = await _dbContext.PriceGroups.Where(p => p.IsActive).Select(p => (int)p.Code).ToListAsync(cancellationToken);
            if (selectedGroups.Count == 0) selectedGroups = new List<int> { 1, 2, 3, 4, 5, 6, 7 };
        }

        var conditionTouched = request.GroupCode is not null || request.ProductStockCodes is not null;
        if (conditionTouched)
        {
            currentCondition.IsDeleted = true;
            currentCondition.EditUser = user;
            currentCondition.EditTime = now;

            var stockJson = nextStockCodes.Count == 0 ? null : JsonSerializer.Serialize(nextStockCodes);

            campaign.CampaignConditions.Add(new CampaignCondition
            {
                Id = Guid.NewGuid(),
                CampaignId = campaign.Id,
                ConditionType = CampaignConditionType.CategoryBased,
                TargetId = null,
                Operator = string.Empty,
                Value = 0m,
                Metric = null,
                Minimum = null,
                Maximum = null,
                CategoryCode = nextGroupCode,
                ProductStockCodesJson = stockJson,
                CreateUser = user,
                CreateTime = now,
                IsDeleted = false
            });
        }

        var discountTouched = request.GroupCode is not null || request.ProductStockCodes is not null || request.DiscountType is not null || request.DiscountValue.HasValue || request.PriceGroupCodes is not null;
        if (discountTouched)
        {
            foreach (var d in currentDiscounts)
            {
                d.IsDeleted = true;
                d.EditUser = user;
                d.EditTime = now;
            }

            static decimal? PickPrice(decimal value, bool selectedFlag)
            {
                return selectedFlag ? value : null;
            }

            CampaignDiscount CreateRow(string? stokKodu)
            {
                return new CampaignDiscount
                {
                    Id = Guid.NewGuid(),
                    CampaignId = campaign.Id,
                    StokKodu = stokKodu,
                    GrupKodu = nextGroupCode,
                    MinSepetTutari = 0m,
                    IskontoTipi = nextDiscountType,
                    Deger = nextDiscountValue,
                    IskontoFiyat1 = PickPrice(nextDiscountValue, selectedGroups.Contains(1)),
                    IskontoFiyat2 = PickPrice(nextDiscountValue, selectedGroups.Contains(2)),
                    IskontoFiyat3 = PickPrice(nextDiscountValue, selectedGroups.Contains(3)),
                    IskontoFiyat4 = PickPrice(nextDiscountValue, selectedGroups.Contains(4)),
                    IskontoFiyat5 = PickPrice(nextDiscountValue, selectedGroups.Contains(5)),
                    IskontoFiyat6 = PickPrice(nextDiscountValue, selectedGroups.Contains(6)),
                    // Sinirsiz fiyat grubu kaynagi. Yukaridaki IskontoFiyat1..6 GERIYE DONUK UYUM icin
                    // yazilmaya devam ediyor; okuma tarafi once bu listeye bakar.
                    PriceGroups = BuildPriceGroups(selectedGroups, nextDiscountValue, user, now),
                    CreateUser = user,
                    CreateTime = now,
                    IsDeleted = false
                };
            }

            if (nextStockCodes.Count == 0)
            {
                _dbContext.CampaignDiscounts.Add(CreateRow(null));
            }
            else
            {
                foreach (var sc in nextStockCodes)
                {
                    _dbContext.CampaignDiscounts.Add(CreateRow(sc));
                }
            }
        }

        campaign.EditUser = user;
        campaign.EditTime = now;

        await _dbContext.SaveChangesAsync(cancellationToken);
        return Ok(new { success = true, data = new { id = campaign.Id } });
    }

    public sealed class PatchQuantityTieredDiscountRequest
    {
        /// <summary>
        /// Kampanyanın uygulanacağı bayiler. NULL = dokunma, BOŞ dizi = kısıtı kaldır (tüm bayiler).
        /// </summary>
        public List<string>? DealerCodes { get; set; }


        /// <summary>
        /// Uygulama sırası; BÜYÜK olan ÖNCE uygulanır. null gönderilirse mevcut değer korunur.
        /// Oluştururken verilebiliyordu ama düzenlerken değiştirilemiyordu.
        /// </summary>
        [Range(0, 1000)]
        public int? Priority { get; set; }

        /// <summary>
        /// Bu kampanya uygulandıysa SONRAKİ kampanyalar hiç denenmesin.
        /// Varlıkta ve değerlendiricide vardı ama hiçbir uçtan ayarlanamıyordu; her kampanya
        /// zorunlu olarak false ile kaydediliyor, yani kampanyalar her zaman üst üste biniyordu.
        /// </summary>
        public bool? StopNext { get; set; }
        public string? Name { get; set; }
        public string? Description { get; set; }
        public DateTime? StartDate { get; set; }
        public DateTime? EndDate { get; set; }
        public List<string>? GroupCodes { get; set; }
        public List<string>? ProductStockCodes { get; set; }
        public List<QuantityTierRequest>? Tiers { get; set; }
        public string? SubeKodu { get; set; }
    }

    [HttpPatch("quantity-tiered-discount/{id:guid}")]
    public async Task<IActionResult> PatchQuantityTieredDiscount([FromRoute] Guid id, [FromBody] PatchQuantityTieredDiscountRequest? request, CancellationToken cancellationToken)
    {
        if (request is null)
        {
            return BadRequest(new { success = false, message = "Request body boş veya geçersiz." });
        }

        static DateTime NormalizeToUtc(DateTime dt)
        {
            return dt.Kind switch
            {
                DateTimeKind.Utc => dt,
                DateTimeKind.Local => dt.ToUniversalTime(),
                _ => DateTime.SpecifyKind(dt, DateTimeKind.Utc)
            };
        }

        static bool TryParseDiscountType(string raw, out IskontoTipi parsed)
        {
            parsed = default;
            var s = (raw ?? string.Empty).Trim();
            if (string.IsNullOrWhiteSpace(s)) return false;

            if (int.TryParse(s, out var i))
            {
                if (i == 1) { parsed = IskontoTipi.Tutar; return true; }
                if (i == 2) { parsed = IskontoTipi.Oran; return true; }
                return false;
            }

            if (string.Equals(s, "tutar", StringComparison.OrdinalIgnoreCase)) { parsed = IskontoTipi.Tutar; return true; }
            if (string.Equals(s, "oran", StringComparison.OrdinalIgnoreCase)) { parsed = IskontoTipi.Oran; return true; }
            return false;
        }

        var campaign = await _dbContext.Campaigns
            .Include(x => x.CampaignConditions)
            .Include(x => x.CampaignDiscounts)
            .Include(x => x.CampaignTargets)
            .FirstOrDefaultAsync(x => x.Id == id, cancellationToken);

        if (campaign is null || campaign.IsDeleted)
        {
            return NotFound(new { success = false, message = "Campaign not found." });
        }

        if (campaign.KampanyaTipi != KampanyaTipi.AdetBazliKademeliIndirim)
        {
            return BadRequest(new { success = false, message = "Campaign type mismatch." });
        }

        var user = User.Identity?.Name ?? "System";
        var now = DateTime.UtcNow;

        var currentConditions = campaign.CampaignConditions
            .Where(x => !x.IsDeleted)
            .OrderBy(x => x.Minimum ?? 0)
            .ThenBy(x => x.CreateTime)
            .ToList();

        var currentDiscounts = campaign.CampaignDiscounts
            .Where(x => !x.IsDeleted)
            .OrderBy(x => x.CreateTime)
            .ToList();

        if (currentConditions.Count == 0 || currentDiscounts.Count == 0)
        {
            return BadRequest(new { success = false, message = "Campaign detail rows not found for patch." });
        }

        if (request.Name is not null)
        {
            var n = request.Name.Trim();
            if (string.IsNullOrWhiteSpace(n)) return BadRequest(new { success = false, message = "Name is required." });
            campaign.Name = n;
        }

        if (request.Description is not null)
        {
            var d = request.Description.Trim();
            campaign.Description = string.IsNullOrWhiteSpace(d) ? null : d;
        }

        // Öncelik ve zincir kesme, ad/açıklama ile aynı kalıpta: gönderilmezse dokunulmaz.
        // DIKKAT: bu iki satir aciklama blogunun DISINDA kalmali. Icine dusurulurse oncelik
        // ancak aciklama da gonderildiginde kaydedilir; canli testte tam boyle yakalandi.
        if (request.Priority.HasValue) campaign.Priority = request.Priority.Value;
        if (request.StopNext.HasValue) campaign.StopNext = request.StopNext.Value;

        // Bayi hedefleri. null = alan gonderilmemis = dokunma; bos dizi = kisiti kaldir.
        ApplyDealerTargets(campaign, request.DealerCodes, user, now);

        if (request.StartDate.HasValue)
        {
            campaign.StartDate = NormalizeToUtc(request.StartDate.Value);
        }

        if (request.EndDate.HasValue)
        {
            campaign.EndDate = NormalizeToUtc(request.EndDate.Value);
        }

        if (campaign.StartDate.HasValue && campaign.EndDate.HasValue && campaign.EndDate < campaign.StartDate)
        {
            return BadRequest(new { success = false, message = "EndDate must be greater than or equal to StartDate." });
        }

        if (request.SubeKodu is not null)
        {
            var sk = request.SubeKodu.Trim();
            campaign.SubeKodu = string.IsNullOrWhiteSpace(sk) ? null : sk;
        }

        var existingTargetsJson = currentConditions.First().ProductStockCodesJson;
        var existingGroupCodes = string.IsNullOrWhiteSpace(existingTargetsJson) ? new List<string>() : ParseGroupCodes(existingTargetsJson).ToList();
        var existingProductStockCodes = string.IsNullOrWhiteSpace(existingTargetsJson) ? new List<string>() : ParseProductStockCodes(existingTargetsJson).ToList();

        var nextGroupCodes = request.GroupCodes is null
            ? existingGroupCodes
            : (request.GroupCodes ?? new List<string>())
                .Where(x => !string.IsNullOrWhiteSpace(x))
                .Select(x => x.Trim())
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToList();

        var nextProductStockCodes = request.ProductStockCodes is null
            ? existingProductStockCodes
            : (request.ProductStockCodes ?? new List<string>())
                .Where(x => !string.IsNullOrWhiteSpace(x))
                .Select(x => x.Trim())
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToList();

        if (nextGroupCodes.Count == 0 && nextProductStockCodes.Count == 0)
        {
            return BadRequest(new { success = false, message = "En az 1 kategori veya 1 ürün seçilmelidir." });
        }

        if (request.ProductStockCodes is not null && nextProductStockCodes.Count > 0)
        {
            var found = await _dbContext.Products
                .AsNoTracking()
                .Where(p => nextProductStockCodes.Contains(p.StockCode))
                .Select(p => p.StockCode)
                .ToListAsync(cancellationToken);

            if (found.Count != nextProductStockCodes.Count)
            {
                return BadRequest(new { success = false, message = "One or more products not found." });
            }
        }

        List<QuantityTierRequest> nextTiers;
        if (request.Tiers is null)
        {
            var count = Math.Min(currentConditions.Count, currentDiscounts.Count);
            if (count <= 0)
            {
                return BadRequest(new { success = false, message = "Campaign tiers not found for patch." });
            }

            nextTiers = new List<QuantityTierRequest>();
            for (var i = 0; i < count; i++)
            {
                var c = currentConditions[i];
                var d = currentDiscounts[i];
                var pg = new List<int>();
                if (d.IskontoFiyat1 is not null) pg.Add(1);
                if (d.IskontoFiyat2 is not null) pg.Add(2);
                if (d.IskontoFiyat3 is not null) pg.Add(3);
                if (d.IskontoFiyat4 is not null) pg.Add(4);
                if (d.IskontoFiyat5 is not null) pg.Add(5);
                if (d.IskontoFiyat6 is not null) pg.Add(6);

                nextTiers.Add(new QuantityTierRequest
                {
                    MinQuantity = c.Minimum ?? 0m,
                    MaxQuantity = c.Maximum,
                    DiscountType = d.IskontoTipi.ToString(),
                    DiscountValue = d.Deger,
                    PriceGroupCodes = pg
                });
            }
        }
        else
        {
            nextTiers = request.Tiers;
        }

        if (nextTiers is null || nextTiers.Count == 0)
        {
            return BadRequest(new { success = false, message = "En az 1 kademe eklenmelidir." });
        }

        for (var i = 0; i < nextTiers.Count; i++)
        {
            var t = nextTiers[i];
            if (t.MinQuantity <= 0)
            {
                return BadRequest(new { success = false, message = $"Tiers[{i}].MinQuantity must be greater than 0." });
            }
            if (t.MaxQuantity.HasValue && t.MaxQuantity.Value < t.MinQuantity)
            {
                return BadRequest(new { success = false, message = $"Tiers[{i}].MaxQuantity must be greater than or equal to MinQuantity." });
            }
            if (!TryParseDiscountType(t.DiscountType, out var dt))
            {
                return BadRequest(new { success = false, message = $"Tiers[{i}].DiscountType is required. Allowed: Tutar, Oran, 1, 2." });
            }
            if (t.DiscountValue < 0)
            {
                return BadRequest(new { success = false, message = $"Tiers[{i}].DiscountValue must be >= 0." });
            }
            if (dt == IskontoTipi.Oran && t.DiscountValue > 100)
            {
                return BadRequest(new { success = false, message = "Oran (%) 100'den büyük olamaz." });
            }
            var pg = (t.PriceGroupCodes ?? new List<int>())
                .Where(x => x >= 1)
                .Distinct()
                .ToList();
            if (pg.Count == 0)
            {
                pg = await _dbContext.PriceGroups.Where(p => p.IsActive).Select(p => (int)p.Code).ToListAsync(cancellationToken);
                if (pg.Count == 0) pg = new List<int> { 1, 2, 3, 4, 5, 6, 7 };
                t.PriceGroupCodes = pg;
            }
        }

        // Cakisma kontrolu yalnizca 1..6 arasinda donuyordu; 7. fiyat grubunda iki kademe
        // ayni araligi kapsasa bile fark edilmiyordu. Artik gercekten secilen gruplar dolasilir.
        foreach (var priceGroup in nextTiers
            .SelectMany(t => t.PriceGroupCodes ?? new List<int>())
            .Where(x => x >= 1)
            .Distinct())
        {
            var ranges = nextTiers
                .Select((t, idx) => new
                {
                    idx,
                    selected = (t.PriceGroupCodes ?? new List<int>()).Contains(priceGroup),
                    min = t.MinQuantity,
                    max = t.MaxQuantity
                })
                .Where(x => x.selected)
                .ToList();

            for (var i = 0; i < ranges.Count; i++)
            {
                for (var j = i + 1; j < ranges.Count; j++)
                {
                    var aMin = ranges[i].min;
                    var aMax = ranges[i].max ?? decimal.MaxValue;
                    var bMin = ranges[j].min;
                    var bMax = ranges[j].max ?? decimal.MaxValue;
                    var overlap = aMin <= bMax && bMin <= aMax;
                    if (overlap)
                    {
                        return BadRequest(new { success = false, message = $"Fiyat {priceGroup} için miktar aralıkları çakışıyor (kademeler: {ranges[i].idx + 1} ve {ranges[j].idx + 1})." });
                    }
                }
            }
        }

        var tiersTouched = request.Tiers is not null;
        var targetsTouched = request.GroupCodes is not null || request.ProductStockCodes is not null;

        if (tiersTouched || targetsTouched)
        {
            foreach (var c in currentConditions)
            {
                c.IsDeleted = true;
                c.EditUser = user;
                c.EditTime = now;
            }

            foreach (var d in currentDiscounts)
            {
                d.IsDeleted = true;
                d.EditUser = user;
                d.EditTime = now;
            }

            var targetsJson = JsonSerializer.Serialize(new QuantityTierTargets { GroupCodes = nextGroupCodes, ProductStockCodes = nextProductStockCodes });

            static decimal? PickPrice(decimal value, bool selectedFlag)
            {
                return selectedFlag ? value : null;
            }

            nextTiers = nextTiers.OrderBy(t => t.MinQuantity).ToList();
            var tierIdx = 0;
            foreach (var t in nextTiers)
            {
                var tierTime = now.AddMilliseconds(tierIdx * 10);
                if (!TryParseDiscountType(t.DiscountType, out var discountType))
                {
                    return BadRequest(new { success = false, message = "Invalid DiscountType." });
                }

                var pg = (t.PriceGroupCodes ?? new List<int>())
                    .Where(x => x >= 1)
                    .Distinct()
                    .ToList();

                campaign.CampaignConditions.Add(new CampaignCondition
                {
                    Id = Guid.NewGuid(),
                    CampaignId = campaign.Id,
                    ConditionType = CampaignConditionType.CategoryBased,
                    TargetId = null,
                    Operator = string.Empty,
                    Value = 0m,
                    Metric = CampaignConditionMetric.Quantity,
                    Minimum = t.MinQuantity,
                    Maximum = t.MaxQuantity,
                    CategoryCode = null,
                    ProductStockCodesJson = targetsJson,
                    CreateUser = user,
                    CreateTime = tierTime,
                    IsDeleted = false
                });

                _dbContext.CampaignDiscounts.Add(new CampaignDiscount
                {
                    Id = Guid.NewGuid(),
                    CampaignId = campaign.Id,
                    StokKodu = null,
                    GrupKodu = null,
                    MinSepetTutari = 0m,
                    IskontoTipi = discountType,
                    Deger = t.DiscountValue,
                    IskontoFiyat1 = PickPrice(t.DiscountValue, pg.Contains(1)),
                    IskontoFiyat2 = PickPrice(t.DiscountValue, pg.Contains(2)),
                    IskontoFiyat3 = PickPrice(t.DiscountValue, pg.Contains(3)),
                    IskontoFiyat4 = PickPrice(t.DiscountValue, pg.Contains(4)),
                    IskontoFiyat5 = PickPrice(t.DiscountValue, pg.Contains(5)),
                    IskontoFiyat6 = PickPrice(t.DiscountValue, pg.Contains(6)),
                    // Sinirsiz fiyat grubu kaynagi. Yukaridaki IskontoFiyat1..6 GERIYE DONUK UYUM icin
                    // yazilmaya devam ediyor; okuma tarafi once bu listeye bakar.
                    PriceGroups = BuildPriceGroups(pg, t.DiscountValue, user, now),
                    CreateUser = user,
                    CreateTime = tierTime,
                    IsDeleted = false
                });

                tierIdx++;
            }
        }

        campaign.EditUser = user;
        campaign.EditTime = now;

        await _dbContext.SaveChangesAsync(cancellationToken);
        return Ok(new { success = true, data = new { id = campaign.Id } });
    }

    public sealed class PatchBuyXGetYRequest
    {
        /// <summary>
        /// Kampanyanın uygulanacağı bayiler. NULL = dokunma, BOŞ dizi = kısıtı kaldır (tüm bayiler).
        /// </summary>
        public List<string>? DealerCodes { get; set; }


        /// <summary>
        /// Uygulama sırası; BÜYÜK olan ÖNCE uygulanır. null gönderilirse mevcut değer korunur.
        /// Oluştururken verilebiliyordu ama düzenlerken değiştirilemiyordu.
        /// </summary>
        [Range(0, 1000)]
        public int? Priority { get; set; }

        /// <summary>
        /// Bu kampanya uygulandıysa SONRAKİ kampanyalar hiç denenmesin.
        /// Varlıkta ve değerlendiricide vardı ama hiçbir uçtan ayarlanamıyordu; her kampanya
        /// zorunlu olarak false ile kaydediliyor, yani kampanyalar her zaman üst üste biniyordu.
        /// </summary>
        public bool? StopNext { get; set; }
        public string? Name { get; set; }
        public string? Description { get; set; }
        public DateTime? StartDate { get; set; }
        public DateTime? EndDate { get; set; }
        public string? TriggerGroupCode { get; set; }
        public List<string>? TriggerProductStockCodes { get; set; }
        public int? TriggerMinQuantity { get; set; }
        public List<PatchBuyXGetYRewardLineRequest>? RewardLines { get; set; }
        public string? SubeKodu { get; set; }
    }

    public sealed class PatchBuyXGetYRewardLineRequest
    {
        public Guid TargetProductId { get; set; }
        public int Quantity { get; set; } = 1;
        public bool IsGift { get; set; }
        public string? DiscountType { get; set; }
        public decimal DiscountValue { get; set; }
        public List<int>? PriceGroupCodes { get; set; }

        /// <summary>
        /// Kampanyanın uygulanacağı bayiler (cari kodları). BOŞ/NULL = tüm bayiler.
        ///
        /// Hedefleme altyapısı (CampaignTargets + IsTargetMatch) zaten vardı ama hiçbir uç
        /// hedef almıyordu; ekrandaki bayi seçimi hiçbir yere gitmiyordu. Buradan gelen
        /// kodlar SpecificCustomer hedefi olarak yazılır.
        /// </summary>
        public List<string>? DealerCodes { get; set; }
    }

    [HttpPatch("buy-x-get-y/{id:guid}")]
    public async Task<IActionResult> PatchBuyXGetY([FromRoute] Guid id, [FromBody] PatchBuyXGetYRequest? request, CancellationToken cancellationToken)
    {
        if (request is null)
        {
            return BadRequest(new { success = false, message = "Request body boş veya geçersiz." });
        }

        static DateTime NormalizeToUtc(DateTime dt)
        {
            return dt.Kind switch
            {
                DateTimeKind.Utc => dt,
                DateTimeKind.Local => dt.ToUniversalTime(),
                _ => DateTime.SpecifyKind(dt, DateTimeKind.Utc)
            };
        }

        static bool TryParseDiscountType(string raw, out IskontoTipi parsed)
        {
            parsed = default;
            var s = (raw ?? string.Empty).Trim();
            if (string.IsNullOrWhiteSpace(s)) return false;

            if (int.TryParse(s, out var i))
            {
                if (i == 1) { parsed = IskontoTipi.Tutar; return true; }
                if (i == 2) { parsed = IskontoTipi.Oran; return true; }
                return false;
            }

            if (string.Equals(s, "tutar", StringComparison.OrdinalIgnoreCase)) { parsed = IskontoTipi.Tutar; return true; }
            if (string.Equals(s, "oran", StringComparison.OrdinalIgnoreCase)) { parsed = IskontoTipi.Oran; return true; }
            return false;
        }

        var campaign = await _dbContext.Campaigns
            .Include(x => x.CampaignConditions)
            .Include(x => x.CampaignActions)
            .Include(x => x.CampaignDiscounts)
            .FirstOrDefaultAsync(x => x.Id == id, cancellationToken);

        if (campaign is null || campaign.IsDeleted)
        {
            return NotFound(new { success = false, message = "Campaign not found." });
        }

        if (campaign.KampanyaTipi != KampanyaTipi.XAlanaYHediyeVeyaIndirimliUrun)
        {
            return BadRequest(new { success = false, message = "Campaign type mismatch." });
        }

        var user = User.Identity?.Name ?? "System";
        var now = DateTime.UtcNow;

        var currentCondition = campaign.CampaignConditions
            .Where(x => !x.IsDeleted)
            .OrderByDescending(x => x.CreateTime)
            .FirstOrDefault();

        if (currentCondition is null)
        {
            return BadRequest(new { success = false, message = "Campaign condition row not found for patch." });
        }

        if (request.Name is not null)
        {
            var n = request.Name.Trim();
            if (string.IsNullOrWhiteSpace(n)) return BadRequest(new { success = false, message = "Name is required." });
            campaign.Name = n;
        }

        if (request.Description is not null)
        {
            var d = request.Description.Trim();
            campaign.Description = string.IsNullOrWhiteSpace(d) ? null : d;
        }

        // Öncelik ve zincir kesme, ad/açıklama ile aynı kalıpta: gönderilmezse dokunulmaz.
        // DIKKAT: bu iki satir aciklama blogunun DISINDA kalmali. Icine dusurulurse oncelik
        // ancak aciklama da gonderildiginde kaydedilir; canli testte tam boyle yakalandi.
        if (request.Priority.HasValue) campaign.Priority = request.Priority.Value;
        if (request.StopNext.HasValue) campaign.StopNext = request.StopNext.Value;

        // Bayi hedefleri. null = alan gonderilmemis = dokunma; bos dizi = kisiti kaldir.
        ApplyDealerTargets(campaign, request.DealerCodes, user, now);

        if (request.StartDate.HasValue)
        {
            campaign.StartDate = NormalizeToUtc(request.StartDate.Value);
        }

        if (request.EndDate.HasValue)
        {
            campaign.EndDate = NormalizeToUtc(request.EndDate.Value);
        }

        if (campaign.StartDate.HasValue && campaign.EndDate.HasValue && campaign.EndDate < campaign.StartDate)
        {
            return BadRequest(new { success = false, message = "EndDate must be greater than or equal to StartDate." });
        }

        if (request.SubeKodu is not null)
        {
            var sk = request.SubeKodu.Trim();
            campaign.SubeKodu = string.IsNullOrWhiteSpace(sk) ? null : sk;
        }

        var triggerTouched = request.TriggerGroupCode is not null || request.TriggerProductStockCodes is not null || request.TriggerMinQuantity.HasValue;

        var nextTriggerGroup = request.TriggerGroupCode is null
            ? (currentCondition.CategoryCode ?? string.Empty)
            : request.TriggerGroupCode.Trim();

        // TriggerGroupCode validation should only run when client explicitly sends TriggerGroupCode.
        // This prevents unrelated edits (like dates/description) from failing if the stored category code is no longer present.
        if (request.TriggerGroupCode is not null)
        {
            if (string.IsNullOrWhiteSpace(nextTriggerGroup))
            {
                return BadRequest(new { success = false, message = "TriggerGroupCode is required." });
            }

            var groupExists = await CheckGroupExistsAsync(nextTriggerGroup, cancellationToken);
            if (!groupExists)
            {
                return BadRequest(new { success = false, message = "Kategori bulunamadı (TriggerGroupCode)." });
            }
        }

        var existingTriggerStockCodes = string.IsNullOrWhiteSpace(currentCondition.ProductStockCodesJson)
            ? new List<string>()
            : ParseProductStockCodes(currentCondition.ProductStockCodesJson).ToList();

        var nextTriggerStockCodes = request.TriggerProductStockCodes is null
            ? existingTriggerStockCodes
            : (request.TriggerProductStockCodes ?? new List<string>())
                .Where(x => !string.IsNullOrWhiteSpace(x))
                .Select(x => x.Trim())
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToList();

        if (request.TriggerProductStockCodes is not null && nextTriggerStockCodes.Count > 0)
        {
            var foundCount = await _dbContext.Products
                .AsNoTracking()
                .Where(p => nextTriggerStockCodes.Contains(p.StockCode))
                .Select(p => p.StockCode)
                .Distinct()
                .CountAsync(cancellationToken);

            if (foundCount != nextTriggerStockCodes.Count)
            {
                return BadRequest(new { success = false, message = "One or more trigger products not found." });
            }
        }

        var nextMinQty = request.TriggerMinQuantity ?? (int)(currentCondition.Minimum ?? 1);
        if (nextMinQty <= 0)
        {
            return BadRequest(new { success = false, message = "TriggerMinQuantity must be greater than 0." });
        }

        if (triggerTouched)
        {
            currentCondition.IsDeleted = true;
            currentCondition.EditUser = user;
            currentCondition.EditTime = now;

            var triggerJson = nextTriggerStockCodes.Count == 0 ? null : JsonSerializer.Serialize(nextTriggerStockCodes);

            campaign.CampaignConditions.Add(new CampaignCondition
            {
                Id = Guid.NewGuid(),
                CampaignId = campaign.Id,
                ConditionType = CampaignConditionType.CategoryBased,
                TargetId = null,
                Operator = string.Empty,
                Value = 0m,
                Metric = CampaignConditionMetric.Quantity,
                Minimum = nextMinQty,
                Maximum = null,
                CategoryCode = nextTriggerGroup,
                ProductStockCodesJson = triggerJson,
                CreateUser = user,
                CreateTime = now,
                IsDeleted = false
            });

            foreach (var d in campaign.CampaignDiscounts.Where(x => !x.IsDeleted))
            {
                d.GrupKodu = nextTriggerGroup;
            }
        }

        var rewardsTouched = request.RewardLines is not null;
        if (rewardsTouched)
        {
            var rewards = request.RewardLines ?? new List<PatchBuyXGetYRewardLineRequest>();
            if (rewards.Count == 0)
            {
                return BadRequest(new { success = false, message = "En az 1 hedef ürün satırı eklenmelidir." });
            }

            var rewardIds = rewards
                .Select(x => x.TargetProductId)
                .Where(x => x != Guid.Empty)
                .Distinct()
                .ToList();

            var rewardProducts = await _dbContext.Products
                .AsNoTracking()
                .Where(p => rewardIds.Contains(p.Id))
                .Select(p => new { p.Id, p.StockCode })
                .ToListAsync(cancellationToken);

            if (rewardProducts.Count != rewardIds.Count)
            {
                return BadRequest(new { success = false, message = "One or more reward products not found." });
            }

            var stockById = rewardProducts.ToDictionary(x => x.Id, x => x.StockCode);

            foreach (var a in campaign.CampaignActions.Where(x => !x.IsDeleted))
            {
                a.IsDeleted = true;
                a.EditUser = user;
                a.EditTime = now;
            }

            foreach (var d in campaign.CampaignDiscounts.Where(x => !x.IsDeleted))
            {
                d.IsDeleted = true;
                d.EditUser = user;
                d.EditTime = now;
            }

            static decimal? PickPrice(decimal value, bool selectedFlag)
            {
                return selectedFlag ? value : null;
            }

            for (var i = 0; i < rewards.Count; i++)
            {
                var r = rewards[i];
                if (r.TargetProductId == Guid.Empty)
                {
                    return BadRequest(new { success = false, message = $"RewardLines[{i}].TargetProductId is required." });
                }
                if (r.Quantity <= 0)
                {
                    return BadRequest(new { success = false, message = $"RewardLines[{i}].Quantity must be greater than 0." });
                }

                if (r.IsGift)
                {
                    campaign.CampaignActions.Add(new CampaignAction
                    {
                        Id = Guid.NewGuid(),
                        CampaignId = campaign.Id,
                        ActionType = CampaignActionType.GiftProduct,
                        TargetProductId = r.TargetProductId,
                        TargetPriceGroupId = null,
                        Value = 0m,
                        Quantity = r.Quantity,
                        CreateUser = user,
                        CreateTime = now,
                        IsDeleted = false
                    });
                }
                else
                {
                    if (!TryParseDiscountType(r.DiscountType ?? string.Empty, out var dt))
                    {
                        return BadRequest(new { success = false, message = $"RewardLines[{i}].DiscountType is required. Allowed: Tutar, Oran, 1, 2." });
                    }
                    if (r.DiscountValue <= 0)
                    {
                        return BadRequest(new { success = false, message = $"RewardLines[{i}].DiscountValue must be greater than 0." });
                    }
                    if (dt == IskontoTipi.Oran && r.DiscountValue > 100)
                    {
                        return BadRequest(new { success = false, message = "Oran (%) 100'den büyük olamaz." });
                    }

                    var pg = (r.PriceGroupCodes ?? new List<int>())
                        .Where(x => x >= 1)
                        .Distinct()
                        .ToList();
                    if (pg.Count == 0)
                    {
                        pg = await _dbContext.PriceGroups.Where(p => p.IsActive).Select(p => (int)p.Code).ToListAsync(cancellationToken);
                        if (pg.Count == 0) pg = new List<int> { 1, 2, 3, 4, 5, 6, 7 };
                    }

                    var stokKodu = stockById[r.TargetProductId];

                    _dbContext.CampaignDiscounts.Add(new CampaignDiscount
                    {
                        Id = Guid.NewGuid(),
                        CampaignId = campaign.Id,
                        StokKodu = stokKodu,
                        GrupKodu = nextTriggerGroup,
                        MinSepetTutari = 0m,
                        IskontoTipi = dt,
                        Deger = r.DiscountValue,
                        IskontoFiyat1 = PickPrice(r.DiscountValue, pg.Contains(1)),
                        IskontoFiyat2 = PickPrice(r.DiscountValue, pg.Contains(2)),
                        IskontoFiyat3 = PickPrice(r.DiscountValue, pg.Contains(3)),
                        IskontoFiyat4 = PickPrice(r.DiscountValue, pg.Contains(4)),
                        IskontoFiyat5 = PickPrice(r.DiscountValue, pg.Contains(5)),
                        IskontoFiyat6 = PickPrice(r.DiscountValue, pg.Contains(6)),
                        // Sinirsiz fiyat grubu kaynagi. Yukaridaki IskontoFiyat1..6 GERIYE DONUK UYUM icin
                        // yazilmaya devam ediyor; okuma tarafi once bu listeye bakar.
                        PriceGroups = BuildPriceGroups(pg, r.DiscountValue, user, now),
                        RewardQuantity = (decimal)r.Quantity,
                        CreateUser = user,
                        CreateTime = now,
                        IsDeleted = false
                    });
                }
            }
        }

        campaign.EditUser = user;
        campaign.EditTime = now;

        await _dbContext.SaveChangesAsync(cancellationToken);
        return Ok(new { success = true, data = new { id = campaign.Id } });
    }

    [HttpGet]
    public async Task<IActionResult> GetAll(
        [FromQuery] string? q,
        [FromQuery] string? name,
        [FromQuery] string? description,
        [FromQuery] string? kampanyaTipi,
        [FromQuery] string? isActive,
        [FromQuery] string? startDate,
        [FromQuery] string? endDate,
        [FromQuery] string? sort,
        [FromQuery] string? dir,
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 20,
        CancellationToken cancellationToken = default)
    {
        page = page < 1 ? 1 : page;
        pageSize = pageSize < 1 ? 20 : pageSize;
        pageSize = pageSize > 200 ? 200 : pageSize;

        static string? Norm(string? s)
        {
            var t = (s ?? string.Empty).Trim();
            return string.IsNullOrWhiteSpace(t) ? null : t.ToLowerInvariant();
        }

        static bool? TryParseBoolQuery(string? s)
        {
            var n = Norm(s);
            if (n is null) return null;
            if (n is "true" or "1" or "evet" or "e" or "aktif") return true;
            if (n is "false" or "0" or "hayir" or "h" or "pasif") return false;
            return null;
        }

        var query = _dbContext.Campaigns
            .AsNoTracking()
            .Include(x => x.CampaignConditions)
            .Include(x => x.CampaignActions)
            .Include(x => x.CampaignTargets)
            .Where(x => !x.IsDeleted)
            .AsQueryable();

        if (!string.IsNullOrWhiteSpace(q))
        {
            var term = q.Trim().ToLower();
            query = query.Where(x => x.Name.ToLower().Contains(term) || (x.Description != null && x.Description.ToLower().Contains(term)));
        }

        if (!string.IsNullOrWhiteSpace(name))
        {
            var term = name.Trim().ToLower();
            query = query.Where(x => x.Name.ToLower().Contains(term));
        }

        if (!string.IsNullOrWhiteSpace(description))
        {
            var term = description.Trim().ToLower();
            query = query.Where(x => x.Description != null && x.Description.ToLower().Contains(term));
        }

        if (!string.IsNullOrWhiteSpace(kampanyaTipi))
        {
            var raw = kampanyaTipi.Trim();
            if (int.TryParse(raw, out var typeInt))
            {
                query = query.Where(x => (int)x.KampanyaTipi == typeInt);
            }
        }

        var activeFilter = TryParseBoolQuery(isActive);
        if (activeFilter.HasValue)
        {
            var v = activeFilter.Value;
            query = query.Where(x => x.IsActive == v);
        }

        if (!string.IsNullOrWhiteSpace(startDate) && DateTime.TryParse(startDate.Trim(), out var startDt))
        {
            var d = startDt.Date;
            query = query.Where(x => x.StartDate.HasValue && x.StartDate.Value.Date == d);
        }

        if (!string.IsNullOrWhiteSpace(endDate) && DateTime.TryParse(endDate.Trim(), out var endDt))
        {
            var d = endDt.Date;
            query = query.Where(x => x.EndDate.HasValue && x.EndDate.Value.Date == d);
        }

        var projected = query.Select(x => new
        {
            id = x.Id,
            name = x.Name,
            description = x.Description,
            startDate = x.StartDate,
            endDate = x.EndDate,
            isIndefinite = x.IsIndefinite,
            priority = x.Priority,
            isActive = x.IsActive,
            kampanyaTipi = x.KampanyaTipi,
            subeKodu = x.SubeKodu,
            stopNext = x.StopNext,
            ecommerceEnabled = x.EcommerceEnabled,
            createTime = x.CreateTime,
            conditionsCount = x.CampaignConditions.Count,
            actionsCount = x.CampaignActions.Count,
            targetsCount = x.CampaignTargets.Count
        });

        var descending = string.Equals(dir, "desc", StringComparison.OrdinalIgnoreCase);
        sort = string.IsNullOrWhiteSpace(sort) ? "createtime" : sort.Trim();

        var ordered = sort.ToLower() switch
        {
            "name" => descending ? projected.OrderByDescending(x => x.name) : projected.OrderBy(x => x.name),
            "description" => descending ? projected.OrderByDescending(x => x.description) : projected.OrderBy(x => x.description),
            "startdate" => descending ? projected.OrderByDescending(x => x.startDate) : projected.OrderBy(x => x.startDate),
            "enddate" => descending ? projected.OrderByDescending(x => x.endDate) : projected.OrderBy(x => x.endDate),
            "priority" => descending ? projected.OrderByDescending(x => x.priority) : projected.OrderBy(x => x.priority),
            "isactive" => descending ? projected.OrderByDescending(x => x.isActive) : projected.OrderBy(x => x.isActive),
            "stopnext" => descending ? projected.OrderByDescending(x => x.stopNext) : projected.OrderBy(x => x.stopNext),
            "kampanyatipi" => descending ? projected.OrderByDescending(x => x.kampanyaTipi) : projected.OrderBy(x => x.kampanyaTipi),
            "createtime" => descending ? projected.OrderByDescending(x => x.createTime) : projected.OrderBy(x => x.createTime),
            "conditionscount" => descending ? projected.OrderByDescending(x => x.conditionsCount) : projected.OrderBy(x => x.conditionsCount),
            "actionscount" => descending ? projected.OrderByDescending(x => x.actionsCount) : projected.OrderBy(x => x.actionsCount),
            "targetscount" => descending ? projected.OrderByDescending(x => x.targetsCount) : projected.OrderBy(x => x.targetsCount),
            _ => descending
                ? projected.OrderByDescending(x => x.createTime)
                : projected.OrderBy(x => x.createTime)
        };

        // Stabil pagination için her zaman Id ile tie-break yap.
        ordered = descending
            ? ordered.ThenByDescending(x => x.id)
            : ordered.ThenBy(x => x.id);

        var total = await ordered.CountAsync(cancellationToken);
        var totalPages = Math.Max(1, (int)Math.Ceiling(total / (double)pageSize));
        if (page > totalPages) page = totalPages;

        var items = await ordered
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .ToListAsync(cancellationToken);

        return Ok(new
        {
            success = true,
            data = new { items, total, page, pageSize, totalPages }
        });
    }

    [HttpGet("active")]
    public async Task<IActionResult> GetActiveCampaigns(
        [FromQuery] string? customerCode,
        [FromQuery] int? priceGroupCode,
        [FromQuery] bool includeExpired = false,
        CancellationToken cancellationToken = default)
    {
        var now = DateTime.UtcNow;

        // Rolün kampanya anahtarı kapalıysa liste BOŞ döner: kullanıcı kampanyayı görmemeli de.
        // Yalnızca uygulamayı engellemek yetmezdi — vitrinde/karuselde duran ama sepette işlemeyen
        // kampanya "çalışmıyor" gibi görünürdü. İstenen: kampanya YOKMUŞ gibi olsun.
        if (!await AreCampaignsEnabledForCurrentUserAsync(cancellationToken))
        {
            return Ok(new { success = true, data = Array.Empty<object>() });
        }

        // SİLİNMİŞ ALT SATIRLAR ÇEKİLMEZ + AYRI SORGULAR (2026-10-04, "sepette kampanya geç
        // geliyor"): bkz. CampaignService.EvaluateSalesOrder'daki aynı not. Tek JOIN'li sorgu
        // hedef × koşul × eylem × indirim × fiyat grubu satırlarını çarpıyordu.
        var query = _dbContext.Campaigns
            .AsNoTracking()
            .AsSplitQuery()
            .Include(x => x.CampaignConditions.Where(c => !c.IsDeleted))
            .Include(x => x.CampaignActions.Where(a => !a.IsDeleted))
            .Include(x => x.CampaignTargets.Where(t => !t.IsDeleted))
            .Include(x => x.CampaignDiscounts.Where(d => !d.IsDeleted))
                .ThenInclude(d => d.PriceGroups)
            .Where(x => !x.IsDeleted && x.IsActive);

        // TARİH SÜZGECİ — değerlendiricideki (CampaignService.EvaluateSalesOrder) kuralın AYNISI
        // olmak zorunda, yoksa vitrin ile sepet birbirini tutmaz. İki hata burada da vardı:
        //   - Bitiş günü sayılmıyordu: '11 Ağustos'ta biter' diye kaydedilen kampanya, 11 Ağustos
        //     00:00'dan itibaren listeden düşüyordu (tarih seçici günü gece yarısı olarak saklar).
        //   - Tek uçlu aralık hiç görünmüyordu: iki tarihin de dolu olması şart koşuluyordu.
        if (!includeExpired)
        {
            query = query.Where(x =>
                x.IsIndefinite ||
                (
                    (!x.StartDate.HasValue || x.StartDate.Value <= now) &&
                    (!x.EndDate.HasValue || now < x.EndDate.Value.Date.AddDays(1))
                ));
        }

        var campaigns = await query
            // Sıra değerlendirici ile aynı mantıkta: büyük öncelik önce, eşitlikte belirleyici.
            .OrderByDescending(x => x.Priority)
            .ThenByDescending(x => x.CreateTime)
            .ThenBy(x => x.Name)
            .ThenBy(x => x.Id)
            .ToListAsync(cancellationToken);

        // HEDEF SÜZGECİ — bu uç, `customerCode` parametresini alıp HİÇ KULLANMIYORDU.
        //
        // Sonucu doğrudan bayiye yansıyordu: ürün kartındaki hediye ikonu, aslında başka bir
        // cariye / bölgeye / fiyat grubuna tanımlı kampanyalar için de çıkıyordu. Bayi ikonu
        // görüp ürünü sepete atıyor, sepette indirim çıkmıyordu — çünkü sepeti hesaplayan
        // CampaignService.IsTargetMatch'ten geçiyor, bu liste geçmiyordu.
        //
        // Aynı kural iki yerde tekrar yazılmasın diye IsTargetMatch paylaşılan tek kaynak.
        var customerCodeTrimmed = (customerCode ?? string.Empty).Trim();
        if (customerCodeTrimmed.Length > 0)
        {
            var targetCustomer = await _dbContext.Customers
                .AsNoTracking()
                .FirstOrDefaultAsync(x => x.CustomerCode == customerCodeTrimmed, cancellationToken);

            if (targetCustomer is not null)
            {
                foreach (var c in campaigns)
                {
                    c.CampaignTargets = c.CampaignTargets.Where(t => !t.IsDeleted).ToList();
                }

                campaigns = campaigns
                    .Where(c => CampaignService.IsTargetMatch(c, targetCustomer))
                    .ToList();
            }
        }

        // Ürüne özel kampanyalı fiyat (2026-10-07): indirim güncel F4'ten türetilir.
        var hedefliKodlar = campaigns
            .SelectMany(c => c.CampaignDiscounts)
            .Where(d => !d.IsDeleted && d.HedefFiyat.HasValue && d.StokKodu != null)
            .Select(d => d.StokKodu!)
            .ToList();
        var hedefF4 = hedefliKodlar.Count == 0
            ? new Dictionary<string, (decimal Price, string Currency)>(StringComparer.OrdinalIgnoreCase)
            : await B2B.Erp.Api.Core.Helpers.CampaignTargetPrice.LoadCatalogPricesAsync(_dbContext, hedefliKodlar, cancellationToken);
        decimal GuncelDeger(CampaignDiscount d) =>
            !d.HedefFiyat.HasValue
                ? d.Deger
                : B2B.Erp.Api.Core.Helpers.CampaignTargetPrice.EffectiveValue(d,
                    d.StokKodu != null && hedefF4.TryGetValue(d.StokKodu, out var k) ? k.Price : (decimal?)null);
        // Grup kolonları (iskontoFiyat1..6) da aynı GÜNCEL farkı taşır: istemcideki eski sepet
        // uygulayıcısı (campaignApplier.getDiscountValueForPriceGroup) önce bu kolonlara bakıyor;
        // kayıttaki fark F4 değişince bayatlardı. Kolon boşsa (grup seçili değil) boş kalır.
        decimal? GrupDeger(CampaignDiscount d, decimal? kolon) =>
            d.HedefFiyat.HasValue ? (kolon.HasValue ? GuncelDeger(d) : null) : kolon;

        // Map to response DTO
        var result = campaigns.Select(c => new
        {
            id = c.Id,
            name = c.Name,
            description = c.Description,
            startDate = c.StartDate,
            endDate = c.EndDate,
            isIndefinite = c.IsIndefinite,
            priority = c.Priority,
            kampanyaTipi = c.KampanyaTipi,
            kampanyaTipiText = c.KampanyaTipi.ToString(),
            stopNext = c.StopNext,
            
            // Campaign discounts info
            discounts = c.CampaignDiscounts.Where(x => !x.IsDeleted).Select(d => new
            {
                stokKodu = d.StokKodu,
                grupKodu = d.GrupKodu,
                minSepetTutari = d.MinSepetTutari,
                iskontoTipi = d.IskontoTipi,
                iskontoTipiText = d.IskontoTipi.ToString(),
                deger = GuncelDeger(d),
                hedefFiyat = d.HedefFiyat,
                iskontoFiyat1 = GrupDeger(d, d.IskontoFiyat1),
                iskontoFiyat2 = GrupDeger(d, d.IskontoFiyat2),
                iskontoFiyat3 = GrupDeger(d, d.IskontoFiyat3),
                iskontoFiyat4 = GrupDeger(d, d.IskontoFiyat4),
                iskontoFiyat5 = GrupDeger(d, d.IskontoFiyat5),
                iskontoFiyat6 = GrupDeger(d, d.IskontoFiyat6),
                // Sinirsiz fiyat grubu kaynagi. iskontoFiyat1..6 geriye donuk uyum icin duruyor.
                priceGroupCodes = d.PriceGroups.Where(pg => !pg.IsDeleted).Select(pg => pg.PriceGroupCode).ToList()
            }).ToList(),
            
            // Conditions
            conditions = c.CampaignConditions.Where(x => !x.IsDeleted).Select(cond => new
            {
                conditionType = cond.ConditionType,
                categoryCode = cond.CategoryCode,
                brandField = cond.BrandField,
                brandCode = cond.BrandCode,
                packageItemsJson = cond.PackageItemsJson,
                productStockCodesJson = cond.ProductStockCodesJson,
                metric = cond.Metric,
                minimum = cond.Minimum,
                maximum = cond.Maximum
            }).ToList(),
            
            // Actions
            actions = c.CampaignActions.Where(x => !x.IsDeleted).Select(act => new
            {
                actionType = act.ActionType,
                targetProductId = act.TargetProductId,
                targetPriceGroupId = act.TargetPriceGroupId,
                value = act.Value,
                quantity = act.Quantity
            }).ToList()
        }).ToList();

        // Filter by price group if specified
        if (priceGroupCode.HasValue && priceGroupCode.Value >= 1)
        {
            // Eskiden yalnizca iskontoFiyat1..6 kolonlarina bakiyordu; 7. fiyat grubu icin
            // hicbir kosul tutmadigindan liste bombos donuyordu.
            result = result.Where(c =>
                c.discounts.Any(d => d.priceGroupCodes.Contains(priceGroupCode.Value))
            ).ToList();
        }

        return Ok(new { success = true, data = result });
    }

    [HttpGet("{id:guid}")]
    public async Task<IActionResult> GetById([FromRoute] Guid id, CancellationToken cancellationToken)
    {
        var campaign = await _dbContext.Campaigns
            .AsNoTracking()
            .Include(x => x.CampaignConditions)
            .Include(x => x.CampaignActions)
            .Include(x => x.CampaignTargets)
            .Include(x => x.CampaignDiscounts)
                .ThenInclude(d => d.PriceGroups)
            .FirstOrDefaultAsync(x => x.Id == id, cancellationToken);

        if (campaign is null || campaign.IsDeleted)
        {
            return NotFound(new { success = false, message = "Campaign not found." });
        }

        var discountStockCodes = campaign.CampaignDiscounts
            .Where(d => !d.IsDeleted)
            .Where(d => d.StokKodu != null)
            .Select(d => d.StokKodu!)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();

        var productIdByStockCode = new Dictionary<string, Guid>(StringComparer.OrdinalIgnoreCase);
        if (discountStockCodes.Count > 0)
        {
            productIdByStockCode = await _dbContext.Products
                .AsNoTracking()
                .Where(p => discountStockCodes.Contains(p.StockCode))
                .Select(p => new { p.StockCode, p.Id })
                .ToDictionaryAsync(x => x.StockCode, x => x.Id, StringComparer.OrdinalIgnoreCase, cancellationToken);
        }

        var data = new
        {
            id = campaign.Id,
            name = campaign.Name,
            description = campaign.Description,
            startDate = campaign.StartDate,
            endDate = campaign.EndDate,
            isIndefinite = campaign.IsIndefinite,
            priority = campaign.Priority,
            isActive = campaign.IsActive,
            kampanyaTipi = campaign.KampanyaTipi,
            subeKodu = campaign.SubeKodu,
            stopNext = campaign.StopNext,
            conditions = campaign.CampaignConditions
                .Where(c => !c.IsDeleted)
                .OrderBy(c => c.Minimum ?? 0)
                .ThenBy(c => c.CreateTime)
                .Select(c => new
            {
                id = c.Id,
                createTime = c.CreateTime,
                conditionType = c.ConditionType,
                categoryCode = c.CategoryCode,
                brandField = c.BrandField,
                brandCode = c.BrandCode,
                packageItemsJson = c.PackageItemsJson,
                metric = c.Metric,
                minimum = c.Minimum,
                maximum = c.Maximum,
                groupCodes = string.IsNullOrWhiteSpace(c.ProductStockCodesJson)
                    ? Array.Empty<string>()
                    : ParseGroupCodes(c.ProductStockCodesJson),
                productStockCodes = string.IsNullOrWhiteSpace(c.ProductStockCodesJson)
                    ? Array.Empty<string>()
                    : ParseProductStockCodes(c.ProductStockCodesJson),
                targetId = c.TargetId,
                @operator = c.Operator,
                value = c.Value
            }),
            actions = campaign.CampaignActions
                .Where(a => !a.IsDeleted)
                .OrderBy(a => a.CreateTime)
                .Select(a => new
            {
                id = a.Id,
                actionType = a.ActionType,
                targetProductId = a.TargetProductId,
                targetPriceGroupId = a.TargetPriceGroupId,
                value = a.Value,
                quantity = a.Quantity
            }),
            targets = campaign.CampaignTargets
                .Where(t => !t.IsDeleted)
                .OrderBy(t => t.CreateTime)
                .Select(t => new
            {
                id = t.Id,
                targetType = t.TargetType,
                targetId = t.TargetId
            }),
            discounts = campaign.CampaignDiscounts
                .Where(d => !d.IsDeleted)
                .OrderBy(d => d.CreateTime)
                .Select(d => new
                {
                    id = d.Id,
                    createTime = d.CreateTime,
                    stokKodu = d.StokKodu,
                    targetProductId = d.StokKodu != null && productIdByStockCode.ContainsKey(d.StokKodu) ? productIdByStockCode[d.StokKodu] : (Guid?)null,
                    grupKodu = d.GrupKodu,
                    minSepetTutari = d.MinSepetTutari,
                    iskontoTipi = d.IskontoTipi,
                    deger = d.Deger,
                    // Ürüne özel kampanyalı fiyat (2026-10-07); düzenleme ekranı listeyi bundan kurar.
                    hedefFiyat = d.HedefFiyat,
                    iskontoFiyat1 = d.IskontoFiyat1,
                    iskontoFiyat2 = d.IskontoFiyat2,
                    iskontoFiyat3 = d.IskontoFiyat3,
                    iskontoFiyat4 = d.IskontoFiyat4,
                    iskontoFiyat5 = d.IskontoFiyat5,
                    iskontoFiyat6 = d.IskontoFiyat6,
                    // Düzenleme ekranı seçili fiyat gruplarını buradan okur; 1..6 kolonları
                    // yalnızca geriye dönük uyum için duruyor.
                    priceGroupCodes = d.PriceGroups.Where(pg => !pg.IsDeleted).Select(pg => pg.PriceGroupCode).ToList(),
                    rewardQuantity = d.RewardQuantity
                })
        };

        return Ok(new { success = true, data });
    }

    private sealed class QuantityTierTargets
    {
        [JsonPropertyName("groupCodes")]
        public List<string> GroupCodes { get; set; } = new();

        [JsonPropertyName("productStockCodes")]
        public List<string> ProductStockCodes { get; set; } = new();
    }

    private static string[] ParseProductStockCodes(string rawJson)
    {
        try
        {
            // Backward compatible: old format was string[]
            var arr = JsonSerializer.Deserialize<string[]>(rawJson);
            if (arr is { Length: > 0 }) return arr;
        }
        catch
        {
            // ignore
        }

        try
        {
            // New format: { groupCodes: [], productStockCodes: [] }
            var obj = JsonSerializer.Deserialize<QuantityTierTargets>(rawJson);
            return (obj?.ProductStockCodes ?? new List<string>()).ToArray();
        }
        catch
        {
            return Array.Empty<string>();
        }
    }

    private static string[] ParseGroupCodes(string rawJson)
    {
        try
        {
            JsonSerializer.Deserialize<string[]>(rawJson);
            return Array.Empty<string>();
        }
        catch
        {
        }

        try
        {
            var obj = JsonSerializer.Deserialize<QuantityTierTargets>(rawJson);
            return (obj?.GroupCodes ?? new List<string>()).ToArray();
        }
        catch
        {
            return Array.Empty<string>();
        }
    }

    [AuthorizePage("users", "kampanya")]
    [HttpPost]
    public async Task<IActionResult> Create([FromBody] CreateCampaignRequest request, CancellationToken cancellationToken)
    {
        static DateTime NormalizeToUtc(DateTime dt)
        {
            return dt.Kind switch
            {
                DateTimeKind.Utc => dt,
                DateTimeKind.Local => dt.ToUniversalTime(),
                _ => DateTime.SpecifyKind(dt, DateTimeKind.Utc)
            };
        }

        static DateTime? NormalizeToUtcNullable(DateTime? dt)
        {
            if (!dt.HasValue) return null;
            return NormalizeToUtc(dt.Value);
        }

        if (request.IsIndefinite)
        {
            request.StartDate = null;
            request.EndDate = null;
        }
        else
        {
            if (!request.StartDate.HasValue)
            {
                ModelState.AddModelError(nameof(request.StartDate), "StartDate is required.");
            }
            if (!request.EndDate.HasValue)
            {
                ModelState.AddModelError(nameof(request.EndDate), "EndDate is required.");
            }
        }

        request.StartDate = NormalizeToUtcNullable(request.StartDate);
        request.EndDate = NormalizeToUtcNullable(request.EndDate);

        if (!request.IsIndefinite && request.StartDate.HasValue && request.EndDate.HasValue && request.EndDate < request.StartDate)
        {
            ModelState.AddModelError(nameof(request.EndDate), "EndDate must be greater than or equal to StartDate.");
        }

        foreach (var action in request.Actions)
        {
            if (action.ActionType == CampaignActionType.GiftProduct && action.Quantity <= 0)
            {
                ModelState.AddModelError(nameof(action.Quantity), "GiftProduct action requires Quantity > 0.");
            }
        }

        foreach (var condition in request.Conditions)
        {
            if (string.IsNullOrWhiteSpace(condition.CategoryCode))
            {
                ModelState.AddModelError(nameof(condition.CategoryCode), "CategoryCode is required.");
                continue;
            }

            if (condition.Minimum <= 0m)
            {
                ModelState.AddModelError(nameof(condition.Minimum), "Minimum must be greater than 0.");
            }

            if (condition.Maximum.HasValue && condition.Maximum.Value < condition.Minimum)
            {
                ModelState.AddModelError(nameof(condition.Maximum), "Maximum must be greater than or equal to Minimum.");
            }

            if (condition.ProductStockCodes is { Count: > 0 })
            {
                var distinct = condition.ProductStockCodes
                    .Where(x => !string.IsNullOrWhiteSpace(x))
                    .Select(x => x.Trim())
                    .Distinct(StringComparer.OrdinalIgnoreCase)
                    .ToList();

                if (distinct.Count == 0)
                {
                    ModelState.AddModelError(nameof(condition.ProductStockCodes), "Invalid ProductStockCodes.");
                }
                else
                {
                    var cat = condition.CategoryCode.Trim();
                    var categories = await _dbContext.ProductCategories.AsNoTracking().ToListAsync(cancellationToken);
                    var catMap = categories.ToDictionary(c => c.Id, c => c.Key);

                    var found = await _dbContext.Products
                        .AsNoTracking()
                        .Where(p => distinct.Contains(p.StockCode))
                        .Select(p => new { p.StockCode, p.MainCategoryId, p.CategoryId, p.Stock })
                        .ToListAsync(cancellationToken);

                    if (found.Count != distinct.Count)
                    {
                        ModelState.AddModelError(nameof(condition.ProductStockCodes), "One or more products not found.");
                    }

                    foreach (var p in found)
                    {
                        var groupKey = p.MainCategoryId.HasValue && catMap.TryGetValue(p.MainCategoryId.Value, out var gk) ? gk : null;
                        var subKey = p.CategoryId.HasValue && catMap.TryGetValue(p.CategoryId.Value, out var sk) ? sk : null;
                        var inCategory = string.Equals(groupKey, cat, StringComparison.OrdinalIgnoreCase) ||
                                         string.Equals(subKey, cat, StringComparison.OrdinalIgnoreCase);
                        if (!inCategory)
                        {
                            ModelState.AddModelError(nameof(condition.ProductStockCodes), $"Product {p.StockCode} is not in selected category.");
                        }

                        if (p.Stock <= 0)
                        {
                            ModelState.AddModelError(nameof(condition.ProductStockCodes), $"Product {p.StockCode} is out of stock.");
                        }
                    }
                }
            }
        }

        if (!ModelState.IsValid)
        {
            return ValidationProblem(ModelState);
        }

        var user = User.Identity?.Name ?? "System";

        await using var tx = await _dbContext.Database.BeginTransactionAsync(cancellationToken);

        var campaign = new Campaign
        {
            Name = request.Name.Trim(),
            Description = string.IsNullOrWhiteSpace(request.Description) ? null : request.Description.Trim(),
            StartDate = request.StartDate,
            EndDate = request.EndDate,
            IsIndefinite = request.IsIndefinite,
            Priority = request.Priority,
            IsActive = request.IsActive,
            StopNext = request.StopNext,
            CreateUser = user,
            CreateTime = DateTime.UtcNow,
            IsDeleted = false
        };

        foreach (var c in request.Conditions)
        {
            var categoryCode = c.CategoryCode.Trim();
            var productStockCodes = (c.ProductStockCodes ?? new List<string>())
                .Where(x => !string.IsNullOrWhiteSpace(x))
                .Select(x => x.Trim())
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToList();

            campaign.CampaignConditions.Add(new CampaignCondition
            {
                ConditionType = CampaignConditionType.CategoryBased,
                CategoryCode = categoryCode,
                ProductStockCodesJson = productStockCodes.Count == 0 ? null : JsonSerializer.Serialize(productStockCodes),
                Metric = c.Metric,
                Minimum = c.Minimum,
                Maximum = c.Maximum,

                TargetId = categoryCode,
                Operator = string.Empty,
                Value = 0m,
                CreateUser = user,
                CreateTime = DateTime.UtcNow,
                IsDeleted = false
            });
        }

        foreach (var a in request.Actions)
        {
            if (a.ActionType == CampaignActionType.GiftProduct)
            {
                if (!a.TargetProductId.HasValue || a.TargetProductId.Value == Guid.Empty)
                {
                    ModelState.AddModelError(nameof(a.TargetProductId), "GiftProduct action requires TargetProductId.");
                    return ValidationProblem(ModelState);
                }

                var exists = await _dbContext.Products.AsNoTracking().AnyAsync(x => x.Id == a.TargetProductId.Value, cancellationToken);
                if (!exists)
                {
                    ModelState.AddModelError(nameof(a.TargetProductId), "Gift product not found.");
                    return ValidationProblem(ModelState);
                }

                if (a.Quantity <= 0)
                {
                    ModelState.AddModelError(nameof(a.Quantity), "GiftProduct action requires Quantity > 0.");
                    return ValidationProblem(ModelState);
                }
            }

            if (a.ActionType == CampaignActionType.PriceGroupShift)
            {
                if (!a.TargetPriceGroupId.HasValue || a.TargetPriceGroupId.Value == Guid.Empty)
                {
                    ModelState.AddModelError(nameof(a.TargetPriceGroupId), "PriceGroupShift action requires TargetPriceGroupId.");
                    return ValidationProblem(ModelState);
                }
            }

            campaign.CampaignActions.Add(new CampaignAction
            {
                ActionType = a.ActionType,
                TargetProductId = a.TargetProductId,
                TargetPriceGroupId = a.TargetPriceGroupId,
                Value = a.Value,
                Quantity = a.Quantity,
                CreateUser = user,
                CreateTime = DateTime.UtcNow,
                IsDeleted = false
            });
        }

        foreach (var t in request.Targets)
        {
            campaign.CampaignTargets.Add(new CampaignTarget
            {
                TargetType = t.TargetType,
                TargetId = string.IsNullOrWhiteSpace(t.TargetId) ? null : t.TargetId.Trim(),
                CreateUser = user,
                CreateTime = DateTime.UtcNow,
                IsDeleted = false
            });
        }

        _dbContext.Campaigns.Add(campaign);

        // Bayi hedefleri. Bos liste = tum bayiler (IsTargetMatch hedefi olmayani herkese acik sayar).
        ApplyDealerTargets(campaign, request.DealerCodes, user, DateTime.UtcNow);
        await _dbContext.SaveChangesAsync(cancellationToken);

        await tx.CommitAsync(cancellationToken);

        return Ok(new { success = true, id = campaign.Id });
    }

    [AuthorizePage("users", "kampanya")]
    [HttpPost("product-discount")]
    public async Task<IActionResult> CreateProductDiscount([FromBody] CreateProductDiscountRequest? request, CancellationToken cancellationToken)
    {
        if (request is null)
        {
            return BadRequest(new
            {
                success = false,
                message = "Request body boş veya geçersiz. Lütfen Content-Type: application/json ve geçerli JSON gönderildiğini kontrol edin."
            });
        }

        static DateTime NormalizeToUtc(DateTime dt)
        {
            return dt.Kind switch
            {
                DateTimeKind.Utc => dt,
                DateTimeKind.Local => dt.ToUniversalTime(),
                _ => DateTime.SpecifyKind(dt, DateTimeKind.Utc)
            };
        }

        static bool TryParseDiscountType(string raw, out IskontoTipi parsed)
        {
            parsed = default;
            var s = (raw ?? string.Empty).Trim();
            if (string.IsNullOrWhiteSpace(s)) return false;

            if (int.TryParse(s, out var i))
            {
                if (i == 1) { parsed = IskontoTipi.Tutar; return true; }
                if (i == 2) { parsed = IskontoTipi.Oran; return true; }
                return false;
            }

            if (string.Equals(s, "tutar", StringComparison.OrdinalIgnoreCase)) { parsed = IskontoTipi.Tutar; return true; }
            if (string.Equals(s, "oran", StringComparison.OrdinalIgnoreCase)) { parsed = IskontoTipi.Oran; return true; }
            return false;
        }

        var name = (request.Name ?? string.Empty).Trim();
        if (string.IsNullOrWhiteSpace(name)) ModelState.AddModelError(nameof(request.Name), "Name is required.");

        /*
          ÜRÜNE ÖZEL KAMPANYALI FİYAT (2026-10-07 kullanıcı isteği: "bir kampanyada 25'e yakın
          ürün, listede her birinin yeni fiyatı"). Liste geldiyse kategori/oran alanları yok sayılır.
        */
        if (request.Items is { Count: > 0 })
        {
            if (!ModelState.IsValid) return ValidationProblem(ModelState);
            var bas = NormalizeToUtc(request.StartDate);
            var bit = NormalizeToUtc(request.EndDate);
            if (bit < bas) return BadRequest(new { success = false, message = "Bitiş tarihi başlangıçtan önce olamaz." });

            var kullanici = User.Identity?.Name ?? "System";
            var simdi = DateTime.UtcNow;
            var gruplar = await ResolvePriceGroupsAsync(request.PriceGroupCodes, cancellationToken);
            var kampanyaId = Guid.NewGuid();

            var (satirlar, kodlar, hata) = await BuildTargetPriceRowsAsync(kampanyaId, request.Items, gruplar, kullanici, simdi, cancellationToken);
            if (hata is not null) return BadRequest(new { success = false, message = hata });

            await using var txHedef = await _dbContext.Database.BeginTransactionAsync(cancellationToken);
            var kampanya = new Campaign
            {
                Id = kampanyaId,
                Name = name,
                Description = string.IsNullOrWhiteSpace(request.Description) ? null : request.Description.Trim(),
                StartDate = bas,
                EndDate = bit,
                IsIndefinite = false,
                Priority = request.Priority,
                IsActive = true,
                StopNext = request.StopNext,
                KampanyaTipi = KampanyaTipi.UrunIndirimi,
                SubeKodu = string.IsNullOrWhiteSpace(request.SubeKodu) ? null : request.SubeKodu.Trim(),
                CreateUser = kullanici,
                CreateTime = simdi,
                IsDeleted = false
            };
            _dbContext.Campaigns.Add(kampanya);
            ApplyDealerTargets(kampanya, request.DealerCodes, kullanici, simdi);
            kampanya.CampaignConditions.Add(new CampaignCondition
            {
                Id = Guid.NewGuid(),
                CampaignId = kampanya.Id,
                ConditionType = CampaignConditionType.CategoryBased,
                TargetId = null,
                Operator = string.Empty,
                Value = 0m,
                CategoryCode = null,
                ProductStockCodesJson = JsonSerializer.Serialize(kodlar),
                CreateUser = kullanici,
                CreateTime = simdi,
                IsDeleted = false
            });
            _dbContext.CampaignDiscounts.AddRange(satirlar!);

            await _dbContext.SaveChangesAsync(cancellationToken);
            await txHedef.CommitAsync(cancellationToken);
            return Ok(new { success = true, id = kampanya.Id });
        }

        var groupCode = (request.GroupCode ?? string.Empty).Trim();
        if (string.IsNullOrWhiteSpace(groupCode)) ModelState.AddModelError(nameof(request.GroupCode), "GroupCode is required.");

        if (!TryParseDiscountType(request.DiscountType, out var discountType))
        {
            ModelState.AddModelError(nameof(request.DiscountType), "DiscountType is required. Allowed: Tutar, Oran, 1, 2.");
        }

        if (request.DiscountValue < 0)
        {
            ModelState.AddModelError(nameof(request.DiscountValue), "İndirim değeri 0'dan küçük olamaz.");
        }

        if (discountType == IskontoTipi.Oran && request.DiscountValue > 100)
        {
            ModelState.AddModelError(nameof(request.DiscountValue), "Oran (%) 100'den büyük olamaz.");
        }

        var start = NormalizeToUtc(request.StartDate);
        var end = NormalizeToUtc(request.EndDate);
        if (end < start) ModelState.AddModelError(nameof(request.EndDate), "EndDate must be greater than or equal to StartDate.");

        var stockCodes = (request.ProductStockCodes ?? new List<string>())
            .Where(x => !string.IsNullOrWhiteSpace(x))
            .Select(x => x.Trim())
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();

        var priceGroupCodes = (request.PriceGroupCodes ?? new List<int>())
            .Where(x => x >= 1)
            .Distinct()
            .ToList();

        if (priceGroupCodes.Count == 0)
        {
            ModelState.AddModelError(nameof(request.PriceGroupCodes), "En az 1 fiyat grubu seçilmelidir. ");
        }

        if (!ModelState.IsValid)
        {
            return ValidationProblem(ModelState);
        }

        if (stockCodes.Count > 0)
        {
            var foundCount = await _dbContext.Products
                .AsNoTracking()
                .Where(p => stockCodes.Contains(p.StockCode))
                .Select(p => p.StockCode)
                .Distinct()
                .CountAsync(cancellationToken);

            if (foundCount != stockCodes.Count)
            {
                ModelState.AddModelError(nameof(request.ProductStockCodes), "One or more products not found.");
                return ValidationProblem(ModelState);
            }
        }

        var user = User.Identity?.Name ?? "System";
        var now = DateTime.UtcNow;

        await using var tx = await _dbContext.Database.BeginTransactionAsync(cancellationToken);

        var campaign = new Campaign
        {
            Id = Guid.NewGuid(),
            Name = name,
            Description = string.IsNullOrWhiteSpace(request.Description) ? null : request.Description.Trim(),
            StartDate = start,
            EndDate = end,
            IsIndefinite = false,
            Priority = request.Priority,
            IsActive = true,
            StopNext = request.StopNext,
            KampanyaTipi = KampanyaTipi.UrunIndirimi,
            SubeKodu = string.IsNullOrWhiteSpace(request.SubeKodu) ? null : request.SubeKodu.Trim(),
            CreateUser = user,
            CreateTime = now,
            IsDeleted = false
        };

        _dbContext.Campaigns.Add(campaign);

        // Bayi hedefleri. Bos liste = tum bayiler (IsTargetMatch hedefi olmayani herkese acik sayar).
        ApplyDealerTargets(campaign, request.DealerCodes, user, now);

        var productJson = stockCodes.Count == 0 ? null : JsonSerializer.Serialize(stockCodes);

        campaign.CampaignConditions.Add(new CampaignCondition
        {
            Id = Guid.NewGuid(),
            CampaignId = campaign.Id,
            ConditionType = CampaignConditionType.CategoryBased,
            TargetId = null,
            Operator = string.Empty,
            Value = 0m,
            Metric = null,
            Minimum = null,
            Maximum = null,
            CategoryCode = groupCode,
            ProductStockCodesJson = productJson,
            CreateUser = user,
            CreateTime = now,
            IsDeleted = false
        });

        static decimal? PickPrice(decimal value, bool selected)
        {
            return selected ? value : null;
        }

        CampaignDiscount CreateDiscountRow(string? stokKodu)
        {
            return new CampaignDiscount
            {
                Id = Guid.NewGuid(),
                CampaignId = campaign.Id,
                StokKodu = stokKodu,
                /*
                  SEÇİLİ ÜRÜN İNDİRİMİNDE GRUP KODU YAZILMAZ (2026-09-18 canlı bildirimi:
                  "seçili ürün indirimi yapıyorum, o kategorideki TÜM ürünlere ikon gidiyor").

                  Satırda hem stok kodu hem grup kodu duruyordu. Okuma tarafı (ürün kartındaki
                  kampanya rozeti) grup kodunu "bu gruptaki her ürün" diye anlıyor ve kampanya
                  tek bir ürüne tanımlanmış olsa bile kategorinin tamamı kampanyalı görünüyordu.
                  Grup kodu yalnızca ürün seçilmeyen (grubun tamamına açılan) satırda anlamlı.
                */
                GrupKodu = stokKodu is null ? groupCode : null,
                MinSepetTutari = 0m,
                IskontoTipi = discountType,
                Deger = request.DiscountValue,
                IskontoFiyat1 = PickPrice(request.DiscountValue, priceGroupCodes.Contains(1)),
                IskontoFiyat2 = PickPrice(request.DiscountValue, priceGroupCodes.Contains(2)),
                IskontoFiyat3 = PickPrice(request.DiscountValue, priceGroupCodes.Contains(3)),
                IskontoFiyat4 = PickPrice(request.DiscountValue, priceGroupCodes.Contains(4)),
                IskontoFiyat5 = PickPrice(request.DiscountValue, priceGroupCodes.Contains(5)),
                IskontoFiyat6 = PickPrice(request.DiscountValue, priceGroupCodes.Contains(6)),
                // Sinirsiz fiyat grubu kaynagi. Yukaridaki IskontoFiyat1..6 GERIYE DONUK UYUM icin
                // yazilmaya devam ediyor; okuma tarafi once bu listeye bakar.
                PriceGroups = BuildPriceGroups(priceGroupCodes, request.DiscountValue, user, now),
                CreateUser = user,
                CreateTime = now,
                IsDeleted = false
            };
        }

        if (stockCodes.Count == 0)
        {
            _dbContext.CampaignDiscounts.Add(CreateDiscountRow(null));
        }
        else
        {
            foreach (var code in stockCodes)
            {
                _dbContext.CampaignDiscounts.Add(CreateDiscountRow(code));
            }
        }

        await _dbContext.SaveChangesAsync(cancellationToken);
        await tx.CommitAsync(cancellationToken);

        return Ok(new { success = true, id = campaign.Id });
    }

    [AuthorizePage("users", "kampanya")]
    [HttpPost("buy-x-get-y")]
    public async Task<IActionResult> CreateBuyXGetY([FromBody] CreateBuyXGetYRequest? request, CancellationToken cancellationToken)
    {
        if (request is null)
        {
            return BadRequest(new
            {
                success = false,
                message = "Request body boş veya geçersiz. Lütfen Content-Type: application/json ve geçerli JSON gönderildiğini kontrol edin."
            });
        }

        static DateTime NormalizeToUtc(DateTime dt)
        {
            return dt.Kind switch
            {
                DateTimeKind.Utc => dt,
                DateTimeKind.Local => dt.ToUniversalTime(),
                _ => DateTime.SpecifyKind(dt, DateTimeKind.Utc)
            };
        }

        static bool TryParseDiscountType(string? raw, out IskontoTipi parsed)
        {
            parsed = default;
            var s = (raw ?? string.Empty).Trim();
            if (string.IsNullOrWhiteSpace(s)) return false;

            if (int.TryParse(s, out var i))
            {
                if (i == 1) { parsed = IskontoTipi.Tutar; return true; }
                if (i == 2) { parsed = IskontoTipi.Oran; return true; }
                return false;
            }

            if (string.Equals(s, "tutar", StringComparison.OrdinalIgnoreCase)) { parsed = IskontoTipi.Tutar; return true; }
            if (string.Equals(s, "oran", StringComparison.OrdinalIgnoreCase)) { parsed = IskontoTipi.Oran; return true; }
            return false;
        }

        var name = (request.Name ?? string.Empty).Trim();
        if (string.IsNullOrWhiteSpace(name)) ModelState.AddModelError(nameof(request.Name), "Name is required.");

        var start = NormalizeToUtc(request.StartDate);
        var end = NormalizeToUtc(request.EndDate);
        if (end < start) ModelState.AddModelError(nameof(request.EndDate), "EndDate must be greater than or equal to StartDate.");

        var triggerGroup = (request.TriggerGroupCode ?? string.Empty).Trim();
        if (string.IsNullOrWhiteSpace(triggerGroup)) ModelState.AddModelError(nameof(request.TriggerGroupCode), "TriggerGroupCode is required.");

        if (request.TriggerMinQuantity <= 0)
        {
            ModelState.AddModelError(nameof(request.TriggerMinQuantity), "TriggerMinQuantity must be greater than 0.");
        }

        var triggerStockCodes = (request.TriggerProductStockCodes ?? new List<string>())
            .Where(x => !string.IsNullOrWhiteSpace(x))
            .Select(x => x.Trim())
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();

        if (request.RewardLines is null || request.RewardLines.Count == 0)
        {
            ModelState.AddModelError(nameof(request.RewardLines), "En az 1 hedef ürün satırı eklenmelidir.");
        }

        var rewards = request.RewardLines ?? new List<BuyXGetYRewardLineRequest>();

        var rewardIndex = 0;
        foreach (var r in rewards)
        {
            if (r.TargetProductId == Guid.Empty)
            {
                ModelState.AddModelError($"RewardLines[{rewardIndex}].TargetProductId", "TargetProductId is required.");
            }

            if (r.Quantity <= 0)
            {
                ModelState.AddModelError($"RewardLines[{rewardIndex}].Quantity", "Quantity must be greater than 0.");
            }

            if (!r.IsGift)
            {
                if (!TryParseDiscountType(r.DiscountType, out _))
                {
                    ModelState.AddModelError($"RewardLines[{rewardIndex}].DiscountType", "DiscountType is required. Allowed: Tutar, Oran, 1, 2.");
                }

                if (r.DiscountValue <= 0)
                {
                    ModelState.AddModelError($"RewardLines[{rewardIndex}].DiscountValue", "DiscountValue must be greater than 0.");
                }

                var pg = (r.PriceGroupCodes ?? new List<int>())
                    .Where(x => x >= 1)
                    .Distinct()
                    .ToList();
                if (pg.Count == 0)
                {
                    ModelState.AddModelError($"RewardLines[{rewardIndex}].PriceGroupCodes", "En az 1 fiyat grubu seçilmelidir. ");
                }

                if (TryParseDiscountType(r.DiscountType, out var dt) && dt == IskontoTipi.Oran && r.DiscountValue > 100)
                {
                    ModelState.AddModelError($"RewardLines[{rewardIndex}].DiscountValue", "Oran (%) 100'den büyük olamaz.");
                }
            }

            rewardIndex++;
        }

        if (!ModelState.IsValid)
        {
            return ValidationProblem(ModelState);
        }

        if (triggerStockCodes.Count > 0)
        {
            var found = await _dbContext.Products
                .AsNoTracking()
                .Where(p => triggerStockCodes.Contains(p.StockCode))
                .Select(p => new { p.StockCode, p.MainCategoryId, p.CategoryId })
                .ToListAsync(cancellationToken);

            if (found.Count != triggerStockCodes.Count)
            {
                ModelState.AddModelError(nameof(request.TriggerProductStockCodes), "One or more trigger products not found.");
                return ValidationProblem(ModelState);
            }
        }

        var rewardIds = rewards
            .Select(x => x.TargetProductId)
            .Where(x => x != Guid.Empty)
            .Distinct()
            .ToList();

        var rewardProducts = await _dbContext.Products
            .AsNoTracking()
            .Where(p => rewardIds.Contains(p.Id))
            .Select(p => new { p.Id, p.StockCode })
            .ToListAsync(cancellationToken);

        if (rewardProducts.Count != rewardIds.Count)
        {
            return BadRequest(new { success = false, message = "One or more reward products not found." });
        }

        var rewardStockById = rewardProducts.ToDictionary(x => x.Id, x => x.StockCode);

        var user = User.Identity?.Name ?? "System";
        var now = DateTime.UtcNow;

        await using var tx = await _dbContext.Database.BeginTransactionAsync(cancellationToken);

        var campaign = new Campaign
        {
            Id = Guid.NewGuid(),
            Name = name,
            Description = string.IsNullOrWhiteSpace(request.Description) ? null : request.Description.Trim(),
            StartDate = start,
            EndDate = end,
            IsIndefinite = false,
            Priority = request.Priority,
            IsActive = true,
            StopNext = request.StopNext,
            KampanyaTipi = KampanyaTipi.XAlanaYHediyeVeyaIndirimliUrun,
            SubeKodu = string.IsNullOrWhiteSpace(request.SubeKodu) ? null : request.SubeKodu.Trim(),
            CreateUser = user,
            CreateTime = now,
            IsDeleted = false
        };

        _dbContext.Campaigns.Add(campaign);

        // Bayi hedefleri. Bos liste = tum bayiler (IsTargetMatch hedefi olmayani herkese acik sayar).
        ApplyDealerTargets(campaign, request.DealerCodes, user, now);

        var triggerJson = triggerStockCodes.Count == 0 ? null : JsonSerializer.Serialize(triggerStockCodes);

        campaign.CampaignConditions.Add(new CampaignCondition
        {
            Id = Guid.NewGuid(),
            CampaignId = campaign.Id,
            ConditionType = CampaignConditionType.CategoryBased,
            TargetId = null,
            Operator = string.Empty,
            Value = 0m,
            Metric = CampaignConditionMetric.Quantity,
            Minimum = request.TriggerMinQuantity,
            Maximum = null,
            CategoryCode = triggerGroup,
            ProductStockCodesJson = triggerJson,
            CreateUser = user,
            CreateTime = now,
            IsDeleted = false
        });

        static decimal? PickPrice(decimal value, bool selected)
        {
            return selected ? value : null;
        }

        foreach (var r in rewards)
        {
            if (r.IsGift)
            {
                campaign.CampaignActions.Add(new CampaignAction
                {
                    Id = Guid.NewGuid(),
                    CampaignId = campaign.Id,
                    ActionType = CampaignActionType.GiftProduct,
                    TargetProductId = r.TargetProductId,
                    TargetPriceGroupId = null,
                    Value = 0m,
                    Quantity = r.Quantity,
                    CreateUser = user,
                    CreateTime = now,
                    IsDeleted = false
                });
            }
            else
            {
                if (!TryParseDiscountType(r.DiscountType, out var dt))
                {
                    return BadRequest(new { success = false, message = "Invalid DiscountType." });
                }

                var pg = (r.PriceGroupCodes ?? new List<int>())
                    .Where(x => x >= 1)
                    .Distinct()
                    .ToList();

                var stokKodu = rewardStockById[r.TargetProductId];

                _dbContext.CampaignDiscounts.Add(new CampaignDiscount
                {
                    Id = Guid.NewGuid(),
                    CampaignId = campaign.Id,
                    StokKodu = stokKodu,
                    GrupKodu = triggerGroup,
                    MinSepetTutari = 0m,
                    IskontoTipi = dt,
                    Deger = r.DiscountValue,
                    IskontoFiyat1 = PickPrice(r.DiscountValue, pg.Contains(1)),
                    IskontoFiyat2 = PickPrice(r.DiscountValue, pg.Contains(2)),
                    IskontoFiyat3 = PickPrice(r.DiscountValue, pg.Contains(3)),
                    IskontoFiyat4 = PickPrice(r.DiscountValue, pg.Contains(4)),
                    IskontoFiyat5 = PickPrice(r.DiscountValue, pg.Contains(5)),
                    IskontoFiyat6 = PickPrice(r.DiscountValue, pg.Contains(6)),
                    // Sinirsiz fiyat grubu kaynagi. Yukaridaki IskontoFiyat1..6 GERIYE DONUK UYUM icin
                    // yazilmaya devam ediyor; okuma tarafi once bu listeye bakar.
                    PriceGroups = BuildPriceGroups(pg, r.DiscountValue, user, now),
                    RewardQuantity = (decimal)r.Quantity,
                    CreateUser = user,
                    CreateTime = now,
                    IsDeleted = false
                });
            }
        }

        await _dbContext.SaveChangesAsync(cancellationToken);
        await tx.CommitAsync(cancellationToken);

        return Ok(new { success = true, id = campaign.Id });
    }

    public sealed class CreateBasketTotalDiscountRequest
    {

        /// <summary>
        /// Bu kampanya uygulandıysa daha düşük öncelikli kampanyalar hiç denenmesin.
        /// Varlıkta ve değerlendiricide vardı ama hiçbir oluşturma ucundan ayarlanamıyordu:
        /// hepsi `StopNext = false` sabitliyordu, yani kampanyalar her zaman üst üste biniyordu
        /// ve "şu kampanya varsa diğerleri geçersiz" kuralı hiç kurulamıyordu.
        /// </summary>
        public bool StopNext { get; set; }

        /// <summary>
        /// Uygulama sırası. BÜYÜK olan ÖNCE uygulanır (değerlendirme Priority'ye göre azalan
        /// sıralar). Eşit önceliklerde sıra ada göre çözülür, yani hiçbir zaman rastgele değildir.
        ///
        /// Bu alan eskiden istekte HİÇ YOKTU: altı kampanya tipinin altısında da varlık
        /// `Priority = 0` ile yaratılıyordu. Sıralama kodu Priority'ye bakmasına rağmen her
        /// kampanyanın önceliği aynı (0) olduğu için sıra pratikte veritabanının döndürdüğü
        /// keyfi sıraydı — aynı sepet farklı çalıştırmalarda farklı indirim alabiliyordu.
        /// </summary>
        [Range(0, 1000)]
        public int Priority { get; set; }
        [Required]
        [StringLength(200)]
        public string Name { get; set; } = string.Empty;

        public string? Description { get; set; }

        [Required]
        public DateTime StartDate { get; set; }

        [Required]
        public DateTime EndDate { get; set; }

        [Required]
        [StringLength(50)]
        public string GroupCode { get; set; } = string.Empty;

        public List<string>? ProductStockCodes { get; set; }

        [Range(0, double.MaxValue)]
        public decimal MinBasketTotal { get; set; }

        [Required]
        public string DiscountType { get; set; } = string.Empty;

        [Range(0, double.MaxValue)]
        public decimal DiscountValue { get; set; }

        public List<int>? PriceGroupCodes { get; set; }

        /// <summary>
        /// Kampanyanın uygulanacağı bayiler (cari kodları). BOŞ/NULL = tüm bayiler.
        ///
        /// Hedefleme altyapısı (CampaignTargets + IsTargetMatch) zaten vardı ama hiçbir uç
        /// hedef almıyordu; ekrandaki bayi seçimi hiçbir yere gitmiyordu. Buradan gelen
        /// kodlar SpecificCustomer hedefi olarak yazılır.
        /// </summary>
        public List<string>? DealerCodes { get; set; }

        [StringLength(50)]
        public string? SubeKodu { get; set; }
    }

    public sealed class CreatePackageItem
    {
        public string? GroupCode { get; set; }

        [Required]
        [StringLength(50)]
        public string StockCode { get; set; } = string.Empty;

        [Range(1, int.MaxValue)]
        public int Quantity { get; set; } = 1;
    }

    public sealed class CreatePackageCampaignRequest
    {

        /// <summary>
        /// Bu kampanya uygulandıysa daha düşük öncelikli kampanyalar hiç denenmesin.
        /// Varlıkta ve değerlendiricide vardı ama hiçbir oluşturma ucundan ayarlanamıyordu:
        /// hepsi `StopNext = false` sabitliyordu, yani kampanyalar her zaman üst üste biniyordu
        /// ve "şu kampanya varsa diğerleri geçersiz" kuralı hiç kurulamıyordu.
        /// </summary>
        public bool StopNext { get; set; }

        /// <summary>
        /// Uygulama sırası. BÜYÜK olan ÖNCE uygulanır (değerlendirme Priority'ye göre azalan
        /// sıralar). Eşit önceliklerde sıra ada göre çözülür, yani hiçbir zaman rastgele değildir.
        ///
        /// Bu alan eskiden istekte HİÇ YOKTU: altı kampanya tipinin altısında da varlık
        /// `Priority = 0` ile yaratılıyordu. Sıralama kodu Priority'ye bakmasına rağmen her
        /// kampanyanın önceliği aynı (0) olduğu için sıra pratikte veritabanının döndürdüğü
        /// keyfi sıraydı — aynı sepet farklı çalıştırmalarda farklı indirim alabiliyordu.
        /// </summary>
        [Range(0, 1000)]
        public int Priority { get; set; }
        [Required]
        [StringLength(200)]
        public string Name { get; set; } = string.Empty;

        public string? Description { get; set; }

        [Required]
        public DateTime StartDate { get; set; }

        [Required]
        public DateTime EndDate { get; set; }

        [Required]
        public List<CreatePackageItem> Items { get; set; } = new();

        // 'Tutar' => sabit paket net fiyatı; 'Oran' => mevcut toplam üzerinden yüzde indirim
        [Required]
        public string OperationType { get; set; } = string.Empty;

        [Range(0, double.MaxValue)]
        public decimal OperationValue { get; set; }

        public List<int>? PriceGroupCodes { get; set; }

        /// <summary>
        /// Kampanyanın uygulanacağı bayiler (cari kodları). BOŞ/NULL = tüm bayiler.
        ///
        /// Hedefleme altyapısı (CampaignTargets + IsTargetMatch) zaten vardı ama hiçbir uç
        /// hedef almıyordu; ekrandaki bayi seçimi hiçbir yere gitmiyordu. Buradan gelen
        /// kodlar SpecificCustomer hedefi olarak yazılır.
        /// </summary>
        public List<string>? DealerCodes { get; set; }

        [StringLength(50)]
        public string? SubeKodu { get; set; }
    }

    public sealed class CreateCategoryBrandDiscountRequest
    {

        /// <summary>
        /// Bu kampanya uygulandıysa daha düşük öncelikli kampanyalar hiç denenmesin.
        /// Varlıkta ve değerlendiricide vardı ama hiçbir oluşturma ucundan ayarlanamıyordu:
        /// hepsi `StopNext = false` sabitliyordu, yani kampanyalar her zaman üst üste biniyordu
        /// ve "şu kampanya varsa diğerleri geçersiz" kuralı hiç kurulamıyordu.
        /// </summary>
        public bool StopNext { get; set; }

        /// <summary>
        /// Uygulama sırası. BÜYÜK olan ÖNCE uygulanır (değerlendirme Priority'ye göre azalan
        /// sıralar). Eşit önceliklerde sıra ada göre çözülür, yani hiçbir zaman rastgele değildir.
        ///
        /// Bu alan eskiden istekte HİÇ YOKTU: altı kampanya tipinin altısında da varlık
        /// `Priority = 0` ile yaratılıyordu. Sıralama kodu Priority'ye bakmasına rağmen her
        /// kampanyanın önceliği aynı (0) olduğu için sıra pratikte veritabanının döndürdüğü
        /// keyfi sıraydı — aynı sepet farklı çalıştırmalarda farklı indirim alabiliyordu.
        /// </summary>
        [Range(0, 1000)]
        public int Priority { get; set; }
        [Required]
        [StringLength(200)]
        public string Name { get; set; } = string.Empty;

        public string? Description { get; set; }

        [Required]
        public DateTime StartDate { get; set; }

        [Required]
        public DateTime EndDate { get; set; }

        [Required]
        [StringLength(50)]
        public string CategoryCode { get; set; } = string.Empty;

        [StringLength(20)]
        public string? BrandField { get; set; }

        [StringLength(50)]
        public string? BrandCode { get; set; }

        [Required]
        public string DiscountType { get; set; } = string.Empty;

        [Range(0, double.MaxValue)]
        public decimal DiscountValue { get; set; }

        public List<int>? PriceGroupCodes { get; set; }

        /// <summary>
        /// Kampanyanın uygulanacağı bayiler (cari kodları). BOŞ/NULL = tüm bayiler.
        ///
        /// Hedefleme altyapısı (CampaignTargets + IsTargetMatch) zaten vardı ama hiçbir uç
        /// hedef almıyordu; ekrandaki bayi seçimi hiçbir yere gitmiyordu. Buradan gelen
        /// kodlar SpecificCustomer hedefi olarak yazılır.
        /// </summary>
        public List<string>? DealerCodes { get; set; }

        [StringLength(50)]
        public string? SubeKodu { get; set; }
    }

    public sealed class CreateQuantityTieredDiscountRequest
    {
        /// <summary>
        /// Kampanyanın uygulanacağı bayiler (cari kodları). BOŞ/NULL = tüm bayiler.
        /// Bkz. ApplyDealerTargets.
        /// </summary>
        public List<string>? DealerCodes { get; set; }


        /// <summary>
        /// Bu kampanya uygulandıysa daha düşük öncelikli kampanyalar hiç denenmesin.
        /// Varlıkta ve değerlendiricide vardı ama hiçbir oluşturma ucundan ayarlanamıyordu:
        /// hepsi `StopNext = false` sabitliyordu, yani kampanyalar her zaman üst üste biniyordu
        /// ve "şu kampanya varsa diğerleri geçersiz" kuralı hiç kurulamıyordu.
        /// </summary>
        public bool StopNext { get; set; }

        /// <summary>
        /// Uygulama sırası. BÜYÜK olan ÖNCE uygulanır (değerlendirme Priority'ye göre azalan
        /// sıralar). Eşit önceliklerde sıra ada göre çözülür, yani hiçbir zaman rastgele değildir.
        ///
        /// Bu alan eskiden istekte HİÇ YOKTU: altı kampanya tipinin altısında da varlık
        /// `Priority = 0` ile yaratılıyordu. Sıralama kodu Priority'ye bakmasına rağmen her
        /// kampanyanın önceliği aynı (0) olduğu için sıra pratikte veritabanının döndürdüğü
        /// keyfi sıraydı — aynı sepet farklı çalıştırmalarda farklı indirim alabiliyordu.
        /// </summary>
        [Range(0, 1000)]
        public int Priority { get; set; }
        [Required]
        [StringLength(200)]
        public string Name { get; set; } = string.Empty;

        public string? Description { get; set; }

        [Required]
        public DateTime StartDate { get; set; }

        [Required]
        public DateTime EndDate { get; set; }

        public List<string>? GroupCodes { get; set; }

        public List<string>? ProductStockCodes { get; set; }

        [MinLength(1)]
        public List<QuantityTierRequest> Tiers { get; set; } = new();

        [StringLength(50)]
        public string? SubeKodu { get; set; }
    }

    public sealed class QuantityTierRequest
    {
        public decimal MinQuantity { get; set; }

        public decimal? MaxQuantity { get; set; }

        [Required]
        public string DiscountType { get; set; } = string.Empty;

        [Range(0, double.MaxValue)]
        public decimal DiscountValue { get; set; }

        [MinLength(1)]
        public List<int> PriceGroupCodes { get; set; } = new();
    }

    public sealed class CreateBuyXGetYRequest
    {
        /// <summary>
        /// Kampanyanın uygulanacağı bayiler (cari kodları). BOŞ/NULL = tüm bayiler.
        /// Bkz. ApplyDealerTargets.
        /// </summary>
        public List<string>? DealerCodes { get; set; }


        /// <summary>
        /// Bu kampanya uygulandıysa daha düşük öncelikli kampanyalar hiç denenmesin.
        /// Varlıkta ve değerlendiricide vardı ama hiçbir oluşturma ucundan ayarlanamıyordu:
        /// hepsi `StopNext = false` sabitliyordu, yani kampanyalar her zaman üst üste biniyordu
        /// ve "şu kampanya varsa diğerleri geçersiz" kuralı hiç kurulamıyordu.
        /// </summary>
        public bool StopNext { get; set; }

        /// <summary>
        /// Uygulama sırası. BÜYÜK olan ÖNCE uygulanır (değerlendirme Priority'ye göre azalan
        /// sıralar). Eşit önceliklerde sıra ada göre çözülür, yani hiçbir zaman rastgele değildir.
        ///
        /// Bu alan eskiden istekte HİÇ YOKTU: altı kampanya tipinin altısında da varlık
        /// `Priority = 0` ile yaratılıyordu. Sıralama kodu Priority'ye bakmasına rağmen her
        /// kampanyanın önceliği aynı (0) olduğu için sıra pratikte veritabanının döndürdüğü
        /// keyfi sıraydı — aynı sepet farklı çalıştırmalarda farklı indirim alabiliyordu.
        /// </summary>
        [Range(0, 1000)]
        public int Priority { get; set; }
        [Required]
        [StringLength(200)]
        public string Name { get; set; } = string.Empty;

        public string? Description { get; set; }

        [Required]
        public DateTime StartDate { get; set; }

        [Required]
        public DateTime EndDate { get; set; }

        [Required]
        [StringLength(50)]
        public string TriggerGroupCode { get; set; } = string.Empty;

        public List<string>? TriggerProductStockCodes { get; set; }

        [Range(1, int.MaxValue)]
        public int TriggerMinQuantity { get; set; } = 1;

        [MinLength(1)]
        public List<BuyXGetYRewardLineRequest> RewardLines { get; set; } = new();

        [StringLength(50)]
        public string? SubeKodu { get; set; }
    }

    public sealed class BuyXGetYRewardLineRequest
    {
        [Required]
        public Guid TargetProductId { get; set; }

        [Range(1, int.MaxValue)]
        public int Quantity { get; set; } = 1;

        public bool IsGift { get; set; }

        public string? DiscountType { get; set; }

        [Range(0, double.MaxValue)]
        public decimal DiscountValue { get; set; }

        public List<int>? PriceGroupCodes { get; set; }

        /// <summary>
        /// Kampanyanın uygulanacağı bayiler (cari kodları). BOŞ/NULL = tüm bayiler.
        ///
        /// Hedefleme altyapısı (CampaignTargets + IsTargetMatch) zaten vardı ama hiçbir uç
        /// hedef almıyordu; ekrandaki bayi seçimi hiçbir yere gitmiyordu. Buradan gelen
        /// kodlar SpecificCustomer hedefi olarak yazılır.
        /// </summary>
        public List<string>? DealerCodes { get; set; }
    }

    /// <summary>Ürüne özel kampanyalı fiyat satırı (2026-10-07): stok kodu + kampanyalı F4.</summary>
    public sealed class TargetPriceItem
    {
        [Required, StringLength(50)]
        public string StockCode { get; set; } = string.Empty;

        /// <summary>Kampanyalı Fiyat 4 — F4 para biriminde, KDV dahil. Güncel F4'ten küçük olmalı.</summary>
        public decimal TargetPrice { get; set; }
    }

    public sealed class CreateProductDiscountRequest
    {

        /// <summary>
        /// Bu kampanya uygulandıysa daha düşük öncelikli kampanyalar hiç denenmesin.
        /// Varlıkta ve değerlendiricide vardı ama hiçbir oluşturma ucundan ayarlanamıyordu:
        /// hepsi `StopNext = false` sabitliyordu, yani kampanyalar her zaman üst üste biniyordu
        /// ve "şu kampanya varsa diğerleri geçersiz" kuralı hiç kurulamıyordu.
        /// </summary>
        public bool StopNext { get; set; }

        /// <summary>
        /// Uygulama sırası. BÜYÜK olan ÖNCE uygulanır (değerlendirme Priority'ye göre azalan
        /// sıralar). Eşit önceliklerde sıra ada göre çözülür, yani hiçbir zaman rastgele değildir.
        ///
        /// Bu alan eskiden istekte HİÇ YOKTU: altı kampanya tipinin altısında da varlık
        /// `Priority = 0` ile yaratılıyordu. Sıralama kodu Priority'ye bakmasına rağmen her
        /// kampanyanın önceliği aynı (0) olduğu için sıra pratikte veritabanının döndürdüğü
        /// keyfi sıraydı — aynı sepet farklı çalıştırmalarda farklı indirim alabiliyordu.
        /// </summary>
        [Range(0, 1000)]
        public int Priority { get; set; }
        [Required]
        [StringLength(200)]
        public string Name { get; set; } = string.Empty;

        public string? Description { get; set; }

        [Required]
        public DateTime StartDate { get; set; }

        [Required]
        public DateTime EndDate { get; set; }

        [StringLength(50)]
        public string GroupCode { get; set; } = string.Empty;

        public List<string>? ProductStockCodes { get; set; }

        public string DiscountType { get; set; } = string.Empty;

        /// <summary>
        /// ÜRÜNE ÖZEL KAMPANYALI FİYAT (2026-10-07). Doluysa her ürüne kendi kampanyalı F4'ü yazılır;
        /// GroupCode / DiscountType / DiscountValue / ProductStockCodes yok sayılır. Ürünler farklı
        /// kategorilerden olabilir. Boşsa eski "seçili ürünlere aynı indirim" davranışı.
        /// </summary>
        public List<TargetPriceItem>? Items { get; set; }

        [Range(0, double.MaxValue)]
        public decimal DiscountValue { get; set; }

        public List<int>? PriceGroupCodes { get; set; }

        /// <summary>
        /// Kampanyanın uygulanacağı bayiler (cari kodları). BOŞ/NULL = tüm bayiler.
        ///
        /// Hedefleme altyapısı (CampaignTargets + IsTargetMatch) zaten vardı ama hiçbir uç
        /// hedef almıyordu; ekrandaki bayi seçimi hiçbir yere gitmiyordu. Buradan gelen
        /// kodlar SpecificCustomer hedefi olarak yazılır.
        /// </summary>
        public List<string>? DealerCodes { get; set; }

        [StringLength(50)]
        public string? SubeKodu { get; set; }
    }

    [AuthorizePage("users", "kampanya")]
    [HttpPost("quantity-tiered-discount")]
    public async Task<IActionResult> CreateQuantityTieredDiscount([FromBody] CreateQuantityTieredDiscountRequest? request, CancellationToken cancellationToken)
    {
        if (request is null)
        {
            return BadRequest(new
            {
                success = false,
                message = "Request body boş veya geçersiz. Lütfen Content-Type: application/json ve geçerli JSON gönderildiğini kontrol edin."
            });
        }

        static DateTime NormalizeToUtc(DateTime dt)
        {
            return dt.Kind switch
            {
                DateTimeKind.Utc => dt,
                DateTimeKind.Local => dt.ToUniversalTime(),
                _ => DateTime.SpecifyKind(dt, DateTimeKind.Utc)
            };
        }

        static bool TryParseDiscountType(string raw, out IskontoTipi parsed)
        {
            parsed = default;
            var s = (raw ?? string.Empty).Trim();
            if (string.IsNullOrWhiteSpace(s)) return false;

            if (int.TryParse(s, out var i))
            {
                if (i == 1) { parsed = IskontoTipi.Tutar; return true; }
                if (i == 2) { parsed = IskontoTipi.Oran; return true; }
                return false;
            }

            if (string.Equals(s, "tutar", StringComparison.OrdinalIgnoreCase)) { parsed = IskontoTipi.Tutar; return true; }
            if (string.Equals(s, "oran", StringComparison.OrdinalIgnoreCase)) { parsed = IskontoTipi.Oran; return true; }
            return false;
        }

        var name = (request.Name ?? string.Empty).Trim();
        if (string.IsNullOrWhiteSpace(name))
        {
            ModelState.AddModelError(nameof(request.Name), "Name is required.");
        }

        var start = NormalizeToUtc(request.StartDate);
        var end = NormalizeToUtc(request.EndDate);
        if (end < start)
        {
            ModelState.AddModelError(nameof(request.EndDate), "EndDate must be greater than or equal to StartDate.");
        }

        var groupCodes = (request.GroupCodes ?? new List<string>())
            .Where(x => !string.IsNullOrWhiteSpace(x))
            .Select(x => x.Trim())
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();

        var stockCodes = (request.ProductStockCodes ?? new List<string>())
            .Where(x => !string.IsNullOrWhiteSpace(x))
            .Select(x => x.Trim())
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();

        if (groupCodes.Count == 0 && stockCodes.Count == 0)
        {
            ModelState.AddModelError(nameof(request.GroupCodes), "En az 1 kategori veya 1 ürün seçilmelidir.");
        }

        if (request.Tiers is null || request.Tiers.Count == 0)
        {
            ModelState.AddModelError(nameof(request.Tiers), "En az 1 kademe eklenmelidir.");
        }

        var tiers = request.Tiers ?? new List<QuantityTierRequest>();

        // Tier validations + overlap validations per price group
        var tierIndex = 0;
        foreach (var t in tiers)
        {
            if (t.MinQuantity <= 0)
            {
                ModelState.AddModelError($"Tiers[{tierIndex}].MinQuantity", "MinQuantity must be greater than 0.");
            }

            if (t.MaxQuantity.HasValue && t.MaxQuantity.Value < t.MinQuantity)
            {
                ModelState.AddModelError($"Tiers[{tierIndex}].MaxQuantity", "MaxQuantity must be greater than or equal to MinQuantity.");
            }

            if (!TryParseDiscountType(t.DiscountType, out _))
            {
                ModelState.AddModelError($"Tiers[{tierIndex}].DiscountType", "DiscountType is required. Allowed: Tutar, Oran, 1, 2.");
            }

            if (t.DiscountValue < 0)
            {
                ModelState.AddModelError($"Tiers[{tierIndex}].DiscountValue", "DiscountValue must be >= 0.");
            }

            var pg = (t.PriceGroupCodes ?? new List<int>())
                .Where(x => x >= 1)
                .Distinct()
                .ToList();
            if (pg.Count == 0)
            {
                ModelState.AddModelError($"Tiers[{tierIndex}].PriceGroupCodes", "En az 1 fiyat grubu seçilmelidir. ");
            }

            tierIndex++;
        }

        // Overlap check: for each price group, ensure quantity ranges do not overlap
        // Cakisma kontrolu yalnizca 1..6 arasinda donuyordu; 7. fiyat grubunda iki kademe
        // ayni araligi kapsasa bile fark edilmiyordu. Artik gercekten secilen gruplar dolasilir.
        foreach (var priceGroup in tiers
            .SelectMany(t => t.PriceGroupCodes ?? new List<int>())
            .Where(x => x >= 1)
            .Distinct())
        {
            var ranges = tiers
                .Select((t, idx) => new
                {
                    idx,
                    selected = (t.PriceGroupCodes ?? new List<int>()).Contains(priceGroup),
                    min = t.MinQuantity,
                    max = t.MaxQuantity
                })
                .Where(x => x.selected)
                .ToList();

            for (var i = 0; i < ranges.Count; i++)
            {
                for (var j = i + 1; j < ranges.Count; j++)
                {
                    var aMin = ranges[i].min;
                    var aMax = ranges[i].max ?? decimal.MaxValue;
                    var bMin = ranges[j].min;
                    var bMax = ranges[j].max ?? decimal.MaxValue;

                    var overlap = aMin <= bMax && bMin <= aMax;
                    if (overlap)
                    {
                        ModelState.AddModelError(nameof(request.Tiers), $"Fiyat {priceGroup} için miktar aralıkları çakışıyor (kademeler: {ranges[i].idx + 1} ve {ranges[j].idx + 1}).");
                    }
                }
            }
        }

        if (!ModelState.IsValid)
        {
            return ValidationProblem(ModelState);
        }

        // Optional product existence validation (only if product targets provided)
        if (stockCodes.Count > 0)
        {
            var found = await _dbContext.Products
                .AsNoTracking()
                .Where(p => stockCodes.Contains(p.StockCode))
                .Select(p => p.StockCode)
                .ToListAsync(cancellationToken);

            if (found.Count != stockCodes.Count)
            {
                return BadRequest(new { success = false, message = "One or more products not found." });
            }
        }

        var user = User.Identity?.Name ?? "System";
        var now = DateTime.UtcNow;

        await using var tx = await _dbContext.Database.BeginTransactionAsync(cancellationToken);

        var campaign = new Campaign
        {
            Id = Guid.NewGuid(),
            Name = name,
            Description = string.IsNullOrWhiteSpace(request.Description) ? null : request.Description.Trim(),
            StartDate = start,
            EndDate = end,
            IsIndefinite = false,
            Priority = request.Priority,
            IsActive = true,
            StopNext = request.StopNext,
            KampanyaTipi = KampanyaTipi.AdetBazliKademeliIndirim,
            SubeKodu = string.IsNullOrWhiteSpace(request.SubeKodu) ? null : request.SubeKodu.Trim(),
            CreateUser = user,
            CreateTime = now,
            IsDeleted = false
        };

        _dbContext.Campaigns.Add(campaign);

        // Bayi hedefleri. Bos liste = tum bayiler (IsTargetMatch hedefi olmayani herkese acik sayar).
        ApplyDealerTargets(campaign, request.DealerCodes, user, now);

        static decimal? PickPrice(decimal value, bool selected)
        {
            return selected ? value : null;
        }

        var targetsJson = JsonSerializer.Serialize(new QuantityTierTargets { GroupCodes = groupCodes, ProductStockCodes = stockCodes });

        var sortedTiers = tiers.OrderBy(t => t.MinQuantity).ToList();
        var createTierIdx = 0;

        foreach (var t in sortedTiers)
        {
            var tierTime = now.AddMilliseconds(createTierIdx * 10);
            if (!TryParseDiscountType(t.DiscountType, out var discountType))
            {
                // Should not happen because of validation, but keep safe.
                return BadRequest(new { success = false, message = "Invalid DiscountType." });
            }

            var pg = (t.PriceGroupCodes ?? new List<int>())
                .Where(x => x >= 1)
                .Distinct()
                .ToList();

            campaign.CampaignConditions.Add(new CampaignCondition
            {
                Id = Guid.NewGuid(),
                CampaignId = campaign.Id,
                ConditionType = CampaignConditionType.CategoryBased,
                TargetId = null,
                Operator = string.Empty,
                Value = 0m,
                Metric = CampaignConditionMetric.Quantity,
                Minimum = t.MinQuantity,
                Maximum = t.MaxQuantity,
                CategoryCode = null,
                ProductStockCodesJson = targetsJson,
                CreateUser = user,
                CreateTime = tierTime,
                IsDeleted = false
            });

            _dbContext.CampaignDiscounts.Add(new CampaignDiscount
            {
                Id = Guid.NewGuid(),
                CampaignId = campaign.Id,
                StokKodu = null,
                GrupKodu = null,
                MinSepetTutari = 0m,
                IskontoTipi = discountType,
                Deger = t.DiscountValue,
                IskontoFiyat1 = PickPrice(t.DiscountValue, pg.Contains(1)),
                IskontoFiyat2 = PickPrice(t.DiscountValue, pg.Contains(2)),
                IskontoFiyat3 = PickPrice(t.DiscountValue, pg.Contains(3)),
                IskontoFiyat4 = PickPrice(t.DiscountValue, pg.Contains(4)),
                IskontoFiyat5 = PickPrice(t.DiscountValue, pg.Contains(5)),
                IskontoFiyat6 = PickPrice(t.DiscountValue, pg.Contains(6)),
                // Sinirsiz fiyat grubu kaynagi. Yukaridaki IskontoFiyat1..6 GERIYE DONUK UYUM icin
                // yazilmaya devam ediyor; okuma tarafi once bu listeye bakar.
                PriceGroups = BuildPriceGroups(pg, t.DiscountValue, user, now),
                CreateUser = user,
                CreateTime = tierTime,
                IsDeleted = false
            });

            createTierIdx++;
        }

        await _dbContext.SaveChangesAsync(cancellationToken);
        await tx.CommitAsync(cancellationToken);

        return Ok(new { success = true, id = campaign.Id });
    }

    [AuthorizePage("users", "kampanya")]
    [HttpPost("basket-total-discount")]
    public async Task<IActionResult> CreateBasketTotalDiscount([FromBody] CreateBasketTotalDiscountRequest? request, CancellationToken cancellationToken)
    {
        if (request is null)
        {
            return BadRequest(new
            {
                success = false,
                message = "Request body boş veya geçersiz. Lütfen Content-Type: application/json ve geçerli JSON gönderildiğini kontrol edin."
            });
        }

        static bool TryParseDiscountType(string raw, out IskontoTipi parsed)
        {
            parsed = default;
            var s = (raw ?? string.Empty).Trim();
            if (string.IsNullOrWhiteSpace(s)) return false;

            if (int.TryParse(s, out var i))
            {
                if (i == 1) { parsed = IskontoTipi.Tutar; return true; }
                if (i == 2) { parsed = IskontoTipi.Oran; return true; }
                return false;
            }

            if (string.Equals(s, "tutar", StringComparison.OrdinalIgnoreCase)) { parsed = IskontoTipi.Tutar; return true; }
            if (string.Equals(s, "oran", StringComparison.OrdinalIgnoreCase)) { parsed = IskontoTipi.Oran; return true; }
            return false;
        }

        static DateTime NormalizeToUtc(DateTime dt)
        {
            return dt.Kind switch
            {
                DateTimeKind.Utc => dt,
                DateTimeKind.Local => dt.ToUniversalTime(),
                _ => DateTime.SpecifyKind(dt, DateTimeKind.Utc)
            };
        }

        var name = (request.Name ?? string.Empty).Trim();
        if (string.IsNullOrWhiteSpace(name)) ModelState.AddModelError(nameof(request.Name), "Name is required.");

        var groupCode = (request.GroupCode ?? string.Empty).Trim();
        if (string.IsNullOrWhiteSpace(groupCode)) ModelState.AddModelError(nameof(request.GroupCode), "GroupCode is required.");

        if (!TryParseDiscountType(request.DiscountType, out var discountType))
        {
            ModelState.AddModelError(nameof(request.DiscountType), "DiscountType is required. Allowed: Tutar, Oran, 1, 2.");
        }

        if (request.MinBasketTotal < 0) ModelState.AddModelError(nameof(request.MinBasketTotal), "Minimum sepet tutarı 0'dan küçük olamaz.");
        if (request.DiscountValue < 0) ModelState.AddModelError(nameof(request.DiscountValue), "İndirim değeri 0'dan küçük olamaz.");

        var start = NormalizeToUtc(request.StartDate);
        var end = NormalizeToUtc(request.EndDate);
        if (end < start) ModelState.AddModelError(nameof(request.EndDate), "EndDate must be greater than or equal to StartDate.");

        var stockCodes = (request.ProductStockCodes ?? new List<string>())
            .Where(x => !string.IsNullOrWhiteSpace(x))
            .Select(x => x.Trim())
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();

        if (!ModelState.IsValid)
        {
            return ValidationProblem(ModelState);
        }

        if (stockCodes.Count > 0)
        {
            var foundCount = await _dbContext.Products
                .AsNoTracking()
                .Where(p => stockCodes.Contains(p.StockCode))
                .Select(p => p.StockCode)
                .Distinct()
                .CountAsync(cancellationToken);

            if (foundCount != stockCodes.Count)
            {
                ModelState.AddModelError(nameof(request.ProductStockCodes), "One or more products not found.");
                return ValidationProblem(ModelState);
            }
        }

        var priceGroupCodes = (request.PriceGroupCodes ?? new List<int>())
            .Where(x => x >= 1)
            .Distinct()
            .ToList();

        var user = User.Identity?.Name ?? "System";
        var now = DateTime.UtcNow;

        await using var tx = await _dbContext.Database.BeginTransactionAsync(cancellationToken);

        var campaign = new Campaign
        {
            Id = Guid.NewGuid(),
            Name = name,
            Description = string.IsNullOrWhiteSpace(request.Description) ? null : request.Description.Trim(),
            StartDate = start,
            EndDate = end,
            IsIndefinite = false,
            Priority = request.Priority,
            IsActive = true,
            StopNext = request.StopNext,
            KampanyaTipi = KampanyaTipi.SepetIndirimi,
            SubeKodu = string.IsNullOrWhiteSpace(request.SubeKodu) ? null : request.SubeKodu.Trim(),
            CreateUser = user,
            CreateTime = now,
            IsDeleted = false
        };

        static decimal? PickPrice(decimal value, bool selected)
        {
            return selected ? value : null;
        }

        CampaignDiscount CreateDiscountRow(string? stokKodu)
        {
            return new CampaignDiscount
            {
                Id = Guid.NewGuid(),
                CampaignId = campaign.Id,
                StokKodu = stokKodu,
                GrupKodu = groupCode,
                MinSepetTutari = request.MinBasketTotal,
                IskontoTipi = discountType,
                Deger = request.DiscountValue,
                IskontoFiyat1 = PickPrice(request.DiscountValue, priceGroupCodes.Contains(1)),
                IskontoFiyat2 = PickPrice(request.DiscountValue, priceGroupCodes.Contains(2)),
                IskontoFiyat3 = PickPrice(request.DiscountValue, priceGroupCodes.Contains(3)),
                IskontoFiyat4 = PickPrice(request.DiscountValue, priceGroupCodes.Contains(4)),
                IskontoFiyat5 = PickPrice(request.DiscountValue, priceGroupCodes.Contains(5)),
                IskontoFiyat6 = PickPrice(request.DiscountValue, priceGroupCodes.Contains(6)),
                // Sinirsiz fiyat grubu kaynagi. Yukaridaki IskontoFiyat1..6 GERIYE DONUK UYUM icin
                // yazilmaya devam ediyor; okuma tarafi once bu listeye bakar.
                PriceGroups = BuildPriceGroups(priceGroupCodes, request.DiscountValue, user, now),
                CreateUser = user,
                CreateTime = now,
                IsDeleted = false
            };
        }

        _dbContext.Campaigns.Add(campaign);

        // Bayi hedefleri. Bos liste = tum bayiler (IsTargetMatch hedefi olmayani herkese acik sayar).
        ApplyDealerTargets(campaign, request.DealerCodes, user, now);

        if (stockCodes.Count == 0)
        {
            _dbContext.CampaignDiscounts.Add(CreateDiscountRow(null));
        }
        else
        {
            foreach (var code in stockCodes)
            {
                _dbContext.CampaignDiscounts.Add(CreateDiscountRow(code));
            }
        }

        await _dbContext.SaveChangesAsync(cancellationToken);
        await tx.CommitAsync(cancellationToken);

        return Ok(new { success = true, id = campaign.Id });
    }

    [AuthorizePage("users", "kampanya")]
    [HttpPut("{id:guid}")]
    public async Task<IActionResult> Update([FromRoute] Guid id, [FromBody] CreateCampaignRequest request, CancellationToken cancellationToken)
    {
        static DateTime NormalizeToUtc(DateTime dt)
        {
            return dt.Kind switch
            {
                DateTimeKind.Utc => dt,
                DateTimeKind.Local => dt.ToUniversalTime(),
                _ => DateTime.SpecifyKind(dt, DateTimeKind.Utc)
            };
        }

        static DateTime? NormalizeToUtcNullable(DateTime? dt)
        {
            if (!dt.HasValue) return null;
            return NormalizeToUtc(dt.Value);
        }

        if (request.IsIndefinite)
        {
            request.StartDate = null;
            request.EndDate = null;
        }
        else
        {
            if (!request.StartDate.HasValue)
            {
                ModelState.AddModelError(nameof(request.StartDate), "StartDate is required.");
            }
            if (!request.EndDate.HasValue)
            {
                ModelState.AddModelError(nameof(request.EndDate), "EndDate is required.");
            }
        }

        request.StartDate = NormalizeToUtcNullable(request.StartDate);
        request.EndDate = NormalizeToUtcNullable(request.EndDate);

        if (!request.IsIndefinite && request.StartDate.HasValue && request.EndDate.HasValue && request.EndDate < request.StartDate)
        {
            ModelState.AddModelError(nameof(request.EndDate), "EndDate must be greater than or equal to StartDate.");
        }

        foreach (var action in request.Actions)
        {
            if (action.ActionType == CampaignActionType.GiftProduct && action.Quantity <= 0)
            {
                ModelState.AddModelError(nameof(action.Quantity), "GiftProduct action requires Quantity > 0.");
            }
        }

        foreach (var condition in request.Conditions)
        {
            if (string.IsNullOrWhiteSpace(condition.CategoryCode))
            {
                ModelState.AddModelError(nameof(condition.CategoryCode), "CategoryCode is required.");
                continue;
            }

            if (condition.Minimum <= 0m)
            {
                ModelState.AddModelError(nameof(condition.Minimum), "Minimum must be greater than 0.");
            }

            if (condition.Maximum.HasValue && condition.Maximum.Value < condition.Minimum)
            {
                ModelState.AddModelError(nameof(condition.Maximum), "Maximum must be greater than or equal to Minimum.");
            }

            if (condition.ProductStockCodes is { Count: > 0 })
            {
                var distinct = condition.ProductStockCodes
                    .Where(x => !string.IsNullOrWhiteSpace(x))
                    .Select(x => x.Trim())
                    .Distinct(StringComparer.OrdinalIgnoreCase)
                    .ToList();

                if (distinct.Count == 0)
                {
                    ModelState.AddModelError(nameof(condition.ProductStockCodes), "Invalid ProductStockCodes.");
                }
                else
                {
                    var cat = condition.CategoryCode.Trim();
                    var categories = await _dbContext.ProductCategories.AsNoTracking().ToListAsync(cancellationToken);
                    var catMap = categories.ToDictionary(c => c.Id, c => c.Key);

                    var found = await _dbContext.Products
                        .AsNoTracking()
                        .Where(p => distinct.Contains(p.StockCode))
                        .Select(p => new { p.StockCode, p.MainCategoryId, p.CategoryId, p.Stock })
                        .ToListAsync(cancellationToken);

                    if (found.Count != distinct.Count)
                    {
                        ModelState.AddModelError(nameof(condition.ProductStockCodes), "One or more products not found.");
                    }

                    foreach (var p in found)
                    {
                        var groupKey = p.MainCategoryId.HasValue && catMap.TryGetValue(p.MainCategoryId.Value, out var gk) ? gk : null;
                        var subKey = p.CategoryId.HasValue && catMap.TryGetValue(p.CategoryId.Value, out var sk) ? sk : null;
                        var inCategory = string.Equals(groupKey, cat, StringComparison.OrdinalIgnoreCase) ||
                                         string.Equals(subKey, cat, StringComparison.OrdinalIgnoreCase);
                        if (!inCategory)
                        {
                            ModelState.AddModelError(nameof(condition.ProductStockCodes), $"Product {p.StockCode} is not in selected category.");
                        }

                        if (p.Stock <= 0)
                        {
                            ModelState.AddModelError(nameof(condition.ProductStockCodes), $"Product {p.StockCode} is out of stock.");
                        }
                    }
                }
            }
        }

        if (!ModelState.IsValid)
        {
            return ValidationProblem(ModelState);
        }

        var user = User.Identity?.Name ?? "System";

        await using var tx = await _dbContext.Database.BeginTransactionAsync(cancellationToken);

        var campaign = await _dbContext.Campaigns
            .IgnoreQueryFilters()
            .Include(x => x.CampaignConditions)
            .Include(x => x.CampaignActions)
            .Include(x => x.CampaignTargets)
            .FirstOrDefaultAsync(x => x.Id == id, cancellationToken);

        if (campaign is null)
        {
            return NotFound(new { success = false, message = "Campaign not found." });
        }

        if (campaign.IsDeleted)
        {
            return BadRequest(new { success = false, message = "Cannot update deleted campaign." });
        }

        campaign.Name = request.Name.Trim();
        campaign.Description = string.IsNullOrWhiteSpace(request.Description) ? null : request.Description.Trim();
        campaign.StartDate = request.StartDate;
        campaign.EndDate = request.EndDate;
        campaign.IsIndefinite = request.IsIndefinite;
        campaign.Priority = request.Priority;
        campaign.IsActive = request.IsActive;
        campaign.StopNext = request.StopNext;
        campaign.EditUser = user;
        campaign.EditTime = DateTime.UtcNow;

        foreach (var existing in campaign.CampaignConditions)
        {
            existing.IsDeleted = true;
            existing.EditUser = user;
            existing.EditTime = DateTime.UtcNow;
        }

        foreach (var existing in campaign.CampaignActions)
        {
            existing.IsDeleted = true;
            existing.EditUser = user;
            existing.EditTime = DateTime.UtcNow;
        }

        foreach (var existing in campaign.CampaignTargets)
        {
            existing.IsDeleted = true;
            existing.EditUser = user;
            existing.EditTime = DateTime.UtcNow;
        }

        foreach (var c in request.Conditions)
        {
            var categoryCode = c.CategoryCode.Trim();
            var productStockCodes = (c.ProductStockCodes ?? new List<string>())
                .Where(x => !string.IsNullOrWhiteSpace(x))
                .Select(x => x.Trim())
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToList();

            campaign.CampaignConditions.Add(new CampaignCondition
            {
                ConditionType = CampaignConditionType.CategoryBased,
                CategoryCode = categoryCode,
                ProductStockCodesJson = productStockCodes.Count == 0 ? null : JsonSerializer.Serialize(productStockCodes),
                Metric = c.Metric,
                Minimum = c.Minimum,
                Maximum = c.Maximum,

                TargetId = categoryCode,
                Operator = string.Empty,
                Value = 0m,
                CreateUser = user,
                CreateTime = DateTime.UtcNow,
                IsDeleted = false
            });
        }

        foreach (var a in request.Actions)
        {
            if (a.ActionType == CampaignActionType.GiftProduct)
            {
                if (!a.TargetProductId.HasValue || a.TargetProductId.Value == Guid.Empty)
                {
                    ModelState.AddModelError(nameof(a.TargetProductId), "GiftProduct action requires TargetProductId.");
                    return ValidationProblem(ModelState);
                }

                var exists = await _dbContext.Products.AsNoTracking().AnyAsync(x => x.Id == a.TargetProductId.Value, cancellationToken);
                if (!exists)
                {
                    ModelState.AddModelError(nameof(a.TargetProductId), "Gift product not found.");
                    return ValidationProblem(ModelState);
                }

                if (a.Quantity <= 0)
                {
                    ModelState.AddModelError(nameof(a.Quantity), "GiftProduct action requires Quantity > 0.");
                    return ValidationProblem(ModelState);
                }
            }

            if (a.ActionType == CampaignActionType.PriceGroupShift)
            {
                if (!a.TargetPriceGroupId.HasValue || a.TargetPriceGroupId.Value == Guid.Empty)
                {
                    ModelState.AddModelError(nameof(a.TargetPriceGroupId), "PriceGroupShift action requires TargetPriceGroupId.");
                    return ValidationProblem(ModelState);
                }
            }

            campaign.CampaignActions.Add(new CampaignAction
            {
                ActionType = a.ActionType,
                TargetProductId = a.TargetProductId,
                TargetPriceGroupId = a.TargetPriceGroupId,
                Value = a.Value,
                Quantity = a.Quantity,
                CreateUser = user,
                CreateTime = DateTime.UtcNow,
                IsDeleted = false
            });
        }

        foreach (var t in request.Targets)
        {
            campaign.CampaignTargets.Add(new CampaignTarget
            {
                TargetType = t.TargetType,
                TargetId = string.IsNullOrWhiteSpace(t.TargetId) ? null : t.TargetId.Trim(),
                CreateUser = user,
                CreateTime = DateTime.UtcNow,
                IsDeleted = false
            });
        }

        await _dbContext.SaveChangesAsync(cancellationToken);
        await tx.CommitAsync(cancellationToken);

        return Ok(new { success = true, id = campaign.Id });
    }

    [AuthorizePage("users", "kampanya")]
    /*
      E-TİCARET KAMPANYA YÖNETİMİ (2026-09-19, kullanıcı: "B2B'de oluşturulan kampanyalar
      e-ticarete de yansısın, ürünlerdeki gibi ara sayfada anahtarı açıp kapatalım").

      Vitrine yalnız ÜRÜN ve KATEGORİ/MARKA indirimleri gider: sepet toplamı, adet kademesi,
      X al Y öde ve paket kampanyalarının vitrinde bir "ürün fiyatı" karşılığı yok. Liste
      bu ikisiyle sınırlı; anahtar (`EcommerceEnabled`) varsayılan kapalı. Vitrin tarafı
      (shop/Shop.Api) bu tabloları doğrudan okur; süzgeç orada da aynı.
    */
    [HttpGet("ecommerce")]
    public async Task<IActionResult> GetEcommerceCampaigns(CancellationToken cancellationToken)
    {
        var now = DateTime.UtcNow;
        var rows = await _dbContext.Campaigns
            .AsNoTracking()
            .Include(x => x.CampaignDiscounts)
            .Include(x => x.CampaignConditions)
            .Where(x => !x.IsDeleted)
            .Where(x => x.KampanyaTipi == KampanyaTipi.UrunIndirimi || x.KampanyaTipi == KampanyaTipi.KategoriMarkaIndirimi)
            .OrderByDescending(x => x.EcommerceEnabled)
            .ThenByDescending(x => x.CreateTime)
            .ToListAsync(cancellationToken);

        var data = rows.Select(x =>
        {
            var expired = !x.IsIndefinite && x.EndDate.HasValue && x.EndDate.Value < now;
            var notStarted = x.StartDate.HasValue && x.StartDate.Value > now;
            var first = x.CampaignDiscounts.OrderBy(d => d.CreateTime).FirstOrDefault();
            var stockCodes = x.CampaignDiscounts
                .Select(d => (d.StokKodu ?? string.Empty).Trim())
                .Where(sc => sc.Length > 0)
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToList();
            var groupCodes = x.CampaignDiscounts
                .Select(d => (d.GrupKodu ?? string.Empty).Trim())
                .Concat(x.CampaignConditions.Select(c => (c.CategoryCode ?? string.Empty).Trim()))
                .Where(g => g.Length > 0)
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToList();

            return new
            {
                id = x.Id,
                name = x.Name,
                description = x.Description,
                kampanyaTipi = x.KampanyaTipi.ToString(),
                startDate = x.StartDate,
                endDate = x.EndDate,
                isIndefinite = x.IsIndefinite,
                isActive = x.IsActive,
                ecommerceEnabled = x.EcommerceEnabled,
                iskontoTipi = first?.IskontoTipi.ToString(),
                deger = first?.Deger,
                stockCodes,
                groupCodes,
                // Vitrinde gerçekten uygulanır mı: anahtar + aktif + tarih aralığı.
                liveOnShop = x.EcommerceEnabled && x.IsActive && !expired && !notStarted,
                expired,
                notStarted
            };
        }).ToList();

        return Ok(new { success = true, data });
    }

    public sealed class EcommerceToggleRequest
    {
        public bool Enabled { get; set; }
    }

    [HttpPut("{id:guid}/ecommerce")]
    public async Task<IActionResult> SetEcommerceEnabled(Guid id, [FromBody] EcommerceToggleRequest request, CancellationToken cancellationToken)
    {
        var campaign = await _dbContext.Campaigns.FirstOrDefaultAsync(x => x.Id == id && !x.IsDeleted, cancellationToken);
        if (campaign is null)
        {
            return NotFound(new { success = false, message = "Kampanya bulunamadı." });
        }

        if (campaign.KampanyaTipi != KampanyaTipi.UrunIndirimi && campaign.KampanyaTipi != KampanyaTipi.KategoriMarkaIndirimi)
        {
            return BadRequest(new { success = false, message = "Vitrine yalnız ürün ve kategori/marka indirimleri açılabilir." });
        }

        campaign.EcommerceEnabled = request.Enabled;
        campaign.EditUser = User.Identity?.Name ?? "System";
        campaign.EditTime = DateTime.UtcNow;
        await _dbContext.SaveChangesAsync(cancellationToken);

        return Ok(new { success = true, ecommerceEnabled = campaign.EcommerceEnabled });
    }

    [HttpDelete("{id:guid}")]
    public async Task<IActionResult> SoftDelete([FromRoute] Guid id, CancellationToken cancellationToken)
    {
        var user = User.Identity?.Name ?? "System";

        var campaign = await _dbContext.Campaigns
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(x => x.Id == id, cancellationToken);

        if (campaign is null)
        {
            return NotFound(new { success = false, message = "Campaign not found." });
        }

        if (campaign.IsDeleted)
        {
            return Ok(new { success = true });
        }

        campaign.IsDeleted = true;
        campaign.EditUser = user;
        campaign.EditTime = DateTime.UtcNow;

        await _dbContext.SaveChangesAsync(cancellationToken);

        return Ok(new { success = true });
    }

    /// <summary>
    /// Sepeti kampanya motorunda değerlendirir.
    ///
    /// <para>
    /// ⚠️ MOTOR SÖZLEŞMESİ: <c>EvaluateSalesOrderLineRequest.UnitPrice</c> motorda <b>TL</b>
    /// kabul edilir (eşikler `CampaignCondition.Minimum` ve sabit tutarlı indirim
    /// `CampaignAction.Value` de TL). Sunucu içi dört çağıran fiyatı TL'ye çevirerek veriyor.
    /// Bu HTTP ucu ise sipariş ekranından çağrılıyor ve satırları <b>ÜRÜNÜN kendi para
    /// biriminde</b> gönderiyor: dolarlı sepette 100 $ (3.800 ₺) "100 ₺" sayılıp
    /// "1.000 ₺ üzeri" eşiğine takılmıyor, sabit 500 ₺'lik indirim ise satıra 500 $ olarak
    /// uygulanıyordu.
    /// </para>
    ///
    /// <para>
    /// Çözüm uçta: satırlar ürünün satış dövizinin kuruyla TL'ye çevrilip motora öyle
    /// veriliyor, dönen tutarlar satırın kendi parasına geri çevriliyor. Böylece istemcinin
    /// gördüğü sözleşme değişmiyor. TL üründe kur 1 — çıktı birebir aynı.
    /// </para>
    /// </summary>
    [HttpPost("evaluate-salesorder")]
    public async Task<IActionResult> EvaluateSalesOrder([FromBody] EvaluateSalesOrderRequest request, CancellationToken cancellationToken)
    {
        var rateByStockCode = await ResolveLineTryRatesAsync(request, cancellationToken);

        static decimal RateFor(IReadOnlyDictionary<string, decimal> rates, string? stockCode)
        {
            var key = (stockCode ?? string.Empty).Trim();
            if (key.Length > 0 && rates.TryGetValue(key, out var r) && r > 0m) return r;
            return 1m;
        }

        var anyFxLine = request.Lines is not null
            && request.Lines.Any(l => RateFor(rateByStockCode, l.StockCode) != 1m);

        if (anyFxLine)
        {
            foreach (var line in request.Lines!)
            {
                line.UnitPrice = Math.Round(line.UnitPrice * RateFor(rateByStockCode, line.StockCode), 4, MidpointRounding.AwayFromZero);
            }
        }

        var data = await _campaignService.EvaluateSalesOrder(request, cancellationToken);

        if (anyFxLine && data?.Lines is not null)
        {
            foreach (var line in data.Lines)
            {
                var rate = RateFor(rateByStockCode, line.StockCode);
                if (rate == 1m) continue;

                line.UnitPrice = Math.Round(line.UnitPrice / rate, 4, MidpointRounding.AwayFromZero);
                line.LineTotal = Math.Round(line.LineTotal / rate, 2, MidpointRounding.AwayFromZero);
                line.DiscountAmount = Math.Round(line.DiscountAmount / rate, 2, MidpointRounding.AwayFromZero);
                line.TaxAmount = Math.Round(line.TaxAmount / rate, 2, MidpointRounding.AwayFromZero);
            }
        }

        return Ok(new { success = true, data });
    }

    /// <summary>
    /// Sepet satırlarının stok kodu → ürünün satış dövizinin TL kuru. TL üründe 1 döner;
    /// kur alınamazsa yine 1'e düşülür (indirimi hiç uygulamamaktansa bugünkü davranış).
    /// </summary>
    private async Task<Dictionary<string, decimal>> ResolveLineTryRatesAsync(
        EvaluateSalesOrderRequest request,
        CancellationToken cancellationToken)
    {
        var result = new Dictionary<string, decimal>(StringComparer.OrdinalIgnoreCase);

        var stockCodes = (request.Lines ?? new List<EvaluateSalesOrderLineRequest>())
            .Select(x => (x.StockCode ?? string.Empty).Trim())
            .Where(x => x.Length > 0)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();

        if (stockCodes.Count == 0) return result;

        var currencyByStockCode = await _dbContext.Products
            .AsNoTracking()
            .Where(p => stockCodes.Contains(p.StockCode))
            .Select(p => new { p.StockCode, p.SalesCurrencyCode })
            .ToListAsync(cancellationToken);

        var rateByCurrency = new Dictionary<int, decimal>();
        foreach (var row in currencyByStockCode)
        {
            var currencyTypeId = B2B.Erp.Api.Core.Helpers.CurrencyTypeHelper.Normalize(row.SalesCurrencyCode);
            if (B2B.Erp.Api.Core.Helpers.CurrencyTypeHelper.IsTry(currencyTypeId)) continue;

            if (!rateByCurrency.TryGetValue(currencyTypeId, out var rate))
            {
                rate = 1m;
                var code = B2B.Erp.Api.Core.Helpers.CurrencyTypeHelper.ToCode(currencyTypeId);
                if (!string.IsNullOrWhiteSpace(code))
                {
                    try
                    {
                        var fetched = await _money.GetLatestTryRateAsync(code, cancellationToken);
                        if (fetched > 0m) rate = fetched;
                    }
                    catch
                    {
                        rate = 1m;
                    }
                }
                rateByCurrency[currencyTypeId] = rate;
            }

            if (rate > 0m && rate != 1m)
            {
                result[row.StockCode] = rate;
            }
        }

        return result;
    }


    private async Task<bool> CheckGroupExistsAsync(string categoryCode, CancellationToken cancellationToken)
    {
        var code = (categoryCode ?? string.Empty).Trim();
        if (string.IsNullOrEmpty(code)) return false;

        var key = ToKey(code);

        // 1. Check StockGroups (ERP/Logo categories)
        var groupCodes = await _dbContext.StockGroups
            .AsNoTracking()
            .Select(x => x.GroupCode)
            .ToListAsync(cancellationToken);

        if (groupCodes.Any(gc => string.Equals(ToKey(gc), key, StringComparison.OrdinalIgnoreCase)))
        {
            return true;
        }

        // 2. Check ProductCategories (B2B system categories)
        var categoryKeysOrNames = await _dbContext.ProductCategories
            .AsNoTracking()
            .Select(x => new { x.Key, x.Name })
            .ToListAsync(cancellationToken);

        return categoryKeysOrNames.Any(c =>
            string.Equals(ToKey(c.Key), key, StringComparison.OrdinalIgnoreCase) ||
            string.Equals(ToKey(c.Name), key, StringComparison.OrdinalIgnoreCase));
    }

    /// <summary>
    /// Bir indirimin uygulanacağı fiyat gruplarını satır olarak üretir.
    ///
    /// Eskiden bu bilgi IskontoFiyat1..6 diye sabit altı kolondu; yedinci fiyat grubu
    /// (Askeriye Tipi Fatura) uçlardaki 1..6 süzgecine takılıp sessizce düşüyordu.
    /// Buradan üretilen satırlar sınırsız sayıda fiyat grubunu taşır.
    /// </summary>
    /// <summary>
    /// Kampanyanın bayi hedeflerini (yeniden) kurar.
    ///
    /// Boş liste = hedef satırı yazılmaz = TÜM bayiler. <c>IsTargetMatch</c> hedefi olmayan
    /// kampanyayı herkese açık sayar; bu yüzden "hepsi" durumunu ayrıca işaretlemeye gerek yok.
    ///
    /// Mevcut hedefler soft-delete edilip yenileri yazılır — böylece düzenlemede bayi çıkarmak
    /// da mümkün olur. <c>dealerCodes</c> null gelirse (alan hiç gönderilmemişse) mevcut
    /// hedeflere DOKUNULMAZ; patch uçlarının "gönderilmeyen alan değişmez" kuralı bozulmasın.
    /// </summary>
    private void ApplyDealerTargets(Campaign campaign, List<string>? dealerCodes, string user, DateTime now)
    {
        if (dealerCodes is null)
        {
            return;
        }

        foreach (var existing in campaign.CampaignTargets.Where(x => !x.IsDeleted))
        {
            existing.IsDeleted = true;
            existing.EditUser = user;
            existing.EditTime = now;
        }

        var codes = dealerCodes
            .Select(x => (x ?? string.Empty).Trim())
            .Where(x => x.Length > 0)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();

        foreach (var code in codes)
        {
            /*
              FİYAT GRUBU HEDEFİ (2026-10-04 kullanıcı bildirimi: "tüm bayileri seçiyorum ama yeni
              açılan bayi kampanyadan yararlanmıyor").

              Bayi seçicideki grup kutusu o gruptaki bayileri TEK TEK hedefe yazıyordu; sonradan
              açılan bayi listede olmadığı için kampanyayı alamıyordu (canlıda bir kampanyada 5.744
              ayrı hedef satırı — sepet hesabını da bu satırlar yavaşlatıyordu). Grup artık
              `PG:<fiyat grubu kimliği>` olarak gelir ve TEK bir CustomerPriceGroup hedefi olur:
              IsTargetMatch müşterinin fiyat grubuna bakar, yeni açılan bayi de kapsanır.
            */
            if (code.StartsWith(PriceGroupTargetPrefix, StringComparison.OrdinalIgnoreCase))
            {
                var raw = code.Substring(PriceGroupTargetPrefix.Length).Trim();
                if (!Guid.TryParse(raw, out var priceGroupId)) continue;

                campaign.CampaignTargets.Add(new CampaignTarget
                {
                    Id = Guid.NewGuid(),
                    CampaignId = campaign.Id,
                    TargetType = CampaignTargetType.CustomerPriceGroup,
                    TargetId = priceGroupId.ToString(),
                    CreateUser = user,
                    CreateTime = now,
                    IsDeleted = false
                });
                continue;
            }

            campaign.CampaignTargets.Add(new CampaignTarget
            {
                Id = Guid.NewGuid(),
                CampaignId = campaign.Id,
                TargetType = CampaignTargetType.SpecificCustomer,
                TargetId = code,
                CreateUser = user,
                CreateTime = now,
                IsDeleted = false
            });
        }
    }

    /// <summary>Bayi seçicinin "bu fiyat grubunun tamamı" belirteci: <c>PG:&lt;Guid&gt;</c>.</summary>
    private const string PriceGroupTargetPrefix = "PG:";

    private static List<CampaignDiscountPriceGroup> BuildPriceGroups(
        IEnumerable<int>? codes,
        decimal value,
        string user,
        DateTime now)
    {
        return (codes ?? Enumerable.Empty<int>())
            .Where(x => x >= 1)
            .Distinct()
            .Select(code => new CampaignDiscountPriceGroup
            {
                PriceGroupCode = code,
                Deger = value,
                CreateUser = user,
                CreateTime = now,
                IsDeleted = false
            })
            .ToList();
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
