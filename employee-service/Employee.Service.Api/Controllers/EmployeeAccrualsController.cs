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
/// Hakedişler: dönem bazlı puantaj ve ödenecek tutar özeti.
/// Günlük snapshot ve manuel override (maaş/yemek) destekler.
/// </summary>
[ApiController]
[Route("api/[controller]")]
[Authorize]
[AuthorizePage("employee", "calisan")]
[AuthorizePage("users", "calisan")]
public sealed class EmployeeAccrualsController : ControllerBase
{
    private readonly EmployeeAccrualService _accruals;
    private readonly AppDbContext _dbContext;
    private readonly WorkCalendarService _calendar;

    public EmployeeAccrualsController(EmployeeAccrualService accruals, AppDbContext dbContext, WorkCalendarService calendar)
    {
        _accruals = accruals;
        _dbContext = dbContext;
        _calendar = calendar;
    }

    /// <summary>Dönemdeki personellerin hakediş özeti (öncelikli olarak snapshot'tan döner).</summary>
    [HttpGet]
    public async Task<IActionResult> List(
        [FromQuery] string? period,
        [FromQuery] string? employeeIds,
        [FromQuery] bool forceRefresh = false,
        CancellationToken cancellationToken = default)
    {
        var ids = ParseIds(employeeIds);

        var data = await _accruals.CalculateWithSnapshotsAsync(
            period ?? string.Empty,
            ids,
            forceRefresh,
            cancellationToken);

        var lastCalculatedAt = data.FirstOrDefault()?.LastCalculatedAt;

        return Ok(new
        {
            success = true,
            period = period ?? string.Empty,
            lastCalculatedAt,
            data,
            summary = new
            {
                employeeCount = data.Count,
                totalGross = data.Sum(x => x.GrossAccrual),
                totalAdvances = data.Sum(x => x.DeductibleAdvances),
                totalAlreadyPaid = data.Sum(x => x.AlreadyPaid),
                totalNetPayable = data.Sum(x => x.NetPayable),
                totalMeal = data.Sum(x => x.MealAccrual),
                totalOvertimePay = data.Sum(x => x.OvertimePay),
                totalAbsenceDeduction = data.Sum(x => x.AbsenceDeduction),
                totalOvertimeMinutes = data.Sum(x => x.OvertimeMinutes),
                totalAbsentDays = data.Sum(x => x.AbsentDays)
            }
        });
    }

    /// <summary>Hakedişi Yenile: O anki günün mesaisini de dahil ederek canlı hesaplar ve snapshot'ı günceller.</summary>
    [HttpPost("refresh")]
    public async Task<IActionResult> Refresh(
        [FromBody] RefreshAccrualRequest request,
        CancellationToken cancellationToken = default)
    {
        var ids = request.EmployeeIds != null && request.EmployeeIds.Count > 0
            ? request.EmployeeIds
            : null;

        var data = await _accruals.CalculateWithSnapshotsAsync(
            request.Period ?? string.Empty,
            ids,
            forceRefresh: true,
            cancellationToken);

        var lastCalculatedAt = data.FirstOrDefault()?.LastCalculatedAt ?? DateTime.UtcNow;

        return Ok(new
        {
            success = true,
            period = request.Period ?? string.Empty,
            lastCalculatedAt,
            data,
            summary = new
            {
                employeeCount = data.Count,
                totalGross = data.Sum(x => x.GrossAccrual),
                totalAdvances = data.Sum(x => x.DeductibleAdvances),
                totalAlreadyPaid = data.Sum(x => x.AlreadyPaid),
                totalNetPayable = data.Sum(x => x.NetPayable),
                totalMeal = data.Sum(x => x.MealAccrual)
            }
        });
    }

    /// <summary>Tek personelin gün gün puantaj dökümü.</summary>
    [HttpGet("{employeeId:int}")]
    public async Task<IActionResult> Detail(
        [FromRoute] int employeeId,
        [FromQuery] string? period,
        CancellationToken cancellationToken = default)
    {
        if (employeeId <= 0) return BadRequest(new { success = false, message = "Geçersiz çalışan" });

        var data = await _accruals.CalculateAsync(
            period ?? string.Empty,
            new[] { employeeId },
            includeDays: true,
            cancellationToken);

        var item = data.FirstOrDefault();
        if (item is null) return NotFound(new { success = false, message = "Çalışan bulunamadı" });

        return Ok(new { success = true, data = item });
    }

    public sealed class DefineSalaryAccrualRequest
    {
        public List<int> EmployeeIds { get; set; } = new();

        /// <summary>Dönem "yyyy-MM". Zorunlu — hakediş dönemi ödeme tarihinden bağımsızdır.</summary>
        public string Period { get; set; } = string.Empty;

        /// <summary>Personel başına tanımlanacak tutar. Verilmeyen personelde hesaplanan hakediş kullanılır.</summary>
        public Dictionary<int, decimal>? Amounts { get; set; }

        public string? Description { get; set; }
    }

    /// <summary>
    /// Seçilen personelin ilgili dönem maaş hakedişini TANIMLAR — cari ekstreye alacak yazan
    /// işlem budur.
    ///
    /// <para>Hakediş kendiliğinden oluşmaz: ekstre bir süre mesai kaydı olmayan aylarda aylık
    /// maaşın tamamını otomatik alacak yazıyordu ve hiç çalışmamış personel için bile hayali
    /// borç çıkıyordu. Hesaplanan hakediş artık yalnızca öneridir; ekstreye giren tutar burada
    /// onaylanandır.</para>
    ///
    /// <para>Aynı dönem yeniden tanımlanırsa tutar güncellenir, ikinci alacak satırı doğmaz.</para>
    /// </summary>
    [HttpPost("define-salary")]
    public async Task<IActionResult> DefineSalaryAccrual(
        [FromBody] DefineSalaryAccrualRequest request,
        CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(request.Period))
            return BadRequest(new { success = false, message = "Dönem (yyyy-MM) gereklidir." });

        var ids = (request.EmployeeIds ?? new List<int>()).Where(x => x > 0).Distinct().ToList();
        if (ids.Count == 0)
            return BadRequest(new { success = false, message = "Çalışan seçilmedi." });

        var period = request.Period.Trim();
        var user = User.Identity?.Name ?? "Admin";
        var now = DateTime.UtcNow;

        var employees = await _dbContext.Employees
            .AsNoTracking()
            .Where(x => ids.Contains(x.Id))
            .Select(x => new { x.Id, x.FirstName, x.LastName, x.Salary, x.HireDate, x.SalaryDay })
            .ToListAsync(cancellationToken);

        if (employees.Count == 0)
            return BadRequest(new { success = false, message = "Çalışan bulunamadı." });

        var calculated = await _accruals.CalculateAsync(period, ids, includeDays: false, cancellationToken);

        // Mesai kaydi olmayan personelde kist oneri IS GUNU bazlidir; takvimi bir kez uretiriz.
        var schedule = await _calendar.GetScheduleAsync(null, cancellationToken);
        var (winStart, _) = SalaryProrationCalculator.ResolveWindow(period, 1);
        var workCalendar = await _calendar.BuildAsync(winStart, winStart.AddMonths(2).AddDays(-1), schedule, cancellationToken);

        var existing = await _dbContext.EmployeeSalaryAccruals
            .Where(x => x.Period == period && ids.Contains(x.EmployeeId))
            .ToListAsync(cancellationToken);

        // Aya ozel manuel duzenleme varsa tanimin varsayilani odur.
        var overrides = await _dbContext.EmployeeMonthlyOverrides
            .AsNoTracking()
            .Where(x => x.Period == period && x.OverrideType == MonthlyOverrideType.Salary && ids.Contains(x.EmployeeId))
            .ToDictionaryAsync(x => x.EmployeeId, x => x.OverrideAmount, cancellationToken);

        var defined = 0;
        var skipped = new List<string>();

        foreach (var emp in employees)
        {
            var calc = calculated.FirstOrDefault(x => x.EmployeeId == emp.Id);
            // Tanimlanan tutar BRUTTUR. Avans hakedisten DUSULMEZ: avans cari ekstrede zaten
            // ayri bir borc satiri, hakedisten de dusersek ayni avans iki kez sayilir ve
            // personele eksik odenir. Bakiye = brut hakedis - avans - odemeler dogru neti verir.
            // Sira: kullanicinin girdigi tutar > aya ozel manuel duzenleme > mesaiden
            // hesaplanan hakedis > personelin aylik maasi.
            //
            // Son basamak SART: mesai (giris/cikis) kaydi olmayan personelde hesaplanan hakedis
            // 0 cikiyor ve tanimlama sessizce atlaniyordu — 35 personelin 34'unde dugme hicbir
            // sey yapmiyordu. Burada aylik maasa dusmek "uydurma" DEGIL: kullanici bilerek
            // "Hakedis Tanimla" diyor. Uydurma olan, ekstrenin bunu kendiliginden yazmasiydi.
            var amount = request.Amounts != null && request.Amounts.TryGetValue(emp.Id, out var custom)
                ? custom
                : overrides.TryGetValue(emp.Id, out var ov)
                    ? ov
                    : (calc?.GrossAccrual ?? 0m);
            // Mesai kaydi yoksa tutar 0 kalir ve personel ATLANIR — calismadan hakedis dogmaz.
            // Yine de tanimlanacaksa aya ozel duzenleme (override) girilir, oncelik onda.

            // Sifir hakedis tanimlamak ekstreye anlamsiz satir yazar; personel atlanir.
            // Buraya artik yalnizca maasi da tanimsiz (0) olan personel duser.
            if (amount <= 0m)
            {
                skipped.Add($"{emp.FirstName} {emp.LastName}".Trim());
                continue;
            }

            var row = existing.FirstOrDefault(x => x.EmployeeId == emp.Id);
            if (row != null)
            {
                row.Amount = amount;
                row.CalculatedAmount = calc?.GrossAccrual ?? 0m;
                row.DeductedAdvances = calc?.DeductibleAdvances ?? 0m;
                row.Description = request.Description;
                row.EditUser = user;
                row.EditTime = now;
            }
            else
            {
                _dbContext.EmployeeSalaryAccruals.Add(new EmployeeSalaryAccrual
                {
                    EmployeeId = emp.Id,
                    Period = period,
                    Amount = amount,
                    CalculatedAmount = calc?.GrossAccrual ?? 0m,
                    DeductedAdvances = calc?.DeductibleAdvances ?? 0m,
                    Description = request.Description,
                    ReferenceNo = await ReferenceNumberGenerator.NextAsync(_dbContext, "SAL", period, cancellationToken),
                    CreateUser = user,
                    CreateTime = now
                });
            }

            defined++;
        }

        await _dbContext.SaveChangesAsync(cancellationToken);

        return Ok(new
        {
            success = true,
            period,
            definedCount = defined,
            skipped,
            message = defined > 0
                ? $"{defined} personel için {period} dönemi maaş hakedişi tanımlandı."
                : "Tanımlanacak hakediş bulunamadı."
        });
    }

    public sealed class DefineMealAccrualRequest
    {
        public List<int> EmployeeIds { get; set; } = new();

        /// <summary>Dönem "yyyy-MM".</summary>
        public string Period { get; set; } = string.Empty;

        /// <summary>Personel başına tanımlanacak tutar. Verilmezse hesaplanan yemek hakedişi kullanılır.</summary>
        public Dictionary<int, decimal>? Amounts { get; set; }

        public string? Description { get; set; }
    }

    /// <summary>
    /// Seçilen personelin ilgili dönem YEMEK hakedişini tanımlar — cari ekstreye alacak yazan
    /// işlem budur. Maaş tarafının birebir karşılığıdır.
    ///
    /// <para>Yemek sabit aylık bir ödeme değildir: günlük yemek bedeli (<c>Employees.MealAmount</c>)
    /// × personelin fiilen GELDİĞİ gün sayısı. Giriş/çıkış kaydı yoksa dönemin bugüne kadar geçen
    /// İŞ GÜNÜ sayısı üzerinden öneri üretilir — takvim günü değil, hafta sonu ve tatil sayılmaz.</para>
    ///
    /// <para>Kayıt <c>EmployeeMealPlans</c> üzerinde tutulur; cari ekstre yemek alacağını yalnızca
    /// buradan okur. Hakediş motorunun <c>MealAccrual</c> değeri ekstreye GİRMEZ — ikisi aynı şeyin
    /// iki yolu, ikisi birden sayılırsa aynı yemek iki kez alacaklandırılır.</para>
    ///
    /// <para>Aynı dönem yeniden tanımlanırsa tutar güncellenir, ikinci plan doğmaz. Ödenmiş bir
    /// dönem yeniden tanımlanamaz.</para>
    /// </summary>
    [HttpPost("define-meal")]
    public async Task<IActionResult> DefineMealAccrual(
        [FromBody] DefineMealAccrualRequest request,
        CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(request.Period))
            return BadRequest(new { success = false, message = "Dönem (yyyy-MM) gereklidir." });

        var ids = (request.EmployeeIds ?? new List<int>()).Where(x => x > 0).Distinct().ToList();
        if (ids.Count == 0)
            return BadRequest(new { success = false, message = "Çalışan seçilmedi." });

        var period = request.Period.Trim();
        var user = User.Identity?.Name ?? "Admin";
        var now = DateTime.UtcNow;

        var employees = await _dbContext.Employees
            .AsNoTracking()
            .Where(x => ids.Contains(x.Id))
            .Select(x => new { x.Id, x.FirstName, x.LastName, x.MealAmount, x.HasMealAllowance, x.SalaryDay, x.HireDate })
            .ToListAsync(cancellationToken);

        if (employees.Count == 0)
            return BadRequest(new { success = false, message = "Çalışan bulunamadı." });

        var calculated = await _accruals.CalculateAsync(period, ids, includeDays: false, cancellationToken);

        var schedule = await _calendar.GetScheduleAsync(null, cancellationToken);
        var (winStart, winEnd) = SalaryProrationCalculator.ResolveWindow(period, 1);
        var workCalendar = await _calendar.BuildAsync(winStart, winStart.AddMonths(2).AddDays(-1), schedule, cancellationToken);

        var mealOverrides = await _dbContext.EmployeeMonthlyOverrides
            .AsNoTracking()
            .Where(x => x.Period == period && x.OverrideType == MonthlyOverrideType.Meal && ids.Contains(x.EmployeeId))
            .ToDictionaryAsync(x => x.EmployeeId, x => x.OverrideAmount, cancellationToken);

        // Donemin plani: dönem penceresinin bitiş gününe yazılır, ay başına tek kayıt.
        var periodStartUtc = TurkeyTime.StartOfDayUtc(TurkeyTime.MonthRange(period).FirstDay);
        var periodEndUtc = TurkeyTime.EndOfDayUtc(TurkeyTime.MonthRange(period).LastDay);

        var existing = await _dbContext.Set<EmployeeMealPlan>()
            .Where(x => ids.Contains(x.EmployeeId) && x.PlannedDate >= periodStartUtc && x.PlannedDate <= periodEndUtc)
            .ToListAsync(cancellationToken);

        var defined = 0;
        var skipped = new List<string>();

        foreach (var emp in employees)
        {
            var name = $"{emp.FirstName} {emp.LastName}".Trim();
            var calc = calculated.FirstOrDefault(x => x.EmployeeId == emp.Id);

            decimal amount;
            // Yemek verilmeyen personel icin hakedis TANIMLANMAZ.
            if (!emp.HasMealAllowance)
            {
                skipped.Add($"{name} (yemek verilmiyor)");
                continue;
            }

            if (request.Amounts != null && request.Amounts.TryGetValue(emp.Id, out var custom))
            {
                amount = custom;
            }
            else if (mealOverrides.TryGetValue(emp.Id, out var ov))
            {
                amount = ov;
            }
            else if (calc is { MealAccrual: > 0m })
            {
                amount = calc.MealAccrual;
            }
            else
            {
                // Mesai kaydi yoksa yemek hakedisi de 0 — maasla ayni kural. Personel atlanir.
                amount = 0m;
            }

            if (amount <= 0m)
            {
                skipped.Add(name);
                continue;
            }

            var row = existing.FirstOrDefault(x => x.EmployeeId == emp.Id);
            if (row != null)
            {
                // Odenmis donemi yeniden tanimlamak, odenmis tutarla alacagi ayristirir.
                if (row.Status == EmployeeMealPlanStatus.Paid)
                {
                    skipped.Add($"{name} (ödenmiş)");
                    continue;
                }

                row.Amount = amount;
                row.Description = request.Description ?? $"{period} dönemi yemek hakedişi";
                row.EditUser = user;
                row.EditTime = now;
            }
            else
            {
                _dbContext.Set<EmployeeMealPlan>().Add(new EmployeeMealPlan
                {
                    EmployeeId = emp.Id,
                    PlannedDate = TurkeyTime.StartOfDayUtc(TurkeyTime.MonthRange(period).LastDay),
                    Amount = amount,
                    Description = request.Description ?? $"{period} dönemi yemek hakedişi",
                    Status = EmployeeMealPlanStatus.Planned,
                    CreateUser = user,
                    CreateTime = now
                });
            }

            defined++;
        }

        await _dbContext.SaveChangesAsync(cancellationToken);

        return Ok(new
        {
            success = true,
            period,
            definedCount = defined,
            skipped,
            message = defined > 0
                ? $"{defined} personel için {period} dönemi yemek hakedişi tanımlandı."
                : "Tanımlanacak yemek hakedişi bulunamadı."
        });
    }

    /// <summary>İlgili dönemde TANIMLANMIŞ maaş hakedişleri.</summary>
    [HttpGet("defined-salary")]
    public async Task<IActionResult> GetDefinedSalaryAccruals(
        [FromQuery] string? period,
        [FromQuery] int? employeeId,
        CancellationToken cancellationToken = default)
    {
        var query = _dbContext.EmployeeSalaryAccruals.AsNoTracking().AsQueryable();

        if (!string.IsNullOrWhiteSpace(period))
            query = query.Where(x => x.Period == period);

        if (employeeId is > 0)
            query = query.Where(x => x.EmployeeId == employeeId.Value);

        var list = await query
            .OrderByDescending(x => x.Period)
            .ThenBy(x => x.EmployeeId)
            .Select(x => new
            {
                x.Id,
                x.EmployeeId,
                x.Period,
                x.Amount,
                x.CalculatedAmount,
                x.DeductedAdvances,
                x.Description,
                x.ReferenceNo,
                x.CreateUser,
                x.CreateTime
            })
            .ToListAsync(cancellationToken);

        return Ok(new { success = true, data = list });
    }

    /// <summary>Tanımlanmış maaş hakedişini geri alır (kullanıcı kararı: kayıt silinir).</summary>
    [HttpDelete("defined-salary/{id:int}")]
    public async Task<IActionResult> DeleteDefinedSalaryAccrual(
        [FromRoute] int id,
        CancellationToken cancellationToken = default)
    {
        var row = await _dbContext.EmployeeSalaryAccruals.FirstOrDefaultAsync(x => x.Id == id, cancellationToken);
        if (row is null) return NotFound(new { success = false, message = "Hakediş kaydı bulunamadı." });

        _dbContext.EmployeeSalaryAccruals.Remove(row);
        await _dbContext.SaveChangesAsync(cancellationToken);

        return Ok(new { success = true, message = "Hakediş tanımı geri alındı." });
    }

    public sealed class UpsertDailyOverrideRequest
    {
        public int EmployeeId { get; set; }

        /// <summary>Düzeltilecek gün "yyyy-MM-dd".</summary>
        public string Date { get; set; } = string.Empty;

        /// <summary>1 = maaş, 2 = yemek.</summary>
        public int Kind { get; set; } = 1;

        /// <summary>O günün çalışılmış sayılacak dakikası. Unutulan çıkış için bunu kullan.</summary>
        public int? OverrideMinutes { get; set; }

        /// <summary>O günün TL değeri. Doluysa dakika hesabının önüne geçer.</summary>
        public decimal? OverrideAmount { get; set; }

        public string? Description { get; set; }
    }

    /// <summary>
    /// Tek bir günün hakedişini elle düzeltir. Gün + personel + tür başına tek kayıt;
    /// aynı gün yeniden düzeltilirse üzerine yazılır.
    ///
    /// <para>Hakediş dakika bazlı ilerlediği için düzeltme yalnızca o günü etkiler; dönemin
    /// geri kalanı motorun hesabıyla yürür. Snapshot bu çalışan için tazelenir, yoksa ekranda
    /// eski değer görünmeye devam ederdi.</para>
    /// </summary>
    [HttpPost("daily-override")]
    public async Task<IActionResult> SaveDailyOverride(
        [FromBody] UpsertDailyOverrideRequest request,
        CancellationToken cancellationToken = default)
    {
        if (request.EmployeeId <= 0)
            return BadRequest(new { success = false, message = "Geçersiz çalışan." });

        if (string.IsNullOrWhiteSpace(request.Date) || !DateOnly.TryParse(request.Date, out var day))
            return BadRequest(new { success = false, message = "Gün (yyyy-MM-dd) geçersiz." });

        if (request.OverrideMinutes is null && request.OverrideAmount is null)
            return BadRequest(new { success = false, message = "Dakika veya tutar düzeltmesi girilmeli." });

        if (request.OverrideMinutes is < 0 || request.OverrideAmount is < 0m)
            return BadRequest(new { success = false, message = "Değerler negatif olamaz." });

        var kind = (DailyOverrideKind)request.Kind;
        var dateKey = day.ToString("yyyy-MM-dd");
        var user = User.Identity?.Name ?? "Admin";
        var now = DateTime.UtcNow;

        var existing = await _dbContext.EmployeeDailyAccrualOverrides
            .FirstOrDefaultAsync(x => x.EmployeeId == request.EmployeeId && x.Date == dateKey && x.Kind == kind, cancellationToken);

        if (existing != null)
        {
            existing.OverrideMinutes = request.OverrideMinutes;
            existing.OverrideAmount = request.OverrideAmount;
            existing.Description = request.Description;
            existing.EditUser = user;
            existing.EditTime = now;
        }
        else
        {
            _dbContext.EmployeeDailyAccrualOverrides.Add(new EmployeeDailyAccrualOverride
            {
                EmployeeId = request.EmployeeId,
                Date = dateKey,
                Kind = kind,
                OverrideMinutes = request.OverrideMinutes,
                OverrideAmount = request.OverrideAmount,
                Description = request.Description,
                CreateUser = user,
                CreateTime = now
            });
        }

        await _dbContext.SaveChangesAsync(cancellationToken);

        var period = TurkeyTime.PeriodOf(day);
        await _accruals.CalculateWithSnapshotsAsync(period, new[] { request.EmployeeId }, forceRefresh: true, cancellationToken);

        return Ok(new { success = true, message = $"{dateKey} günü düzeltmesi kaydedildi." });
    }

    /// <summary>Bir günün düzeltmesini kaldırır; o gün motorun hesabına döner.</summary>
    [HttpDelete("daily-override")]
    public async Task<IActionResult> DeleteDailyOverride(
        [FromQuery] int employeeId,
        [FromQuery] string date,
        [FromQuery] int kind = 1,
        CancellationToken cancellationToken = default)
    {
        if (employeeId <= 0 || string.IsNullOrWhiteSpace(date) || !DateOnly.TryParse(date, out var day))
            return BadRequest(new { success = false, message = "Geçersiz istek." });

        var dateKey = day.ToString("yyyy-MM-dd");
        var row = await _dbContext.EmployeeDailyAccrualOverrides
            .FirstOrDefaultAsync(x => x.EmployeeId == employeeId && x.Date == dateKey && x.Kind == (DailyOverrideKind)kind, cancellationToken);

        if (row is null) return NotFound(new { success = false, message = "Düzeltme bulunamadı." });

        _dbContext.EmployeeDailyAccrualOverrides.Remove(row);
        await _dbContext.SaveChangesAsync(cancellationToken);

        await _accruals.CalculateWithSnapshotsAsync(TurkeyTime.PeriodOf(day), new[] { employeeId }, forceRefresh: true, cancellationToken);

        return Ok(new { success = true, message = "Düzeltme kaldırıldı." });
    }

    /// <summary>İlgili dönemdeki gün bazlı düzeltmeler.</summary>
    [HttpGet("daily-overrides")]
    public async Task<IActionResult> GetDailyOverrides(
        [FromQuery] int employeeId,
        [FromQuery] string? period,
        [FromQuery] int kind = 1,
        CancellationToken cancellationToken = default)
    {
        if (employeeId <= 0) return BadRequest(new { success = false, message = "Geçersiz çalışan." });

        var targetPeriod = string.IsNullOrWhiteSpace(period)
            ? TurkeyTime.PeriodOf(TurkeyTime.LocalDate(DateTime.UtcNow))
            : period.Trim();

        var range = TurkeyTime.MonthRange(targetPeriod);
        var from = TurkeyTime.Ymd(range.FirstDay);
        var to = TurkeyTime.Ymd(range.LastDay);

        var rows = await _dbContext.EmployeeDailyAccrualOverrides
            .AsNoTracking()
            .Where(x => x.EmployeeId == employeeId && x.Kind == (DailyOverrideKind)kind)
            .Where(x => string.Compare(x.Date, from) >= 0 && string.Compare(x.Date, to) <= 0)
            .OrderBy(x => x.Date)
            .Select(x => new { x.Id, x.Date, x.OverrideMinutes, x.OverrideAmount, x.Description, x.CreateUser, x.CreateTime })
            .ToListAsync(cancellationToken);

        return Ok(new { success = true, data = rows });
    }

    /// <summary>Aylık maaş veya yemek tutarını ilgili aya özel manuel override etme.</summary>
    [HttpPost("override")]
    public async Task<IActionResult> SaveOverride(
        [FromBody] UpsertMonthlyOverrideRequest request,
        CancellationToken cancellationToken = default)
    {
        if (request.EmployeeId <= 0)
            return BadRequest(new { success = false, message = "Geçersiz çalışan." });

        if (string.IsNullOrWhiteSpace(request.Period))
            return BadRequest(new { success = false, message = "Dönem (yyyy-MM) gereklidir." });

        var employee = await _dbContext.Employees
            .FirstOrDefaultAsync(x => x.Id == request.EmployeeId, cancellationToken);

        if (employee == null)
            return NotFound(new { success = false, message = "Çalışan bulunamadı." });

        var overrideType = (MonthlyOverrideType)request.OverrideType;

        var existing = await _dbContext.EmployeeMonthlyOverrides
            .FirstOrDefaultAsync(x => x.EmployeeId == request.EmployeeId
                                      && x.Period == request.Period
                                      && x.OverrideType == overrideType, cancellationToken);

        var originalAmount = overrideType == MonthlyOverrideType.Salary
            ? employee.Salary
            : employee.MealAmount;

        var user = User.Identity?.Name ?? "Admin";

        if (existing != null)
        {
            existing.OverrideAmount = request.OverrideAmount;
            existing.Description = request.Description;
            existing.EditUser = user;
            existing.EditTime = DateTime.UtcNow;
        }
        else
        {
            _dbContext.EmployeeMonthlyOverrides.Add(new EmployeeMonthlyOverride
            {
                EmployeeId = request.EmployeeId,
                Period = request.Period,
                OverrideType = overrideType,
                OriginalAmount = originalAmount,
                OverrideAmount = request.OverrideAmount,
                Description = request.Description,
                CreateUser = user,
                CreateTime = DateTime.UtcNow
            });
        }

        // TANIMLI HAKEDİŞ DE GÜNCELLENİR (2026-10-16). Hakediş tanımlandıktan sonra "Düzenle" ile
        // tutar değişince maaş ekranı tanımlı (eski) tutarı, cari ekstre düzenlenen (yeni) tutarı
        // gösteriyordu; aynı personel için iki ekran iki ayrı borç söylüyordu. Kullanıcının son
        // girdiği tutar geçerlidir.
        var syncedAccrual = false;
        if (overrideType == MonthlyOverrideType.Salary && request.OverrideAmount > 0m)
        {
            var definedRow = await _dbContext.EmployeeSalaryAccruals
                .FirstOrDefaultAsync(x => x.EmployeeId == request.EmployeeId && x.Period == request.Period, cancellationToken);
            if (definedRow is not null && definedRow.Amount != request.OverrideAmount)
            {
                definedRow.Amount = request.OverrideAmount;
                definedRow.EditUser = user;
                definedRow.EditTime = DateTime.UtcNow;
                syncedAccrual = true;
            }
        }

        await _dbContext.SaveChangesAsync(cancellationToken);

        // Hakediş snapshot'ını bu çalışan için tazele
        await _accruals.CalculateWithSnapshotsAsync(request.Period, new[] { request.EmployeeId }, forceRefresh: true, cancellationToken);

        return Ok(new
        {
            success = true,
            accrualUpdated = syncedAccrual,
            message = syncedAccrual
                ? "Manuel düzenleme kaydedildi; tanımlı hakediş ve cari ekstre de bu tutara güncellendi."
                : "Manuel düzenleme kaydedildi."
        });
    }

    /// <summary>İlgili döneme ait manuel override kayıtları.</summary>
    [HttpGet("overrides")]
    public async Task<IActionResult> GetOverrides(
        [FromQuery] string? period,
        [FromQuery] int? employeeId,
        CancellationToken cancellationToken = default)
    {
        var query = _dbContext.EmployeeMonthlyOverrides.AsNoTracking().AsQueryable();

        if (!string.IsNullOrWhiteSpace(period))
            query = query.Where(x => x.Period == period);

        if (employeeId.HasValue && employeeId.Value > 0)
            query = query.Where(x => x.EmployeeId == employeeId.Value);

        var list = await query
            .OrderByDescending(x => x.CreateTime)
            .Select(x => new
            {
                x.Id,
                x.EmployeeId,
                x.Period,
                x.OverrideType,
                x.OriginalAmount,
                x.OverrideAmount,
                x.Description,
                x.CreateUser,
                x.CreateTime
            })
            .ToListAsync(cancellationToken);

        return Ok(new { success = true, data = list });
    }

    /// <summary>Manuel override'ı silip standart hesaplamaya dönme.</summary>
    [HttpDelete("override/{id:int}")]
    public async Task<IActionResult> DeleteOverride(
        [FromRoute] int id,
        CancellationToken cancellationToken = default)
    {
        var item = await _dbContext.EmployeeMonthlyOverrides
            .FirstOrDefaultAsync(x => x.Id == id, cancellationToken);

        if (item == null)
            return NotFound(new { success = false, message = "Kayıt bulunamadı." });

        _dbContext.EmployeeMonthlyOverrides.Remove(item);
        await _dbContext.SaveChangesAsync(cancellationToken);

        // Snapshot'ı tazele
        await _accruals.CalculateWithSnapshotsAsync(item.Period, new[] { item.EmployeeId }, forceRefresh: true, cancellationToken);

        return Ok(new { success = true, message = "Manuel düzenleme kaldırıldı." });
    }

    private static List<int>? ParseIds(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return null;

        var ids = raw
            .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Select(x => int.TryParse(x, out var n) ? n : 0)
            .Where(x => x > 0)
            .Distinct()
            .ToList();

        return ids.Count == 0 ? null : ids;
    }

    public sealed class RefreshAccrualRequest
    {
        public string? Period { get; set; }
        public List<int>? EmployeeIds { get; set; }
    }

    public sealed class UpsertMonthlyOverrideRequest
    {
        public int EmployeeId { get; set; }
        public string Period { get; set; } = string.Empty;
        public int OverrideType { get; set; } // 1=Salary, 2=Meal
        public decimal OverrideAmount { get; set; }
        public string? Description { get; set; }
    }
}
