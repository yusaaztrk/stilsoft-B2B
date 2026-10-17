using B2B.Erp.Api.Core.Authorization;
using B2B.Erp.Api.Core.Time;
using B2B.Erp.Api.Core.Services;
using B2B.Erp.Api.Data;
using B2B.Erp.Api.Dtos.Employees;
using B2B.Erp.Api.Entities;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace B2B.Erp.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
[Authorize]
[AuthorizePage("employee", "calisan")]
[AuthorizePage("users", "calisan")]
public sealed class EmployeeCheckInsController : ControllerBase
{
    private readonly AppDbContext _dbContext;
    private readonly WorkCalendarService _calendar;

    public EmployeeCheckInsController(AppDbContext dbContext, WorkCalendarService calendar)
    {
        _dbContext = dbContext;
        _calendar = calendar;
    }

    public sealed class CloseOpenCheckInsRequest
    {
        /// <summary>Boş ise tüm personel.</summary>
        public List<int>? EmployeeIds { get; set; }

        /// <summary>Dönem "yyyy-MM". Boş ise içinde bulunulan ay.</summary>
        public string? Period { get; set; }

        /// <summary>Yalnızca bu gün "yyyy-MM-dd". Doluysa dönem yok sayılır.</summary>
        public string? Date { get; set; }

        /// <summary>
        /// Çıkışın yazılacağı dakika (00:00'dan itibaren). Verilmezse o günün mesai bitişi
        /// kullanılır; mesai tanımı yoksa kayıt atlanır.
        /// </summary>
        public int? CloseAtMinute { get; set; }
    }

    /// <summary>
    /// Açık kalmış giriş kayıtlarını (çıkış yapılmamış) toplu kapatır.
    ///
    /// <para>Personel sabah giriş yapıp akşam çıkışı unutursa o gün <b>0 dakika</b> çalışılmış
    /// sayılır ve hakediş doğmaz — hesap dakika bazlı olduğu için kayıp doğrudan paraya yansır.
    /// Bu uç, açık kayıtları o günün mesai bitişiyle kapatır.</para>
    ///
    /// <para><b>Bugünün açık kaydına dokunulmaz:</b> personel hâlâ içeride olabilir; günü
    /// erkenden kapatmak fiilen çalışılan süreyi kırpardı.</para>
    /// </summary>
    [HttpPost("close-open")]
    public async Task<IActionResult> CloseOpenCheckIns(
        [FromBody] CloseOpenCheckInsRequest request,
        CancellationToken cancellationToken = default)
    {
        DateOnly from, to;

        if (!string.IsNullOrWhiteSpace(request.Date) && DateOnly.TryParse(request.Date, out var single))
        {
            from = to = single;
        }
        else
        {
            var period = string.IsNullOrWhiteSpace(request.Period)
                ? TurkeyTime.PeriodOf(TurkeyTime.LocalDate(DateTime.UtcNow))
                : request.Period.Trim();
            var range = TurkeyTime.MonthRange(period);
            from = range.FirstDay;
            to = range.LastDay;
        }

        var today = TurkeyTime.LocalDate(DateTime.UtcNow);
        if (to >= today) to = today.AddDays(-1);
        if (to < from) return Ok(new { success = true, closedCount = 0, message = "Kapatılacak geçmiş gün yok." });

        var startUtc = TurkeyTime.StartOfDayUtc(from);
        var endUtc = TurkeyTime.EndOfDayUtc(to);

        var query = _dbContext.EmployeeCheckIns
            .Where(x => x.CheckOutTime == null)
            .Where(x => x.CheckInTime >= startUtc && x.CheckInTime <= endUtc);

        var ids = (request.EmployeeIds ?? new List<int>()).Where(x => x > 0).Distinct().ToList();
        if (ids.Count > 0) query = query.Where(x => ids.Contains(x.EmployeeId));

        var open = await query.ToListAsync(cancellationToken);
        if (open.Count == 0)
        {
            return Ok(new { success = true, closedCount = 0, message = "Açık giriş kaydı bulunamadı." });
        }

        // MESAİ BİTİŞİ PERSONELİN KENDİ TANIMINDAN (2026-10-04). Eskiden herkes varsayılan
        // mesaiye göre kapatılıyordu: farklı vardiyadaki (ör. 12:00–21:00) personelin unutulan
        // çıkışı 18:00'e yazılıyor, 3 saati kayboluyordu.
        var openEmployeeIds = open.Select(x => x.EmployeeId).Distinct().ToList();
        var scheduleIdByEmployee = await _dbContext.Employees
            .AsNoTracking()
            .Where(x => openEmployeeIds.Contains(x.Id))
            .Select(x => new { x.Id, x.WorkScheduleSettingId })
            .ToDictionaryAsync(x => x.Id, x => x.WorkScheduleSettingId ?? 0, cancellationToken);

        var calendarBySchedule = new Dictionary<int, Dictionary<DateOnly, WorkCalendarDay>>();
        async Task<Dictionary<DateOnly, WorkCalendarDay>> CalendarFor(int employeeId)
        {
            var key = scheduleIdByEmployee.TryGetValue(employeeId, out var sid) ? sid : 0;
            if (!calendarBySchedule.TryGetValue(key, out var map))
            {
                var schedule = await _calendar.GetScheduleAsync(key > 0 ? key : null, cancellationToken);
                map = (await _calendar.BuildAsync(from, to, schedule, cancellationToken)).ToDictionary(x => x.Date);
                calendarBySchedule[key] = map;
            }
            return map;
        }

        var username = User.Identity?.Name ?? "System";
        var now = DateTime.UtcNow;
        var closed = 0;
        var skipped = 0;

        foreach (var row in open)
        {
            var day = TurkeyTime.LocalDate(row.CheckInTime);
            var byDate = await CalendarFor(row.EmployeeId);

            int? endMinute = request.CloseAtMinute;
            if (endMinute is null && byDate.TryGetValue(day, out var calDay) && calDay.Blocks.Count > 0)
            {
                endMinute = calDay.Blocks.Max(b => b.EndMinute);
            }

            // Mesai tanımı yoksa uydurma bir bitiş yazmaktansa kaydı atla.
            if (endMinute is null) { skipped++; continue; }

            var closeUtc = TurkeyTime.StartOfDayUtc(day).AddMinutes(endMinute.Value);

            // Girişten önceye kapatmak negatif süre üretir.
            if (closeUtc <= row.CheckInTime) { skipped++; continue; }

            row.CheckOutTime = closeUtc;
            row.EditUser = username;
            row.EditTime = now;
            closed++;
        }

        await _dbContext.SaveChangesAsync(cancellationToken);

        return Ok(new
        {
            success = true,
            closedCount = closed,
            skippedCount = skipped,
            message = closed > 0
                ? $"{closed} açık giriş kaydı mesai bitişiyle kapatıldı."
                : "Kapatılabilecek kayıt bulunamadı."
        });
    }

    /// <summary>
    /// Bugunun mesai durumu: kim iste, kim degil.
    ///
    /// Dashboard bu bilgiyi her personel icin AYRI istek atarak topluyordu (200 personel =
    /// 200 HTTP istegi). Tek sorguya indirildi. Gun siniri Turkiye saatine gore belirlenir.
    /// </summary>
    [HttpGet("today")]
    public async Task<IActionResult> Today(CancellationToken cancellationToken = default)
    {
        var today = TurkeyTime.LocalDate(DateTime.UtcNow);
        var startUtc = TurkeyTime.StartOfDayUtc(today);
        var endUtc = TurkeyTime.EndOfDayUtc(today);

        var items = await _dbContext.EmployeeCheckIns
            .AsNoTracking()
            .Where(x => x.CheckInTime >= startUtc && x.CheckInTime < endUtc)
            .Select(x => new
            {
                employeeId = x.EmployeeId,
                checkInTime = x.CheckInTime,
                checkOutTime = x.CheckOutTime
            })
            .ToListAsync(cancellationToken);

        // Gun degismeden kapatilmamis kayitlar da "su an iste" sayilir.
        var stillOpen = await _dbContext.EmployeeCheckIns
            .AsNoTracking()
            .Where(x => x.CheckOutTime == null && x.CheckInTime < startUtc)
            .Select(x => new
            {
                employeeId = x.EmployeeId,
                checkInTime = x.CheckInTime,
                checkOutTime = (DateTime?)null
            })
            .ToListAsync(cancellationToken);

        var atWorkEmployeeIds = items.Where(x => x.checkOutTime == null)
            .Select(x => x.employeeId)
            .Concat(stillOpen.Select(x => x.employeeId))
            .Distinct()
            .ToList();

        return Ok(new
        {
            success = true,
            data = new
            {
                date = TurkeyTime.Ymd(today),
                checkIns = items,
                staleOpenCheckIns = stillOpen,
                atWorkEmployeeIds
            }
        });
    }

    [HttpGet("by-employee/{employeeId:int}")]
    public async Task<IActionResult> GetByEmployee(
        [FromRoute] int employeeId,
        [FromQuery] int take = 200,
        CancellationToken cancellationToken = default)
    {
        if (employeeId <= 0) return BadRequest(new { success = false, message = "Geçersiz employeeId" });

        take = Math.Clamp(take, 1, 2000);

        var exists = await _dbContext.Employees
            .AsNoTracking()
            .AnyAsync(x => x.Id == employeeId, cancellationToken);

        if (!exists) return NotFound(new { success = false, message = "Çalışan bulunamadı" });

        var items = await _dbContext.EmployeeCheckIns
            .AsNoTracking()
            .Where(x => x.EmployeeId == employeeId)
            .OrderByDescending(x => x.CheckInTime)
            .Take(take)
            .Select(x => new EmployeeCheckInDtos.ListItemResponse
            {
                Id = x.Id,
                EmployeeId = x.EmployeeId,
                CheckInTime = x.CheckInTime,
                CheckOutTime = x.CheckOutTime,
                Latitude = x.Latitude,
                Longitude = x.Longitude,
                CheckOutLatitude = x.CheckOutLatitude,
                CheckOutLongitude = x.CheckOutLongitude,
                City = x.City,
                District = x.District,
                CheckOutCity = x.CheckOutCity,
                CheckOutDistrict = x.CheckOutDistrict,
                CheckOutOffsite = x.CheckOutOffsite,
                CheckOutAuto = x.CheckOutAuto,
                SuspicionCount = _dbContext.EmployeeAttendanceSuspicions.Count(s => s.CheckInId == x.Id && s.ReviewedAt == null),
                CreateUser = x.CreateUser,
                CreateTime = x.CreateTime
            })
            .ToListAsync(cancellationToken);

        return Ok(new { success = true, data = items });
    }

    [HttpPost("by-employee/{employeeId:int}")]
    public async Task<IActionResult> Create(
        [FromRoute] int employeeId,
        [FromBody] EmployeeCheckInDtos.UpsertRequest request,
        CancellationToken cancellationToken = default)
    {
        if (employeeId <= 0) return BadRequest(new { success = false, message = "Geçersiz employeeId" });

        var exists = await _dbContext.Employees
            .AsNoTracking()
            .AnyAsync(x => x.Id == employeeId, cancellationToken);

        if (!exists) return NotFound(new { success = false, message = "Çalışan bulunamadı" });

        var now = DateTime.UtcNow;
        var checkInTime = DateTime.SpecifyKind(request.CheckInTime, DateTimeKind.Utc);

        var entity = new EmployeeCheckIn
        {
            EmployeeId = employeeId,
            CheckInTime = checkInTime,
            Latitude = 0,
            Longitude = 0,
            // Cikis koordinatlari NULL birakilmaz.
            //
            // Ayni tenant veritabanini ana ERP de kullaniyor ve orada bu kolonlar
            // NOT NULL DEFAULT 0 olarak tanimli; NULL yazmak insert'i patlatir. Ayrica ana
            // API'nin varligi bu alanlari nullable olmayan decimal olarak okuyor, NULL satir
            // orada okuma hatasi verir. Deger bilinmedigi icin 0 yazilir.
            CheckOutLatitude = 0,
            CheckOutLongitude = 0,
            City = null,
            District = null,
            CreateUser = User.Identity?.Name ?? "System",
            CreateTime = now
        };

        _dbContext.EmployeeCheckIns.Add(entity);
        await _dbContext.SaveChangesAsync(cancellationToken);

        return Ok(new { success = true, data = new { id = entity.Id } });
    }

    [HttpPut("{id:int}")]
    public async Task<IActionResult> Update(
        [FromRoute] int id,
        [FromBody] EmployeeCheckInDtos.UpsertRequest request,
        CancellationToken cancellationToken = default)
    {
        if (id <= 0) return BadRequest(new { success = false, message = "Geçersiz id" });

        var entity = await _dbContext.EmployeeCheckIns.FirstOrDefaultAsync(x => x.Id == id, cancellationToken);
        if (entity is null) return NotFound(new { success = false, message = "Kayıt bulunamadı" });

        var checkIn = DateTime.SpecifyKind(request.CheckInTime, DateTimeKind.Utc);
        if (entity.CheckOutTime.HasValue && checkIn >= entity.CheckOutTime.Value)
            return BadRequest(new { success = false, message = "Giriş saati çıkış saatinden önce olmalıdır." });

        entity.CheckInTime = checkIn;
        entity.EditUser = User.Identity?.Name ?? "System";
        entity.EditTime = DateTime.UtcNow;

        await _dbContext.SaveChangesAsync(cancellationToken);
        return Ok(new { success = true });
    }

    [HttpPut("{id:int}/check-out")]
    public async Task<IActionResult> UpdateCheckOut(
        [FromRoute] int id,
        [FromBody] EmployeeCheckInDtos.UpsertCheckOutRequest request,
        CancellationToken cancellationToken = default)
    {
        if (id <= 0) return BadRequest(new { success = false, message = "Geçersiz id" });

        var entity = await _dbContext.EmployeeCheckIns.FirstOrDefaultAsync(x => x.Id == id, cancellationToken);
        if (entity is null) return NotFound(new { success = false, message = "Kayıt bulunamadı" });

        var checkOut = DateTime.SpecifyKind(request.CheckOutTime, DateTimeKind.Utc);

        // SAAT DOĞRULAMASI (2026-10-04). Çıkış girişten önce ya da 24 saatten uzun sonra
        // yazılabiliyordu: ilki o günü sessizce 0 dakika yapıyor (personel gelmemiş gibi),
        // ikincisi — başka günün açık kaydına yanlışlıkla yazılan çıkış — günlerce süren dev bir
        // fazla mesai üretiyordu.
        if (checkOut <= entity.CheckInTime)
            return BadRequest(new { success = false, message = "Çıkış saati giriş saatinden sonra olmalıdır." });
        if (checkOut - entity.CheckInTime > TimeSpan.FromHours(24))
            return BadRequest(new { success = false, message = "Çıkış, girişten 24 saatten uzun sonra olamaz. Doğru giriş kaydını seçtiğinizden emin olun." });

        entity.CheckOutTime = checkOut;
        // Elle girilen çıkış artık otomatik değildir (takvimdeki ayrı renk kalkar).
        entity.CheckOutAuto = false;
        entity.CheckOutLatitude = request.CheckOutLatitude ?? entity.CheckOutLatitude ?? 0;
        entity.CheckOutLongitude = request.CheckOutLongitude ?? entity.CheckOutLongitude ?? 0;
        entity.EditUser = User.Identity?.Name ?? "System";
        entity.EditTime = DateTime.UtcNow;

        await _dbContext.SaveChangesAsync(cancellationToken);
        return Ok(new { success = true });
    }

    [HttpDelete("{id:int}")]
    public async Task<IActionResult> Delete(
        [FromRoute] int id,
        CancellationToken cancellationToken = default)
    {
        if (id <= 0) return BadRequest(new { success = false, message = "Geçersiz id" });

        var entity = await _dbContext.EmployeeCheckIns.FirstOrDefaultAsync(x => x.Id == id, cancellationToken);
        if (entity is null) return NotFound(new { success = false, message = "Kayıt bulunamadı" });

        _dbContext.EmployeeCheckIns.Remove(entity);
        await _dbContext.SaveChangesAsync(cancellationToken);
        return Ok(new { success = true });
    }
}
