using System.Security.Claims;
using B2B.Erp.Api.Core.Authorization;
using B2B.Erp.Api.Core.Services;
using B2B.Erp.Api.Core.Time;
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
public sealed class EmployeeLeavesController : ControllerBase
{
    private readonly AppDbContext _dbContext;
    private readonly WorkCalendarService _calendar;

    public EmployeeLeavesController(AppDbContext dbContext, WorkCalendarService calendar)
    {
        _dbContext = dbContext;
        _calendar = calendar;
    }

    private static DateTime NormalizeUtc(DateTime dt)
    {
        if (dt == default) return DateTime.UtcNow;
        return dt.Kind == DateTimeKind.Utc ? dt : DateTime.SpecifyKind(dt, DateTimeKind.Utc);
    }

    private string GetUsername()
    {
        var username = User.FindFirst(ClaimTypes.Name)?.Value;
        return string.IsNullOrWhiteSpace(username) ? "System" : username;
    }

    [HttpGet("by-employee/{employeeId:int}")]
    public async Task<IActionResult> ByEmployee([FromRoute] int employeeId, [FromQuery] int take = 500, CancellationToken cancellationToken = default)
    {
        if (employeeId <= 0) return BadRequest(new { success = false, message = "Geçersiz çalışan" });
        take = Math.Clamp(take, 1, 2000);

        var data = await _dbContext.Set<EmployeeLeave>()
            .AsNoTracking()
            .Where(x => x.EmployeeId == employeeId)
            .OrderByDescending(x => x.LeaveStartTime)
            .ThenByDescending(x => x.Id)
            .Take(take)
            .Select(x => new EmployeeLeaveListItemResponse
            {
                Id = x.Id,
                EmployeeId = x.EmployeeId,
                LeaveStartTime = x.LeaveStartTime,
                ReturnTime = x.ReturnTime,
                Description = x.Description,
                LeaveType = x.LeaveType,
                Status = x.Status,
                IsPaid = x.IsPaid,
                DayCount = x.DayCount,
                DecidedBy = x.DecidedBy,
                DecidedAt = x.DecidedAt,
                RejectReason = x.RejectReason,
                CreateUser = x.CreateUser,
                CreateTime = x.CreateTime
            })
            .ToListAsync(cancellationToken);

        return Ok(new { success = true, data });
    }

    /// <summary>
    /// Personelin yıllık izin hakedişi ve bakiyesi.
    /// Hak, 4857 sayılı kanunun kıdem kademelerine göre hesaplanır; personel kartında elle
    /// giriş varsa o kullanılır. Kullanılan gün, onaylı yıllık izinlerin iş günü toplamıdır.
    /// </summary>
    [HttpGet("balance/{employeeId:int}")]
    public async Task<IActionResult> Balance([FromRoute] int employeeId, [FromQuery] int? year, CancellationToken cancellationToken = default)
    {
        if (employeeId <= 0) return BadRequest(new { success = false, message = "Geçersiz çalışan" });

        var employee = await _dbContext.Employees
            .AsNoTracking()
            .Where(x => x.Id == employeeId)
            .Select(x => new { x.Id, x.FirstName, x.LastName, x.HireDate, x.AnnualLeaveOverrideDays })
            .FirstOrDefaultAsync(cancellationToken);

        if (employee is null) return NotFound(new { success = false, message = "Çalışan bulunamadı" });

        var targetYear = year is >= 2000 and <= 2100 ? year.Value : TurkeyTime.ToLocal(DateTime.UtcNow).Year;
        var yearStart = TurkeyTime.StartOfDayUtc(new DateOnly(targetYear, 1, 1));
        var yearEnd = TurkeyTime.EndOfDayUtc(new DateOnly(targetYear, 12, 31));

        var leaves = await _dbContext.Set<EmployeeLeave>()
            .AsNoTracking()
            .Where(x => x.EmployeeId == employeeId)
            .Where(x => x.LeaveStartTime < yearEnd && x.ReturnTime >= yearStart)
            .Select(x => new { x.LeaveType, x.Status, x.DayCount })
            .ToListAsync(cancellationToken);

        // GECMIS YILLARIN yillik izin kullanimi — devir hesabi icin.
        var priorAnnual = await _dbContext.Set<EmployeeLeave>()
            .AsNoTracking()
            .Where(x => x.EmployeeId == employeeId)
            .Where(x => x.LeaveType == EmployeeLeaveType.Annual && x.Status == EmployeeLeaveStatus.Approved)
            .Where(x => x.LeaveStartTime < yearStart)
            .Select(x => new { x.LeaveStartTime, x.DayCount })
            .ToListAsync(cancellationToken);

        var seniority = EmployeeAccrualService.SeniorityYearsAt(employee.HireDate, new DateOnly(targetYear, 12, 31));
        var entitlement = employee.AnnualLeaveOverrideDays ?? EmployeeAccrualService.LegalAnnualLeaveDays(seniority);

        var usedAnnual = leaves
            .Where(x => x.LeaveType == EmployeeLeaveType.Annual && x.Status == EmployeeLeaveStatus.Approved)
            .Sum(x => x.DayCount);

        var pendingAnnual = leaves
            .Where(x => x.LeaveType == EmployeeLeaveType.Annual && x.Status == EmployeeLeaveStatus.Pending)
            .Sum(x => x.DayCount);

        // --- YILLIK IZIN DEVRI ---
        //
        // Kullanilmayan yillik izin bir sonraki yila DEVREDER (Is Kanunu m.53-54); yil sonunda
        // yanmaz. Eskiden yalnizca icinde bulunulan yil hesaplaniyordu, gecen yildan kalan gunler
        // gorunmuyor ve elle `AnnualLeaveOverrideDays` alanina yazilmasi gerekiyordu.
        //
        // Devir = ise girisinden onceki yil sonuna kadar HER YIL icin (o yilin hakkedisi -
        // o yil kullanilan). Yil bazinda eksiye dusulmez: bir yil fazla kullanildiysa o yilin
        // bakiyesi 0 sayilir, sonraki yilin hakkindan eksiltilmez.
        //
        // ELLE OVERRIDE VARSA DEVIR EKLENMEZ: `AnnualLeaveOverrideDays` toplam hakkedisin elle
        // girilmis halidir; ustune bir de devir eklemek gunleri iki kez sayardi.
        decimal carryOver = 0m;
        if (!employee.AnnualLeaveOverrideDays.HasValue && employee.HireDate.HasValue)
        {
            var hireYear = TurkeyTime.LocalDate(employee.HireDate.Value).Year;
            var usedByYear = priorAnnual
                .GroupBy(x => TurkeyTime.LocalDate(x.LeaveStartTime).Year)
                .ToDictionary(g => g.Key, g => g.Sum(x => x.DayCount));

            // DEVIR YALNIZCA SISTEMIN IZLEDIGI YILLARDAN sayilir.
            //
            // Ise girisinden itibaren saymak, sisteme yeni gecilmis firmada felaket uretiyor:
            // 10 yillik personelin gecmis izinleri kagitta kaldigi icin her yil "hic
            // kullanilmamis" gorunuyor ve 170 gunluk hayali bakiye cikiyor. Devir, personelin
            // sistemdeki ILK izin kaydinin yilindan baslar; hic kaydi yoksa devir 0'dir —
            // sistemin gecmis hakkinda soyleyecek sozu yok.
            //
            // Gecmisten gercekten devreden gun varsa personel kartindaki
            // `AnnualLeaveOverrideDays` ile elle girilir.
            var firstTrackedYear = priorAnnual.Count > 0
                ? priorAnnual.Min(x => TurkeyTime.LocalDate(x.LeaveStartTime).Year)
                : targetYear;

            var startYear = Math.Max(hireYear, firstTrackedYear);

            for (var y = startYear; y < targetYear; y++)
            {
                var seniorityAtYearEnd = EmployeeAccrualService.SeniorityYearsAt(
                    employee.HireDate, new DateOnly(y, 12, 31));
                var yearEntitlement = EmployeeAccrualService.LegalAnnualLeaveDays(seniorityAtYearEnd);
                var yearUsed = usedByYear.TryGetValue(y, out var u) ? u : 0m;

                carryOver += Math.Max(0m, yearEntitlement - yearUsed);
            }
        }

        var totalEntitlement = entitlement + carryOver;

        return Ok(new
        {
            success = true,
            data = new
            {
                employeeId = employee.Id,
                employeeName = $"{employee.FirstName} {employee.LastName}".Trim(),
                year = targetYear,
                hireDate = employee.HireDate,
                seniorityYears = seniority,
                entitlementDays = entitlement,
                carryOverDays = carryOver,
                totalEntitlementDays = totalEntitlement,
                usedDays = usedAnnual,
                pendingDays = pendingAnnual,
                remainingDays = totalEntitlement - usedAnnual,
                isOverridden = employee.AnnualLeaveOverrideDays.HasValue,
                byType = leaves
                    .Where(x => x.Status == EmployeeLeaveStatus.Approved)
                    .GroupBy(x => x.LeaveType)
                    .Select(g => new { leaveType = (int)g.Key, days = g.Sum(x => x.DayCount) })
                    .ToList()
            }
        });
    }

    /// <summary>
    /// TÜM aktif personelin yıllık izin bakiyesi — izin yönetimi ekranının bakiye sekmesi.
    ///
    /// <para>Tekil <c>balance/{id}</c> ucu personel sayısı kadar istek gerektiriyordu.
    /// Hesap kuralı tekil uçla birebir aynıdır: hak ediş + devir − kullanılan.</para>
    /// </summary>
    [HttpGet("balances")]
    public async Task<IActionResult> Balances([FromQuery] int? year, CancellationToken cancellationToken = default)
    {
        var targetYear = year is >= 2000 and <= 2100 ? year.Value : TurkeyTime.ToLocal(DateTime.UtcNow).Year;
        var yearStart = TurkeyTime.StartOfDayUtc(new DateOnly(targetYear, 1, 1));
        var yearEnd = TurkeyTime.EndOfDayUtc(new DateOnly(targetYear, 12, 31));

        var employees = await _dbContext.Employees
            .AsNoTracking()
            .Where(x => x.IsActive)
            .Select(x => new { x.Id, x.EmployeeCode, x.FirstName, x.LastName, x.Workplace, x.HireDate, x.AnnualLeaveOverrideDays })
            .OrderBy(x => x.FirstName)
            .ToListAsync(cancellationToken);

        var ids = employees.Select(x => x.Id).ToList();

        var annual = await _dbContext.Set<EmployeeLeave>()
            .AsNoTracking()
            .Where(x => ids.Contains(x.EmployeeId) && x.LeaveType == EmployeeLeaveType.Annual)
            .Where(x => x.Status == EmployeeLeaveStatus.Approved || x.Status == EmployeeLeaveStatus.Pending)
            .Select(x => new { x.EmployeeId, x.LeaveStartTime, x.DayCount, x.Status })
            .ToListAsync(cancellationToken);

        var result = employees.Select(e =>
        {
            var mine = annual.Where(x => x.EmployeeId == e.Id).ToList();

            var used = mine
                .Where(x => x.Status == EmployeeLeaveStatus.Approved)
                .Where(x => x.LeaveStartTime >= yearStart && x.LeaveStartTime <= yearEnd)
                .Sum(x => x.DayCount);

            var pending = mine
                .Where(x => x.Status == EmployeeLeaveStatus.Pending)
                .Where(x => x.LeaveStartTime >= yearStart && x.LeaveStartTime <= yearEnd)
                .Sum(x => x.DayCount);

            var seniority = EmployeeAccrualService.SeniorityYearsAt(e.HireDate, new DateOnly(targetYear, 12, 31));
            var entitlement = e.AnnualLeaveOverrideDays ?? EmployeeAccrualService.LegalAnnualLeaveDays(seniority);

            // Devir kurali tekil uctakiyle AYNI: yalnizca sistemin izledigi yillardan sayilir,
            // elle override varsa hic sayilmaz. Iki yer ayrisirsa liste ile kart birbirini tutmaz.
            decimal carry = 0m;
            var prior = mine
                .Where(x => x.Status == EmployeeLeaveStatus.Approved && x.LeaveStartTime < yearStart)
                .ToList();

            if (!e.AnnualLeaveOverrideDays.HasValue && e.HireDate.HasValue && prior.Count > 0)
            {
                var hireYear = TurkeyTime.LocalDate(e.HireDate.Value).Year;
                var usedByYear = prior
                    .GroupBy(x => TurkeyTime.LocalDate(x.LeaveStartTime).Year)
                    .ToDictionary(g => g.Key, g => g.Sum(x => x.DayCount));

                var startYear = Math.Max(hireYear, prior.Min(x => TurkeyTime.LocalDate(x.LeaveStartTime).Year));

                for (var y = startYear; y < targetYear; y++)
                {
                    var sen = EmployeeAccrualService.SeniorityYearsAt(e.HireDate, new DateOnly(y, 12, 31));
                    var ent = EmployeeAccrualService.LegalAnnualLeaveDays(sen);
                    carry += Math.Max(0m, ent - (usedByYear.TryGetValue(y, out var u) ? u : 0m));
                }
            }

            var total = entitlement + carry;

            return new
            {
                employeeId = e.Id,
                employeeCode = e.EmployeeCode,
                employeeName = $"{e.FirstName} {e.LastName}".Trim(),
                workplace = e.Workplace,
                hireDate = e.HireDate,
                seniorityYears = seniority,
                entitlementDays = entitlement,
                carryOverDays = carry,
                totalEntitlementDays = total,
                usedDays = used,
                pendingDays = pending,
                remainingDays = total - used,
                isOverridden = e.AnnualLeaveOverrideDays.HasValue
            };
        }).ToList();

        return Ok(new { success = true, year = targetYear, data = result });
    }

    /// <summary>Onay bekleyen izin talepleri.</summary>
    /// <summary>
    /// Tarih ARALIĞINDAKİ tüm izinler — izin yönetimi ekranının takvim ve liste kaynağı.
    ///
    /// <para>Şu ana kadar yalnızca "personele göre" ve "onay bekleyen" uçları vardı; bir ayda
    /// kimin izinli olduğunu görmek için personel sayısı kadar istek atmak gerekiyordu.</para>
    ///
    /// <para>Aralıkla KESİŞEN izinler döner: 28 Ağustos–3 Eylül izni, ağustos sorgusunda da
    /// eylül sorgusunda da görünür — takvimde günü boş bırakmamak için şart.</para>
    /// </summary>
    [HttpGet("range")]
    public async Task<IActionResult> Range(
        [FromQuery] string? from,
        [FromQuery] string? to,
        [FromQuery] int? status,
        CancellationToken cancellationToken = default)
    {
        var today = TurkeyTime.LocalDate(DateTime.UtcNow);
        var fromDate = !string.IsNullOrWhiteSpace(from) && DateOnly.TryParse(from, out var f)
            ? f
            : new DateOnly(today.Year, today.Month, 1);
        var toDate = !string.IsNullOrWhiteSpace(to) && DateOnly.TryParse(to, out var t)
            ? t
            : fromDate.AddMonths(1).AddDays(-1);

        if (toDate < fromDate) (fromDate, toDate) = (toDate, fromDate);

        var startUtc = TurkeyTime.StartOfDayUtc(fromDate);
        var endUtc = TurkeyTime.EndOfDayUtc(toDate);

        var query = _dbContext.Set<EmployeeLeave>()
            .AsNoTracking()
            .Where(x => x.LeaveStartTime <= endUtc && x.ReturnTime >= startUtc);

        if (status is > 0)
        {
            var st = (EmployeeLeaveStatus)status.Value;
            query = query.Where(x => x.Status == st);
        }

        var data = await query
            .OrderBy(x => x.LeaveStartTime)
            .Select(x => new
            {
                id = x.Id,
                employeeId = x.EmployeeId,
                employeeName = x.Employee != null ? (x.Employee.FirstName + " " + x.Employee.LastName).Trim() : string.Empty,
                employeeCode = x.Employee != null ? x.Employee.EmployeeCode : null,
                leaveStartTime = x.LeaveStartTime,
                returnTime = x.ReturnTime,
                leaveType = (int)x.LeaveType,
                status = (int)x.Status,
                isPaid = x.IsPaid,
                dayCount = x.DayCount,
                description = x.Description,
                decidedBy = x.DecidedBy,
                rejectReason = x.RejectReason,
                createUser = x.CreateUser
            })
            .ToListAsync(cancellationToken);

        return Ok(new { success = true, from = TurkeyTime.Ymd(fromDate), to = TurkeyTime.Ymd(toDate), data });
    }

    [HttpGet("pending")]
    public async Task<IActionResult> Pending(CancellationToken cancellationToken = default)
    {
        var data = await _dbContext.Set<EmployeeLeave>()
            .AsNoTracking()
            .Where(x => x.Status == EmployeeLeaveStatus.Pending)
            .OrderBy(x => x.LeaveStartTime)
            .Select(x => new
            {
                id = x.Id,
                employeeId = x.EmployeeId,
                employeeName = x.Employee != null ? (x.Employee.FirstName + " " + x.Employee.LastName).Trim() : string.Empty,
                leaveStartTime = x.LeaveStartTime,
                returnTime = x.ReturnTime,
                leaveType = (int)x.LeaveType,
                isPaid = x.IsPaid,
                dayCount = x.DayCount,
                description = x.Description,
                createUser = x.CreateUser,
                createTime = x.CreateTime
            })
            .ToListAsync(cancellationToken);

        return Ok(new { success = true, data });
    }

    [HttpPost]
    public async Task<IActionResult> Create([FromBody] CreateEmployeeLeaveRequest request, CancellationToken cancellationToken)
    {
        if (!ModelState.IsValid) return ValidationProblem(ModelState);
        if (request.EmployeeId <= 0) return BadRequest(new { success = false, message = "Geçersiz çalışan" });

        var start = NormalizeUtc(request.LeaveStartTime);
        var end = NormalizeUtc(request.ReturnTime);
        if (end <= start) return BadRequest(new { success = false, message = "Dönüş tarihi çıkış tarihinden büyük olmalıdır" });

        var employee = await _dbContext.Employees
            .AsNoTracking()
            .Where(x => x.Id == request.EmployeeId)
            .Select(x => new { x.Id, x.HireDate, x.AnnualLeaveOverrideDays, x.WorkScheduleSettingId })
            .FirstOrDefaultAsync(cancellationToken);

        if (employee is null) return BadRequest(new { success = false, message = "Çalışan bulunamadı" });

        // Çakışma kontrolü: aynı personele üst üste binen izin girilemez. Eskiden kontrol
        // yoktu; aynı güne iki izin girilebiliyor ve izin günü iki kez sayılıyordu.
        var overlaps = await _dbContext.Set<EmployeeLeave>()
            .AsNoTracking()
            .Where(x => x.EmployeeId == request.EmployeeId)
            .Where(x => x.Status == EmployeeLeaveStatus.Approved || x.Status == EmployeeLeaveStatus.Pending)
            .AnyAsync(x => x.LeaveStartTime < end && x.ReturnTime > start, cancellationToken);

        if (overlaps)
        {
            return Conflict(new { success = false, message = "Bu tarihlerle çakışan bir izin kaydı zaten var" });
        }

        var leaveType = request.LeaveType ?? EmployeeLeaveType.Annual;
        var status = request.Status ?? EmployeeLeaveStatus.Approved;
        var isPaid = request.IsPaid ?? leaveType != EmployeeLeaveType.Unpaid;

        var schedule = await _calendar.GetScheduleAsync(employee.WorkScheduleSettingId, cancellationToken);
        var dayCount = await _calendar.CalculateLeaveDaysAsync(start, end, schedule, cancellationToken);

        if (dayCount <= 0)
        {
            var totalCalDays = (decimal)Math.Max(1, TurkeyTime.LocalDate(end).DayNumber - TurkeyTime.LocalDate(start).DayNumber + (start.Date == end.Date ? 1 : 0));
            dayCount = totalCalDays;
        }



        // Yıllık izinde bakiye aşımı engellenir; hak edilmemiş izin kullandırmak
        // çıkışta kıdem/izin ücreti hesabını bozar.
        if (leaveType == EmployeeLeaveType.Annual && status == EmployeeLeaveStatus.Approved)
        {
            var year = TurkeyTime.LocalDate(start).Year;
            var yearStart = TurkeyTime.StartOfDayUtc(new DateOnly(year, 1, 1));
            var yearEnd = TurkeyTime.EndOfDayUtc(new DateOnly(year, 12, 31));

            var used = await _dbContext.Set<EmployeeLeave>()
                .AsNoTracking()
                .Where(x => x.EmployeeId == request.EmployeeId)
                .Where(x => x.LeaveType == EmployeeLeaveType.Annual)
                .Where(x => x.Status == EmployeeLeaveStatus.Approved)
                .Where(x => x.LeaveStartTime < yearEnd && x.ReturnTime >= yearStart)
                .SumAsync(x => x.DayCount, cancellationToken);

            var seniority = EmployeeAccrualService.SeniorityYearsAt(employee.HireDate, new DateOnly(year, 12, 31));
            var entitlement = employee.AnnualLeaveOverrideDays ?? EmployeeAccrualService.LegalAnnualLeaveDays(seniority);

            if (used + dayCount > entitlement)
            {
                return BadRequest(new
                {
                    success = false,
                    message = $"Yıllık izin bakiyesi yetersiz. Hak: {entitlement} gün, kullanılan: {used} gün, talep: {dayCount} gün."
                });
            }
        }

        var now = DateTime.UtcNow;
        var username = GetUsername();

        var entity = new EmployeeLeave
        {
            EmployeeId = request.EmployeeId,
            LeaveStartTime = start,
            ReturnTime = end,
            Description = string.IsNullOrWhiteSpace(request.Description) ? null : request.Description.Trim(),
            LeaveType = leaveType,
            Status = status,
            IsPaid = isPaid,
            DayCount = dayCount,
            DecidedBy = status == EmployeeLeaveStatus.Approved ? username : null,
            DecidedAt = status == EmployeeLeaveStatus.Approved ? now : null,
            CreateUser = username,
            CreateTime = now
        };

        _dbContext.Set<EmployeeLeave>().Add(entity);
        await _dbContext.SaveChangesAsync(cancellationToken);

        return StatusCode(StatusCodes.Status201Created, new { success = true, data = new { id = entity.Id, dayCount } });
    }

    public sealed class DecideLeaveRequest
    {
        public bool Approve { get; set; }

        public string? RejectReason { get; set; }
    }

    /// <summary>İzin talebini onaylar ya da reddeder.</summary>
    [HttpPut("{id:int}/decide")]
    public async Task<IActionResult> Decide([FromRoute] int id, [FromBody] DecideLeaveRequest request, CancellationToken cancellationToken)
    {
        if (id <= 0) return BadRequest(new { success = false, message = "Geçersiz izin" });

        var entity = await _dbContext.Set<EmployeeLeave>().FirstOrDefaultAsync(x => x.Id == id, cancellationToken);
        if (entity is null) return NotFound(new { success = false, message = "İzin kaydı bulunamadı" });

        if (entity.Status != EmployeeLeaveStatus.Pending)
        {
            return BadRequest(new { success = false, message = "Sadece onay bekleyen izin kararlandırılabilir" });
        }

        entity.Status = request.Approve ? EmployeeLeaveStatus.Approved : EmployeeLeaveStatus.Rejected;
        entity.RejectReason = request.Approve ? null : request.RejectReason?.Trim();
        entity.DecidedBy = GetUsername();
        entity.DecidedAt = DateTime.UtcNow;
        entity.EditUser = GetUsername();
        entity.EditTime = DateTime.UtcNow;

        await _dbContext.SaveChangesAsync(cancellationToken);
        return Ok(new { success = true });
    }

    public sealed class EarlyReturnRequest
    {
        /// <summary>Fiilî dönüş anı. Boş gelirse izin aralığındaki İLK giriş (check-in) kaydı alınır.</summary>
        public DateTime? ReturnTime { get; set; }
    }

    /// <summary>
    /// İZİNDEN ERKEN DÖNÜŞ (2026-10-04 kullanıcı bildirimi: "izin alıp erken gelince yine izinli
    /// gösteriyordu").
    ///
    /// <para>İzin kaydının dönüş anını öne çeker ve gün sayısını (yıllık izin bakiyesinden düşen
    /// gün) yeniden hesaplar. Hakediş motoru izinli günde yapılan çalışmayı zaten çalışma sayar;
    /// bu uç kaydın kendisini — dolayısıyla izin bakiyesini — düzeltir.</para>
    ///
    /// <para>Dönüş anı verilmezse personelin izin aralığındaki ilk giriş kaydı kullanılır; böyle bir
    /// kayıt yoksa istek reddedilir.</para>
    /// </summary>
    [HttpPut("{id:int}/early-return")]
    public async Task<IActionResult> EarlyReturn([FromRoute] int id, [FromBody] EarlyReturnRequest request, CancellationToken cancellationToken)
    {
        if (id <= 0) return BadRequest(new { success = false, message = "Geçersiz izin" });

        var entity = await _dbContext.Set<EmployeeLeave>().FirstOrDefaultAsync(x => x.Id == id, cancellationToken);
        if (entity is null) return NotFound(new { success = false, message = "İzin kaydı bulunamadı" });

        DateTime newReturn;
        if (request.ReturnTime.HasValue && request.ReturnTime.Value != default)
        {
            newReturn = NormalizeUtc(request.ReturnTime.Value);
        }
        else
        {
            var firstCheckIn = await _dbContext.EmployeeCheckIns
                .AsNoTracking()
                .Where(x => x.EmployeeId == entity.EmployeeId
                            && x.CheckInTime > entity.LeaveStartTime
                            && x.CheckInTime < entity.ReturnTime)
                .OrderBy(x => x.CheckInTime)
                .Select(x => (DateTime?)x.CheckInTime)
                .FirstOrDefaultAsync(cancellationToken);

            if (!firstCheckIn.HasValue)
            {
                return BadRequest(new { success = false, message = "İzin süresi içinde giriş kaydı yok; dönüş tarihini elle seçin." });
            }

            newReturn = NormalizeUtc(firstCheckIn.Value);
        }

        if (newReturn <= entity.LeaveStartTime)
        {
            return BadRequest(new { success = false, message = "Dönüş, izin başlangıcından sonra olmalıdır. İzin hiç kullanılmadıysa kaydı silin." });
        }

        if (newReturn >= entity.ReturnTime)
        {
            return BadRequest(new { success = false, message = "Erken dönüş, mevcut dönüş tarihinden önce olmalıdır." });
        }

        var scheduleId = await _dbContext.Employees
            .AsNoTracking()
            .Where(x => x.Id == entity.EmployeeId)
            .Select(x => x.WorkScheduleSettingId)
            .FirstOrDefaultAsync(cancellationToken);

        var schedule = await _calendar.GetScheduleAsync(scheduleId, cancellationToken);
        var oldDayCount = entity.DayCount;
        var dayCount = await _calendar.CalculateLeaveDaysAsync(entity.LeaveStartTime, newReturn, schedule, cancellationToken);

        entity.ReturnTime = newReturn;
        entity.DayCount = dayCount;
        entity.EditUser = GetUsername();
        entity.EditTime = DateTime.UtcNow;

        await _dbContext.SaveChangesAsync(cancellationToken);

        return Ok(new
        {
            success = true,
            data = new { id = entity.Id, returnTime = entity.ReturnTime, dayCount, oldDayCount },
            message = $"İzin {TurkeyTime.ToLocal(newReturn):dd.MM.yyyy HH:mm} itibarıyla kapatıldı. İzin günü {oldDayCount:0.##} → {dayCount:0.##}."
        });
    }

    [HttpDelete("{id:int}")]
    public async Task<IActionResult> Delete([FromRoute] int id, CancellationToken cancellationToken = default)
    {
        if (id <= 0) return BadRequest(new { success = false, message = "Geçersiz izin" });

        var entity = await _dbContext.Set<EmployeeLeave>().FirstOrDefaultAsync(x => x.Id == id, cancellationToken);
        if (entity is null) return NotFound(new { success = false, message = "İzin kaydı bulunamadı" });

        _dbContext.Set<EmployeeLeave>().Remove(entity);
        await _dbContext.SaveChangesAsync(cancellationToken);

        return Ok(new { success = true });
    }
}
