using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using ServiceOps.Domain.Entities;
using ServiceOps.Infrastructure.Data;

namespace ServiceOps.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
[Authorize]
public class UserActivitiesController : ControllerBase
{
    private readonly ApplicationDbContext _context;
    private readonly ServiceOps.Api.Services.IServiceOpsPermissionService _permissions;

    public UserActivitiesController(
        ApplicationDbContext context,
        ServiceOps.Api.Services.IServiceOpsPermissionService permissions)
    {
        _context = context;
        _permissions = permissions;
    }

    /// <summary>
    /// Kullanıcı hareket defteri kim tarafından okunabilir.
    ///
    /// Bu uçta hiçbir sayfa yetkisi aranmıyordu: tek engel [Authorize] idi, yani oturum açmış
    /// HERKES bütün kullanıcıların hareket kayıtlarını (kim neyi ne zaman değiştirdi) okuyabiliyordu.
    /// Doğrulandı (2026-08-10): 'Kullanıcı Hareketleri' yetkisi olmayan Müdür rolü 200 ve dolu
    /// gövde alıyordu.
    ///
    /// NOT: 'userActivities' anahtarının Pages tablosunda karşılığı YOK — frontend
    /// (auth/pagePermissions.ts) '/kullanici-hareketleri' rotasını bu anahtara eşliyor ama satır
    /// hiç oluşturulmamış. Dolayısıyla şu an yalnızca süper admin geçebilir; bu ekranı bir role
    /// açmak için önce o sayfa satırının eklenmesi gerekiyor. Kapalı başarısız olmak, herkese
    /// açık bırakmaktan iyidir.
    /// </summary>
    private async Task<bool> CanReadActivitiesAsync()
    {
        var scope = await _permissions.GetScopeAsync(User, "userActivities");
        return scope.CanAccess;
    }

    [HttpGet]
    public async Task<IActionResult> GetActivities(
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 10,
        [FromQuery] string? query = null,
        [FromQuery] string? actionType = null,
        [FromQuery] string? moduleKey = null,
        [FromQuery] string? fromDate = null,
        [FromQuery] string? toDate = null)
    {
        if (!await CanReadActivitiesAsync()) return Forbid();

        var dbQuery = _context.UserActivityLogs.AsNoTracking();

        if (!string.IsNullOrWhiteSpace(query))
        {
            var q = query.Trim().ToLower();
            dbQuery = dbQuery.Where(x => 
                x.Username.ToLower().Contains(q) || 
                x.UserDisplayName.ToLower().Contains(q) || 
                x.Description.ToLower().Contains(q)
            );
        }

        if (!string.IsNullOrWhiteSpace(actionType))
        {
            dbQuery = dbQuery.Where(x => x.ActionType == actionType);
        }

        if (!string.IsNullOrWhiteSpace(moduleKey))
        {
            dbQuery = dbQuery.Where(x => x.ModuleKey == moduleKey);
        }

        if (!string.IsNullOrWhiteSpace(fromDate) && DateTime.TryParse(fromDate, out var fromVal))
        {
            var utcFrom = DateTime.SpecifyKind(fromVal, DateTimeKind.Utc);
            dbQuery = dbQuery.Where(x => x.CreateTime >= utcFrom);
        }

        if (!string.IsNullOrWhiteSpace(toDate) && DateTime.TryParse(toDate, out var toVal))
        {
            var utcTo = DateTime.SpecifyKind(toVal.AddDays(1), DateTimeKind.Utc);
            dbQuery = dbQuery.Where(x => x.CreateTime < utcTo);
        }

        var total = await dbQuery.CountAsync();

        var items = await dbQuery
            .OrderByDescending(x => x.CreateTime)
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .ToListAsync();

        return Ok(new
        {
            success = true,
            data = new
            {
                items = items.Select(x => new
                {
                    id = x.Id,
                    username = x.Username,
                    userDisplayName = x.UserDisplayName,
                    moduleKey = x.ModuleKey,
                    pageKey = x.PageKey,
                    actionType = x.ActionType,
                    description = x.Description,
                    recordId = x.RecordId,
                    detailsJson = x.DetailsJson,
                    createTime = x.CreateTime.ToString("o")
                }).ToList(),
                total = total,
                page = page,
                pageSize = pageSize
            }
        });
    }

    [HttpGet("action-types")]
    public async Task<IActionResult> GetActionTypes()
    {
        // Aynı defterin türetilmiş hâli; listeyle aynı kapıdan geçer.
        if (!await CanReadActivitiesAsync()) return Forbid();

        var types = await _context.UserActivityLogs
            .AsNoTracking()
            .Select(x => x.ActionType)
            .Distinct()
            .ToListAsync();

        return Ok(new
        {
            success = true,
            data = types
        });
    }
}
