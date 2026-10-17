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
/// Personel cari ekstresi.
///
/// <para>Mantik ticari cari hesabin aynisi:
/// <b>Alacak</b> = personelin firmadan alacagi (aylik maas hakedisi, planlanan prim, planlanan
/// yemek). <b>Borc</b> = personele odenen her sey (maas, prim, yemek, avans).
/// <b>Bakiye</b> = alacak - borc; pozitifse firma personele borclu.</para>
///
/// <para>Yemek tarafinda ciftlemeye dikkat: hakedis raporundaki <c>MealAccrual</c>
/// (gunluk yemek bedeli x gelinen gun) ile <c>EmployeeMealPlans</c> ayni seyin iki farkli
/// yolu. Ekstre yalniz PLANLARI alacak yazar; <c>MealAccrual</c> hesaba katilmaz, yoksa
/// ayni yemek iki kez alacaklandirilirdi. Ayni sebeple maas tarafinda yalniz
/// <c>GrossAccrual</c> kullanilir.</para>
/// </summary>
[ApiController]
[Route("api/[controller]")]
[Authorize]
[AuthorizePage("employee", "calisan")]
[AuthorizePage("users", "calisan")]
public sealed class EmployeeLedgerController : ControllerBase
{
    private readonly AppDbContext _dbContext;
    private readonly EmployeeAccrualService _accruals;
    private readonly EmployeeCashService _cash;
    private readonly ErpPaymentAccountService _erp;

    public EmployeeLedgerController(AppDbContext dbContext, EmployeeAccrualService accruals, EmployeeCashService cash, ErpPaymentAccountService erp)
    {
        _erp = erp;
        _dbContext = dbContext;
        _accruals = accruals;
        _cash = cash;
    }

    /// <summary>Ekstrenin tek satiri.</summary>
    public sealed class LedgerLine
    {
        /// <summary>Satirin tarihi (yyyy-MM-dd).</summary>
        public string Date { get; set; } = string.Empty;

        /// <summary>Donem (yyyy-MM) — hakedis satirlarinda dolu.</summary>
        public string? Period { get; set; }

        /// <summary>Makine tarafi ayrim: accrual | bonusPlan | mealPlan | salary | bonus | meal | advance</summary>
        public string Kind { get; set; } = string.Empty;

        public string Label { get; set; } = string.Empty;

        public string? Description { get; set; }

        /// <summary>Personelin alacagi (hakedis).</summary>
        public decimal Credit { get; set; }

        /// <summary>Personele odenen.</summary>
        public decimal Debit { get; set; }

        /// <summary>O satirdan sonraki yuruyen bakiye.</summary>
        public decimal Balance { get; set; }

        /// <summary>Kaynak kaydin kimligi (odeme/plan). Hakedis satirlarinda null.</summary>
        public int? RefId { get; set; }
    }

    /// <summary>
    /// Filtre değeri GÜN (yyyy-MM-dd) ise onu, AY (yyyy-MM) ise ayın ilk/son gününü verir.
    ///
    /// <para>Ekstre bir süre yalnız ay seçtiriyordu; bankaya gönderilen rapor için "15 Ağustos –
    /// 14 Eylül" gibi tam aralık gerekiyor. Ay biçimi geriye dönük çalışmaya devam eder.</para>
    /// </summary>
    private static DateOnly? ParseBoundary(string? value, bool isStart)
    {
        var v = (value ?? string.Empty).Trim();
        if (v.Length == 0) return null;

        if (DateOnly.TryParseExact(v, "yyyy-MM-dd", out var exact)) return exact;

        if (v.Length == 7 && DateOnly.TryParseExact(v + "-01", "yyyy-MM-dd", out var monthStart))
        {
            return isStart ? monthStart : monthStart.AddMonths(1).AddDays(-1);
        }

        return null;
    }

    private static (string From, string To) ResolveRange(string? from, string? to)
    {
        var today = TurkeyTime.LocalDate(DateTime.UtcNow);

        // Filtre GUN (yyyy-MM-dd) da olabilir; hesap ay bazinda yurudugu icin donem kismina
        // indirilir. Gun bazli kirpma satirlar uretildikten SONRA yapilir.
        static string ToPeriod(string v) => v.Length >= 7 ? v[..7] : v;

        var toPeriod = string.IsNullOrWhiteSpace(to) ? TurkeyTime.PeriodOf(today) : ToPeriod(to.Trim());

        // Varsayilan: icinde bulunulan ay dahil son 12 ay.
        var fromPeriod = string.IsNullOrWhiteSpace(from)
            ? TurkeyTime.PeriodOf(new DateOnly(today.Year, today.Month, 1).AddMonths(-11))
            : ToPeriod(from.Trim());

        return (fromPeriod, toPeriod);
    }

    /// <summary>
    /// Aralikta gezilecek donemler. Ters verilirse duzeltilir, 24 ay ile sinirlanir:
    /// her donem icin ayri hakedis hesabi kosuyor, sinirsiz aralik ekrani kitliyordu.
    /// </summary>
    private static List<string> PeriodsBetween(string fromPeriod, string toPeriod)
    {
        var (fy, fm) = TurkeyTime.ParsePeriod(fromPeriod);
        var (ty, tm) = TurkeyTime.ParsePeriod(toPeriod);

        var start = new DateOnly(fy, fm, 1);
        var end = new DateOnly(ty, tm, 1);
        if (end < start) (start, end) = (end, start);

        var list = new List<string>();
        for (var d = start; d <= end && list.Count < 24; d = d.AddMonths(1))
        {
            list.Add(TurkeyTime.PeriodOf(d));
        }

        return list;
    }

    private static string PaymentLabel(EmployeePaymentType type) => type switch
    {
        EmployeePaymentType.Salary => "Maaş ödemesi",
        EmployeePaymentType.Bonus => "Prim ödemesi",
        EmployeePaymentType.CashAdvance => "Avans",
        EmployeePaymentType.Meal => "Yemek ödemesi",
        _ => "Ödeme"
    };

    private static string PaymentKind(EmployeePaymentType type) => type switch
    {
        EmployeePaymentType.Salary => "salary",
        EmployeePaymentType.Bonus => "bonus",
        EmployeePaymentType.CashAdvance => "advance",
        EmployeePaymentType.Meal => "meal",
        _ => "payment"
    };

    /// <summary>Tek personelin ekstresi: satir satir hareket ve yuruyen bakiye.</summary>
    [HttpGet("{employeeId:int}")]
    public async Task<IActionResult> Get(
        [FromRoute] int employeeId,
        [FromQuery] string? from,
        [FromQuery] string? to,
        CancellationToken cancellationToken = default)
    {
        var employee = await _dbContext.Employees
            .AsNoTracking()
            .Where(x => x.Id == employeeId)
            .Select(x => new { x.Id, x.EmployeeCode, x.FirstName, x.LastName, x.Workplace, x.HireDate, x.Salary, x.BankAccountNo, x.CustomerNo, x.Iban, x.BankName })
            .FirstOrDefaultAsync(cancellationToken);

        if (employee is null)
        {
            return NotFound(new { success = false, message = "Çalışan bulunamadı" });
        }

        var (fromPeriod, toPeriod) = ResolveRange(from, to);
        var periods = PeriodsBetween(fromPeriod, toPeriod);

        var rangeStart = TurkeyTime.MonthRange(periods[0]).FirstDay;
        var rangeEnd = TurkeyTime.MonthRange(periods[^1]).LastDay;
        var startUtc = TurkeyTime.StartOfDayUtc(rangeStart);
        var endUtc = TurkeyTime.EndOfDayUtc(rangeEnd);

        var lines = new List<LedgerLine>();

        // Overrides for this employee across periods:
        var monthlyOverrides = await _dbContext.Set<EmployeeMonthlyOverride>()
            .AsNoTracking()
            .Where(x => x.EmployeeId == employeeId && periods.Contains(x.Period))
            .ToListAsync(cancellationToken);

        // --- Alacak: TANIMLANMIS maas hakedisi ---
        //
        // Hakedis kendiliginden dogmaz. Bir sure hesaplanan hakedis yoksa aylik maasin tamami
        // otomatik alacak yaziliyordu; mesai kaydi olmayan personel icin 12 aylik ekstre
        // milyonluk hayali borc gosteriyordu. Artik yalnizca kullanicinin maas ekranindan
        // TANIMLADIGI hakedis (EmployeeSalaryAccruals) ekstreye girer. Aya ozel override varsa
        // tanimli tutarin yerine o gecer.
        var salaryAccruals = await _dbContext.EmployeeSalaryAccruals
            .AsNoTracking()
            .Where(x => x.EmployeeId == employeeId && periods.Contains(x.Period))
            .ToListAsync(cancellationToken);

        foreach (var accrualRow in salaryAccruals.OrderBy(x => x.Period))
        {
            var salOverride = monthlyOverrides.FirstOrDefault(
                x => x.Period == accrualRow.Period && x.OverrideType == MonthlyOverrideType.Salary);

            // Ekstreye giren tutar TANIMLI hakedistir — maas ekrani da onu okur. Eskiden burada
            // aya ozel duzenleme onceydi: tanimdan sonra "Duzenle" ile tutar degisince maas ekrani
            // eski tutari, ekstre yenisini gosteriyordu (2026-10-16). Duzenleme artik tanimli
            // hakedisi de gunceller (EmployeeAccrualsController.SaveOverride).
            var amount = accrualRow.Amount;
            if (amount <= 0m) continue;

            var lastDay = TurkeyTime.MonthRange(accrualRow.Period).LastDay;
            lines.Add(new LedgerLine
            {
                Date = TurkeyTime.Ymd(lastDay),
                Period = accrualRow.Period,
                Kind = "accrual",
                Label = "Maaş Hakedişi",
                Description = $"{accrualRow.Period} dönemi maaş hakedişi"
                    + (salOverride != null && !string.IsNullOrWhiteSpace(salOverride.Description)
                        ? $" ({salOverride.Description})"
                        : !string.IsNullOrWhiteSpace(accrualRow.Description) ? $" ({accrualRow.Description})" : ""),
                Credit = amount,
                RefId = accrualRow.Id
            });
        }

        // --- Alacak: planlanan yemek ---
        //
        // Yemek tarafinda ciftleme tuzagi: hakedis raporundaki MealAccrual ile EmployeeMealPlans
        // ayni seyin iki yolu. Ekstre yalniz PLANLARI sayar, yoksa ayni yemek iki kez
        // alacaklandirilirdi.
        var mealPlans = await _dbContext.Set<EmployeeMealPlan>()
            .AsNoTracking()
            .Where(x => x.EmployeeId == employeeId && x.PlannedDate >= startUtc && x.PlannedDate < endUtc)
            // IPTAL edilen plan alacak DEGILDIR. Bu suzgec aylik ozette vardi ama detay
            // ekstrede yoktu; iki ekran ayni personel icin farkli bakiye gosteriyordu.
            .Where(x => x.Status != EmployeeMealPlanStatus.Cancelled)
            .Select(x => new { x.Id, x.PlannedDate, x.Amount, x.Description })
            .ToListAsync(cancellationToken);

        foreach (var m in mealPlans)
        {
            lines.Add(new LedgerLine
            {
                Date = TurkeyTime.Ymd(TurkeyTime.LocalDate(m.PlannedDate)),
                Kind = "mealPlan",
                Label = "Yemek Hakedişi",
                Description = m.Description,
                Credit = m.Amount,
                RefId = m.Id
            });
        }

        // --- Alacak: planlanan primler ---
        var bonusPlans = await _dbContext.Set<EmployeeBonusPlan>()
            .AsNoTracking()
            .Where(x => x.EmployeeId == employeeId && x.PlannedDate >= startUtc && x.PlannedDate < endUtc)
            .Where(x => x.Status != EmployeeBonusPlanStatus.Cancelled)
            .Select(x => new { x.Id, x.PlannedDate, x.Amount, x.Description })
            .ToListAsync(cancellationToken);

        foreach (var p in bonusPlans)
        {
            lines.Add(new LedgerLine
            {
                Date = TurkeyTime.Ymd(TurkeyTime.LocalDate(p.PlannedDate)),
                Kind = "bonusPlan",
                Label = "Prim Tahakkuku",
                Description = string.IsNullOrWhiteSpace(p.Description) ? "Prim Hakedişi" : p.Description,
                Credit = p.Amount,
                RefId = p.Id
            });
        }

        // --- Borc: yapilan odemeler (iptal edilmemis olanlar) ---
        var payments = await _dbContext.Set<EmployeePayment>()
            .AsNoTracking()
            .Where(x => x.EmployeeId == employeeId && x.PaymentDate >= startUtc && x.PaymentDate < endUtc && !x.IsCancelled)
            .Select(x => new { x.Id, x.Type, x.Amount, x.PaymentDate, x.Description, x.SalaryPeriod })
            .ToListAsync(cancellationToken);

        foreach (var p in payments)
        {
            lines.Add(new LedgerLine
            {
                Date = TurkeyTime.Ymd(TurkeyTime.LocalDate(p.PaymentDate)),
                Period = p.SalaryPeriod,
                Kind = PaymentKind(p.Type),
                Label = PaymentLabel(p.Type),
                // Maaş ödemesi hangi AYIN maaşı — hakediş satırıyla aynı biçim (2026-10-16).
                Description = p.Type == EmployeePaymentType.Salary && !string.IsNullOrWhiteSpace(p.SalaryPeriod)
                    ? $"{p.SalaryPeriod} dönemi maaş ödemesi" + (string.IsNullOrWhiteSpace(p.Description) ? "" : $" ({p.Description})")
                    : p.Description,
                Debit = p.Amount,
                RefId = p.Id
            });
        }

        // GUN bazli aralik verildiyse satirlar tam gune gore suzulur. Hesap ayin tamami
        // uzerinden yurur (hakedis ay sonuna yazilir), sonra istenen araliga kirpilir;
        // bankaya gonderilen rapor "15 Agustos - 14 Eylul" gibi tam aralik isteyebiliyor.
        var dayFrom = ParseBoundary(from, isStart: true);
        var dayTo = ParseBoundary(to, isStart: false);

        if (dayFrom.HasValue) lines = lines.Where(x => string.CompareOrdinal(x.Date, TurkeyTime.Ymd(dayFrom.Value)) >= 0).ToList();
        if (dayTo.HasValue) lines = lines.Where(x => string.CompareOrdinal(x.Date, TurkeyTime.Ymd(dayTo.Value)) <= 0).ToList();

        // Tarih sirasi; ayni gunde once alacak sonra borc yazilir
        var ordered = lines
            .OrderBy(x => x.Date, StringComparer.Ordinal)
            .ThenByDescending(x => x.Credit > 0m)
            .ThenBy(x => x.RefId ?? 0)
            .ToList();

        var running = 0m;
        foreach (var line in ordered)
        {
            running += line.Credit - line.Debit;
            line.Balance = decimal.Round(running, 2, MidpointRounding.AwayFromZero);
        }

        var totalCredit = decimal.Round(ordered.Sum(x => x.Credit), 2, MidpointRounding.AwayFromZero);
        var totalDebit = decimal.Round(ordered.Sum(x => x.Debit), 2, MidpointRounding.AwayFromZero);

        return Ok(new
        {
            success = true,
            data = new
            {
                employee = new
                {
                    id = employee.Id,
                    employeeCode = employee.EmployeeCode,
                    name = $"{employee.FirstName} {employee.LastName}".Trim(),
                    workplace = employee.Workplace,
                    hireDate = employee.HireDate,
                    salary = employee.Salary,
                    bankAccountNo = employee.BankAccountNo,
                    customerNo = employee.CustomerNo,
                    iban = employee.Iban,
                    bankName = employee.BankName
                },
                fromPeriod = periods[0],
                toPeriod = periods[^1],
                lines = ordered,
                totals = new
                {
                    credit = totalCredit,
                    debit = totalDebit,
                    balance = decimal.Round(totalCredit - totalDebit, 2, MidpointRounding.AwayFromZero)
                }
            }
        });
    }

    /// <summary>
    /// Bir personelin SEÇİLEN AYDAKİ tüm finansal durumu tek ekranda: maaş, yemek, prim, avans.
    ///
    /// <para>Dört ödeme türü dört ayrı ekranda yönetildiği için "bu ay bu adama ne oldu"
    /// sorusunun cevabı dağınıktı. Buradaki her blok kendi kaynağından okunur; ekstredeki
    /// alacak/borç ile aynı kuralları kullanır, ayrı bir hesap yapmaz.</para>
    /// </summary>
    [HttpGet("{employeeId:int}/monthly-summary")]
    public async Task<IActionResult> MonthlySummary(
        [FromRoute] int employeeId,
        [FromQuery] string? period,
        CancellationToken cancellationToken = default)
    {
        var targetPeriod = string.IsNullOrWhiteSpace(period)
            ? TurkeyTime.PeriodOf(TurkeyTime.LocalDate(DateTime.UtcNow))
            : period.Trim();

        var employee = await _dbContext.Employees
            .AsNoTracking()
            .Where(x => x.Id == employeeId)
            .Select(x => new { x.Id, x.EmployeeCode, x.FirstName, x.LastName, x.Salary, x.MealAmount, x.SalaryDay })
            .FirstOrDefaultAsync(cancellationToken);

        if (employee is null)
            return NotFound(new { success = false, message = "Çalışan bulunamadı" });

        var range = TurkeyTime.MonthRange(targetPeriod);
        var startUtc = TurkeyTime.StartOfDayUtc(range.FirstDay);
        var endUtc = TurkeyTime.EndOfDayUtc(range.LastDay);

        var overrides = await _dbContext.EmployeeMonthlyOverrides
            .AsNoTracking()
            .Where(x => x.EmployeeId == employeeId && x.Period == targetPeriod)
            .ToListAsync(cancellationToken);

        var salaryOverride = overrides.FirstOrDefault(x => x.OverrideType == MonthlyOverrideType.Salary);
        var mealOverride = overrides.FirstOrDefault(x => x.OverrideType == MonthlyOverrideType.Meal);

        var definedSalary = await _dbContext.EmployeeSalaryAccruals
            .AsNoTracking()
            .FirstOrDefaultAsync(x => x.EmployeeId == employeeId && x.Period == targetPeriod, cancellationToken);

        var mealPlans = await _dbContext.Set<EmployeeMealPlan>()
            .AsNoTracking()
            .Where(x => x.EmployeeId == employeeId && x.PlannedDate >= startUtc && x.PlannedDate <= endUtc)
            .Where(x => x.Status != EmployeeMealPlanStatus.Cancelled)
            .ToListAsync(cancellationToken);

        var bonusPlans = await _dbContext.Set<EmployeeBonusPlan>()
            .AsNoTracking()
            .Where(x => x.EmployeeId == employeeId && x.PlannedDate >= startUtc && x.PlannedDate <= endUtc)
            .Where(x => x.Status != EmployeeBonusPlanStatus.Cancelled)
            .ToListAsync(cancellationToken);

        // Odemeler donem eslesmesiyle: SalaryPeriod doluysa ona, degilse odeme tarihinin ayina.
        var payments = await _dbContext.Set<EmployeePayment>()
            .AsNoTracking()
            .Where(x => x.EmployeeId == employeeId && !x.IsCancelled)
            .Where(x => x.SalaryPeriod == targetPeriod
                        || (x.SalaryPeriod == null && x.PaymentDate >= startUtc && x.PaymentDate <= endUtc))
            .ToListAsync(cancellationToken);

        decimal PaidOf(EmployeePaymentType t) => payments.Where(x => x.Type == t).Sum(x => x.Amount);

        var advances = payments.Where(x => x.Type == EmployeePaymentType.CashAdvance).ToList();
        var advanceTotal = advances.Sum(x => x.Amount);
        var advanceDeductible = advances.Where(x => x.DeductFromSalary).Sum(x => x.Amount);

        // Tanimli hakedis once; tanimsizsa aya ozel duzenleme (maas ekraniyla ayni sira).
        var salaryAccrual = definedSalary?.Amount ?? salaryOverride?.OverrideAmount ?? 0m;
        var salaryPaid = PaidOf(EmployeePaymentType.Salary);
        var salaryNet = Math.Max(0m, salaryAccrual - advanceDeductible);

        var mealAccrual = mealPlans.Sum(x => x.Amount);
        var mealPaid = PaidOf(EmployeePaymentType.Meal);

        var bonusAccrual = bonusPlans.Sum(x => x.Amount);
        var bonusPaid = PaidOf(EmployeePaymentType.Bonus);

        return Ok(new
        {
            success = true,
            period = targetPeriod,
            employee = new
            {
                employee.Id,
                employee.EmployeeCode,
                name = $"{employee.FirstName} {employee.LastName}".Trim(),
                standardSalary = employee.Salary,
                monthlyMealAmount = employee.MealAmount,
                employee.SalaryDay
            },
            salary = new
            {
                standard = employee.Salary,
                overrideAmount = salaryOverride?.OverrideAmount,
                overrideDescription = salaryOverride?.Description,
                accrued = salaryAccrual,
                accrualDefined = definedSalary != null,
                referenceNo = definedSalary?.ReferenceNo,
                calculatedAtDefine = definedSalary?.CalculatedAmount,
                advanceDeduction = advanceDeductible,
                net = salaryNet,
                paid = salaryPaid,
                remaining = Math.Max(0m, salaryNet - salaryPaid)
            },
            meal = new
            {
                monthlyAmount = employee.MealAmount,
                overrideAmount = mealOverride?.OverrideAmount,
                accrued = mealAccrual,
                accrualDefined = mealPlans.Count > 0,
                paid = mealPaid,
                remaining = Math.Max(0m, mealAccrual - mealPaid)
            },
            bonus = new
            {
                accrued = bonusAccrual,
                paid = bonusPaid,
                pending = Math.Max(0m, bonusAccrual - bonusPaid),
                items = bonusPlans.Select(x => new { x.Id, x.PlannedDate, x.Amount, x.Description, status = (int)x.Status })
            },
            advance = new
            {
                total = advanceTotal,
                deductibleFromSalary = advanceDeductible,
                notDeductible = advanceTotal - advanceDeductible,
                deducted = advances.Where(x => x.SalaryDeductedAt != null).Sum(x => x.Amount),
                items = advances.Select(x => new
                {
                    x.Id,
                    x.Amount,
                    x.Description,
                    x.PaymentDate,
                    x.DeductFromSalary,
                    isDeducted = x.SalaryDeductedAt != null,
                    x.ReferenceNo
                })
            }
        });
    }

    /// <summary>Butun personelin tek bakista bakiyesi.</summary>
    [HttpGet("summary")]
    public async Task<IActionResult> Summary(
        [FromQuery] string? from,
        [FromQuery] string? to,
        CancellationToken cancellationToken = default)
    {
        var (fromPeriod, toPeriod) = ResolveRange(from, to);
        var periods = PeriodsBetween(fromPeriod, toPeriod);

        // GUN bazli aralik verildiyse sinirlar tam gune cekilir; bankaya gonderilen rapor
        // "15 Agustos - 14 Eylul" gibi ay sinirina oturmayan aralik isteyebiliyor.
        var rangeStart = ParseBoundary(from, isStart: true) ?? TurkeyTime.MonthRange(periods[0]).FirstDay;
        var rangeEnd = ParseBoundary(to, isStart: false) ?? TurkeyTime.MonthRange(periods[^1]).LastDay;
        if (rangeEnd < rangeStart) (rangeStart, rangeEnd) = (rangeEnd, rangeStart);

        var startUtc = TurkeyTime.StartOfDayUtc(rangeStart);
        var endUtc = TurkeyTime.EndOfDayUtc(rangeEnd);

        var employees = await _dbContext.Employees
            .AsNoTracking()
            .Where(x => x.IsActive)
            .Select(x => new { x.Id, x.EmployeeCode, x.FirstName, x.LastName, x.Workplace, x.Salary, x.BankAccountNo, x.CustomerNo, x.Iban, x.BankName })
            .ToListAsync(cancellationToken);

        var credit = employees.ToDictionary(x => x.Id, _ => 0m);
        var debit = employees.ToDictionary(x => x.Id, _ => 0m);

        void AddCredit(int id, decimal amount)
        {
            if (credit.ContainsKey(id)) credit[id] += amount;
        }

        void AddDebit(int id, decimal amount)
        {
            if (debit.ContainsKey(id)) debit[id] += amount;
        }

        // Detay ekstresiyle AYNI kaynak: alacak yalnizca TANIMLANMIS hakedisten ve planlardan
        // dogar. Iki yer ayrisirsa liste ile detay birbirini tutmaz.
        var definedAccruals = await _dbContext.EmployeeSalaryAccruals
            .AsNoTracking()
            .Where(x => periods.Contains(x.Period))
            .Select(x => new { x.EmployeeId, x.Period, x.Amount })
            .ToListAsync(cancellationToken);

        foreach (var row in definedAccruals)
        {
            // Hakedis satiri ayin SON gunune yazilir; gun bazli aralikta o gun disarida
            // kaliyorsa alacak da sayilmaz. Detay ekstre ile ayni kural.
            var accrualDay = TurkeyTime.MonthRange(row.Period).LastDay;
            if (accrualDay < rangeStart || accrualDay > rangeEnd) continue;

            // Detay ekstreyle ayni kural: tanimli hakedis gecerli.
            var amount = row.Amount;
            if (amount > 0m) AddCredit(row.EmployeeId, amount);
        }

        var mealPlansAll = await _dbContext.Set<EmployeeMealPlan>()
            .AsNoTracking()
            .Where(x => x.PlannedDate >= startUtc && x.PlannedDate < endUtc)
            .Where(x => x.Status != EmployeeMealPlanStatus.Cancelled)
            .Select(x => new { x.EmployeeId, x.Amount })
            .ToListAsync(cancellationToken);
        foreach (var m in mealPlansAll) AddCredit(m.EmployeeId, m.Amount);

        var bonusPlans = await _dbContext.Set<EmployeeBonusPlan>()
            .AsNoTracking()
            .Where(x => x.PlannedDate >= startUtc && x.PlannedDate < endUtc)
            .Where(x => x.Status != EmployeeBonusPlanStatus.Cancelled)
            .Select(x => new { x.EmployeeId, x.Amount })
            .ToListAsync(cancellationToken);
        foreach (var p in bonusPlans) AddCredit(p.EmployeeId, p.Amount);

        var payments = await _dbContext.Set<EmployeePayment>()
            .AsNoTracking()
            .Where(x => x.PaymentDate >= startUtc && x.PaymentDate < endUtc && !x.IsCancelled)
            .Select(x => new { x.EmployeeId, x.Amount })
            .ToListAsync(cancellationToken);
        foreach (var p in payments) AddDebit(p.EmployeeId, p.Amount);


        var data = employees
            .Select(e => new
            {
                employeeId = e.Id,
                employeeCode = e.EmployeeCode,
                employeeName = $"{e.FirstName} {e.LastName}".Trim(),
                workplace = e.Workplace,
                salary = e.Salary,
                bankAccountNo = e.BankAccountNo,
                customerNo = e.CustomerNo,
                iban = e.Iban,
                bankName = e.BankName,
                credit = decimal.Round(credit[e.Id], 2, MidpointRounding.AwayFromZero),
                debit = decimal.Round(debit[e.Id], 2, MidpointRounding.AwayFromZero),
                balance = decimal.Round(credit[e.Id] - debit[e.Id], 2, MidpointRounding.AwayFromZero)
            })
            .OrderByDescending(x => x.balance)
            .ThenBy(x => x.employeeName, StringComparer.CurrentCulture)
            .ToList();

        return Ok(new
        {
            success = true,
            data,
            fromPeriod = periods[0],
            toPeriod = periods[^1],
            summary = new
            {
                employeeCount = data.Count,
                totalCredit = data.Sum(x => x.credit),
                totalDebit = data.Sum(x => x.debit),
                totalBalance = data.Sum(x => x.balance)
            }
        });
    }

    public sealed class SinglePayoutRequest
    {
        public int EmployeeId { get; set; }
        public decimal Amount { get; set; }
        public int PaymentType { get; set; } = 1;
        public string? Description { get; set; }
        public DateTime? PaymentDate { get; set; }
        public int? CashAccountId { get; set; }
        public int? BankAccountDefinitionId { get; set; }

        /// <summary>B2B kasa/banka kaynağı (2026-09-27). Doluysa seçilen hesaba tek "Personel Ödemesi" satırı yazılır.</summary>
        public ErpPaymentSource? ErpSource { get; set; }

        /// <summary>
        /// Ödemenin ait olduğu dönem "yyyy-MM". Boşsa maaş ödemesi en eski açık maaş döneminden
        /// başlayarak dönemlere dağıtılır; diğer türlerde ödeme tarihinin ayı kullanılır.
        /// </summary>
        public string? SalaryPeriod { get; set; }
    }

    /// <summary>
    /// Kişi cari ekstresinden anında ödeme / para yatırma çıkışı yapar.
    ///
    /// <para><b>Maaşta dönem (2026-10-16):</b> dönem ödeme TARİHİNDEN türetiliyordu; ağustos
    /// maaşı 3 eylülde ekstreden ödenince eylüle yazılıyor, ağustos "Gecikti" kalıyordu. Dönem
    /// verilmezse tutar en eski açık maaş döneminden başlayarak dağıtılır; birden fazla döneme
    /// düşerse dönem başına ayrı ödeme kaydı açılır, kasaya ve B2B'ye yine TEK satır yazılır.</para>
    /// </summary>
    [HttpPost("single-payout")]
    public async Task<IActionResult> SinglePayout([FromBody] SinglePayoutRequest request, CancellationToken cancellationToken)
    {
        if (request.EmployeeId <= 0 || request.Amount <= 0)
        {
            return BadRequest(new { success = false, message = "Geçersiz çalışan veya tutar" });
        }

        var employee = await _dbContext.Employees.FirstOrDefaultAsync(x => x.Id == request.EmployeeId, cancellationToken);
        if (employee is null) return NotFound(new { success = false, message = "Çalışan bulunamadı" });

        var now = DateTime.UtcNow;
        var paymentDate = request.PaymentDate.HasValue
            ? (request.PaymentDate.Value.Kind == DateTimeKind.Utc ? request.PaymentDate.Value : DateTime.SpecifyKind(request.PaymentDate.Value, DateTimeKind.Utc))
            : now;

        var type = (EmployeePaymentType)request.PaymentType;
        var paymentPeriod = TurkeyTime.PeriodOf(TurkeyTime.LocalDate(paymentDate));
        var explicitPeriod = string.IsNullOrWhiteSpace(request.SalaryPeriod) ? null : request.SalaryPeriod.Trim();
        var parts = new List<(string Period, decimal Amount)> { (explicitPeriod ?? paymentPeriod, request.Amount) };

        if (type == EmployeePaymentType.Salary)
        {
            var rows = (await SalaryPeriodBalance.LoadAsync(_dbContext, new[] { employee.Id }, cancellationToken))[employee.Id];
            if (explicitPeriod is null)
            {
                parts = SalaryPeriodBalance.Allocate(rows, request.Amount, paymentPeriod);
            }
            else
            {
                // Mükerrer kapı: maaş ekranındaki tekil ödemeyle aynı kural.
                var row = rows.FirstOrDefault(x => x.Period == explicitPeriod);
                if (row is not null && row.Remaining <= 0.004m)
                    return Conflict(new { success = false, message = $"{explicitPeriod} dönemi maaşı tamamen ödenmiş. İkinci maaş ödemesi yapılmadı." });
                if (row is not null && request.Amount > row.Remaining + 0.01m)
                    return Conflict(new { success = false, message = $"{explicitPeriod} dönemi için kalan maaş {row.Remaining:N2}; girilen {request.Amount:N2} bunu aşıyor." });
            }
        }

        var empFullName = $"{employee.FirstName} {employee.LastName}".Trim();
        var desc = string.IsNullOrWhiteSpace(request.Description)
            ? $"{PaymentLabel(type)} - {empFullName}"
            : request.Description.Trim();

        var username = User.Identity?.Name ?? "System";

        await using var tx = await _dbContext.Database.BeginTransactionAsync(cancellationToken);

        var cashAccount = await _cash.GetOrCreateDefaultAccountAsync(request.CashAccountId, cancellationToken);

        var payments = new List<EmployeePayment>();
        foreach (var part in parts)
        {
            var payment = new EmployeePayment
            {
                EmployeeId = employee.Id,
                Type = type,
                Amount = part.Amount,
                PaymentDate = paymentDate,
                SalaryPeriod = part.Period,
                Description = parts.Count > 1 ? $"{desc} ({part.Period})" : desc,
                ReferenceNo = await ReferenceNumberGenerator.NextAsync(_dbContext, "PAY", part.Period, cancellationToken),
                CashAccountId = cashAccount.Id,
                BankAccountDefinitionId = request.BankAccountDefinitionId,
                CreateUser = username,
                CreateTime = now
            };
            _dbContext.EmployeePayments.Add(payment);
            payments.Add(payment);
        }

        await _dbContext.SaveChangesAsync(cancellationToken);

        // Kasa hareketi PERSONEL kasasina yazilir; ERP'nin gercek kasasina degil. Odeme birden
        // fazla doneme dagildiysa kasaya ve B2B'ye yine tek satir gider (ust kayit + kirilim).
        EmployeeCashTransaction cashTx;
        if (payments.Count == 1)
        {
            cashTx = _cash.AddSingleOut(cashAccount.Id, payments[0], empFullName, desc, username);
        }
        else
        {
            var bulkRef = await ReferenceNumberGenerator.NextAsync(_dbContext, "BULK", paymentPeriod, cancellationToken);
            cashTx = _cash.AddBulkParent(
                cashAccount.Id, paymentDate, payments.Sum(x => x.Amount), (int)type, null, bulkRef,
                $"{desc} ({string.Join(", ", payments.Select(x => x.SalaryPeriod))})", username);
        }

        if (request.ErpSource is not null)
        {
            var erpHata = await _erp.AttachAsync(cashTx, request.ErpSource, User, username, cancellationToken);
            if (erpHata is not null) return BadRequest(new { success = false, message = erpHata });
        }

        if (payments.Count > 1)
        {
            await _dbContext.SaveChangesAsync(cancellationToken);
            foreach (var p in payments)
            {
                _cash.AddBulkChild(cashAccount.Id, cashTx.Id, p, empFullName, p.Description ?? desc, username);
            }
        }

        if (type == EmployeePaymentType.Salary)
        {
            foreach (var p in payments)
            {
                await AdvanceSettlement.MarkDeductedAsync(_dbContext, new[] { p.EmployeeId }, p.SalaryPeriod!, now, cancellationToken);
            }
        }

        await _dbContext.SaveChangesAsync(cancellationToken);

        await tx.CommitAsync(cancellationToken);

        return Ok(new
        {
            success = true,
            paymentId = payments[0].Id,
            referenceNo = payments[0].ReferenceNo,
            periods = payments.Select(x => new { period = x.SalaryPeriod, amount = x.Amount })
        });
    }

    /// <summary>Cari ekstredeki tek bir hareket satırını (ödeme veya plan) geri alır/siler.</summary>
    [HttpDelete("line/{kind}/{refId:int}")]
    public async Task<IActionResult> DeleteLine([FromRoute] string kind, [FromRoute] int refId, CancellationToken cancellationToken)
    {
        if (refId <= 0) return BadRequest(new { success = false, message = "Geçersiz kayıt kimliği" });

        var normKind = (kind ?? "").Trim().ToLowerInvariant();
        var username = User.Identity?.Name ?? "System";
        var now = DateTime.UtcNow;

        // Hakedis satiri: tanimi geri alinir, alacak ekstreden duser.
        if (normKind == "accrual")
        {
            var accrualRow = await _dbContext.EmployeeSalaryAccruals
                .FirstOrDefaultAsync(x => x.Id == refId, cancellationToken);
            if (accrualRow is null) return NotFound(new { success = false, message = "Hakediş kaydı bulunamadı" });

            _dbContext.EmployeeSalaryAccruals.Remove(accrualRow);
            await _dbContext.SaveChangesAsync(cancellationToken);
            return Ok(new { success = true, message = "Maaş hakedişi tanımı geri alındı" });
        }

        if (normKind == "bonusplan")
        {
            var plan = await _dbContext.Set<EmployeeBonusPlan>().FirstOrDefaultAsync(x => x.Id == refId, cancellationToken);
            if (plan is null) return NotFound(new { success = false, message = "Prim planı bulunamadı" });
            _dbContext.Set<EmployeeBonusPlan>().Remove(plan);
            await _dbContext.SaveChangesAsync(cancellationToken);
            return Ok(new { success = true, message = "Prim planı silindi" });
        }

        if (normKind == "mealplan")
        {
            var plan = await _dbContext.Set<EmployeeMealPlan>().FirstOrDefaultAsync(x => x.Id == refId, cancellationToken);
            if (plan is null) return NotFound(new { success = false, message = "Yemek planı bulunamadı" });
            _dbContext.Set<EmployeeMealPlan>().Remove(plan);
            await _dbContext.SaveChangesAsync(cancellationToken);
            return Ok(new { success = true, message = "Yemek planı silindi" });
        }

        // Ödeme türleri (salary, bonus, meal, advance, payment)
        var payment = await _dbContext.Set<EmployeePayment>().FirstOrDefaultAsync(x => x.Id == refId, cancellationToken);
        if (payment is null) return NotFound(new { success = false, message = "Ödeme kaydı bulunamadı" });

        if (payment.Type == EmployeePaymentType.Salary)
        {
            await AdvanceSettlement.UnmarkAsync(_dbContext, payment.EmployeeId, payment.SalaryPeriod, cancellationToken, payment.Id);
        }

        // İlgili personel kasası hareketini de kaldır (toplu ödemede üst kaydın tutarı düşer).
        await _cash.RemoveByPaymentIdAsync(refId, cancellationToken, username);

        _dbContext.Set<EmployeePayment>().Remove(payment);
        await _dbContext.SaveChangesAsync(cancellationToken);

        return Ok(new { success = true, message = "Ödeme kaydı geri alındı" });
    }
}


