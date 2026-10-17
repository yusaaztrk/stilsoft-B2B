using System.Security.Claims;
using B2B.Erp.Api.Core.Services;
using B2B.Erp.Api.Core.Time;
using System.ComponentModel.DataAnnotations;
using B2B.Erp.Api.Data;
using B2B.Erp.Api.Entities;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace B2B.Erp.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
[Authorize]
public sealed class EmployeeSelfController : ControllerBase
{
    private readonly AppDbContext _dbContext;
    private readonly WorkCalendarService _calendar;
    private readonly ReverseGeocoder _geocoder;

    public EmployeeSelfController(AppDbContext dbContext, WorkCalendarService calendar, ReverseGeocoder geocoder)
    {
        _dbContext = dbContext;
        _calendar = calendar;
        _geocoder = geocoder;
    }

    private int? GetEmployeeId()
    {
        var raw = User.Claims.FirstOrDefault(c => string.Equals(c.Type, "EmployeeId", StringComparison.OrdinalIgnoreCase))?.Value;
        return int.TryParse(raw, out var id) && id > 0 ? id : null;
    }

    /// <summary>
    /// Donem baslangicini TURKIYE gunune gore verir.
    ///
    /// Eskiden ay siniri dogrudan UTC'de kuruluyor, gun etiketi de UTC tarihinden
    /// uretiliyordu. Turkiye UTC+3 oldugu icin gece 00:00-03:00 arasi atilan mesai kaydi
    /// bir onceki gune, ay basi/sonu kayitlari da yanlis aya dusuyordu.
    /// </summary>
    private static (DateTime StartUtc, DateTime EndUtc, string Key) MonthRangeUtc(string month)
    {
        var (year, m) = TurkeyTime.ParsePeriod(month);
        var first = new DateOnly(year, m, 1);
        var last = first.AddMonths(1);

        return (TurkeyTime.StartOfDayUtc(first), TurkeyTime.StartOfDayUtc(last), $"{year:D4}-{m:D2}");
    }

    /// <summary>UTC damgayi TURKIYE gunune cevirip yyyy-MM-dd verir.</summary>
    private static string Ymd(DateTime utc) => TurkeyTime.Ymd(TurkeyTime.LocalDate(utc));

    public sealed class DashboardResponse
    {
        public sealed class EmployeeInfo
        {
            public int EmployeeId { get; set; }
            public string EmployeeName { get; set; } = string.Empty;
            public string? EmployeeCode { get; set; }
            public string? Mail { get; set; }
        }

        public sealed class CalendarInfo
        {
            public string Month { get; set; } = string.Empty;
            public List<string> WorkedDays { get; set; } = new();
            public List<string> LeaveDays { get; set; } = new();
        }

        public sealed class CheckInItem
        {
            public int Id { get; set; }
            public DateTime CheckInTime { get; set; }
            public DateTime? CheckOutTime { get; set; }
        }

        public sealed class LeaveItem
        {
            public int Id { get; set; }
            public DateTime LeaveStartTime { get; set; }
            public DateTime ReturnTime { get; set; }
            public string? Description { get; set; }
        }

        public sealed class PaymentItem
        {
            public int Id { get; set; }
            public int Type { get; set; }
            public decimal Amount { get; set; }
            public DateTime PaymentDate { get; set; }
            public string? Description { get; set; }
        }

        public EmployeeInfo Employee { get; set; } = new();
        public CalendarInfo Calendar { get; set; } = new();
        public List<CheckInItem> CheckIns { get; set; } = new();
        public List<LeaveItem> Leaves { get; set; } = new();
        public List<PaymentItem> Payments { get; set; } = new();
    }

    [HttpGet("dashboard")]
    public async Task<IActionResult> Dashboard([FromQuery] string month, [FromQuery] int take = 500, CancellationToken cancellationToken = default)
    {
        var employeeId = GetEmployeeId();
        if (!employeeId.HasValue) return Unauthorized(new { success = false, message = "Çalışan oturumu bulunamadı" });

        take = Math.Clamp(take, 50, 2000);

        var (monthStart, monthEnd, monthKey) = MonthRangeUtc(month);

        var emp = await _dbContext.Set<Employee>()
            .AsNoTracking()
            .Where(x => x.Id == employeeId.Value)
            .Select(x => new { x.Id, x.EmployeeCode, x.FirstName, x.LastName, x.Mail, x.WorkScheduleSettingId })
            .FirstOrDefaultAsync(cancellationToken);

        if (emp is null) return NotFound(new { success = false, message = "Çalışan bulunamadı" });

        var checkIns = await _dbContext.Set<EmployeeCheckIn>()
            .AsNoTracking()
            .Where(x => x.EmployeeId == employeeId.Value)
            .Where(x => x.CheckInTime >= monthStart && x.CheckInTime < monthEnd)
            .OrderByDescending(x => x.CheckInTime)
            .Take(take)
            .Select(x => new DashboardResponse.CheckInItem
            {
                Id = x.Id,
                CheckInTime = x.CheckInTime,
                CheckOutTime = x.CheckOutTime
            })
            .ToListAsync(cancellationToken);

        var leaves = await _dbContext.Set<EmployeeLeave>()
            .AsNoTracking()
            .Where(x => x.EmployeeId == employeeId.Value)
            .Where(x => x.LeaveStartTime < monthEnd && x.ReturnTime >= monthStart)
            .OrderByDescending(x => x.LeaveStartTime)
            .ThenByDescending(x => x.Id)
            .Take(take)
            .Select(x => new DashboardResponse.LeaveItem
            {
                Id = x.Id,
                LeaveStartTime = x.LeaveStartTime,
                ReturnTime = x.ReturnTime,
                Description = x.Description
            })
            .ToListAsync(cancellationToken);

        var payments = await _dbContext.Set<EmployeePayment>()
            .AsNoTracking()
            .Where(x => x.EmployeeId == employeeId.Value)
            .Where(x => x.PaymentDate >= monthStart && x.PaymentDate < monthEnd)
            .OrderByDescending(x => x.PaymentDate)
            .ThenByDescending(x => x.Id)
            .Take(take)
            .Select(x => new DashboardResponse.PaymentItem
            {
                Id = x.Id,
                Type = (int)x.Type,
                Amount = x.Amount,
                PaymentDate = x.PaymentDate,
                Description = x.Description
            })
            .ToListAsync(cancellationToken);

        var workedDays = checkIns
            .Select(x => Ymd(x.CheckInTime))
            .Distinct()
            .OrderBy(x => x)
            .ToList();

        /*
          İZİNLİ GÜNLER HAKEDİŞ MOTORUYLA AYNI KURALLA (2026-10-04 kullanıcı bildirimi: "izin alıp
          erken gelince yine izinli gösteriyordu").

          Eskiden: (1) onaylanmamış / reddedilmiş izin de "izinli" sayılıyordu; (2) izin dönüş gününün
          bir öncesine kadar sayıldığı için izin bitiş günü hiç görünmüyordu (izin ekranı dönüşü son
          günün akşamına yazıyor); (3) izinliyken işe gelinen gün ekranda yine "İzinli" yazıyordu.
          Artık yalnız ONAYLI izin, mesai bloklarıyla kesişen günlerde ve personel o gün işe
          GELMEDİYSE izinli sayılır.
        */
        var approvedLeaves = await _dbContext.Set<EmployeeLeave>()
            .AsNoTracking()
            .Where(x => x.EmployeeId == employeeId.Value)
            .Where(x => x.Status == EmployeeLeaveStatus.Approved)
            .Where(x => x.LeaveStartTime < monthEnd && x.ReturnTime >= monthStart)
            .Select(x => new { x.LeaveStartTime, x.ReturnTime })
            .ToListAsync(cancellationToken);

        var workedSet = workedDays.ToHashSet();
        var leaveDaysSet = new HashSet<string>();
        if (approvedLeaves.Count > 0)
        {
            var schedule = await _calendar.GetScheduleAsync(emp.WorkScheduleSettingId, cancellationToken);
            var firstLocal = TurkeyTime.LocalDate(monthStart);
            var lastLocal = TurkeyTime.LocalDate(monthEnd.AddTicks(-1));
            var days = await _calendar.BuildAsync(firstLocal, lastLocal, schedule, cancellationToken);

            foreach (var day in days)
            {
                var ymd = TurkeyTime.Ymd(day.Date);
                if (workedSet.Contains(ymd)) continue;

                var dayStartLocal = day.Date.ToDateTime(TimeOnly.MinValue);
                var covered = approvedLeaves.Any(l =>
                {
                    var ls = (TurkeyTime.ToLocal(l.LeaveStartTime) - dayStartLocal).TotalMinutes;
                    var le = (TurkeyTime.ToLocal(l.ReturnTime) - dayStartLocal).TotalMinutes;
                    return day.Blocks.Any(bl => Math.Min(le, bl.EndMinute) - Math.Max(ls, bl.StartMinute) > 0);
                });

                if (covered) leaveDaysSet.Add(ymd);
            }
        }

        var resp = new DashboardResponse
        {
            Employee = new DashboardResponse.EmployeeInfo
            {
                EmployeeId = emp.Id,
                EmployeeName = ($"{emp.FirstName} {emp.LastName}").Trim(),
                EmployeeCode = emp.EmployeeCode,
                Mail = emp.Mail
            },
            Calendar = new DashboardResponse.CalendarInfo
            {
                Month = monthKey,
                WorkedDays = workedDays,
                LeaveDays = leaveDaysSet.OrderBy(x => x).ToList()
            },
            CheckIns = checkIns,
            Leaves = leaves,
            Payments = payments
        };

        return Ok(new { success = true, data = resp });
    }

    public sealed class LastCheckInResponse
    {
        public int Id { get; set; }
        public DateTime CheckInTime { get; set; }
        public DateTime? CheckOutTime { get; set; }
    }

    [HttpGet("last-checkin")]
    public async Task<IActionResult> LastCheckIn(CancellationToken cancellationToken = default)
    {
        var employeeId = GetEmployeeId();
        if (!employeeId.HasValue) return Unauthorized(new { success = false, message = "Çalışan oturumu bulunamadı" });

        var item = await _dbContext.Set<EmployeeCheckIn>()
            .AsNoTracking()
            .Where(x => x.EmployeeId == employeeId.Value)
            .OrderByDescending(x => x.CheckInTime)
            .ThenByDescending(x => x.Id)
            .Select(x => new LastCheckInResponse
            {
                Id = x.Id,
                CheckInTime = x.CheckInTime,
                CheckOutTime = x.CheckOutTime
            })
            .FirstOrDefaultAsync(cancellationToken);

        return Ok(new { success = true, data = item });
    }

    public sealed class SelfCheckOutRequest
    {
        [Range(-90.0, 90.0, ErrorMessage = "Geçersiz enlem değeri.")]
        public decimal Latitude { get; set; }

        [Range(-180.0, 180.0, ErrorMessage = "Geçersiz boylam değeri.")]
        public decimal Longitude { get; set; }

        /// <summary>Telefonun bildirdiği konum hassasiyeti (m); sahte konum tespitinde kullanılır.</summary>
        public double? Accuracy { get; set; }
    }

    [HttpPost("check-out")]
    public async Task<IActionResult> SelfCheckOut([FromBody] SelfCheckOutRequest request, CancellationToken cancellationToken)
    {
        var employeeId = GetEmployeeId();
        if (!employeeId.HasValue) return Unauthorized(new { success = false, message = "Çalışan oturumu bulunamadı" });

        var openCheckIn = await _dbContext.Set<EmployeeCheckIn>()
            .Where(x => x.EmployeeId == employeeId.Value)
            .Where(x => x.CheckOutTime == null)
            .OrderByDescending(x => x.CheckInTime)
            .FirstOrDefaultAsync(cancellationToken);

        if (openCheckIn is null)
        {
            return BadRequest(new { success = false, code = "no_open_checkin", message = "Açık giriş kaydınız yok; çıkışınız zaten yapılmış olabilir. Sayfayı yenileyin." });
        }

        // ÇIKIŞTA KONUM KAPISI (2026-10-16): "Mesaiyi Bitir" düğmesi konum bölgesine hiç
        // bakmıyordu; personel bölgeden ayrıldıktan sonra her yerden çıkış basabiliyordu.
        // Kural yüz ve QR çıkışıyla aynı (AttendanceLocation).
        var employee = await _dbContext.Employees.AsNoTracking()
            .FirstOrDefaultAsync(x => x.Id == employeeId.Value, cancellationToken);
        if (employee is null) return Unauthorized(new { success = false, message = "Çalışan bulunamadı" });

        var geo = await AttendanceLocation.ValidateAsync(_dbContext, employee, request.Latitude, request.Longitude, isCheckOut: true, cancellationToken, openCheckIn);
        if (!geo.Ok)
        {
            return BadRequest(new { success = false, code = geo.Code, message = geo.Error });
        }

        var now = DateTime.UtcNow;
        openCheckIn.CheckOutTime = now;
        openCheckIn.CheckOutLatitude = request.Latitude;
        openCheckIn.CheckOutLongitude = request.Longitude;
        openCheckIn.CheckOutOffsite = geo.Offsite;
        openCheckIn.CheckOutAccuracy = request.Accuracy;
        openCheckIn.EditUser = User.Identity?.Name ?? "SelfPortal";
        openCheckIn.EditTime = now;
        await _geocoder.FillCheckOutAsync(openCheckIn, cancellationToken);

        await _dbContext.SaveChangesAsync(cancellationToken);
        await AttendanceSuspicionDetector.InspectAsync(_dbContext, employee.Id, openCheckIn, true, request.Latitude, request.Longitude, request.Accuracy, "mesaiyi-bitir", cancellationToken);

        return Ok(new
        {
            success = true,
            offsite = geo.Offsite,
            message = geo.Offsite ? "Konum dışı çıkışınız kaydedildi." : "Çıkış işlemi başarıyla kaydedildi"
        });
    }
}
