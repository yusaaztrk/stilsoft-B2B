using B2B.Erp.Api.Data;
using B2B.Erp.Api.Entities;
using Microsoft.EntityFrameworkCore;

namespace B2B.Erp.Api.Core.Services;

/// <summary>
/// Bir personelin maaş DÖNEMİ bazında kalan borcu: hakediş − maaştan düşülecek avans − ödenen maaş.
///
/// <para><b>Neden var (2026-10-16):</b> maaş ödemesinin hangi döneme yazılacağı ödeme TARİHİNDEN
/// türetiliyordu. Ağustos maaşı 3 Eylül'de "Maaş Yatır" ile ya da cari ekstreden ödenince kayıt
/// Eylül'e düşüyor; Ağustos sonsuza kadar "Gecikti" kalıyor, Eylül peşin ödenmiş görünüyordu.
/// Dönem belirtilmeyen maaş ödemesi artık bu sınıfla <b>en eski açık döneme</b> yazılır.</para>
///
/// <para><b>Hakediş kaynağı:</b> tanımlanmış hakediş (<see cref="EmployeeSalaryAccrual"/>), yoksa
/// aya özel düzenleme. İkisi de yoksa dönem "bilinmiyor" sayılır — ne açık dönem olur ne de
/// fazla ödeme kapısı uygulanır (maaş ekranı bu durumda kullanıcıyı zaten uyarıyor).</para>
/// </summary>
public static class SalaryPeriodBalance
{
    public sealed record Row(string Period, decimal Gross, decimal Advances, decimal Paid)
    {
        public decimal Net => Math.Max(0m, Gross - Advances);
        public decimal Remaining => Math.Max(0m, Net - Paid);
    }

    /// <summary>Personellerin hakedişi BİLİNEN dönemleri (tanımlı ya da aya özel düzenlemeli).</summary>
    public static async Task<Dictionary<int, List<Row>>> LoadAsync(
        AppDbContext db,
        IReadOnlyCollection<int> employeeIds,
        CancellationToken cancellationToken)
    {
        var ids = employeeIds.Where(x => x > 0).Distinct().ToList();
        var result = ids.ToDictionary(x => x, _ => new List<Row>());
        if (ids.Count == 0) return result;

        var defined = await db.EmployeeSalaryAccruals
            .AsNoTracking()
            .Where(x => ids.Contains(x.EmployeeId))
            .Select(x => new { x.EmployeeId, x.Period, x.Amount })
            .ToListAsync(cancellationToken);

        var overrides = await db.EmployeeMonthlyOverrides
            .AsNoTracking()
            .Where(x => ids.Contains(x.EmployeeId) && x.OverrideType == MonthlyOverrideType.Salary)
            .Select(x => new { x.EmployeeId, x.Period, x.OverrideAmount })
            .ToListAsync(cancellationToken);

        var payments = await db.EmployeePayments
            .AsNoTracking()
            .Where(x => ids.Contains(x.EmployeeId) && !x.IsCancelled)
            .Where(x => x.Type == EmployeePaymentType.Salary
                        || (x.Type == EmployeePaymentType.CashAdvance && x.DeductFromSalary))
            .Select(x => new { x.EmployeeId, x.Type, x.Amount, x.SalaryPeriod, x.PaymentDate })
            .ToListAsync(cancellationToken);

        foreach (var id in ids)
        {
            // Tanimli hakedis once gelir: maas ekrani ve cari ekstre ayni tutari okur.
            var gross = new Dictionary<string, decimal>();
            foreach (var o in overrides.Where(x => x.EmployeeId == id)) gross[o.Period] = o.OverrideAmount;
            foreach (var d in defined.Where(x => x.EmployeeId == id)) gross[d.Period] = d.Amount;

            foreach (var (period, amount) in gross.OrderBy(x => x.Key, StringComparer.Ordinal))
            {
                var (y, m) = Time.TurkeyTime.ParsePeriod(period);
                var startUtc = Time.TurkeyTime.StartOfDayUtc(new DateOnly(y, m, 1));
                var endUtc = Time.TurkeyTime.StartOfDayUtc(new DateOnly(y, m, 1).AddMonths(1));

                var mine = payments.Where(x => x.EmployeeId == id).ToList();
                var advances = mine
                    .Where(x => x.Type == EmployeePaymentType.CashAdvance)
                    .Where(x => x.SalaryPeriod == period
                                || (x.SalaryPeriod == null && x.PaymentDate >= startUtc && x.PaymentDate < endUtc))
                    .Sum(x => x.Amount);
                var paid = mine
                    .Where(x => x.Type == EmployeePaymentType.Salary && x.SalaryPeriod == period)
                    .Sum(x => x.Amount);

                result[id].Add(new Row(period, amount, advances, paid));
            }
        }

        return result;
    }

    /// <summary>Tek personelin tek dönemdeki kalanı; hakediş bilinmiyorsa null.</summary>
    public static async Task<Row?> GetAsync(AppDbContext db, int employeeId, string period, CancellationToken cancellationToken)
    {
        var rows = await LoadAsync(db, new[] { employeeId }, cancellationToken);
        return rows[employeeId].FirstOrDefault(x => x.Period == period);
    }

    /// <summary>
    /// Dönemi belirtilmemiş bir maaş ödemesini dönemlere dağıtır: en eski açık dönemden başlar,
    /// ödeme ayından sonraki dönemlere dokunmaz. Açık dönemleri aşan kısım ödeme ayına yazılır
    /// (kullanıcı bilerek fazla ödüyor — kayıt kaybolmasın).
    /// </summary>
    public static List<(string Period, decimal Amount)> Allocate(
        IEnumerable<Row> rows,
        decimal amount,
        string paymentPeriod)
    {
        var parts = new List<(string Period, decimal Amount)>();
        var left = Math.Round(amount, 2, MidpointRounding.AwayFromZero);

        foreach (var row in rows
                     .Where(x => string.CompareOrdinal(x.Period, paymentPeriod) <= 0 && x.Remaining > 0.004m)
                     .OrderBy(x => x.Period, StringComparer.Ordinal))
        {
            if (left <= 0m) break;
            var take = Math.Min(left, row.Remaining);
            parts.Add((row.Period, take));
            left -= take;
        }

        if (left > 0m)
        {
            var idx = parts.FindIndex(x => x.Period == paymentPeriod);
            if (idx >= 0) parts[idx] = (paymentPeriod, parts[idx].Amount + left);
            else parts.Add((paymentPeriod, left));
        }

        return parts;
    }
}
