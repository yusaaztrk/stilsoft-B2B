using B2B.Erp.Api.Core.Time;
using B2B.Erp.Api.Data;
using B2B.Erp.Api.Entities;
using Microsoft.EntityFrameworkCore;

namespace B2B.Erp.Api.Core.Services;

/// <summary>Bir personelin bir dönemdeki (yyyy-MM) puantaj ve hakediş özeti.</summary>
public sealed class EmployeeAccrual
{
    public int EmployeeId { get; set; }
    public string EmployeeCode { get; set; } = string.Empty;
    public string EmployeeName { get; set; } = string.Empty;
    public string Period { get; set; } = string.Empty;
    public string ScheduleName { get; set; } = string.Empty;

    // --- Takvim ---
    public int ExpectedWorkDays { get; set; }
    public int ExpectedMinutes { get; set; }
    public int HolidayCount { get; set; }

    // --- Fiili durum ---
    public int AttendedDays { get; set; }

    /// <summary>
    /// Yemek hakedişinin gün karşılığı: her iş günü için o günün doluluk oranı (0..1) toplanır.
    /// Tam doldurulan gün 1, yarım gün 0,5 sayılır; fazla mesai yemeği artırmaz.
    /// </summary>
    public decimal MealDayFactor { get; set; }
    public int WorkedMinutes { get; set; }

    /// <summary>Plan içinde (bir mesai bloğuna denk gelen) çalışılan dakika.</summary>
    public int PlannedWorkedMinutes { get; set; }

    /// <summary>
    /// Plan dışı çalışılan dakikadan aynı günün EKSİĞİNİ kapatan kısım (geç gelip geç çıkma,
    /// erken gelip erken çıkma). Temel ücretle ödenir; fazla mesai sayılmaz, kesinti de doğmaz.
    /// </summary>
    public int CompensatedMinutes { get; set; }

    /// <summary>Hiçbir bloğa denk gelmeyen ve günün eksiğini kapattıktan sonra artan dakika (fazla mesai).</summary>
    public int OvertimeMinutes { get; set; }

    public int MissingMinutes { get; set; }
    public int LateDays { get; set; }
    public int OpenCheckInCount { get; set; }

    // --- İzin / devamsızlık ---
    public decimal PaidLeaveDays { get; set; }
    public decimal UnpaidLeaveDays { get; set; }
    public decimal AbsentDays { get; set; }

    // --- Para ---
    public decimal MonthlySalary { get; set; }

    /// <summary>
    /// Dönemin BUGÜNE KADAR geçen kısmının maaşı. Ay bitmişse aylık maaşın tamamı; ay sürüyorsa
    /// geçen mesai dakikası oranında (bugünün henüz gelmemiş saatleri dahil değil). Devamsızlık
    /// kesintisi bunun üzerinden ölçülür.
    /// </summary>
    public decimal ElapsedSalary { get; set; }
    public decimal DailyWage { get; set; }
    public decimal HourlyWage { get; set; }

    /// <summary>Dakika başına temel ücret. Bütün hesap bunun üzerinden yürür.</summary>
    public decimal MinuteWage { get; set; }

    public decimal AbsenceDeduction { get; set; }

    /// <summary>Blok katsayılarından doğan ek ödeme (gece/hafta sonu zamlı dilimler).</summary>
    public decimal ShiftPremium { get; set; }

    public decimal OvertimePay { get; set; }
    public decimal MealAccrual { get; set; }
    public decimal GrossAccrual { get; set; }
    public decimal DeductibleAdvances { get; set; }
    public decimal AlreadyPaid { get; set; }
    public decimal NetPayable { get; set; }

    // --- Yıllık izin ---
    public int SeniorityYears { get; set; }
    public int AnnualLeaveEntitlementDays { get; set; }
    public decimal AnnualLeaveUsedDays { get; set; }
    public decimal AnnualLeaveRemainingDays { get; set; }

    // --- Snapshot & Override Bilgileri ---
    public DateTime? LastCalculatedAt { get; set; }
    public string? LastCalculatedDate { get; set; }
    public bool HasSalaryOverride { get; set; }
    public decimal? SalaryOverrideAmount { get; set; }
    public string? SalaryOverrideDescription { get; set; }
    public bool HasMealOverride { get; set; }
    public decimal? MealOverrideAmount { get; set; }
    public string? MealOverrideDescription { get; set; }

    public List<EmployeeAccrualDay> Days { get; set; } = new();
}


/// <summary>Hakediş dökümünün gün satırı.</summary>
public sealed class EmployeeAccrualDay
{
    public string Date { get; set; } = string.Empty;
    public int ExpectedMinutes { get; set; }
    public int WorkedMinutes { get; set; }
    public int PlannedWorkedMinutes { get; set; }
    public int CompensatedMinutes { get; set; }
    public int OvertimeMinutes { get; set; }
    public decimal DayPay { get; set; }
    public bool IsHoliday { get; set; }
    public string? HolidayName { get; set; }
    public bool IsLeave { get; set; }
    public bool IsPaidLeave { get; set; }

    /// <summary>O gün izinle kapsanan mesai dakikası (çalışılan kısım düşülmüş).</summary>
    public int LeaveMinutes { get; set; }

    /// <summary>İzin aralığındaki günde personel işe gelmiş (izinden erken dönmüş / kısmi izin).</summary>
    public bool WorkedDuringLeave { get; set; }
    public bool IsLate { get; set; }
    public bool IsAbsent { get; set; }
    public bool HasOpenCheckIn { get; set; }

    /// <summary>Gün içindeki blok bazlı döküm.</summary>
    public List<EmployeeAccrualDayBlock> Blocks { get; set; } = new();
}

/// <summary>Gün içindeki tek bir mesai bloğunun sonucu.</summary>
public sealed class EmployeeAccrualDayBlock
{
    public string Label { get; set; } = string.Empty;
    public string Start { get; set; } = string.Empty;
    public string End { get; set; } = string.Empty;
    public decimal PayMultiplier { get; set; }
    public int ExpectedMinutes { get; set; }
    public int WorkedMinutes { get; set; }
}

/// <summary>
/// Puantaj ve hakediş hesabı.
///
/// <para>Hesap DAKİKA bazlıdır ve mesai bloklarıyla çakıştırma üzerinden yürür: çalışılan
/// aralık hangi bloğa denk geliyorsa o bloğun ücret katsayısıyla değerlenir, hiçbir bloğa
/// denk gelmeyen kısım fazla mesai sayılır. Önceki sürüm günü tek bir "beklenen süre" olarak
/// görüyordu; gece dilimine ayrı ücret vermek ya da öğle arasıyla bölünmüş mesaiyi ifade
/// etmek mümkün değildi.</para>
///
/// <para>Gün sınırları Türkiye saatine göre belirlenir (<see cref="TurkeyTime"/>); UTC gününe
/// göre gruplamak gece vardiyasında kayıtları bir önceki güne yazıyordu.</para>
/// </summary>
public sealed class EmployeeAccrualService
{
    private readonly AppDbContext _dbContext;
    private readonly WorkCalendarService _calendar;

    public EmployeeAccrualService(AppDbContext dbContext, WorkCalendarService calendar)
    {
        _dbContext = dbContext;
        _calendar = calendar;
    }

    /// <summary>
    /// 4857 sayılı İş Kanunu md. 53: 1-5 yıl 14 gün, 5-15 yıl 20 gün, 15 yıl ve üzeri 26 gün.
    /// 1 yılını doldurmayan personelin yıllık izin hakkı doğmaz.
    /// 18 yaş altı ve 50 yaş üstü için taban 20 gündür; bu istisna otomatik uygulanmaz,
    /// gerekirse personel kartındaki elle giriş alanı kullanılır.
    /// </summary>
    public static int LegalAnnualLeaveDays(int seniorityYears) => seniorityYears switch
    {
        < 5 => 14,
        < 15 => 20,
        _ => 26
    };

    public static int SeniorityYearsAt(DateTime? hireDate, DateOnly asOf)
    {
        if (!hireDate.HasValue) return 0;

        var start = TurkeyTime.LocalDate(hireDate.Value);
        if (start > asOf) return 0;

        var years = asOf.Year - start.Year;
        if (asOf < start.AddYears(years)) years--;
        return Math.Max(0, years);
    }

    public async Task<List<EmployeeAccrual>> CalculateAsync(
        string period,
        IReadOnlyCollection<int>? employeeIds,
        bool includeDays,
        CancellationToken cancellationToken)
    {
        var (year, month) = TurkeyTime.ParsePeriod(period);
        var periodKey = $"{year:D4}-{month:D2}";
        var firstDay = new DateOnly(year, month, 1);
        var lastDay = firstDay.AddMonths(1).AddDays(-1);

        var rangeStartUtc = TurkeyTime.StartOfDayUtc(firstDay);
        var rangeEndUtc = TurkeyTime.EndOfDayUtc(lastDay);

        var employeeQuery = _dbContext.Employees.AsNoTracking().AsQueryable();
        if (employeeIds is { Count: > 0 })
        {
            employeeQuery = employeeQuery.Where(x => employeeIds.Contains(x.Id));
        }
        else
        {
            employeeQuery = employeeQuery.Where(x => x.IsActive);
        }

        var employees = await employeeQuery
            .OrderBy(x => x.FirstName)
            .ThenBy(x => x.LastName)
            .ToListAsync(cancellationToken);

        if (employees.Count == 0) return new List<EmployeeAccrual>();

        var ids = employees.Select(x => x.Id).ToList();

        // Gece vardiyası bir önceki günden başlayabildiği için aralık bir gün geriden taranır.
        var scanStartUtc = rangeStartUtc.AddDays(-1);

        var checkIns = await _dbContext.EmployeeCheckIns
            .AsNoTracking()
            .Where(x => ids.Contains(x.EmployeeId))
            .Where(x => x.CheckInTime >= scanStartUtc && x.CheckInTime < rangeEndUtc)
            .Select(x => new { x.EmployeeId, x.CheckInTime, x.CheckOutTime })
            .ToListAsync(cancellationToken);

        var leaves = await _dbContext.EmployeeLeaves
            .AsNoTracking()
            .Where(x => ids.Contains(x.EmployeeId))
            .Where(x => x.Status == EmployeeLeaveStatus.Approved)
            .Where(x => x.LeaveStartTime < rangeEndUtc && x.ReturnTime >= rangeStartUtc)
            .Select(x => new { x.EmployeeId, x.LeaveStartTime, x.ReturnTime, x.LeaveType, x.IsPaid })
            .ToListAsync(cancellationToken);

        var yearStartUtc = TurkeyTime.StartOfDayUtc(new DateOnly(year, 1, 1));
        var yearEndUtc = TurkeyTime.EndOfDayUtc(new DateOnly(year, 12, 31));

        var annualLeaves = await _dbContext.EmployeeLeaves
            .AsNoTracking()
            .Where(x => ids.Contains(x.EmployeeId))
            .Where(x => x.Status == EmployeeLeaveStatus.Approved)
            .Where(x => x.LeaveType == EmployeeLeaveType.Annual)
            .Where(x => x.LeaveStartTime < yearEndUtc && x.ReturnTime >= yearStartUtc)
            .Select(x => new { x.EmployeeId, x.DayCount })
            .ToListAsync(cancellationToken);

        var annualUsedByEmployee = annualLeaves
            .GroupBy(x => x.EmployeeId)
            .ToDictionary(g => g.Key, g => g.Sum(x => x.DayCount));

        var payments = await _dbContext.EmployeePayments
            .AsNoTracking()
            .Where(x => ids.Contains(x.EmployeeId))
            .Where(x => !x.IsCancelled)
            .Where(x => x.SalaryPeriod == periodKey
                        || (x.SalaryPeriod == null && x.PaymentDate >= rangeStartUtc && x.PaymentDate < rangeEndUtc))
            .Select(x => new { x.EmployeeId, x.Type, x.Amount, x.DeductFromSalary })
            .ToListAsync(cancellationToken);

        var overrides = await _dbContext.EmployeeMonthlyOverrides
            .AsNoTracking()
            .Where(x => ids.Contains(x.EmployeeId) && x.Period == periodKey)
            .ToListAsync(cancellationToken);

        // Gun bazli duzeltmeler: personel -> gun -> duzeltme. Tarih metin olarak saklanir
        // (yerel gun), motorun gun anahtariyla eslesmesi icin DateOnly'ye cevrilir.
        var firstDayKey = TurkeyTime.Ymd(firstDay);
        var lastDayKey = TurkeyTime.Ymd(lastDay);

        var dailyOverrideRows = await _dbContext.EmployeeDailyAccrualOverrides
            .AsNoTracking()
            .Where(x => ids.Contains(x.EmployeeId) && x.Kind == DailyOverrideKind.Salary)
            .Where(x => string.Compare(x.Date, firstDayKey) >= 0 && string.Compare(x.Date, lastDayKey) <= 0)
            .ToListAsync(cancellationToken);

        var dailyOverrideMap = dailyOverrideRows
            .GroupBy(x => x.EmployeeId)
            .ToDictionary(
                g => g.Key,
                g => (IReadOnlyDictionary<DateOnly, EmployeeDailyAccrualOverride>)g
                    .Where(x => DateOnly.TryParse(x.Date, out _))
                    .GroupBy(x => DateOnly.Parse(x.Date))
                    .ToDictionary(k => k.Key, v => v.First()));

        var holidays = await _calendar.GetHolidayMapAsync(firstDay, lastDay, cancellationToken);

        var scheduleCache = new Dictionary<int, WorkScheduleSetting>();
        var results = new List<EmployeeAccrual>(employees.Count);

        foreach (var emp in employees)
        {
            var scheduleKey = emp.WorkScheduleSettingId ?? 0;
            if (!scheduleCache.TryGetValue(scheduleKey, out var schedule))
            {
                schedule = await _calendar.GetScheduleAsync(emp.WorkScheduleSettingId, cancellationToken);
                scheduleCache[scheduleKey] = schedule;
            }

            var empSalaryOverride = overrides.FirstOrDefault(x => x.EmployeeId == emp.Id && x.OverrideType == MonthlyOverrideType.Salary);
            var empMealOverride = overrides.FirstOrDefault(x => x.EmployeeId == emp.Id && x.OverrideType == MonthlyOverrideType.Meal);

            results.Add(BuildAccrual(
                emp,
                schedule,
                periodKey,
                firstDay,
                lastDay,
                holidays,
                checkIns.Where(x => x.EmployeeId == emp.Id).Select(x => (x.CheckInTime, x.CheckOutTime)).ToList(),
                leaves.Where(x => x.EmployeeId == emp.Id)
                      .Select(x => (x.LeaveStartTime, x.ReturnTime, x.LeaveType, x.IsPaid)).ToList(),
                payments.Where(x => x.EmployeeId == emp.Id)
                        .Select(x => (x.Type, x.Amount, x.DeductFromSalary)).ToList(),
                annualUsedByEmployee.TryGetValue(emp.Id, out var used) ? used : 0m,
                includeDays,
                empSalaryOverride,
                empMealOverride,
                dailyOverrideMap.TryGetValue(emp.Id, out var empDaily) ? empDaily : null));
        }

        return results;
    }

    public async Task<List<EmployeeAccrual>> CalculateWithSnapshotsAsync(
        string period,
        IReadOnlyCollection<int>? employeeIds,
        bool forceRefresh,
        CancellationToken cancellationToken)
    {
        var (year, month) = TurkeyTime.ParsePeriod(period);
        var periodKey = $"{year:D4}-{month:D2}";
        var nowUtc = DateTime.UtcNow;
        var todayLocal = DateOnly.FromDateTime(TurkeyTime.ToLocal(nowUtc));

        var employeeQuery = _dbContext.Employees.AsNoTracking().AsQueryable();
        if (employeeIds is { Count: > 0 })
        {
            employeeQuery = employeeQuery.Where(x => employeeIds.Contains(x.Id));
        }
        else
        {
            employeeQuery = employeeQuery.Where(x => x.IsActive);
        }

        var employees = await employeeQuery
            .OrderBy(x => x.FirstName)
            .ThenBy(x => x.LastName)
            .ToListAsync(cancellationToken);

        if (employees.Count == 0) return new List<EmployeeAccrual>();
        var ids = employees.Select(x => x.Id).ToList();

        /*
          HAKEDİŞ HER ZAMAN CANLI HESAPLANIR (2026-10-04 kullanıcı bildirimi: "maaşı güncelliyorum
          ama aylık hakedişe yansımıyor").

          Liste önce kayıtlı anlık görüntüden (snapshot) dönüyordu ve görüntü yalnızca "Yenile"
          düğmesiyle tazeleniyordu. Maaş, mesai, izin, ödeme ya da aya özel düzenleme değişince
          görüntü GEÇERSİZ olmuyordu; ekran eski maaşla hesaplanmış rakamı göstermeye devam
          ediyordu. Hesap birkaç toplu sorgudan ibaret ve hızlı; artık her istekte canlı yapılır,
          görüntü yalnızca "son hesaplama zamanı" kaydı olarak yazılır. `forceRefresh` geriye
          dönük uyumluluk için duruyor, etkisi yok.
        */
        _ = forceRefresh;

        // Live calculation and snapshot upsert
        var liveAccruals = await CalculateAsync(period, ids, includeDays: false, cancellationToken);

        var existingDbSnapshots = await _dbContext.EmployeeAccrualSnapshots
            .Where(x => ids.Contains(x.EmployeeId) && x.Period == periodKey)
            .ToListAsync(cancellationToken);

        var dbMap = existingDbSnapshots.ToDictionary(x => x.EmployeeId);

        foreach (var acc in liveAccruals)
        {
            acc.LastCalculatedAt = nowUtc;
            acc.LastCalculatedDate = TurkeyTime.Ymd(todayLocal);

            if (dbMap.TryGetValue(acc.EmployeeId, out var snap))
            {
                snap.LastCalculatedDate = acc.LastCalculatedDate;
                snap.LastCalculatedAt = nowUtc;
                snap.MonthlySalary = acc.MonthlySalary;
                snap.DailyWage = acc.DailyWage;
                snap.GrossAccrual = acc.GrossAccrual;
                snap.MealAccrual = acc.MealAccrual;
                snap.AttendedDays = acc.AttendedDays;
                snap.WorkedMinutes = acc.WorkedMinutes;
                snap.MissingMinutes = acc.MissingMinutes;
                snap.OvertimeMinutes = acc.OvertimeMinutes;
                snap.AbsenceDeduction = acc.AbsenceDeduction;
                snap.OvertimePay = acc.OvertimePay;
                snap.ShiftPremium = acc.ShiftPremium;
                snap.DeductibleAdvances = acc.DeductibleAdvances;
                snap.AlreadyPaid = acc.AlreadyPaid;
                snap.NetPayable = acc.NetPayable;
                snap.IsLive = true;
                snap.EditTime = nowUtc;
            }
            else
            {
                _dbContext.EmployeeAccrualSnapshots.Add(new EmployeeAccrualSnapshot
                {
                    EmployeeId = acc.EmployeeId,
                    Period = periodKey,
                    LastCalculatedDate = acc.LastCalculatedDate,
                    LastCalculatedAt = nowUtc,
                    MonthlySalary = acc.MonthlySalary,
                    DailyWage = acc.DailyWage,
                    GrossAccrual = acc.GrossAccrual,
                    MealAccrual = acc.MealAccrual,
                    AttendedDays = acc.AttendedDays,
                    WorkedMinutes = acc.WorkedMinutes,
                    MissingMinutes = acc.MissingMinutes,
                    OvertimeMinutes = acc.OvertimeMinutes,
                    AbsenceDeduction = acc.AbsenceDeduction,
                    OvertimePay = acc.OvertimePay,
                    ShiftPremium = acc.ShiftPremium,
                    DeductibleAdvances = acc.DeductibleAdvances,
                    AlreadyPaid = acc.AlreadyPaid,
                    NetPayable = acc.NetPayable,
                    IsLive = true,
                    CreateTime = nowUtc
                });
            }
        }

        await _dbContext.SaveChangesAsync(cancellationToken);
        return liveAccruals;
    }


    /// <summary>Çalışılan bir aralık: gün başından itibaren dakika cinsinden.</summary>
    private readonly record struct WorkedInterval(int Start, int End)
    {
        public int Duration => Math.Max(0, End - Start);
    }

    /// <summary>İki aralığın kesişim süresi.</summary>
    private static int Overlap(int aStart, int aEnd, int bStart, int bEnd)
        => Math.Max(0, Math.Min(aEnd, bEnd) - Math.Max(aStart, bStart));

    /// <summary>
    /// Çalışılan aralığın bir mesai bloğuyla kesişimi — GİRİŞ ve ÇIKIŞ toleransı uygulanmış hâli.
    ///
    /// <para>Tolerans bir süre yalnızca "geç geldi" etiketinde kullanılıyordu; hesap ham
    /// saatlerle yapıldığı için 15 dk toleransa rağmen 09:12'de giren personelin hakedişinden
    /// 12 dakika kesiliyordu. Tolerans artık dakika hesabına da girer.</para>
    ///
    /// <para>Yalnızca GEÇ girişi ve ERKEN çıkışı affeder; erken gelmek veya geç çıkmak buradan
    /// fazladan dakika kazandırmaz — o kısım zaten fazla mesai olarak değerlenir. Aralık bloğa
    /// hiç değmiyorsa tolerans onu bloğun içine ÇEKMEZ: sınırlar yalnızca blokla çakışan aralık
    /// için kaydırılır.</para>
    /// </summary>
    private static int OverlapWithTolerance(
        int aStart,
        int aEnd,
        int bStart,
        int bEnd,
        int entryToleranceMinutes,
        int exitToleranceMinutes)
    {
        // Once ham kesisim: hic degmiyorsa tolerans uygulanmaz.
        if (Overlap(aStart, aEnd, bStart, bEnd) <= 0) return 0;

        var start = aStart;
        var end = aEnd;

        // Gec giris toleransi: blok basindan sonra ama tolerans icindeyse blok basina cekilir.
        if (entryToleranceMinutes > 0 && start > bStart && start <= bStart + entryToleranceMinutes)
        {
            start = bStart;
        }

        // Erken cikis toleransi: blok bitisinden once ama tolerans icindeyse blok sonuna uzatilir.
        if (exitToleranceMinutes > 0 && end < bEnd && end >= bEnd - exitToleranceMinutes)
        {
            end = bEnd;
        }

        return Overlap(start, end, bStart, bEnd);
    }

    private static string Clock(int minute)
    {
        var normalized = ((minute % 1440) + 1440) % 1440;
        return $"{normalized / 60:D2}:{normalized % 60:D2}";
    }

    private static EmployeeAccrual BuildAccrual(
        Employee emp,
        WorkScheduleSetting schedule,
        string periodKey,
        DateOnly firstDay,
        DateOnly lastDay,
        IReadOnlyDictionary<DateOnly, Holiday> holidays,
        List<(DateTime CheckIn, DateTime? CheckOut)> checkIns,
        List<(DateTime Start, DateTime End, EmployeeLeaveType Type, bool IsPaid)> leaves,
        List<(EmployeePaymentType Type, decimal Amount, bool DeductFromSalary)> payments,
        decimal annualUsedDays,
        bool includeDays,
        EmployeeMonthlyOverride? salaryOverride = null,
        EmployeeMonthlyOverride? mealOverride = null,
        IReadOnlyDictionary<DateOnly, EmployeeDailyAccrualOverride>? dailyOverrides = null)
    {
        var calendar = WorkCalendarService.Build(firstDay, lastDay, schedule, holidays);

        /*
          İŞE GİRİŞ / ÇIKIŞ TARİHİ (2026-10-04 uçtan uca testte bulundu).

          Ay ortasında işe başlayan personelin işe girmeden ÖNCEKİ günleri "devamsız" sayılıyor ve
          o günlerin maaşı kesinti olarak yazılıyordu; ayrılan personelde de ayrılış sonrası günler
          için aynısı. Bu günler artık beklenmez: ne devamsızlık ne kesinti doğar. Dakika ücreti
          AYIN TAMAMI üzerinden kalır — kıst ay, çalışılan günlerin ücretiyle ödenir.
        */
        var employedFrom = emp.HireDate.HasValue ? TurkeyTime.LocalDate(emp.HireDate.Value) : (DateOnly?)null;
        var employedTo = emp.TerminationDate.HasValue ? TurkeyTime.LocalDate(emp.TerminationDate.Value) : (DateOnly?)null;
        bool IsEmployed(DateOnly d) => (employedFrom is null || d >= employedFrom) && (employedTo is null || d <= employedTo);

        // Mesai kayıtlarını yerel güne göre, dakika aralığı olarak topla.
        // Aralık, girişin yapıldığı günün 00:00'ına göre ölçülür; gece yarısını aşan vardiya
        // 1440'ı geçen bitiş değeriyle ifade edilir ve blok tanımıyla doğal olarak çakışır.
        var intervalsByDay = new Dictionary<DateOnly, List<WorkedInterval>>();
        var firstInByDay = new Dictionary<DateOnly, int>();
        var openByDay = new HashSet<DateOnly>();

        foreach (var (checkIn, checkOut) in checkIns)
        {
            var day = TurkeyTime.LocalDate(checkIn);
            var localIn = TurkeyTime.ToLocal(checkIn);
            var startMinute = localIn.Hour * 60 + localIn.Minute;

            if (!firstInByDay.TryGetValue(day, out var existing) || startMinute < existing)
            {
                firstInByDay[day] = startMinute;
            }

            if (checkOut.HasValue)
            {
                var duration = (int)Math.Round((checkOut.Value - checkIn).TotalMinutes, MidpointRounding.AwayFromZero);
                if (duration > 0)
                {
                    if (!intervalsByDay.TryGetValue(day, out var list))
                    {
                        list = new List<WorkedInterval>();
                        intervalsByDay[day] = list;
                    }

                    list.Add(new WorkedInterval(startMinute, startMinute + duration));
                }
            }
            else
            {
                openByDay.Add(day);
            }
        }

        // İZİNLER DAKİKA ARALIĞI OLARAK TUTULUR (2026-10-04).
        //
        // Eskiden izin gün gün işaretleniyordu: başlangıç gününden dönüş gününün BİR ÖNCESİNE kadar.
        // Üç sonucu vardı: (1) aynı gün içindeki saatlik / yarım gün izin HİÇ görünmüyordu (başlangıç
        // ve dönüş aynı gün → aralık boş); (2) öğleden sonra dönüşte dönüş günü bakiyede izin, hakedişte
        // iş günü sayılıyordu; (3) izinli günde işe gelen personel yine "izinli" görünüyor, ücretli
        // izinde o gün hem izin hem çalışma ücreti alıyordu. Artık her gün için izin aralığının mesai
        // bloklarıyla kesişen dakikası ölçülür; çalışılan dakika izinden ÖNCE gelir.
        var leaveRanges = leaves
            .Select(l => (Start: TurkeyTime.ToLocal(l.Start), End: TurkeyTime.ToLocal(l.End), l.IsPaid))
            .Where(l => l.End > l.Start)
            .ToList();

        var effectiveSalary = salaryOverride != null ? salaryOverride.OverrideAmount : emp.Salary;

        var accrual = new EmployeeAccrual
        {
            EmployeeId = emp.Id,
            EmployeeCode = emp.EmployeeCode,
            EmployeeName = $"{emp.FirstName} {emp.LastName}".Trim(),
            Period = periodKey,
            ScheduleName = schedule.Name,
            MonthlySalary = effectiveSalary,
            HasSalaryOverride = salaryOverride != null,
            SalaryOverrideAmount = salaryOverride?.OverrideAmount,
            SalaryOverrideDescription = salaryOverride?.Description,
            HasMealOverride = mealOverride != null,
            MealOverrideAmount = mealOverride?.OverrideAmount,
            MealOverrideDescription = mealOverride?.Description
        };

        // Dönemin beklenen dakikası önce hesaplanır; dakika ücreti buna bölünerek bulunur.
        foreach (var day in calendar)
        {
            if (day.ExpectedMinutes > 0)
            {
                accrual.ExpectedWorkDays++;
                accrual.ExpectedMinutes += day.ExpectedMinutes;
            }

            if (day.IsHoliday) accrual.HolidayCount++;
        }

        accrual.MinuteWage = accrual.ExpectedMinutes > 0
            ? Math.Round(accrual.MonthlySalary / accrual.ExpectedMinutes, 6, MidpointRounding.AwayFromZero)
            : 0m;

        accrual.DailyWage = accrual.ExpectedWorkDays > 0
            ? Math.Round(accrual.MonthlySalary / accrual.ExpectedWorkDays, 2, MidpointRounding.AwayFromZero)
            : 0m;

        accrual.HourlyWage = Math.Round(accrual.MinuteWage * 60m, 2, MidpointRounding.AwayFromZero);

        var nowLocal = TurkeyTime.ToLocal(DateTime.UtcNow);
        var todayLocal = DateOnly.FromDateTime(nowLocal);
        var nowMinute = nowLocal.Hour * 60 + nowLocal.Minute;

        decimal plannedPay = 0m;
        decimal plannedBasePay = 0m;
        decimal overtimePay = 0m;

        // Dönem sürerken kesinti hesabı yalnızca GEÇMİŞ dakikalara bakmalı.
        var elapsedExpectedMinutes = 0;

        foreach (var day in calendar)
        {
            var intervals = intervalsByDay.TryGetValue(day.Date, out var list) ? list : new List<WorkedInterval>();
            var hasOpen = openByDay.Contains(day.Date);

            /*
              BUGÜN YARIM SAYILIR (2026-10-04, "fazla mesai yapıyor ama maaştan düşüyor").

              Bugünün beklenen dakikasının TAMAMI geçmiş sayılıyordu: öğlen ekrana bakıldığında mesaisi
              henüz bitmemiş herkes günün kalan saatleri kadar "eksik" görünüyor, kesinti yazılıyordu.
              Bugün için yalnızca ŞU ANA kadar geçen blok dakikası beklenir; gün bitmeden devamsızlık
              da yazılmaz.
            */
            var isToday = day.Date == todayLocal;
            var isFuture = day.Date > todayLocal;
            var employed = IsEmployed(day.Date);
            var expectedSoFar = isFuture || !employed
                ? 0
                : isToday
                    ? day.Blocks.Sum(bl => Overlap(bl.StartMinute, bl.EndMinute, 0, nowMinute))
                    : day.ExpectedMinutes;
            var dayFinished = !isFuture && (!isToday || day.Blocks.Count == 0 || nowMinute >= day.Blocks.Max(bl => bl.EndMinute));

            elapsedExpectedMinutes += expectedSoFar;

            // GUNLUK DUZELTME: o gunun dakikasi elle verildiyse motorun buldugu yerine o gecer.
            // Unutulan cikis, yarim gun izin ya da o gune ozel anlasma boyle duzeltilir.
            EmployeeDailyAccrualOverride? dayOverride = null;
            dailyOverrides?.TryGetValue(day.Date, out dayOverride);

            var workedTotal = dayOverride?.OverrideMinutes ?? intervals.Sum(x => x.Duration);
            accrual.WorkedMinutes += workedTotal;

            if (workedTotal > 0 || hasOpen) accrual.AttendedDays++;
            if (hasOpen) accrual.OpenCheckInCount++;

            // Blok blok çakıştırma: her bloğun içinde geçen dakika kendi katsayısıyla değerlenir.
            var dayBlocks = new List<EmployeeAccrualDayBlock>();
            var plannedMinutesToday = 0;
            decimal dayPay = 0m;

            foreach (var block in day.Blocks)
            {
                // Dakika elle verildiyse cakistirilacak aralik yok; duzeltilmis dakika
                // bloklara siga siga dagitilir (once ilk blok dolar).
                var inBlock = dayOverride?.OverrideMinutes is int fixedMinutes
                    ? Math.Max(0, Math.Min(block.DurationMinutes, fixedMinutes - plannedMinutesToday))
                    : intervals.Sum(iv => OverlapWithTolerance(
                        iv.Start, iv.End, block.StartMinute, block.EndMinute,
                        schedule.LateToleranceMinutes, schedule.EarlyLeaveToleranceMinutes));
                // Ayni bloga denk gelen ust uste girisler (cift kayit) blogu tasiramaz.
                inBlock = Math.Min(inBlock, block.DurationMinutes);
                plannedMinutesToday += inBlock;

                var basePay = inBlock * accrual.MinuteWage;
                plannedBasePay += basePay;
                plannedPay += basePay * block.PayMultiplier;
                dayPay += basePay * block.PayMultiplier;

                if (includeDays)
                {
                    dayBlocks.Add(new EmployeeAccrualDayBlock
                    {
                        Label = string.IsNullOrWhiteSpace(block.Label) ? $"{Clock(block.StartMinute)}–{Clock(block.EndMinute)}" : block.Label!,
                        Start = Clock(block.StartMinute),
                        End = Clock(block.EndMinute),
                        PayMultiplier = block.PayMultiplier,
                        ExpectedMinutes = block.DurationMinutes,
                        WorkedMinutes = inBlock
                    });
                }
            }

            // Gunun TL degeri elle verildiyse dakika hesabinin onune gecer.
            if (dayOverride?.OverrideAmount is decimal fixedAmount)
            {
                plannedPay += fixedAmount - dayPay;
                dayPay = fixedAmount;
            }

            accrual.PlannedWorkedMinutes += plannedMinutesToday;

            // --- İZİN: günün mesai bloklarıyla kesişen izin dakikası ---
            var dayStartLocal = day.Date.ToDateTime(TimeOnly.MinValue);
            var paidLeaveCovered = 0;
            var unpaidLeaveCovered = 0;
            foreach (var lr in leaveRanges)
            {
                var ls = (int)Math.Floor((lr.Start - dayStartLocal).TotalMinutes);
                var le = (int)Math.Ceiling((lr.End - dayStartLocal).TotalMinutes);
                if (le <= 0 || ls >= 2880) continue;
                var covered = day.Blocks.Sum(bl => Overlap(bl.StartMinute, bl.EndMinute, ls, le));
                if (covered <= 0) continue;
                if (lr.IsPaid) paidLeaveCovered += covered; else unpaidLeaveCovered += covered;
            }
            var leaveCovered = Math.Min(day.ExpectedMinutes, paidLeaveCovered + unpaidLeaveCovered);

            /*
              EKSİK SAATİ MESAİ DIŞI ÇALIŞMA KAPATIR (2026-10-04 kullanıcı bildirimi: "fazla mesai
              yapıyor, maaştan düşüyor").

              Plan dışı (bloğa denk gelmeyen) her dakika doğrudan fazla mesai sayılıyordu; aynı gün
              bloğun içindeki eksik ise ayrıca maaştan kesiliyordu. Geç gelip geç çıkan personel tam
              gün çalıştığı hâlde her gün kesinti + fazla mesai alıyordu. Artık plan dışı dakika önce
              O GÜNÜN eksiğini (izinle kapanmayan kısmını) temel ücretle kapatır; yalnızca artan kısım
              fazla mesaidir.
            */
            var outsideMinutes = Math.Max(0, workedTotal - plannedMinutesToday);
            var expectedWorkSoFar = Math.Max(0, expectedSoFar - Math.Min(leaveCovered, expectedSoFar));
            var compensatedToday = Math.Min(outsideMinutes, Math.Max(0, expectedWorkSoFar - plannedMinutesToday));
            if (compensatedToday > 0)
            {
                var compensatePay = compensatedToday * accrual.MinuteWage;
                plannedBasePay += compensatePay;
                plannedPay += compensatePay;
                dayPay += compensatePay;
                accrual.CompensatedMinutes += compensatedToday;
            }

            var workedInPlan = plannedMinutesToday + compensatedToday;

            // İzin, çalışılan dakikanın KAPATMADIĞI kısım kadar geçerlidir: izinliyken işe gelen
            // personelin geldiği süre izin değil çalışmadır (erken dönüş / kısmi izin).
            var leaveMinutesToday = Math.Max(0, Math.Min(leaveCovered, day.ExpectedMinutes - workedInPlan));
            var paidLeaveMinutes = leaveCovered > 0
                ? (int)Math.Round((decimal)leaveMinutesToday * paidLeaveCovered / (paidLeaveCovered + unpaidLeaveCovered), MidpointRounding.AwayFromZero)
                : 0;
            var unpaidLeaveMinutes = leaveMinutesToday - paidLeaveMinutes;
            var workedDuringLeave = leaveCovered > 0 && (workedTotal > 0 || hasOpen);

            if (day.ExpectedMinutes > 0)
            {
                if (paidLeaveMinutes > 0)
                {
                    accrual.PaidLeaveDays += Math.Round((decimal)paidLeaveMinutes / day.ExpectedMinutes, 2, MidpointRounding.AwayFromZero);
                    // Ücretli izin çalışılmış gibi ödenir (katsayısız, temel ücretten).
                    var leavePay = paidLeaveMinutes * accrual.MinuteWage;
                    plannedBasePay += leavePay;
                    plannedPay += leavePay;
                    dayPay += leavePay;
                }
                if (unpaidLeaveMinutes > 0)
                {
                    accrual.UnpaidLeaveDays += Math.Round((decimal)unpaidLeaveMinutes / day.ExpectedMinutes, 2, MidpointRounding.AwayFromZero);
                }
            }

            // YEMEK GUN BAZLIDIR: gunu tam dolduran tam yemek alir, yarim gun yarim alir.
            // Fazla mesai yemegi ARTIRMAZ, bu yuzden oran 1'i asamaz. Dakika bazinda
            // oranlamak, gunleri farkli uzunlukta olan takvimde (cumartesi 7 saat) kisa
            // gunun yemegini haksiz yere kirpiyordu. Eksigi kapatan mesai disi calisma gunu
            // doldurmus sayilir.
            if (day.ExpectedMinutes > 0)
            {
                var fill = (decimal)workedInPlan / day.ExpectedMinutes;
                accrual.MealDayFactor += Math.Min(1m, Math.Max(0m, fill));
            }

            // Fazla mesai = plan dışı çalışmadan günün eksiğini kapattıktan sonra artan kısım.
            var overtimeToday = outsideMinutes - compensatedToday;
            accrual.OvertimeMinutes += overtimeToday;

            var overtimeTodayPay = overtimeToday * accrual.MinuteWage * schedule.OvertimeMultiplier;
            overtimePay += overtimeTodayPay;
            dayPay += overtimeTodayPay;

            // Eksik dakika: gelinen (ya da kısmi izinli) günde ne çalışmayla ne izinle kapanan süre.
            if (expectedSoFar > 0 && (workedInPlan > 0 || leaveCovered > 0))
            {
                accrual.MissingMinutes += Math.Max(0, expectedSoFar - workedInPlan - Math.Min(leaveCovered, expectedSoFar));
            }

            // Geç kalma: o gün izni olan (ör. sabah yarım gün izinli) geç gelmiş sayılmaz.
            var isLate = false;
            if (leaveCovered == 0 && day.FirstStartMinute.HasValue && firstInByDay.TryGetValue(day.Date, out var firstIn))
            {
                isLate = firstIn > day.FirstStartMinute.Value + schedule.LateToleranceMinutes;
                if (isLate) accrual.LateDays++;
            }

            // Devamsızlık: gün BİTMİŞ, hiç çalışılmamış, izinle de kapanmamış.
            var isAbsent = false;
            if (employed && day.ExpectedMinutes > 0 && dayFinished && workedTotal == 0 && !hasOpen && leaveCovered == 0)
            {
                isAbsent = true;
                accrual.AbsentDays += 1m;
            }

            if (includeDays)
            {
                accrual.Days.Add(new EmployeeAccrualDay
                {
                    Date = TurkeyTime.Ymd(day.Date),
                    ExpectedMinutes = day.ExpectedMinutes,
                    WorkedMinutes = workedTotal,
                    PlannedWorkedMinutes = plannedMinutesToday,
                    CompensatedMinutes = compensatedToday,
                    OvertimeMinutes = overtimeToday,
                    DayPay = Math.Round(dayPay, 2, MidpointRounding.AwayFromZero),
                    IsHoliday = day.IsHoliday,
                    HolidayName = day.HolidayName,
                    // Gün "izinli" yalnızca personel o gün HİÇ gelmediyse görünür.
                    IsLeave = leaveMinutesToday > 0 && workedTotal == 0 && !hasOpen,
                    IsPaidLeave = paidLeaveMinutes > 0 && workedTotal == 0 && !hasOpen,
                    LeaveMinutes = leaveMinutesToday,
                    WorkedDuringLeave = workedDuringLeave,
                    IsLate = isLate,
                    IsAbsent = isAbsent,
                    HasOpenCheckIn = hasOpen,
                    Blocks = dayBlocks
                });
            }
        }

        // --- Para hesabı ---
        accrual.ShiftPremium = Math.Round(plannedPay - plannedBasePay, 2, MidpointRounding.AwayFromZero);
        accrual.OvertimePay = Math.Round(overtimePay, 2, MidpointRounding.AwayFromZero);

        var earned = Math.Round(plannedPay + overtimePay, 2, MidpointRounding.AwayFromZero);

        var elapsedSalary = accrual.ExpectedMinutes > 0 && elapsedExpectedMinutes < accrual.ExpectedMinutes
            ? Math.Round(accrual.MonthlySalary * elapsedExpectedMinutes / accrual.ExpectedMinutes, 2, MidpointRounding.AwayFromZero)
            : accrual.MonthlySalary;
        accrual.ElapsedSalary = elapsedSalary;

        accrual.AbsenceDeduction = Math.Round(
            Math.Max(0m, elapsedSalary - plannedBasePay), 2, MidpointRounding.AwayFromZero);

        accrual.GrossAccrual = earned;

        // YEMEK: aylik tutar, GUN bazinda hak edilir.
        //
        // Gunluk yemek = aylik yemek / donemin is gunu sayisi. Gunu tam dolduran o gunun
        // yemegini tam alir; fazla mesai yemegi artirmaz (MealDayFactor 1'i asmaz).
        // Maastan farki: maas dakika bazli, yemek gun bazli — gun uzunlugu degisse de
        // (cumartesi 7 saat) o gunun yemegi tam sayilir.
        //
        // Personele yemek verilmiyorsa tutar dolu olsa bile hakedis 0'dir.
        if (!emp.HasMealAllowance)
        {
            accrual.MealAccrual = 0m;
        }
        else if (mealOverride != null)
        {
            accrual.MealAccrual = mealOverride.OverrideAmount;
        }
        else if (accrual.ExpectedWorkDays > 0)
        {
            var dailyMeal = emp.MealAmount / accrual.ExpectedWorkDays;
            accrual.MealAccrual = Math.Round(dailyMeal * accrual.MealDayFactor, 2, MidpointRounding.AwayFromZero);
        }
        else
        {
            accrual.MealAccrual = 0m;
        }

        accrual.DeductibleAdvances = payments
            .Where(p => p.Type == EmployeePaymentType.CashAdvance && p.DeductFromSalary)
            .Sum(p => p.Amount);

        accrual.AlreadyPaid = payments
            .Where(p => p.Type == EmployeePaymentType.Salary)
            .Sum(p => p.Amount);

        accrual.NetPayable = Math.Round(
            accrual.GrossAccrual - accrual.DeductibleAdvances - accrual.AlreadyPaid, 2, MidpointRounding.AwayFromZero);

        // --- Yıllık izin ---
        accrual.SeniorityYears = SeniorityYearsAt(emp.HireDate, lastDay);
        accrual.AnnualLeaveEntitlementDays = emp.AnnualLeaveOverrideDays ?? LegalAnnualLeaveDays(accrual.SeniorityYears);
        accrual.AnnualLeaveUsedDays = annualUsedDays;
        accrual.AnnualLeaveRemainingDays = accrual.AnnualLeaveEntitlementDays - annualUsedDays;

        return accrual;
    }
}

