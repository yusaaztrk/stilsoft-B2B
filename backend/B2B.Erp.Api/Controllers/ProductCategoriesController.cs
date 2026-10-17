using B2B.Erp.Api.Core.Authorization;
using B2B.Erp.Api.Data;
using B2B.Erp.Api.Dtos.ProductCategories;
using B2B.Erp.Api.Entities;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using System.Security.Claims;

namespace B2B.Erp.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
[Authorize]
public sealed class ProductCategoriesController : ControllerBase
{
    private readonly AppDbContext _dbContext;

    public ProductCategoriesController(AppDbContext dbContext)
    {
        _dbContext = dbContext;
    }

    [HttpGet("list")]
    public async Task<IActionResult> List([FromQuery] string? dealerCode, CancellationToken cancellationToken, [FromQuery] bool includeInactive = false)
    {

        // IMPORTANT:
        // Admin pages call this without dealerCode and must get full category tree.
        // Only apply customer-category filtering when dealerCode is explicitly provided.
        //
        // AMA SÜZGEÇ İSTEMCİNİN GÖNDERDİĞİ PARAMETREYE BIRAKILAMAZ: kategori kısıtı olan bir
        // bayi, istekten `dealerCode`u silince süzgeç hiç devreye girmiyor ve şirketin bütün
        // kategori ağacını görebiliyordu. Kapsamı sınırlı her kullanıcıda süzgeç ZORUNLU;
        // hangi cariye göre süzüleceğini zaten `ResolveCustomerCodeForFiltering` jetondan
        // okuyor (süper admin dışında istemcinin verdiği kod dikkate alınmıyor).
        var shouldFilterByCustomer = !string.IsNullOrWhiteSpace(dealerCode)
                                     || !CustomerScope.IsUnrestrictedFor(User);
        var resolvedCustomerCode = shouldFilterByCustomer ? ResolveCustomerCodeForFiltering(dealerCode) : null;

        HashSet<Guid>? allowedIds = null;
        if (!string.IsNullOrWhiteSpace(resolvedCustomerCode))
        {
            allowedIds = await ResolveAllowedCategoryIds(resolvedCustomerCode!, cancellationToken);
        }

        var query = _dbContext.Set<ProductCategory>()
            .AsNoTracking();

        if (!includeInactive)
        {
            query = query.Where(x => x.IsActive);
        }

        if (allowedIds is not null)
        {
            query = query.Where(x => allowedIds.Contains(x.Id));
        }

        var data = await query
            .OrderBy(x => x.ParentId)
            .ThenBy(x => x.SortOrder)
            .ThenBy(x => x.Name)
            .Select(x => new ProductCategoryListItemResponse
            {
                Id = x.Id,
                Name = x.Name,
                ParentId = x.ParentId,
                IsActive = x.IsActive
            })
            .ToListAsync(cancellationToken);

        return Ok(new { success = true, data });
    }

    [HttpGet]
    public async Task<IActionResult> GetState([FromQuery] string? dealerCode, CancellationToken cancellationToken)
    {

        var anyExists = await _dbContext.Set<ProductCategory>()
            .AsNoTracking()
            .AnyAsync(cancellationToken);

        if (!anyExists)
        {
            await SeedDefaultCategoriesIfEmpty(cancellationToken);
        }
        else
        {
            await SeedDefaultSubCategoriesIfMissing(cancellationToken);
        }

        // Admin pages call this without dealerCode and must get full category tree.
        // Only apply customer-category filtering when dealerCode is explicitly provided.
        //
        // AMA SÜZGEÇ İSTEMCİNİN GÖNDERDİĞİ PARAMETREYE BIRAKILAMAZ: kategori kısıtı olan bir
        // bayi, istekten `dealerCode`u silince süzgeç hiç devreye girmiyor ve şirketin bütün
        // kategori ağacını görebiliyordu. Kapsamı sınırlı her kullanıcıda süzgeç ZORUNLU;
        // hangi cariye göre süzüleceğini zaten `ResolveCustomerCodeForFiltering` jetondan
        // okuyor (süper admin dışında istemcinin verdiği kod dikkate alınmıyor).
        var shouldFilterByCustomer = !string.IsNullOrWhiteSpace(dealerCode)
                                     || !CustomerScope.IsUnrestrictedFor(User);
        var resolvedCustomerCode = shouldFilterByCustomer ? ResolveCustomerCodeForFiltering(dealerCode) : null;
        HashSet<Guid>? allowedIds = null;
        if (!string.IsNullOrWhiteSpace(resolvedCustomerCode))
        {
            allowedIds = await ResolveAllowedCategoryIds(resolvedCustomerCode!, cancellationToken);
        }

        var query = _dbContext.Set<ProductCategory>()
            .AsNoTracking();

        if (allowedIds is not null)
        {
            query = query.Where(x => x.IsActive).Where(x => allowedIds.Contains(x.Id));
        }

        var categories = await query
            .OrderBy(x => x.ParentId)
            .ThenBy(x => x.SortOrder)
            .ThenBy(x => x.Name)
            .ToListAsync(cancellationToken);

        HashSet<string>? usedGroupCodes = null;
        HashSet<string>? usedSubGroupCodes = null;
        HashSet<Guid>? usedMainCategoryIds = null;
        HashSet<Guid>? usedSubCategoryIds = null;

        if (!string.IsNullOrWhiteSpace(resolvedCustomerCode))
        {
            var usedCategoryPairs = await _dbContext.Products
                .AsNoTracking()
                .Where(x => x.IsActive && (x.MainCategoryId.HasValue || x.CategoryId.HasValue))
                .Select(x => new { x.MainCategoryId, x.CategoryId })
                .Distinct()
                .ToListAsync(cancellationToken);

            var allCatLookup = await _dbContext.Set<ProductCategory>()
                .AsNoTracking()
                .Select(c => new { c.Id, c.ParentId, c.Key, c.Name })
                .ToDictionaryAsync(c => c.Id, cancellationToken);

            usedGroupCodes = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            usedSubGroupCodes = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            usedMainCategoryIds = new HashSet<Guid>();
            usedSubCategoryIds = new HashSet<Guid>();

            foreach (var item in usedCategoryPairs)
            {
                if (item.MainCategoryId.HasValue && allCatLookup.TryGetValue(item.MainCategoryId.Value, out var mainCat))
                {
                    usedMainCategoryIds.Add(mainCat.Id);
                    var normGroupKey = NormalizeForMatching(mainCat.Key);
                    var normGroupName = NormalizeForMatching(mainCat.Name);
                    if (!string.IsNullOrEmpty(normGroupKey)) usedGroupCodes.Add(normGroupKey);
                    if (!string.IsNullOrEmpty(normGroupName)) usedGroupCodes.Add(normGroupName);
                }

                if (item.CategoryId.HasValue && allCatLookup.TryGetValue(item.CategoryId.Value, out var subCat))
                {
                    usedSubCategoryIds.Add(subCat.Id);

                    // Add subCat's actual database ParentId as used main category
                    if (subCat.ParentId.HasValue && allCatLookup.TryGetValue(subCat.ParentId.Value, out var actualParent))
                    {
                        usedMainCategoryIds.Add(actualParent.Id);
                        var pKey = NormalizeForMatching(actualParent.Key);
                        var pName = NormalizeForMatching(actualParent.Name);
                        if (!string.IsNullOrEmpty(pKey)) usedGroupCodes.Add(pKey);
                        if (!string.IsNullOrEmpty(pName)) usedGroupCodes.Add(pName);

                        var normSubKey = NormalizeForMatching(subCat.Key);
                        var normSubName = NormalizeForMatching(subCat.Name);

                        if (!string.IsNullOrEmpty(normSubKey))
                        {
                            if (!string.IsNullOrEmpty(pKey)) usedSubGroupCodes.Add($"{pKey}:{normSubKey}");
                            if (!string.IsNullOrEmpty(pName)) usedSubGroupCodes.Add($"{pName}:{normSubKey}");
                        }
                        if (!string.IsNullOrEmpty(normSubName))
                        {
                            if (!string.IsNullOrEmpty(pKey)) usedSubGroupCodes.Add($"{pKey}:{normSubName}");
                            if (!string.IsNullOrEmpty(pName)) usedSubGroupCodes.Add($"{pName}:{normSubName}");
                        }
                    }

                    if (item.MainCategoryId.HasValue && allCatLookup.TryGetValue(item.MainCategoryId.Value, out var mCat))
                    {
                        var normGroupKey = NormalizeForMatching(mCat.Key);
                        var normGroupName = NormalizeForMatching(mCat.Name);
                        var normSubKey = NormalizeForMatching(subCat.Key);
                        var normSubName = NormalizeForMatching(subCat.Name);

                        if (!string.IsNullOrEmpty(normSubKey))
                        {
                            if (!string.IsNullOrEmpty(normGroupKey)) usedSubGroupCodes.Add($"{normGroupKey}:{normSubKey}");
                            if (!string.IsNullOrEmpty(normGroupName)) usedSubGroupCodes.Add($"{normGroupName}:{normSubKey}");
                        }
                        if (!string.IsNullOrEmpty(normSubName))
                        {
                            if (!string.IsNullOrEmpty(normGroupKey)) usedSubGroupCodes.Add($"{normGroupKey}:{normSubName}");
                            if (!string.IsNullOrEmpty(normGroupName)) usedSubGroupCodes.Add($"{normGroupName}:{normSubName}");
                        }
                    }
                }
            }
        }

        var mains = categories
            .Where(x => x.ParentId == null)
            .OrderBy(x => x.SortOrder)
            .ThenBy(x => x.Name)
            .ToList();

        var byParent = categories
            .Where(x => x.ParentId != null)
            .GroupBy(x => x.ParentId!.Value)
            .ToDictionary(g => g.Key, g => g.OrderBy(x => x.SortOrder).ThenBy(x => x.Name).ToList());

        var response = new ProductCategoryStateResponse();

        foreach (var main in mains)
        {
            if (usedMainCategoryIds is not null && usedGroupCodes is not null)
            {
                var isMainUsed = usedMainCategoryIds.Contains(main.Id);
                if (!isMainUsed)
                {
                    var mainMatchCandidates = new List<string> { main.Name, main.Key }
                        .Where(c => !string.IsNullOrWhiteSpace(c))
                        .Select(c => NormalizeForMatching(c))
                        .Distinct()
                        .ToList();

                    isMainUsed = mainMatchCandidates.Any(c => usedGroupCodes.Contains(c));
                }

                if (!isMainUsed)
                {
                    continue;
                }
            }

            if (!string.IsNullOrWhiteSpace(main.Key))
            {
                response.Labels[main.Key] = main.Name;
                var dashKey = main.Key.Replace('.', '-');
                if (!string.IsNullOrWhiteSpace(dashKey)) response.Labels[dashKey] = main.Name;
                var dotKey = main.Key.Replace('-', '.');
                if (!string.IsNullOrWhiteSpace(dotKey)) response.Labels[dotKey] = main.Name;
            }
            if (!string.IsNullOrWhiteSpace(main.Name)) response.Labels[main.Name] = main.Name;

            var mainKeyStr = main.Key;
            if (!response.Mains.Contains(mainKeyStr))
            {
                response.Mains.Add(mainKeyStr);
            }

            var mainMetaKey = MainId(main.Key);
            response.Meta[mainMetaKey] = new ProductCategoryMetaResponse
            {
                Description = main.Description,
                Status = main.IsActive ? "active" : "passive"
            };

            var subs = byParent.TryGetValue(main.Id, out var list) ? list : new List<ProductCategory>();

            if (subs.Count == 0)
            {
                var childrenQuery = _dbContext.Set<ProductCategory>()
                    .AsNoTracking()
                    .Where(x => x.ParentId == main.Id);

                if (allowedIds is not null)
                {
                    childrenQuery = childrenQuery.Where(x => x.IsActive).Where(x => allowedIds.Contains(x.Id));
                }

                subs = await childrenQuery
                    .OrderBy(x => x.SortOrder)
                    .ThenBy(x => x.Name)
                    .ToListAsync(cancellationToken);
            }

            if (usedSubCategoryIds is not null && usedSubGroupCodes is not null)
            {
                var mainMatchCandidates = new List<string> { main.Name, main.Key }
                    .Where(c => !string.IsNullOrWhiteSpace(c))
                    .Select(c => NormalizeForMatching(c))
                    .Distinct()
                    .ToList();

                var filteredSubs = new List<ProductCategory>();
                foreach (var sub in subs)
                {
                    var isSubUsed = usedSubCategoryIds.Contains(sub.Id);
                    if (!isSubUsed)
                    {
                        var subMatchCandidates = new List<string> { sub.Name, sub.Key }
                            .Where(c => !string.IsNullOrWhiteSpace(c))
                            .Select(c => NormalizeForMatching(c))
                            .Distinct()
                            .ToList();

                        foreach (var mCand in mainMatchCandidates)
                        {
                            foreach (var sCand in subMatchCandidates)
                            {
                                if (usedSubGroupCodes.Contains($"{mCand}:{sCand}"))
                                {
                                    isSubUsed = true;
                                    break;
                                }
                            }
                            if (isSubUsed) break;
                        }
                    }

                    if (isSubUsed)
                    {
                        filteredSubs.Add(sub);
                    }
                }
                subs = filteredSubs;
            }

            var subKeys = subs.Select(s => s.Key).Distinct().ToList();
            response.SubsByMain[main.Key] = subKeys;

            var aliasCandidates = new List<string>();
            if (!string.IsNullOrWhiteSpace(main.Name)) aliasCandidates.Add(main.Name);
            var nameKey = ToKey(main.Name);
            if (!string.IsNullOrWhiteSpace(nameKey)) aliasCandidates.Add(nameKey);
            var keyKey = ToKey(main.Key);
            if (!string.IsNullOrWhiteSpace(keyKey)) aliasCandidates.Add(keyKey);

            foreach (var alias in aliasCandidates.Distinct(StringComparer.OrdinalIgnoreCase))
            {
                if (string.IsNullOrWhiteSpace(alias)) continue;
                if (!response.SubsByMain.ContainsKey(alias))
                {
                    response.SubsByMain[alias] = subKeys;
                }
            }

            foreach (var sub in subs)
            {
                if (!string.IsNullOrWhiteSpace(sub.Key))
                {
                    response.Labels[sub.Key] = sub.Name;
                    var dashKey = sub.Key.Replace('.', '-');
                    if (!string.IsNullOrWhiteSpace(dashKey)) response.Labels[dashKey] = sub.Name;
                    var dotKey = sub.Key.Replace('-', '.');
                    if (!string.IsNullOrWhiteSpace(dotKey)) response.Labels[dotKey] = sub.Name;
                }
                if (!string.IsNullOrWhiteSpace(sub.Name)) response.Labels[sub.Name] = sub.Name;

                var subMetaKey = SubId(main.Key, sub.Key);
                response.Meta[subMetaKey] = new ProductCategoryMetaResponse
                {
                    Description = sub.Description,
                    Status = sub.IsActive ? "active" : "passive"
                };
            }
        }

        response.Items = categories.Select(c => new ProductCategoryItemDto
        {
            Id = c.Id,
            ParentId = c.ParentId,
            Key = c.Key,
            Name = c.Name,
            Description = c.Description,
            IsActive = c.IsActive,
            SortOrder = c.SortOrder
        }).ToList();

        return Ok(new { success = true, data = response });
    }

    private async Task<bool> RequesterCanAccessAnyAdminCategoryPage(CancellationToken cancellationToken)
    {
        var user = User;
        if (user?.Identity?.IsAuthenticated != true) return false;

        var isSsaClaim = user.FindFirst("IsSuperSuperAdmin")?.Value;
        if (isSsaClaim == "1") return true;

        var roleIdClaim = user.Claims
            .FirstOrDefault(c => string.Equals(c.Type, "RoleId", StringComparison.OrdinalIgnoreCase))
            ?.Value;
        if (string.IsNullOrWhiteSpace(roleIdClaim) || !int.TryParse(roleIdClaim, out var roleId) || roleId <= 0)
        {
            return false;
        }

        var lookupKeys = new List<string>
        {
            "users:kategoriYonetimi",
            "users:urunYonetimi"
        };

        var pageIds = await _dbContext.Pages
            .AsNoTracking()
            .Where(p => lookupKeys.Contains(p.ModuleKey + ":" + p.Key))
            .Select(p => p.Id)
            .ToListAsync(cancellationToken);

        if (pageIds.Count == 0) return false;

        return await _dbContext.RolePagePermissions
            .AsNoTracking()
            .AnyAsync(rpp => rpp.RoleId == roleId && rpp.CanAccess && pageIds.Contains(rpp.PageId), cancellationToken);
    }

    private async Task SeedDefaultSubCategoriesIfMissing(CancellationToken cancellationToken)
    {
        var defaults = new Dictionary<string, List<string>>
        {
            ["DEMO"] = new List<string> { "G.HAZIR", "I.HAZIR", "EV.GEREC", "EV.TEMIZ", "K.BAKIM", "UTU" },
            ["YATAKBAZA"] = new List<string> { "SILTE", "BASLIK", "BAZA", "TEKSTIL" },
            ["BYZ-ESYA"] = new List<string> { "KLIMA", "SEBIL", "ANKASTRE", "CAM.MAK", "BUZDLB", "DRN.DON", "BUL-MAK", "SOLO", "ELEKTRO" }
        };

        var mains = await _dbContext.Set<ProductCategory>()
            .AsNoTracking()
            .Where(x => x.ParentId == null)
            .Select(x => new { x.Id, x.Key, x.Name })
            .ToListAsync(cancellationToken);

        if (mains.Count == 0)
        {
            return;
        }

        // Be tolerant to historical data where Key/Name may not be normalized consistently.
        var mainByKey = new Dictionary<string, Guid>(StringComparer.OrdinalIgnoreCase);
        foreach (var m in mains)
        {
            var k1 = ToKey(m.Key);
            if (!string.IsNullOrWhiteSpace(k1) && !mainByKey.ContainsKey(k1)) mainByKey[k1] = m.Id;

            var k2 = ToKey(m.Name);
            if (!string.IsNullOrWhiteSpace(k2) && !mainByKey.ContainsKey(k2)) mainByKey[k2] = m.Id;
        }
        var mainIds = mains.Select(x => x.Id).ToList();

        var existingSubs = await _dbContext.Set<ProductCategory>()
            .AsNoTracking()
            .Where(x => x.ParentId != null)
            .Where(x => mainIds.Contains(x.ParentId!.Value))
            .Select(x => new { ParentId = x.ParentId!.Value, x.Key })
            .ToListAsync(cancellationToken);

        var existingByParent = existingSubs
            .GroupBy(x => x.ParentId)
            .ToDictionary(g => g.Key, g => new HashSet<string>(g.Select(x => x.Key)));

        var subsToInsert = new List<ProductCategory>();
        foreach (var (mainName, subNames) in defaults)
        {
            var mainKey = ToKey(mainName);
            if (!mainByKey.TryGetValue(mainKey, out var parentId))
            {
                continue;
            }

            var existingKeys = existingByParent.TryGetValue(parentId, out var set) ? set : new HashSet<string>();
            var sort = 0;
            foreach (var subName in subNames)
            {
                var subKey = ToKey(subName);
                if (string.IsNullOrWhiteSpace(subKey)) continue;
                if (existingKeys.Contains(subKey)) continue;

                subsToInsert.Add(new ProductCategory
                {
                    Id = Guid.NewGuid(),
                    ParentId = parentId,
                    Key = subKey,
                    Name = subKey,
                    IsActive = true,
                    SortOrder = sort++
                });
            }
        }

        if (subsToInsert.Count == 0)
        {
            return;
        }

        _dbContext.Set<ProductCategory>().AddRange(subsToInsert);
        await _dbContext.SaveChangesAsync(cancellationToken);
    }

    private bool GetRequesterIsSuperAdmin()
    {
        var isSuperAdmin = User.FindFirst("IsSuperAdmin")?.Value;
        return isSuperAdmin == "1";
    }

    private string? ResolveCustomerCodeForFiltering(string? dealerCode)
    {
        var isSuperAdmin = GetRequesterIsSuperAdmin();
        if (isSuperAdmin)
        {
            return string.IsNullOrWhiteSpace(dealerCode) ? null : dealerCode.Trim();
        }

        var claimCari = User.FindFirst("Carikodu")?.Value;
        return string.IsNullOrWhiteSpace(claimCari) ? null : claimCari.Trim();
    }

    private async Task<HashSet<Guid>?> ResolveAllowedCategoryIds(string customerCode, CancellationToken cancellationToken)
    {
        var accessMode = await _dbContext.Customers
            .AsNoTracking()
            .Where(x => x.CustomerCode == customerCode)
            .Select(x => (CategoryAccessMode?)x.CategoryAccessMode)
            .FirstOrDefaultAsync(cancellationToken);

        if (!accessMode.HasValue || accessMode.Value == CategoryAccessMode.All)
        {
            return null;
        }

        var selectedIds = await _dbContext.CustomerProductCategories
            .AsNoTracking()
            .Where(x => x.CustomerCode == customerCode)
            .Select(x => x.ProductCategoryId)
            .Distinct()
            .ToListAsync(cancellationToken);

        if (selectedIds.Count == 0)
        {
            return new HashSet<Guid>();
        }

        var selected = await _dbContext.Set<ProductCategory>()
            .AsNoTracking()
            .Where(x => x.IsActive)
            .Where(x => selectedIds.Contains(x.Id))
            .Select(x => new { x.Id, x.ParentId })
            .ToListAsync(cancellationToken);

        var mainIds = selected.Where(x => x.ParentId == null).Select(x => x.Id).Distinct().ToList();
        var subIds = selected.Where(x => x.ParentId != null).Select(x => x.Id).Distinct().ToList();
        var subParentIds = selected.Where(x => x.ParentId != null).Select(x => x.ParentId!.Value).Distinct().ToList();

        // Expand: main selection covers all its current/future subs.
        var expandedSubIds = mainIds.Count == 0
            ? new List<Guid>()
            : await _dbContext.Set<ProductCategory>()
                .AsNoTracking()
                .Where(x => x.IsActive)
                .Where(x => x.ParentId != null)
                .Where(x => mainIds.Contains(x.ParentId!.Value))
                .Select(x => x.Id)
                .ToListAsync(cancellationToken);

        var allowed = new HashSet<Guid>();
        foreach (var id in mainIds) allowed.Add(id);
        foreach (var id in subParentIds) allowed.Add(id);
        foreach (var id in subIds) allowed.Add(id);
        foreach (var id in expandedSubIds) allowed.Add(id);
        return allowed;
    }

    private async Task SeedDefaultCategoriesIfEmpty(CancellationToken cancellationToken)
    {
        var stillEmpty = !await _dbContext.Set<ProductCategory>()
            .AsNoTracking()
            .AnyAsync(cancellationToken);

        if (!stillEmpty)
        {
            return;
        }

        var defaults = new Dictionary<string, List<string>>
        {
            ["DEMO"] = new List<string> { "G.HAZIR", "I.HAZIR", "EV.GEREC", "EV.TEMIZ", "K.BAKIM", "UTU" },
            ["YATAKBAZA"] = new List<string> { "SILTE", "BASLIK", "BAZA", "TEKSTIL" },
            ["BYZ-ESYA"] = new List<string> { "KLIMA", "SEBIL", "ANKASTRE", "CAM.MAK", "BUZDLB", "DRN.DON", "BUL-MAK", "SOLO", "ELEKTRO" }
        };

        var mains = new List<ProductCategory>();
        var sort = 0;
        foreach (var main in defaults.Keys)
        {
            mains.Add(new ProductCategory
            {
                Id = Guid.NewGuid(),
                ParentId = null,
                Key = ToKey(main),
                Name = ToKey(main),
                IsActive = true,
                SortOrder = sort++
            });
        }

        _dbContext.Set<ProductCategory>().AddRange(mains);
        await _dbContext.SaveChangesAsync(cancellationToken);

        var mainByKey = mains.ToDictionary(x => x.Key, x => x);
        var subs = new List<ProductCategory>();

        foreach (var (mainName, subNames) in defaults)
        {
            var mainKey = ToKey(mainName);
            if (!mainByKey.TryGetValue(mainKey, out var parent))
            {
                continue;
            }

            var subSort = 0;
            foreach (var subName in subNames)
            {
                subs.Add(new ProductCategory
                {
                    Id = Guid.NewGuid(),
                    ParentId = parent.Id,
                    Key = ToKey(subName),
                    Name = ToKey(subName),
                    IsActive = true,
                    SortOrder = subSort++
                });
            }
        }

        _dbContext.Set<ProductCategory>().AddRange(subs);
        await _dbContext.SaveChangesAsync(cancellationToken);
    }

    [HttpPost("main")]
    [AuthorizePage("users", "kategoriYonetimi")]
    public async Task<IActionResult> CreateMain([FromBody] CreateMainCategoryRequest request, CancellationToken cancellationToken)
    {
        if (!ModelState.IsValid)
        {
            return ValidationProblem(ModelState);
        }

        var name = request.Name.Trim();
        var key = ToKey(name);
        if (string.IsNullOrWhiteSpace(key))
        {
            ModelState.AddModelError(nameof(request.Name), "Kategori adı geçersiz");
            return ValidationProblem(ModelState);
        }

        var exists = await _dbContext.Set<ProductCategory>()
            .AsNoTracking()
            .AnyAsync(x => x.ParentId == null && x.Key == key, cancellationToken);

        if (exists)
        {
            ModelState.AddModelError(nameof(request.Name), "Bu kategori zaten mevcut");
            return ValidationProblem(ModelState);
        }

        var nextSort = await _dbContext.Set<ProductCategory>()
            .AsNoTracking()
            .Where(x => x.ParentId == null)
            .Select(x => (int?)x.SortOrder)
            .MaxAsync(cancellationToken) ?? -1;

        var category = new ProductCategory
        {
            Id = Guid.NewGuid(),
            ParentId = null,
            Key = key,
            Name = key,
            Description = request.Description,
            IsActive = true,
            SortOrder = nextSort + 1
        };

        _dbContext.Set<ProductCategory>().Add(category);
        await _dbContext.SaveChangesAsync(cancellationToken);

        return Ok(new { success = true, message = "Kategori oluşturuldu" });
    }

    [HttpPost("sub")]
    [AuthorizePage("users", "kategoriYonetimi")]
    public async Task<IActionResult> CreateSub([FromBody] CreateSubCategoryRequest request, CancellationToken cancellationToken)
    {
        if (!ModelState.IsValid)
        {
            return ValidationProblem(ModelState);
        }

        var mainName = request.MainName.Trim();
        var mainKey = ToKey(mainName);
        if (string.IsNullOrWhiteSpace(mainKey))
        {
            ModelState.AddModelError(nameof(request.MainName), "Ana kategori adı geçersiz");
            return ValidationProblem(ModelState);
        }

        var mainNameUpper = mainName.ToUpperInvariant();
        var main = await _dbContext.Set<ProductCategory>()
            .FirstOrDefaultAsync(
                x => x.ParentId == null
                     && (x.Key == mainKey || x.Name == mainKey || x.Name == mainName || x.Name == mainNameUpper),
                cancellationToken);

        if (main is null)
        {
            ModelState.AddModelError(nameof(request.MainName), "Ana kategori bulunamadı");
            return ValidationProblem(ModelState);
        }

        var subName = request.Name.Trim();
        var subKey = ToKey(subName);
        if (string.IsNullOrWhiteSpace(subKey))
        {
            ModelState.AddModelError(nameof(request.Name), "Alt kategori adı geçersiz");
            return ValidationProblem(ModelState);
        }

        var exists = await _dbContext.Set<ProductCategory>()
            .AsNoTracking()
            .AnyAsync(x => x.ParentId == main.Id && x.Key == subKey, cancellationToken);

        if (exists)
        {
            ModelState.AddModelError(nameof(request.Name), "Bu alt kategori zaten mevcut");
            return ValidationProblem(ModelState);
        }

        var nextSubSort = await _dbContext.Set<ProductCategory>()
            .AsNoTracking()
            .Where(x => x.ParentId == main.Id)
            .Select(x => (int?)x.SortOrder)
            .MaxAsync(cancellationToken) ?? -1;

        var sub = new ProductCategory
        {
            Id = Guid.NewGuid(),
            ParentId = main.Id,
            Key = subKey,
            Name = subKey,
            Description = request.Description,
            IsActive = true,
            SortOrder = nextSubSort + 1
        };

        _dbContext.Set<ProductCategory>().Add(sub);
        await _dbContext.SaveChangesAsync(cancellationToken);

        return Ok(new { success = true, message = "Alt kategori oluşturuldu" });
    }

    [HttpPut("{id}")]
    [AuthorizePage("users", "kategoriYonetimi")]
    public async Task<IActionResult> Update(string id, [FromBody] UpdateCategoryRequest request, CancellationToken cancellationToken)
    {
        if (!ModelState.IsValid)
        {
            return ValidationProblem(ModelState);
        }

        ProductCategory? category = null;

        if (Guid.TryParse(id, out var categoryGuid))
        {
            category = await _dbContext.Set<ProductCategory>()
                .FirstOrDefaultAsync(x => x.Id == categoryGuid, cancellationToken);
        }

        if (category == null && TryParseCategoryId(id, out var level, out var mainKey, out var subKey))
        {
            if (level == "main")
            {
                category = await _dbContext.Set<ProductCategory>()
                    .FirstOrDefaultAsync(x => x.ParentId == null && (x.Key == mainKey || x.Name == mainKey), cancellationToken);
            }
            else
            {
                var parent = await _dbContext.Set<ProductCategory>()
                    .AsNoTracking()
                    .FirstOrDefaultAsync(x => x.ParentId == null && (x.Key == mainKey || x.Name == mainKey), cancellationToken);

                if (parent != null)
                {
                    category = await _dbContext.Set<ProductCategory>()
                        .FirstOrDefaultAsync(x => x.ParentId == parent.Id && (x.Key == subKey || x.Name == subKey), cancellationToken);
                }
            }
        }

        if (category == null)
        {
            return NotFound(new { success = false, message = "Kategori bulunamadı" });
        }

        // Update display Name without modifying permanent Key!
        if (!string.IsNullOrWhiteSpace(request.Name))
        {
            category.Name = request.Name.Trim();
        }

        if (!string.IsNullOrWhiteSpace(request.Key) && request.Key.Trim() != category.Key)
        {
            var newKey = ToKey(request.Key.Trim());
            var exists = await _dbContext.Set<ProductCategory>()
                .AsNoTracking()
                .AnyAsync(x => x.Id != category.Id && x.ParentId == category.ParentId && x.Key == newKey, cancellationToken);

            if (!exists)
            {
                category.Key = newKey;
            }
        }

        category.Description = request.Description;
        category.IsActive = request.Status != "passive";

        await _dbContext.SaveChangesAsync(cancellationToken);
        return Ok(new { success = true, message = "Kategori güncellendi" });
    }

    [HttpDelete("{id}")]
    [AuthorizePage("users", "kategoriYonetimi")]
    public async Task<IActionResult> Delete(string id, [FromQuery] bool force = false, CancellationToken cancellationToken = default)
    {
        ProductCategory? category = null;

        if (Guid.TryParse(id, out var categoryGuid))
        {
            category = await _dbContext.Set<ProductCategory>()
                .FirstOrDefaultAsync(x => x.Id == categoryGuid, cancellationToken);
        }

        if (category == null && TryParseCategoryId(id, out var level, out var mainKey, out var subKey))
        {
            if (level == "main")
            {
                category = await _dbContext.Set<ProductCategory>()
                    .FirstOrDefaultAsync(x => x.ParentId == null && (x.Key == mainKey || x.Name == mainKey), cancellationToken);
            }
            else
            {
                var parent = await _dbContext.Set<ProductCategory>()
                    .AsNoTracking()
                    .FirstOrDefaultAsync(x => x.ParentId == null && (x.Key == mainKey || x.Name == mainKey), cancellationToken);

                if (parent != null)
                {
                    category = await _dbContext.Set<ProductCategory>()
                        .FirstOrDefaultAsync(x => x.ParentId == parent.Id && (x.Key == subKey || x.Name == subKey), cancellationToken);
                }
            }
        }

        if (category is null)
        {
            return NotFound(new { success = false, message = "Kategori bulunamadı" });
        }

        /*
          DOLU KATEGORI ONAYSIZ SILINEMEZ (2026-08-24).

          Bu uc iki kez canliyi bozdu (2026-08-23 ve 2026-08-24): 36 kategoriden 14'u silindi
          ve 1217 urunun kategori bagi NULL'landi. Yedekten geri yazildi ama sebep acikti ve
          ucuncu kez tekrarladi.

          Kalibi su: ANA kategori silinince alt kategorileri de siliniyor ve butun bagli
          urunlerin kategorisi sessizce NULL'laniyor. Ekranda tek bir "sil" tiklamasi, geri
          alinamaz sekilde binlerce urunun kategorisini goturuyor — ne kac urunun etkilenecegi
          soyleniyor ne de bir iz birakiliyor.

          Artik: etkilenecek urun/alt kategori varsa istek REDDEDILIYOR ve sayilar donuyor.
          Gercekten silinecekse cagiran `?force=true` ile ACIKCA israr etmeli. Bos kategori
          (urunu ve altinda kategori olmayan) eskisi gibi tek adimda silinir.
        */
        var altKategoriler = category.ParentId == null
            ? await _dbContext.Set<ProductCategory>()
                .Where(x => x.ParentId == category.Id)
                .ToListAsync(cancellationToken)
            : new List<ProductCategory>();

        var altIdler = altKategoriler.Select(x => x.Id).ToList();

        var etkilenenUrunSayisi = await _dbContext.Products
            .CountAsync(x => x.CategoryId == category.Id
                          || x.MainCategoryId == category.Id
                          || (x.CategoryId != null && altIdler.Contains(x.CategoryId.Value)),
                        cancellationToken);

        if (!force && (etkilenenUrunSayisi > 0 || altKategoriler.Count > 0))
        {
            return Conflict(new
            {
                success = false,
                requiresConfirmation = true,
                affectedProducts = etkilenenUrunSayisi,
                affectedSubCategories = altKategoriler.Count,
                message =
                    $"'{category.Name}' kategorisi silinirse {etkilenenUrunSayisi} ürünün kategori bağı " +
                    $"kaldırılacak" +
                    (altKategoriler.Count > 0 ? $" ve {altKategoriler.Count} alt kategori silinecek" : string.Empty) +
                    ". Bu işlem geri alınamaz. Devam etmek için onaylayın.",
            });
        }

        // Unassign any products linked to this category
        var productsToUnassign = await _dbContext.Products
            .Where(x => x.CategoryId == category.Id || x.MainCategoryId == category.Id)
            .ToListAsync(cancellationToken);

        foreach (var p in productsToUnassign)
        {
            if (p.CategoryId == category.Id)
            {
                p.CategoryId = null;
            }
            if (p.MainCategoryId == category.Id)
            {
                p.MainCategoryId = null;
            }
        }

        // If this is a main category, clean up child categories and their products as well
        if (category.ParentId == null)
        {
            var children = await _dbContext.Set<ProductCategory>()
                .Where(x => x.ParentId == category.Id)
                .ToListAsync(cancellationToken);

            foreach (var child in children)
            {
                var childProducts = await _dbContext.Products
                    .Where(x => x.CategoryId == child.Id)
                    .ToListAsync(cancellationToken);

                foreach (var cp in childProducts)
                {
                    cp.CategoryId = null;
                }

                _dbContext.Set<ProductCategory>().Remove(child);
            }
        }

        /*
          SILME KAYDA GECER (2026-08-24).

          Banka hesabi silinince `DeletionLogs`'a yaziliyor, kategori silinince YAZILMIYORDU.
          Iki kayip olayinda da "kim sildi" sorusunu cevaplayamadik; kalibi ancak yedekle
          karsilastirarak cikardik. Kayit, kac urunun ve kac alt kategorinin etkilendigini de
          tutuyor — kaybin buyuklugu sonradan yedek acmadan gorulebilsin.
        */
        _dbContext.Set<DeletionLog>().Add(new DeletionLog
        {
            ModuleKey = "users",
            PageKey = "kategoriYonetimi",
            RecordType = nameof(ProductCategory),
            RecordId = category.Id.ToString(),
            Description =
                $"Kategori silindi: {category.Name} ({category.Key}) — " +
                $"{etkilenenUrunSayisi} ürün bağı kaldırıldı, {altKategoriler.Count} alt kategori silindi",
            DetailsJson = System.Text.Json.JsonSerializer.Serialize(new
            {
                category.Id,
                category.Key,
                category.Name,
                category.ParentId,
                category.SortOrder,
                category.IsActive,
                affectedProducts = etkilenenUrunSayisi,
                subCategories = altKategoriler.Select(x => new { x.Id, x.Key, x.Name }).ToList(),
            }),
            CreateUser = User.Identity?.Name ?? "System",
            CreateTime = DateTime.UtcNow,
        });

        _dbContext.Set<ProductCategory>().Remove(category);
        await _dbContext.SaveChangesAsync(cancellationToken);
        return Ok(new { success = true, message = "Kategori başarıyla silindi" });
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
            .Replace('ç', 'C');
    }

    private static string MainId(string mainKey) => $"m:{mainKey}";

    private static string SubId(string mainKey, string subKey) => $"s:{mainKey}:{subKey}";

    private static bool TryParseCategoryId(string id, out string level, out string mainKey, out string subKey)
    {
        level = string.Empty;
        mainKey = string.Empty;
        subKey = string.Empty;

        if (string.IsNullOrWhiteSpace(id))
        {
            return false;
        }

        var parts = id.Split(':', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        if (parts.Length < 2)
        {
            return false;
        }

        if (parts[0] == "m" && parts.Length == 2)
        {
            level = "main";
            mainKey = parts[1];
            return true;
        }

        if (parts[0] == "s" && parts.Length == 3)
        {
            level = "sub";
            mainKey = parts[1];
            subKey = parts[2];
            return true;
        }

        return false;
    }

    private static string NormalizeForMatching(string s)
    {
        if (string.IsNullOrWhiteSpace(s)) return string.Empty;
        var sb = new System.Text.StringBuilder();
        foreach (var c in s)
        {
            if (char.IsLetterOrDigit(c))
            {
                sb.Append(char.ToUpperInvariant(c));
            }
        }
        var res = sb.ToString();
        return res
            .Replace('İ', 'I')
            .Replace('Ğ', 'G')
            .Replace('Ü', 'U')
            .Replace('Ş', 'S')
            .Replace('Ö', 'O')
            .Replace('Ç', 'C');
    }
}
