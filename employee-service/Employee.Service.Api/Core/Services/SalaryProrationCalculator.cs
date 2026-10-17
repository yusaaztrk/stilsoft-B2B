using B2B.Erp.Api.Core.Time;
using B2B.Erp.Api.Entities;

namespace B2B.Erp.Api.Core.Services;

/// <summary>
/// Maaş hakedişinin DAKİKA bazlı kıst hesabı.
///
/// <para><b>Model:</b> aylık maaş, dönemin toplam beklenen çalışma dakikasına bölünür ve dakika
/// ücreti bulunur; hakediş geçen dakikayla ilerler. Gün sayısına bölmek yanlıştı — günlerin
/// süresi eşit değil (Cumartesi 7 saat, hafta içi 9 saat), gün bazlı oran kısa günü tam gün
/// gibi sayıyordu.</para>
///
/// <para><b>Pencere maaş gününe göredir.</b> Maaş günü ayın 4'ü olan personelin ağustos dönemi
/// 4 Ağustos – 3 Eylül'dür. Ödemenin 1-2 gün sonra yapılması dönemi değiştirmez: her ayın maaşı
/// kendi dönemine yazılır.</para>
///
/// <para><b>Gelecek dönem 0'dır.</b> Henüz geçmemiş dakikanın hakedişi doğmaz.</para>
///
/// <para>Bu yalnızca <b>öneri</b> üretir — giriş/çıkış kaydı olmayan personel için "dönemin bu
/// ana kadar geçen kısmı". Mesai kaydı varsa <see cref="EmployeeAccrualService"/>'in fiilen
/// çalışılan dakikayı blok katsayılarıyla değerleyen hesabı, aya özel manuel düzenleme varsa
/// o tutar önceliklidir.</para>
/// </summary>
public static class SalaryProrationCalculator
{
    public sealed record Result(
        decimal Amount,
        /// <summary>Dönemde bugüne kadar geçen beklenen çalışma dakikası.</summary>
        int ElapsedMinutes,
        /// <summary>Dönemin toplam beklenen çalışma dakikası.</summary>
        int TotalMinutes,
        decimal MinuteWage,
        int EarnedDays,
        int TotalWorkDays,
        DateOnly PeriodStart,
        DateOnly PeriodEnd);

    /// <summary>
    /// Dönemin maaş günü bazlı penceresi: <paramref name="salaryDay"/>'inden bir sonraki maaş
    /// gününün bir gün öncesine kadar. Ayın gün sayısını aşan maaş günü ayın son gününe çekilir
    /// (31'i maaş günü olan personel şubatta 28/29'unda alır).
    /// </summary>
    public static (DateOnly Start, DateOnly End) ResolveWindow(string period, int salaryDay)
    {
        var range = TurkeyTime.MonthRange(period);
        var monthStart = range.FirstDay;

        var day = Math.Min(Math.Max(1, salaryDay), DateTime.DaysInMonth(monthStart.Year, monthStart.Month));
        var start = new DateOnly(monthStart.Year, monthStart.Month, day);

        var nextMonth = monthStart.AddMonths(1);
        var nextDay = Math.Min(Math.Max(1, salaryDay), DateTime.DaysInMonth(nextMonth.Year, nextMonth.Month));
        var end = new DateOnly(nextMonth.Year, nextMonth.Month, nextDay).AddDays(-1);

        return (start, end);
    }

    /// <summary>
    /// <paramref name="calendar"/> pencerenin tamamını kapsayan mesai takvimidir
    /// (<see cref="WorkCalendarService.BuildAsync"/>).
    /// Hakediş = <c>aylık maaş × (geçen beklenen dakika / dönemin toplam beklenen dakikası)</c>.
    /// </summary>
    public static Result Calculate(
        decimal monthlySalary,
        string period,
        int salaryDay,
        DateTime? hireDate,
        IReadOnlyList<WorkCalendarDay> calendar,
        DateTime utcNow)
    {
        var (start, end) = ResolveWindow(period, salaryDay);

        // İşe giriş dönemin içindeyse hakediş o günden başlar.
        var effectiveStart = start;
        if (hireDate.HasValue)
        {
            var hire = TurkeyTime.LocalDate(hireDate.Value);
            if (hire > effectiveStart) effectiveStart = hire;
        }

        var today = TurkeyTime.LocalDate(utcNow);

        var totalMinutes = 0;
        var elapsedMinutes = 0;
        var totalWorkDays = 0;
        var earnedDays = 0;

        foreach (var day in calendar)
        {
            if (day.Date < effectiveStart || day.Date > end) continue;
            if (day.ExpectedMinutes <= 0) continue;

            totalMinutes += day.ExpectedMinutes;
            totalWorkDays++;

            if (day.Date <= today)
            {
                elapsedMinutes += day.ExpectedMinutes;
                earnedDays++;
            }
        }

        var minuteWage = totalMinutes > 0
            ? Math.Round(monthlySalary / totalMinutes, 6, MidpointRounding.AwayFromZero)
            : 0m;

        if (monthlySalary <= 0m || totalMinutes == 0 || elapsedMinutes == 0)
        {
            return new Result(0m, 0, totalMinutes, minuteWage, 0, totalWorkDays, start, end);
        }

        // Dönem kapandıysa tam maaş: dakika yuvarlamasından kuruş sapması olmasın.
        var amount = elapsedMinutes >= totalMinutes
            ? monthlySalary
            : monthlySalary * elapsedMinutes / totalMinutes;

        return new Result(
            decimal.Round(amount, 2, MidpointRounding.AwayFromZero),
            elapsedMinutes,
            totalMinutes,
            minuteWage,
            earnedDays,
            totalWorkDays,
            start,
            end);
    }
}
