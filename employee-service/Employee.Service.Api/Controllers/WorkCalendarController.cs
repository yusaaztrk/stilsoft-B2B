using System.ComponentModel.DataAnnotations;
using System.Security.Claims;
using B2B.Erp.Api.Core.Authorization;
using B2B.Erp.Api.Core.Services;
using B2B.Erp.Api.Core.Time;
using B2B.Erp.Api.Data;
using B2B.Erp.Api.Entities;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace B2B.Erp.Api.Controllers;

/// <summary>
/// İş günü (mesai) tanımı ve resmî tatil takvimi.
/// Puantaj, hakediş ve izin gün sayımının tamamı buradaki tanımlara dayanır.
/// </summary>
[ApiController]
[Route("api/[controller]")]
[Authorize]
[AuthorizePage("employee", "calisan")]
[AuthorizePage("users", "calisan")]
public sealed class WorkCalendarController : ControllerBase
{
    private readonly AppDbContext _dbContext;
    private readonly WorkCalendarService _calendar;

    public WorkCalendarController(AppDbContext dbContext, WorkCalendarService calendar)
    {
        _dbContext = dbContext;
        _calendar = calendar;
    }

    private string GetUsername()
    {
        var username = User.FindFirst(ClaimTypes.Name)?.Value;
        return string.IsNullOrWhiteSpace(username) ? "System" : username;
    }

    // ---------------------------------------------------------------------
    // Mesai tanımları
    // ---------------------------------------------------------------------

    public sealed class UpsertScheduleRequest
    {
        [Required]
        [StringLength(100)]
        public string Name { get; set; } = string.Empty;

        [Range(0, 1440)] public int MondayMinutes { get; set; } = 540;
        [Range(0, 1440)] public int TuesdayMinutes { get; set; } = 540;
        [Range(0, 1440)] public int WednesdayMinutes { get; set; } = 540;
        [Range(0, 1440)] public int ThursdayMinutes { get; set; } = 540;
        [Range(0, 1440)] public int FridayMinutes { get; set; } = 540;
        [Range(0, 1440)] public int SaturdayMinutes { get; set; }
        [Range(0, 1440)] public int SundayMinutes { get; set; }

        [Range(0, 480)] public int BreakMinutes { get; set; } = 60;
        [Range(0, 1439)] public int StartTimeMinutes { get; set; } = 540;
        [Range(0, 480)] public int LateToleranceMinutes { get; set; } = 15;
        [Range(0, 480)] public int EarlyLeaveToleranceMinutes { get; set; } = 15;
        [Range(1.0, 5.0)] public decimal OvertimeMultiplier { get; set; } = 1.50m;

        public bool CountHolidaysAsWorkDay { get; set; }
        public bool IsDefault { get; set; }
        public bool IsActive { get; set; } = true;

        /// <summary>
        /// Haftalik mesai bloklari. Gonderilirse tanimin butun bloklari bununla degistirilir;
        /// bos liste gonderilirse gunluk sure alanlarindan (eski duzen) blok uretilir.
        /// </summary>
        public List<ShiftBlockRequest> Blocks { get; set; } = new();
    }

    public sealed class ShiftBlockRequest
    {
        /// <summary>0 = Pazar, 1 = Pazartesi ... 6 = Cumartesi.</summary>
        [Range(0, 6)]
        public int DayOfWeek { get; set; }

        /// <summary>Gun basindan itibaren baslangic dakikasi (0-1439).</summary>
        [Range(0, 1439)]
        public int StartMinute { get; set; }

        /// <summary>Bitis dakikasi. Gece yarisini asan vardiyada 1440'tan buyuk olabilir.</summary>
        [Range(1, 2880)]
        public int EndMinute { get; set; }

        [Range(0.1, 10.0)]
        public decimal PayMultiplier { get; set; } = 1.00m;

        [StringLength(80)]
        public string? Label { get; set; }
    }

    [HttpGet("schedules")]
    public async Task<IActionResult> ListSchedules(CancellationToken cancellationToken)
    {
        var entities = await _dbContext.WorkScheduleSettings
            .AsNoTracking()
            .Include(x => x.Blocks)
            .OrderByDescending(x => x.IsDefault)
            .ThenBy(x => x.Name)
            .ToListAsync(cancellationToken);

        // Blok tanımı olmayan eski kayıtlar için günlük sürelerden bellekte blok üretilir.
        // Hakediş motoru zaten bunu yapıyor; liste ucu yapmazsa ekran aynı kaydın bütün
        // günlerini "tatil" gösterir ve düzenlemeye girildiğinde hafta boş gelir.
        foreach (var entity in entities)
        {
            WorkCalendarService.EnsureBlocks(entity);
        }

        var data = entities
            .Select(x => new
            {
                id = x.Id,
                name = x.Name,
                mondayMinutes = x.MondayMinutes,
                tuesdayMinutes = x.TuesdayMinutes,
                wednesdayMinutes = x.WednesdayMinutes,
                thursdayMinutes = x.ThursdayMinutes,
                fridayMinutes = x.FridayMinutes,
                saturdayMinutes = x.SaturdayMinutes,
                sundayMinutes = x.SundayMinutes,
                breakMinutes = x.BreakMinutes,
                startTimeMinutes = x.StartTimeMinutes,
                lateToleranceMinutes = x.LateToleranceMinutes,
                earlyLeaveToleranceMinutes = x.EarlyLeaveToleranceMinutes,
                overtimeMultiplier = x.OvertimeMultiplier,
                countHolidaysAsWorkDay = x.CountHolidaysAsWorkDay,
                isDefault = x.IsDefault,
                isActive = x.IsActive,
                blocks = x.Blocks
                    .OrderBy(b => b.DayOfWeek)
                    .ThenBy(b => b.StartMinute)
                    .Select(b => new
                    {
                        id = b.Id,
                        dayOfWeek = b.DayOfWeek,
                        startMinute = b.StartMinute,
                        endMinute = b.EndMinute,
                        payMultiplier = b.PayMultiplier,
                        label = b.Label
                    })
                    .ToList(),
                weeklyMinutes = x.Blocks.Count > 0
                    ? x.Blocks.Sum(b => b.EndMinute - b.StartMinute)
                    : x.MondayMinutes + x.TuesdayMinutes + x.WednesdayMinutes
                      + x.ThursdayMinutes + x.FridayMinutes + x.SaturdayMinutes + x.SundayMinutes,
                weightedWeeklyMinutes = x.Blocks.Sum(b => (b.EndMinute - b.StartMinute) * b.PayMultiplier)
            })
            .ToList();

        return Ok(new { success = true, data });
    }

    [HttpPost("schedules")]
    public async Task<IActionResult> CreateSchedule([FromBody] UpsertScheduleRequest request, CancellationToken cancellationToken)
    {
        if (!ModelState.IsValid) return ValidationProblem(ModelState);

        var blockError = ValidateBlocks(request.Blocks);
        if (blockError is not null) return BadRequest(new { success = false, message = blockError });

        var entity = new WorkScheduleSetting
        {
            CreateUser = GetUsername(),
            CreateTime = DateTime.UtcNow
        };

        Apply(entity, request);
        SyncBlocks(entity, request, GetUsername());

        _dbContext.WorkScheduleSettings.Add(entity);
        await _dbContext.SaveChangesAsync(cancellationToken);

        await EnforceSingleDefaultAsync(entity, cancellationToken);

        return StatusCode(StatusCodes.Status201Created, new { success = true, data = new { id = entity.Id } });
    }

    [HttpPut("schedules/{id:int}")]
    public async Task<IActionResult> UpdateSchedule([FromRoute] int id, [FromBody] UpsertScheduleRequest request, CancellationToken cancellationToken)
    {
        if (!ModelState.IsValid) return ValidationProblem(ModelState);

        var entity = await _dbContext.WorkScheduleSettings
            .Include(x => x.Blocks)
            .FirstOrDefaultAsync(x => x.Id == id, cancellationToken);
        if (entity is null) return NotFound(new { success = false, message = "Mesai tanımı bulunamadı" });

        var blockError = ValidateBlocks(request.Blocks);
        if (blockError is not null) return BadRequest(new { success = false, message = blockError });

        Apply(entity, request);
        SyncBlocks(entity, request, GetUsername());
        entity.EditUser = GetUsername();
        entity.EditTime = DateTime.UtcNow;

        await _dbContext.SaveChangesAsync(cancellationToken);
        await EnforceSingleDefaultAsync(entity, cancellationToken);

        return Ok(new { success = true });
    }

    [HttpDelete("schedules/{id:int}")]
    public async Task<IActionResult> DeleteSchedule([FromRoute] int id, CancellationToken cancellationToken)
    {
        var entity = await _dbContext.WorkScheduleSettings.FirstOrDefaultAsync(x => x.Id == id, cancellationToken);
        if (entity is null) return NotFound(new { success = false, message = "Mesai tanımı bulunamadı" });

        // Son tanım silinirse hakediş hesabı dayanaksız kalır.
        var remaining = await _dbContext.WorkScheduleSettings.CountAsync(x => x.Id != id, cancellationToken);
        if (remaining == 0)
        {
            return BadRequest(new { success = false, message = "Tek mesai tanımı silinemez. Önce yeni bir tanım ekleyin." });
        }

        var inUse = await _dbContext.Employees.AnyAsync(x => x.WorkScheduleSettingId == id, cancellationToken);
        if (inUse)
        {
            return BadRequest(new { success = false, message = "Bu mesai tanımı personellere atanmış. Önce personelleri başka tanıma taşıyın." });
        }

        _dbContext.WorkScheduleSettings.Remove(entity);
        await _dbContext.SaveChangesAsync(cancellationToken);

        return Ok(new { success = true });
    }

    /// <summary>
    /// Blok tutarliligini denetler. Ayni gunde ust uste binen blok, hesabi ikiye katlardi:
    /// calisilan dakika iki blokta birden sayilip iki kez ucretlendirilirdi.
    /// </summary>
    private static string? ValidateBlocks(List<ShiftBlockRequest> blocks)
    {
        if (blocks.Count == 0) return null;

        var dayNames = new[] { "Pazar", "Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi" };

        foreach (var group in blocks.GroupBy(x => x.DayOfWeek))
        {
            var ordered = group.OrderBy(x => x.StartMinute).ToList();

            foreach (var b in ordered)
            {
                if (b.EndMinute <= b.StartMinute)
                {
                    return $"{dayNames[b.DayOfWeek]}: bitiş saati başlangıçtan sonra olmalı.";
                }
            }

            for (var i = 1; i < ordered.Count; i++)
            {
                if (ordered[i].StartMinute < ordered[i - 1].EndMinute)
                {
                    return $"{dayNames[group.Key]}: mesai blokları üst üste biniyor.";
                }
            }
        }

        return null;
    }

    /// <summary>
    /// Tanimin bloklarini istekle degistirir. Blok gonderilmediyse eski duzendeki gunluk
    /// surelerden tek blok uretilir; boylece blok tanimi olmayan kayitlar da yeni hesaba
    /// dogru sekilde girer.
    /// </summary>
    private static void SyncBlocks(WorkScheduleSetting entity, UpsertScheduleRequest request, string username)
    {
        var now = DateTime.UtcNow;

        entity.Blocks.Clear();

        var incoming = request.Blocks;

        if (incoming.Count == 0)
        {
            foreach (var day in Enum.GetValues<DayOfWeek>())
            {
                var minutes = entity.LegacyMinutesFor(day);
                if (minutes <= 0) continue;

                incoming.Add(new ShiftBlockRequest
                {
                    DayOfWeek = (int)day,
                    StartMinute = entity.StartTimeMinutes,
                    EndMinute = entity.StartTimeMinutes + minutes,
                    PayMultiplier = 1.00m
                });
            }
        }

        foreach (var b in incoming.OrderBy(x => x.DayOfWeek).ThenBy(x => x.StartMinute))
        {
            entity.Blocks.Add(new WorkShiftBlock
            {
                DayOfWeek = b.DayOfWeek,
                StartMinute = b.StartMinute,
                EndMinute = b.EndMinute,
                PayMultiplier = b.PayMultiplier <= 0 ? 1.00m : b.PayMultiplier,
                Label = string.IsNullOrWhiteSpace(b.Label) ? null : b.Label.Trim(),
                CreateUser = username,
                CreateTime = now
            });
        }

        // Eski gunluk sure alanlari, blok toplamlariyla tutarli tutulur; boylece bu alanlara
        // bakan eski kod yolu da dogru sonuc verir.
        entity.MondayMinutes = SumFor(entity, DayOfWeek.Monday);
        entity.TuesdayMinutes = SumFor(entity, DayOfWeek.Tuesday);
        entity.WednesdayMinutes = SumFor(entity, DayOfWeek.Wednesday);
        entity.ThursdayMinutes = SumFor(entity, DayOfWeek.Thursday);
        entity.FridayMinutes = SumFor(entity, DayOfWeek.Friday);
        entity.SaturdayMinutes = SumFor(entity, DayOfWeek.Saturday);
        entity.SundayMinutes = SumFor(entity, DayOfWeek.Sunday);

        var earliest = entity.Blocks.Count > 0 ? entity.Blocks.Min(x => x.StartMinute) : entity.StartTimeMinutes;
        entity.StartTimeMinutes = Math.Clamp(earliest, 0, 1439);
    }

    private static int SumFor(WorkScheduleSetting entity, DayOfWeek day)
        => entity.Blocks.Where(x => x.DayOfWeek == (int)day).Sum(x => x.EndMinute - x.StartMinute);

    private static void Apply(WorkScheduleSetting entity, UpsertScheduleRequest request)
    {
        entity.Name = request.Name.Trim();
        entity.MondayMinutes = request.MondayMinutes;
        entity.TuesdayMinutes = request.TuesdayMinutes;
        entity.WednesdayMinutes = request.WednesdayMinutes;
        entity.ThursdayMinutes = request.ThursdayMinutes;
        entity.FridayMinutes = request.FridayMinutes;
        entity.SaturdayMinutes = request.SaturdayMinutes;
        entity.SundayMinutes = request.SundayMinutes;
        entity.BreakMinutes = request.BreakMinutes;
        entity.StartTimeMinutes = request.StartTimeMinutes;
        entity.LateToleranceMinutes = request.LateToleranceMinutes;
        entity.EarlyLeaveToleranceMinutes = request.EarlyLeaveToleranceMinutes;
        entity.OvertimeMultiplier = request.OvertimeMultiplier;
        entity.CountHolidaysAsWorkDay = request.CountHolidaysAsWorkDay;
        entity.IsDefault = request.IsDefault;
        entity.IsActive = request.IsActive;
    }

    /// <summary>Varsayılan tanım tek olmalı; yenisi işaretlendiğinde diğerleri düşer.</summary>
    private async Task EnforceSingleDefaultAsync(WorkScheduleSetting entity, CancellationToken cancellationToken)
    {
        if (!entity.IsDefault) return;

        await _dbContext.WorkScheduleSettings
            .Where(x => x.Id != entity.Id && x.IsDefault)
            .ExecuteUpdateAsync(s => s.SetProperty(x => x.IsDefault, false), cancellationToken);
    }

    // ---------------------------------------------------------------------
    // Resmî tatiller
    // ---------------------------------------------------------------------

    public sealed class UpsertHolidayRequest
    {
        [Required]
        public DateTime Date { get; set; }

        [Required]
        [StringLength(150)]
        public string Name { get; set; } = string.Empty;

        public bool IsHalfDay { get; set; }

        public bool IsRecurringYearly { get; set; }
    }

    [HttpGet("holidays")]
    public async Task<IActionResult> ListHolidays([FromQuery] int? year, CancellationToken cancellationToken = default)
    {
        var targetYear = year is >= 2000 and <= 2100
            ? year.Value
            : TurkeyTime.ToLocal(DateTime.UtcNow).Year;

        var map = await _calendar.GetHolidayMapAsync(
            new DateOnly(targetYear, 1, 1),
            new DateOnly(targetYear, 12, 31),
            cancellationToken);

        var data = map
            .OrderBy(x => x.Key)
            .Select(x => new
            {
                id = x.Value.Id,
                date = TurkeyTime.Ymd(x.Key),
                name = x.Value.Name,
                isHalfDay = x.Value.IsHalfDay,
                isRecurringYearly = x.Value.IsRecurringYearly
            })
            .ToList();

        return Ok(new { success = true, data });
    }

    [HttpPost("holidays")]
    public async Task<IActionResult> CreateHoliday([FromBody] UpsertHolidayRequest request, CancellationToken cancellationToken)
    {
        if (!ModelState.IsValid) return ValidationProblem(ModelState);

        var date = DateOnly.FromDateTime(request.Date);

        var exists = await _dbContext.Holidays.AnyAsync(x => x.Date == date, cancellationToken);
        if (exists) return Conflict(new { success = false, message = "Bu tarihte zaten bir tatil kaydı var" });

        var entity = new Holiday
        {
            Date = date,
            Name = request.Name.Trim(),
            IsHalfDay = request.IsHalfDay,
            IsRecurringYearly = request.IsRecurringYearly,
            CreateUser = GetUsername(),
            CreateTime = DateTime.UtcNow
        };

        _dbContext.Holidays.Add(entity);
        await _dbContext.SaveChangesAsync(cancellationToken);

        return StatusCode(StatusCodes.Status201Created, new { success = true, data = new { id = entity.Id } });
    }

    [HttpPut("holidays/{id:int}")]
    public async Task<IActionResult> UpdateHoliday([FromRoute] int id, [FromBody] UpsertHolidayRequest request, CancellationToken cancellationToken)
    {
        if (!ModelState.IsValid) return ValidationProblem(ModelState);

        var entity = await _dbContext.Holidays.FirstOrDefaultAsync(x => x.Id == id, cancellationToken);
        if (entity is null) return NotFound(new { success = false, message = "Tatil kaydı bulunamadı" });

        var date = DateOnly.FromDateTime(request.Date);

        var clash = await _dbContext.Holidays.AnyAsync(x => x.Id != id && x.Date == date, cancellationToken);
        if (clash) return Conflict(new { success = false, message = "Bu tarihte zaten bir tatil kaydı var" });

        entity.Date = date;
        entity.Name = request.Name.Trim();
        entity.IsHalfDay = request.IsHalfDay;
        entity.IsRecurringYearly = request.IsRecurringYearly;
        entity.EditUser = GetUsername();
        entity.EditTime = DateTime.UtcNow;

        await _dbContext.SaveChangesAsync(cancellationToken);
        return Ok(new { success = true });
    }

    [HttpDelete("holidays/{id:int}")]
    public async Task<IActionResult> DeleteHoliday([FromRoute] int id, CancellationToken cancellationToken)
    {
        var entity = await _dbContext.Holidays.FirstOrDefaultAsync(x => x.Id == id, cancellationToken);
        if (entity is null) return NotFound(new { success = false, message = "Tatil kaydı bulunamadı" });

        _dbContext.Holidays.Remove(entity);
        await _dbContext.SaveChangesAsync(cancellationToken);
        return Ok(new { success = true });
    }

    /// <summary>
    /// Sabit tarihli resmî tatilleri tek tuşla ekler. Dinî bayramlar her yıl kaydığı için
    /// buraya dâhil edilmez; onlar yıl yıl elle girilir.
    /// </summary>
    [HttpPost("holidays/seed-official")]
    public async Task<IActionResult> SeedOfficialHolidays(CancellationToken cancellationToken)
    {
        var fixedHolidays = new (int Month, int Day, string Name, bool HalfDay)[]
        {
            (1, 1, "Yılbaşı", false),
            (4, 23, "Ulusal Egemenlik ve Çocuk Bayramı", false),
            (5, 1, "Emek ve Dayanışma Günü", false),
            (5, 19, "Atatürk'ü Anma, Gençlik ve Spor Bayramı", false),
            (7, 15, "Demokrasi ve Millî Birlik Günü", false),
            (8, 30, "Zafer Bayramı", false),
            (10, 28, "Cumhuriyet Bayramı Arifesi", true),
            (10, 29, "Cumhuriyet Bayramı", false)
        };

        var existing = await _dbContext.Holidays
            .AsNoTracking()
            .Where(x => x.IsRecurringYearly)
            .Select(x => new { x.Date.Month, x.Date.Day })
            .ToListAsync(cancellationToken);

        var existingSet = existing.Select(x => (x.Month, x.Day)).ToHashSet();

        var year = TurkeyTime.ToLocal(DateTime.UtcNow).Year;
        var now = DateTime.UtcNow;
        var username = GetUsername();
        var added = 0;

        foreach (var (month, day, name, halfDay) in fixedHolidays)
        {
            if (existingSet.Contains((month, day))) continue;

            var date = new DateOnly(year, month, day);
            if (await _dbContext.Holidays.AnyAsync(x => x.Date == date, cancellationToken)) continue;

            _dbContext.Holidays.Add(new Holiday
            {
                Date = date,
                Name = name,
                IsHalfDay = halfDay,
                IsRecurringYearly = true,
                CreateUser = username,
                CreateTime = now
            });

            added++;
        }

        if (added > 0) await _dbContext.SaveChangesAsync(cancellationToken);

        return Ok(new { success = true, added });
    }

    // ---------------------------------------------------------------------
    // Takvim önizleme
    // ---------------------------------------------------------------------

    /// <summary>Bir dönemin gün gün takvimi — iş günü sayısı ve tatiller.</summary>
    [HttpGet("preview")]
    public async Task<IActionResult> Preview(
        [FromQuery] string? period,
        [FromQuery] int? scheduleId,
        CancellationToken cancellationToken = default)
    {
        var (year, month) = TurkeyTime.ParsePeriod(period);
        var first = new DateOnly(year, month, 1);
        var last = first.AddMonths(1).AddDays(-1);

        var schedule = await _calendar.GetScheduleAsync(scheduleId, cancellationToken);
        var days = await _calendar.BuildAsync(first, last, schedule, cancellationToken);

        return Ok(new
        {
            success = true,
            data = new
            {
                period = $"{year:D4}-{month:D2}",
                scheduleName = schedule.Name,
                workDayCount = days.Count(x => x.IsWorkDay),
                expectedMinutes = days.Sum(x => x.ExpectedMinutes),
                holidayCount = days.Count(x => x.IsHoliday),
                weightedMinutes = days.Sum(x => x.Blocks.Sum(b => b.DurationMinutes * b.PayMultiplier)),
                days = days.Select(x => new
                {
                    date = TurkeyTime.Ymd(x.Date),
                    expectedMinutes = x.ExpectedMinutes,
                    isWorkDay = x.IsWorkDay,
                    isHoliday = x.IsHoliday,
                    isHalfDayHoliday = x.IsHalfDayHoliday,
                    holidayName = x.HolidayName,
                    blocks = x.Blocks.Select(b => new
                    {
                        startMinute = b.StartMinute,
                        endMinute = b.EndMinute,
                        payMultiplier = b.PayMultiplier,
                        label = b.Label
                    })
                })
            }
        });
    }
}
