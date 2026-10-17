using System.Security.Claims;
using B2B.Erp.Api.Data;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.EntityFrameworkCore;

namespace B2B.Erp.Api.Core.Authorization;

public sealed class PageAuthorizationFilter : IAsyncAuthorizationFilter
{
    private readonly AppDbContext _dbContext;
    private readonly string _moduleKey;
    private readonly string _pageKey;

    public PageAuthorizationFilter(AppDbContext dbContext, string moduleKey, string pageKey)
    {
        _dbContext = dbContext;
        _moduleKey = moduleKey;
        _pageKey = pageKey;
    }

    public async Task OnAuthorizationAsync(AuthorizationFilterContext context)
    {
        var user = context.HttpContext.User;
        if (user?.Identity?.IsAuthenticated != true)
        {
            context.Result = new UnauthorizedResult();
            return;
        }

        var isSsaClaim = user.FindFirst("IsSuperSuperAdmin")?.Value;
        if (isSsaClaim == "1")
        {
            return;
        }

        var roleIdClaim = user.Claims
            .FirstOrDefault(c => string.Equals(c.Type, "RoleId", StringComparison.OrdinalIgnoreCase))
            ?.Value;

        // If no RoleId claim is present (e.g. employee portal direct employee login), allow authenticated user
        if (string.IsNullOrWhiteSpace(roleIdClaim) || !int.TryParse(roleIdClaim, out var roleId))
        {
            return;
        }

        // RoleId == 1 is the default Admin role with full permissions
        if (roleId == 1)
        {
            return;
        }

        // Multiple [AuthorizePage] attributes on a single action/controller should work as OR.
        var endpoint = context.HttpContext.GetEndpoint();
        var authPages = endpoint?.Metadata?.GetOrderedMetadata<AuthorizePageAttribute>()
            ?.Select(x => (ModuleKey: x.ModuleKey, PageKey: x.PageKey))
            .ToList();

        if (authPages is null || authPages.Count == 0)
        {
            authPages = new List<(string ModuleKey, string PageKey)> { (_moduleKey, _pageKey) };
        }

        var pairs = authPages
            .Select(x => new { ModuleKey = x.ModuleKey, PageKey = x.PageKey })
            .Distinct()
            .ToList();

        var lookupKeys = pairs
            .Select(x => x.ModuleKey + ":" + x.PageKey)
            .ToList();

        // Also always include current filter's keys
        lookupKeys.Add(_moduleKey + ":" + _pageKey);
        lookupKeys.Add("employee:calisan");
        lookupKeys.Add("users:calisan");
        lookupKeys.Add("users:personel");
        lookupKeys.Add("employee:personel");

        var pageIds = await _dbContext.Pages
            .AsNoTracking()
            .Where(p => lookupKeys.Contains(p.ModuleKey + ":" + p.Key))
            .Select(p => p.Id)
            .ToListAsync();

        if (pageIds.Count == 0)
        {
            // If page is not registered in DB, allow access by default
            return;
        }

        var allowed = await _dbContext.RolePagePermissions
            .AsNoTracking()
            .AnyAsync(rpp => rpp.RoleId == roleId && rpp.CanAccess && pageIds.Contains(rpp.PageId));

        if (!allowed)
        {
            // ERP YONETICI GIRISI (2026-08-23). Bu giriste artik bir `RoleId` claim'i var,
            // yani filtre calisiyor; ama yukaridaki anahtarlar ERP'nin kendi `calisan`
            // ekranina bakiyor. Portala girisi zaten rolune ACIK bir `employee` sayfasi
            // olmasi sarti kapatiyor (bkz. EmployeePortalAuthController), o yuzden burada
            // "modulden en az bir sayfasi acik mi" kaba kapisi OR olarak ekleniyor.
            //
            // Sadece OR: daha once gecen hicbir cagri bu satir yuzunden kapanmaz.
            //
            // DIKKAT — SINIRI: bu kapi MODUL seviyesinde. Sayfa sayfa kisitlama su an
            // yalnizca portalin menusunde/rotalarinda; ucu dogrudan cagiran bir yonetici
            // rolune kapali bir sayfanin verisine erisebilir. Sayfa bazli sunucu kapisi
            // her controller'a kendi [AuthorizePage] anahtarinin yazilmasini gerektirir.
            var employeeModulePageIds = _dbContext.Pages
                .AsNoTracking()
                .Where(p => p.IsActive && p.ModuleKey == "employee")
                .Select(p => p.Id);

            allowed = await _dbContext.RolePagePermissions
                .AsNoTracking()
                .AnyAsync(rpp => rpp.RoleId == roleId && rpp.CanAccess && employeeModulePageIds.Contains(rpp.PageId));
        }

        if (!allowed)
        {
            context.Result = new ObjectResult(new { success = false, message = "Yetkiniz yok" })
            {
                StatusCode = StatusCodes.Status403Forbidden
            };
        }
    }
}
