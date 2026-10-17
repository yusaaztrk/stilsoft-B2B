using B2B.Erp.Api.Core.Authorization;
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
[Route("api/[controller]")]
[Authorize]
public sealed class UserActivitiesController : ControllerBase
{
    private readonly AppDbContext _dbContext;
    private readonly B2B.Erp.Api.Core.Helpers.CompanyClock _clock;

    public UserActivitiesController(
        AppDbContext dbContext,
        B2B.Erp.Api.Core.Helpers.CompanyClock clock)
    {
        _dbContext = dbContext;
        _clock = clock;
    }

    /// <summary>
    /// Ekranda seçilen TAKVİM GÜNÜ aralığını, kayıtların UTC damgalarıyla karşılaştırılabilecek
    /// bir pencereye çevirir.
    ///
    /// <para>
    /// Burada iki ayrı hata vardı ve ikisi de "seçtiğim günün kayıtları gelmiyor" diye
    /// görünüyordu:
    /// </para>
    ///
    /// <para>
    /// 1) <b>Bitiş günü dışarıda kalıyordu.</b> 20.08 seçildiğinde sınır 20.08 00:00 olarak
    /// kuruluyor ve <c>&lt;=</c> ile karşılaştırılıyordu — yani o günün gece yarısından
    /// sonraki HİÇBİR kaydı gelmiyordu. Pencere artık [başlangıç, bitiş+1gün) biçiminde,
    /// yani bitiş günü tümüyle içeride.
    /// </para>
    ///
    /// <para>
    /// 2) <b>Gün sınırı UTC'den okunuyordu.</b> Ekran saatleri tarayıcının yerel saatinde
    /// gösteriliyor; KKTC'de (UTC+3) yerel 01:30'daki bir kayıt UTC'de bir ÖNCEKİ günün
    /// 22:30'udur. Kullanıcı listede "20.08 01:30" görüp 20.08'i süzdüğünde o satır
    /// kayboluyordu. Sınır artık firmanın takvim gününden kuruluyor
    /// (<see cref="B2B.Erp.Api.Core.Helpers.CompanyClock"/>).
    /// </para>
    /// </summary>
    private (DateTime? FromUtc, DateTime? ToUtcExclusive) ResolveDayWindow(DateTime? fromDate, DateTime? toDate)
    {
        DateTime? fromUtc = fromDate.HasValue
            ? _clock.CompanyDayStartUtc(fromDate.Value.Date)
            : null;

        DateTime? toUtcExclusive = toDate.HasValue
            ? _clock.CompanyDayEndUtc(toDate.Value.Date)
            : null;

        return (fromUtc, toUtcExclusive);
    }

    [HttpGet]
    [AuthorizePage("users", "userActivities")]
    public async Task<IActionResult> GetActivities(
        [FromQuery] string? query,
        [FromQuery] string? actionType,
        [FromQuery] string? moduleKey,
        [FromQuery] string? pageKey,
        [FromQuery] DateTime? fromDate,
        [FromQuery] DateTime? toDate,
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 50,
        CancellationToken cancellationToken = default)
    {
        page = Math.Max(1, page);
        pageSize = Math.Clamp(pageSize, 1, 200);

        var dbQuery = _dbContext.UserActivityLogs.AsNoTracking().AsQueryable();

        if (!string.IsNullOrWhiteSpace(query))
        {
            var q = query.Trim();
            dbQuery = dbQuery.Where(x => EF.Functions.ILike(x.Username, $"%{q}%") 
                                      || EF.Functions.ILike(x.UserDisplayName, $"%{q}%")
                                      || EF.Functions.ILike(x.Description, $"%{q}%")
                                      || EF.Functions.ILike(x.RecordId, $"%{q}%"));
        }

        if (!string.IsNullOrWhiteSpace(actionType))
        {
            dbQuery = dbQuery.Where(x => x.ActionType == actionType.Trim());
        }

        if (!string.IsNullOrWhiteSpace(moduleKey))
        {
            dbQuery = dbQuery.Where(x => x.ModuleKey == moduleKey.Trim());
        }

        if (!string.IsNullOrWhiteSpace(pageKey))
        {
            dbQuery = dbQuery.Where(x => x.PageKey == pageKey.Trim());
        }

        var (fromUtc, toUtcExclusive) = ResolveDayWindow(fromDate, toDate);

        if (fromUtc.HasValue)
        {
            dbQuery = dbQuery.Where(x => x.CreateTime >= fromUtc.Value);
        }

        if (toUtcExclusive.HasValue)
        {
            dbQuery = dbQuery.Where(x => x.CreateTime < toUtcExclusive.Value);
        }

        var total = await dbQuery.CountAsync(cancellationToken);

        var items = await dbQuery
            .OrderByDescending(x => x.CreateTime)
            .ThenByDescending(x => x.Id)
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .ToListAsync(cancellationToken);

        return Ok(new
        {
            success = true,
            data = new
            {
                items,
                total,
                page,
                pageSize
            }
        });
    }

    [HttpGet("action-types")]
    [AuthorizePage("users", "userActivities")]
    public async Task<IActionResult> GetActionTypes(CancellationToken cancellationToken)
    {
        var types = await _dbContext.UserActivityLogs
            .AsNoTracking()
            .Select(x => x.ActionType)
            .Distinct()
            .OrderBy(x => x)
            .ToListAsync(cancellationToken);

        return Ok(new { success = true, data = types });
    }

    [HttpDelete("clear-range")]
    [AuthorizePage("users", "userActivities")]
    public async Task<IActionResult> DeleteActivitiesRange(
        [FromQuery] DateTime? fromDate,
        [FromQuery] DateTime? toDate,
        CancellationToken cancellationToken)
    {
        // DENETİM İZİNİ SİLME HAKKI, OKUMA HAKKIYLA AYNI OLAMAZ. Bu uç yalnızca sayfa yetkisiyle
        // korunuyordu; oysa aynı yetki logları GÖRMEK için de gerekiyor. Yani hareket kayıtlarını
        // görebilen herkes, kendi izini de dahil olmak üzere istediği tarih aralığını kalıcı
        // olarak silebiliyordu. Silme süper admin/SSA'ya bırakıldı; okuma değişmedi.
        var canPurge = User.FindFirst("IsSuperSuperAdmin")?.Value == "1"
                       || User.FindFirst("IsSuperAdmin")?.Value == "1";

        if (!canPurge)
        {
            return Forbid();
        }

        if (fromDate is null && toDate is null)
        {
            return BadRequest(new { success = false, message = "En az bir tarih sınırı seçilmelidir." });
        }

        var dbQuery = _dbContext.UserActivityLogs.AsQueryable();

        // Silme penceresi listelemeyle AYNI kuralı kullanır. Farklı olsaydı ekranda "bu
        // aralıkta şu kadar kayıt var" diye görüp başka bir aralığı silmek mümkün olurdu.
        var (purgeFromUtc, purgeToUtcExclusive) = ResolveDayWindow(fromDate, toDate);

        if (purgeFromUtc.HasValue)
        {
            dbQuery = dbQuery.Where(x => x.CreateTime >= purgeFromUtc.Value);
        }

        if (purgeToUtcExclusive.HasValue)
        {
            dbQuery = dbQuery.Where(x => x.CreateTime < purgeToUtcExclusive.Value);
        }

        var deletedCount = await dbQuery.ExecuteDeleteAsync(cancellationToken);

        return Ok(new { success = true, message = $"{deletedCount} adet hareket kaydı başarıyla silindi." });
    }
}
