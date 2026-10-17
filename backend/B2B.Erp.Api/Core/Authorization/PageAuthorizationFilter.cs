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

    private const string AlreadyEvaluatedKey = "__PageAuthorizationEvaluated";

    public async Task OnAuthorizationAsync(AuthorizationFilterContext context)
    {
        // [AuthorizePage] is AllowMultiple, and every attribute creates its own filter
        // instance. Each instance already evaluates ALL attributes on the endpoint as an OR,
        // so running it once is enough — the extra runs only repeated the same two queries.
        // An action carrying 11 attributes was issuing 22 redundant lookups per request.
        if (context.HttpContext.Items.ContainsKey(AlreadyEvaluatedKey))
        {
            return;
        }
        context.HttpContext.Items[AlreadyEvaluatedKey] = true;

        var user = context.HttpContext.User;
        if (user?.Identity?.IsAuthenticated != true)
        {
            context.Result = new UnauthorizedResult();
            return;
        }

        // Super super admin. The ONLY accepted proof is the claim, which is issued by the
        // master database at login and cannot be produced from inside a tenant.
        //
        // A username check used to sit here as well: any account literally named "ssa" — in
        // any tenant, created by any tenant administrator — bypassed every page permission in
        // the system. Username is tenant-controlled data, so it can never be an authorization
        // decision.
        var isSsaClaim = user.FindFirst("IsSuperSuperAdmin")?.Value;
        if (isSsaClaim == "1")
        {
            return;
        }

        var roleIdClaim = user.Claims
            .FirstOrDefault(c => string.Equals(c.Type, "RoleId", StringComparison.OrdinalIgnoreCase))
            ?.Value;
        if (string.IsNullOrWhiteSpace(roleIdClaim) || !int.TryParse(roleIdClaim, out var roleId))
        {
            context.Result = new ForbidResult();
            return;
        }

        // IMPORTANT: multiple [AuthorizePage] attributes on a single action should work as OR.
        // If ANY page permission matches, allow the request.
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

        var pageIds = await _dbContext.Pages
            .AsNoTracking()
            .Where(p => lookupKeys.Contains(p.ModuleKey + ":" + p.Key))
            .Select(p => p.Id)
            .ToListAsync();

        var allowed = pageIds.Count > 0 && await _dbContext.RolePagePermissions
            .AsNoTracking()
            .AnyAsync(rpp => rpp.RoleId == roleId && rpp.CanAccess && pageIds.Contains(rpp.PageId));

        if (!allowed)
        {
            context.Result = new ObjectResult(new { success = false, message = "Yetkiniz yok" })
            {
                StatusCode = StatusCodes.Status403Forbidden
            };
        }
    }
}
