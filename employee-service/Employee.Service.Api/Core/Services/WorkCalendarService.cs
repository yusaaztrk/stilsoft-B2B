using B2B.Erp.Api.Core.Time;
using B2B.Erp.Api.Data;
using B2B.Erp.Api.Entities;
using Microsoft.EntityFrameworkCore;

namespace B2B.Erp.Api.Core.Services;

/// <summary>Bir güne düşen mesai bloğu (tatil etkisi uygulanmış hâliyle).</summary>
public sealed class WorkCalendarBlock
{
    public int StartMinute { get; init; }

    public int EndMinute { get; init; }

    public decimal PayMultiplier { get; init; } = 1.00m;

    public string? Label { get; init; }

    public int DurationMinutes => Math.Max(0, EndMinute - StartMinute);
}

/// <summary>Bir güne ait takvim bilgisi.</summary>
public sealed class WorkCalendarDay
{
    public DateOnly Date { get; init; }

    /// <summary>O gün için geçerli mesai blokları.</summary>
    public List<WorkCalendarBlock> Blocks { get; init; } = new();

    /// <summary>Mesai tanımına ve tatil takvimine göre o gün beklenen çalışma dakikası.</summary>
    public int ExpectedMinutes => Blocks.Sum(x => x.DurationMinutes);

    /// <summary>Mesai tanımında o gün çalışma var mı (tatil etkisi hariç)?</summary>
    public bool IsScheduledWorkDay { get; init; }

    public bool IsHoliday { get; init; }

    public bool IsHalfDayHoliday { get; init; }

    public string? HolidayName { get; init; }

    /// <summary>Fiilen iş günü sayılıyor mu?</summary>
    public bool IsWorkDay => ExpectedMinutes > 0;

    /// <summary>Gün içindeki ilk mesai başlangıcı; geç kalma buna göre ölçülür.</summary>
    public int? FirstStartMinute => Blocks.Count == 0 ? null : Blocks.Min(x => x.StartMinute);
}

/// <summary>
/// İş günü takvimi. Mesai tanımının bloklarını (<see cref="WorkShiftBlock"/>) resmî tatil
/// takvimiyle birleştirip gün gün beklenen mesaiyi üretir. Puantaj, hakediş ve izin gün
/// sayımı tek bir yerden bu servisi kullanır.
/// </summary>
public sealed class WorkCalendarService
{
    private readonly AppDbContext _dbContext;

    public WorkCalendarService(AppDbContext dbContext)
    {
        _dbContext = dbContext;
    }

    /// <summary>
    /// Personelin bağlı olduğu mesai tanımını bloklarıyla getirir. Personelde tanım yoksa
    /// varsayılan, varsayılan da yoksa ilk aktif tanım, hiç kayıt yoksa bellekte üretilen
    /// Pzt–Cum 09:00–18:00 tanımı kullanılır.
    /// </summary>
    public async Task<WorkScheduleSetting> GetScheduleAsync(int? workScheduleSettingId, CancellationToken cancellationToken)
    {
        WorkScheduleSetting? schedule = null;

        if (workScheduleSettingId is > 0)
        {
            schedule = await _dbContext.WorkScheduleSettings
                .AsNoTracking()
                .Include(x => x.Blocks)
                .FirstOrDefaultAsync(x => x.Id == workScheduleSettingId.Value, cancellationToken);
        }

        schedule ??= await _dbContext.WorkScheduleSettings
            .AsNoTracking()
            .Include(x => x.Blocks)
            .Where(x => x.IsActive)
            .OrderByDescending(x => x.IsDefault)
            .ThenBy(x => x.Id)
            .FirstOrDefaultAsync(cancellationToken);

        schedule ??= new WorkScheduleSetting { Id = 0, Name = "Varsayılan Mesai", IsDefault = true };

        EnsureBlocks(schedule);
        return schedule;
    }

    /// <summary>
    /// Blok tanımı olmayan (eski düzenden kalan) kayıtlar için günlük sürelerden bellekte blok
    /// üretir: mesai başlangıcından itibaren tek blok. Böylece eski tanımlar bozulmadan yeni
    /// hesaba dâhil olur; kullanıcı tanımı ekrandan kaydettiğinde gerçek bloklar yazılır.
    ///
    /// <para>Hakediş hesabı DIŞINDA mesai tanımını listeleyen uçlar da bunu çağırmak zorunda:
    /// çağırmazsa ekran blok tanımı olmayan kaydın bütün günlerini "tatil" gösterir, oysa
    /// hakediş aynı kayıt için Pzt–Cum çalışıyor sayar.</para>
    /// </summary>
    public static void EnsureBlocks(WorkScheduleSetting schedule)
    {
        if (schedule.Blocks.Count > 0) return;

        foreach (var day in Enum.GetValues<DayOfWeek>())
        {
            var minutes = schedule.LegacyMinutesFor(day);
            if (minutes <= 0) continue;

            schedule.Blocks.Add(new WorkShiftBlock
            {
                WorkScheduleSettingId = schedule.Id,
                DayOfWeek = (int)day,
                StartMinute = schedule.StartTimeMinutes,
                EndMinute = schedule.StartTimeMinutes + minutes,
                PayMultiplier = 1.00m,
                Label = null
            });
        }
    }

    /// <summary>
    /// Aralıktaki tatilleri getirir. Her yıl tekrar eden sabit tatiller (<c>IsRecurringYearly</c>)
    /// kayıtlı oldukları yıldan bağımsız olarak aralıktaki her yıla uygulanır.
    /// </summary>
    public async Task<Dictionary<DateOnly, Holiday>> GetHolidayMapAsync(DateOnly from, DateOnly to, CancellationToken cancellationToken)
    {
        var all = await _dbContext.Holidays.AsNoTracking().ToListAsync(cancellationToken);

        var map = new Dictionary<DateOnly, Holiday>();

        foreach (var h in all)
        {
            if (h.IsRecurringYearly)
            {
                for (var year = from.Year; year <= to.Year; year++)
                {
                    if (h.Date.Month == 2 && h.Date.Day == 29 && !DateTime.IsLeapYear(year)) continue;

                    var projected = new DateOnly(year, h.Date.Month, h.Date.Day);
                    if (projected >= from && projected <= to) map[projected] = h;
                }
            }
            else if (h.Date >= from && h.Date <= to)
            {
                map[h.Date] = h;
            }
        }

        return map;
    }

    /// <summary>Aralığı gün gün takvime çevirir (uç günler dâhil).</summary>
    public async Task<List<WorkCalendarDay>> BuildAsync(
        DateOnly from,
        DateOnly to,
        WorkScheduleSetting schedule,
        CancellationToken cancellationToken)
    {
        if (to < from) (from, to) = (to, from);

        var holidays = await GetHolidayMapAsync(from, to, cancellationToken);
        return Build(from, to, schedule, holidays);
    }

    /// <summary>Tatil haritası önceden yüklenmişse tekrar sorgu atmayan sürüm.</summary>
    public static List<WorkCalendarDay> Build(
        DateOnly from,
        DateOnly to,
        WorkScheduleSetting schedule,
        IReadOnlyDictionary<DateOnly, Holiday> holidays)
    {
        var days = new List<WorkCalendarDay>();

        for (var d = from; d <= to; d = d.AddDays(1))
        {
            var scheduled = schedule.BlocksFor(d.DayOfWeek).ToList();
            holidays.TryGetValue(d, out var holiday);

            var effective = new List<WorkCalendarBlock>();

            if (holiday is null || schedule.CountHolidaysAsWorkDay)
            {
                effective.AddRange(scheduled.Select(ToCalendarBlock));
            }
            else if (holiday.IsHalfDay)
            {
                // Arife: her blok yarıya iner, başlangıç saati korunur.
                effective.AddRange(scheduled.Select(b => new WorkCalendarBlock
                {
                    StartMinute = b.StartMinute,
                    EndMinute = b.StartMinute + b.DurationMinutes / 2,
                    PayMultiplier = b.PayMultiplier,
                    Label = b.Label
                }));
            }
            // Tam gün tatilde blok kalmaz.

            days.Add(new WorkCalendarDay
            {
                Date = d,
                Blocks = effective.Where(x => x.DurationMinutes > 0).ToList(),
                IsScheduledWorkDay = scheduled.Sum(x => x.DurationMinutes) > 0,
                IsHoliday = holiday is not null,
                IsHalfDayHoliday = holiday?.IsHalfDay ?? false,
                HolidayName = holiday?.Name
            });
        }

        return days;
    }

    private static WorkCalendarBlock ToCalendarBlock(WorkShiftBlock b) => new()
    {
        StartMinute = b.StartMinute,
        EndMinute = b.EndMinute,
        PayMultiplier = b.PayMultiplier,
        Label = b.Label
    };

    /// <summary>
    /// İzin gün sayısı. Hafta tatili ve resmî tatiller izinden düşülmez — yıllık izin
    /// bakiyesi iş günü üzerinden takip edilir. Yarım gün tatil 0,5 gün sayılır.
    /// </summary>
    public async Task<decimal> CalculateLeaveDaysAsync(
        DateTime startUtc,
        DateTime endUtc,
        WorkScheduleSetting schedule,
        CancellationToken cancellationToken)
    {
        var from = TurkeyTime.LocalDate(startUtc);
        var to = TurkeyTime.LocalDate(endUtc);

        if (to < from) return 0m;

        // Aynı gün içindeki izinler (saatlik veya 1 günlük izin)
        if (from == to)
        {
            var singleCalendar = await BuildAsync(from, from, schedule, cancellationToken);
            var singleDay = singleCalendar.FirstOrDefault();
            if (singleDay is null || singleDay.ExpectedMinutes <= 0)
            {
                return 0m;
            }

            var totalMinutes = (decimal)(endUtc - startUtc).TotalMinutes;
            if (totalMinutes <= 0) return 0m;

            // 6 saat ve üzeri veya mesai süresinin tamamı ise 1 tam gün
            if (totalMinutes >= singleDay.ExpectedMinutes || totalMinutes >= 360)
            {
                return 1m;
            }
            // 3 saat ve üzeri ise yarım gün
            if (totalMinutes >= 180)
            {
                return 0.5m;
            }

            // Kısa izinlerde oransal (en az 0.5 gün)
            return Math.Round(Math.Max(0.5m, totalMinutes / singleDay.ExpectedMinutes), 1);
        }

        // Farklı günleri kapsayan izinler
        var endLocal = TurkeyTime.ToLocal(endUtc);
        // Dönüş saati öğleden önce (12:00 ve öncesi) ise dönüş günü işbaşı sayılır (o gün izne dahil edilmez).
        // Dönüş saati öğleden sonra/akşam ise dönüş günü de izne dahildir.
        var inclusiveTo = endLocal.TimeOfDay <= new TimeSpan(12, 0, 0)
            ? to.AddDays(-1)
            : to;

        if (inclusiveTo < from) inclusiveTo = from;

        var calendar = await BuildAsync(from, inclusiveTo, schedule, cancellationToken);

        decimal total = 0m;
        foreach (var day in calendar)
        {
            if (day.ExpectedMinutes <= 0) continue;

            // Gun kendi TANIMLI suresinin tamamini kapsiyorsa TAM GUN sayilir; yarim gun
            // yalnizca gunun kendi suresi kisaldiginda (yarim gunluk resmi tatil) olusur.
            //
            // Cumartesi 7 saat tanimli oldugu icin hafta ici 9 saatle kiyaslanip "yarim gun"
            // sayilmaz - kullanici karari (2026-08-19): CUMARTESI TAM GUN. Kiyas gunun kendi
            // tanimiyla yapilir, baska bir gunle degil.
            var full = schedule.MinutesFor(day.Date.DayOfWeek);
            total += full > 0 && day.ExpectedMinutes < full ? 0.5m : 1m;
        }

        return total;
    }
}

