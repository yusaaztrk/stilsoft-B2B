using B2B.Erp.Api.Data;
using B2B.Erp.Api.Entities;
using Microsoft.EntityFrameworkCore;

namespace B2B.Erp.Api.Core.Services;

/// <summary>
/// Avans mahsup damgası (<see cref="EmployeePayment.SalaryDeductedAt"/>).
///
/// <para>Bir dönemin maaşı ödendiğinde, o döneme ait "maaştan düşülecek" avanslar mahsup
/// edilmiş sayılır. Damganın tek işlevi kaydı korumaktır: mahsup edilmiş bir avans SİLİNEMEZ.
/// Silinebilseydi, maaş avans düşülerek net ödendiği hâlde avans borcu ekstreden kalkar ve
/// personel olduğundan alacaklı görünürdü.</para>
///
/// <para><b>Neden ayrı bir yardımcı:</b> damgayı bir süre yalnızca <c>bulk-salary</c> ucu
/// basıyordu. Ödeme akışı <c>bulk-cash-payout</c> / <c>single-payout</c> / tekil ödemeye
/// taşınınca damga hiç basılmaz oldu ve koruma sessizce devre dışı kaldı. Yeni bir maaş ödeme
/// yolu eklerken <see cref="MarkDeductedAsync"/>, geri alma yolu eklerken
/// <see cref="UnmarkAsync"/> çağrılmalıdır.</para>
/// </summary>
public static class AdvanceSettlement
{
    /// <summary>
    /// <paramref name="period"/> dönemine ait, maaştan düşülecek ve henüz mahsup edilmemiş
    /// avansları mahsup edilmiş olarak damgalar. Dönemi olmayan eski kayıtlar için ödeme
    /// tarihinin ayına bakılır — dönem alanı sonradan eklendi.
    /// </summary>
    public static async Task<int> MarkDeductedAsync(
        AppDbContext dbContext,
        IEnumerable<int> employeeIds,
        string period,
        DateTime nowUtc,
        CancellationToken cancellationToken)
    {
        var ids = employeeIds.Where(x => x > 0).Distinct().ToList();
        if (ids.Count == 0 || string.IsNullOrWhiteSpace(period)) return 0;

        var (year, month) = Time.TurkeyTime.ParsePeriod(period);
        var periodStart = Time.TurkeyTime.StartOfDayUtc(new DateOnly(year, month, 1));
        var periodEnd = Time.TurkeyTime.StartOfDayUtc(new DateOnly(year, month, 1).AddMonths(1));

        var advances = await dbContext.Set<EmployeePayment>()
            .Where(x => x.Type == EmployeePaymentType.CashAdvance)
            .Where(x => x.DeductFromSalary && x.SalaryDeductedAt == null && !x.IsCancelled)
            .Where(x => ids.Contains(x.EmployeeId))
            .Where(x => x.SalaryPeriod == period
                        || (x.SalaryPeriod == null && x.PaymentDate >= periodStart && x.PaymentDate < periodEnd))
            .ToListAsync(cancellationToken);

        foreach (var a in advances)
        {
            a.SalaryDeductedAt = nowUtc;
        }

        return advances.Count;
    }

    /// <summary>
    /// Maaş ödemesi geri alındığında mahsup damgasını kaldırır. Kalmasaydı avans kalıcı olarak
    /// silinemez hâle gelir ve düzeltme yapılamazdı.
    /// </summary>
    public static async Task<int> UnmarkAsync(
        AppDbContext dbContext,
        int employeeId,
        string? period,
        CancellationToken cancellationToken,
        int? removedSalaryPaymentId = null)
    {
        if (employeeId <= 0 || string.IsNullOrWhiteSpace(period)) return 0;

        // Aynı dönemin BAŞKA bir maaş ödemesi duruyorsa (kısmi ödemeler) avans o ödemeyle mahsup
        // edilmiş sayılmaya devam eder; damga kaldırılırsa avans silinebilir hâle gelir ve
        // personel net maaşını aldığı hâlde avans borcu kaybolurdu (2026-10-04).
        var otherSalaryExists = await dbContext.Set<EmployeePayment>()
            .AnyAsync(x => x.Type == EmployeePaymentType.Salary
                           && x.EmployeeId == employeeId
                           && x.SalaryPeriod == period
                           && (removedSalaryPaymentId == null || x.Id != removedSalaryPaymentId), cancellationToken);
        if (otherSalaryExists) return 0;

        var advances = await dbContext.Set<EmployeePayment>()
            .Where(x => x.Type == EmployeePaymentType.CashAdvance)
            .Where(x => x.EmployeeId == employeeId && x.SalaryPeriod == period && x.SalaryDeductedAt != null)
            .ToListAsync(cancellationToken);

        foreach (var a in advances)
        {
            a.SalaryDeductedAt = null;
        }

        return advances.Count;
    }
}
