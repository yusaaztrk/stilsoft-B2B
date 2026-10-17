using System.Globalization;
using B2B.Erp.Api.Data;
using B2B.Erp.Api.Core.Security;
using B2B.Erp.Api.Core.Services;
using B2B.Erp.Api.Dtos.Qr;
using B2B.Erp.Api.Entities;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace B2B.Erp.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
// check-in / check-out anonim ve kullanıcı adı + şifre alıyor: parola denemesine açık uçlar.
[Microsoft.AspNetCore.RateLimiting.EnableRateLimiting("auth")]
public sealed class QrController : ControllerBase
{
    private readonly AppDbContext _dbContext;
    private readonly ReverseGeocoder _geocoder;

    public QrController(AppDbContext dbContext, ReverseGeocoder geocoder)
    {
        _dbContext = dbContext;
        _geocoder = geocoder;
    }

    [HttpGet("daily")]
    [Authorize]
    public IActionResult GetDailyQr()
    {
        var tenantCode = StringValuesOrNull(Request.Headers["X-Tenant-Code"]);
        if (string.IsNullOrWhiteSpace(tenantCode))
        {
            return BadRequest(new { success = false, message = "Tenant bulunamadı" });
        }

        tenantCode = tenantCode.Trim().ToUpperInvariant();

        var date = DateTime.UtcNow.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
        var path = $"/qr-attendance?tenant={Uri.EscapeDataString(tenantCode)}";

        return Ok(new { success = true, data = new QrDtos.DailyQrResponse { Date = date, Path = path } });
    }

    [HttpPost("check-in")]
    [AllowAnonymous]
    public async Task<IActionResult> EmployeeCheckIn([FromBody] QrDtos.EmployeeCheckInRequest request, CancellationToken cancellationToken)
    {
        if (!ModelState.IsValid) return ValidationProblem(ModelState);

        var tenantCode = StringValuesOrNull(Request.Headers["X-Tenant-Code"]);
        if (string.IsNullOrWhiteSpace(tenantCode))
        {
            return BadRequest(new { success = false, message = "Tenant bulunamadı" });
        }

        var username = (request.Username ?? string.Empty).Trim();
        var password = (request.Password ?? string.Empty).Trim();

        if (string.IsNullOrWhiteSpace(username) || string.IsNullOrWhiteSpace(password))
        {
            return BadRequest(new { success = false, message = "Kullanıcı adı ve şifre zorunludur" });
        }

        var emp = await _dbContext.Set<Employee>()
            .FirstOrDefaultAsync(x => x.IsActive && x.Username != null && x.Username == username, cancellationToken);

        if (emp is null || string.IsNullOrWhiteSpace(emp.Password))
        {
            return Unauthorized(new { success = false, message = "Hatalı kullanıcı adı veya şifre" });
        }

        bool isPasswordValid = false;
        string storedPassword = emp.Password;
        if (PasswordHasher.IsHashed(storedPassword))
        {
            isPasswordValid = PasswordHasher.VerifyPassword(password, storedPassword);
        }
        else
        {
            isPasswordValid = (password == storedPassword);
            if (isPasswordValid)
            {
                try
                {
                    emp.Password = PasswordHasher.HashPassword(password);
                    await _dbContext.SaveChangesAsync(cancellationToken);
                }
                catch
                {
                    // Ignore
                }
            }
        }

        if (!isPasswordValid)
        {
            return Unauthorized(new { success = false, message = "Hatalı kullanıcı adı veya şifre" });
        }

        var empName = $"{emp.FirstName} {emp.LastName}".Trim();

        // AÇIK GİRİŞ VARSA İKİNCİSİ AÇILMAZ.
        //
        // Giriş kaydı koşulsuz ekleniyordu: QR iki kez okutulduğunda (ya da ağ yavaşken
        // kullanıcı tekrar bastığında) aynı personele üst üste açık giriş satırları
        // düşüyor, çalışma saati ve puantaj hesapları bozuluyordu. Durum konumdan ÖNCE
        // söylenir (2026-10-16): içerideki personel konum hatası değil "girişiniz yapıldı" görür.
        var existingOpenCheckIn = await _dbContext.EmployeeCheckIns
            .AsNoTracking()
            .Where(x => x.EmployeeId == emp.Id && x.CheckOutTime == null)
            .OrderByDescending(x => x.CheckInTime)
            .FirstOrDefaultAsync(cancellationToken);

        if (existingOpenCheckIn is not null)
        {
            var sameDay = Core.Time.TurkeyTime.LocalDate(existingOpenCheckIn.CheckInTime) == Core.Time.TurkeyTime.LocalDate(DateTime.UtcNow);
            return BadRequest(new
            {
                success = false,
                code = "already_checked_in",
                employeeName = empName,
                message = sameDay
                    ? $"{empName}, girişiniz zaten yapıldı (saat {AttendanceLocation.LocalStamp(existingOpenCheckIn.CheckInTime)}). Mesai bitince çıkış yapın."
                    : $"{empName}, {AttendanceLocation.LocalStamp(existingOpenCheckIn.CheckInTime)} tarihli girişiniz kapatılmamış. Önce çıkış yapın ya da yöneticinize bildirin.",
                data = new { checkInTime = existingOpenCheckIn.CheckInTime }
            });
        }

        // Konum zorunlu; bölge tanımlıysa içinde olunmalı (AttendanceLocation).
        var geo = await AttendanceLocation.ValidateAsync(_dbContext, emp, request.Latitude, request.Longitude, isCheckOut: false, cancellationToken);
        if (!geo.Ok)
        {
            return BadRequest(new { success = false, code = geo.Code, message = geo.Error });
        }

        var now = DateTime.UtcNow;
        var newRow = new EmployeeCheckIn
        {
            EmployeeId = emp.Id,
            CheckInTime = now,
            Latitude = request.Latitude,
            Longitude = request.Longitude,
            // Cikis koordinatlari NULL BIRAKILMAZ.
            //
            // Kolonlar veritabaninda `numeric(9,6) NOT NULL DEFAULT 0.0`. Bu varlikta alanlar
            // `decimal?` oldugu icin EF, atanmadiklarinda acikca NULL gonderiyor ve insert
            // NOT NULL kisitina takiliyor: yuz eslesse bile giris kaydi olusmuyor, uc 500
            // donuyordu. (Ana ERP'de ayni alanlar `decimal`, yani orada sorun cikmiyor —
            // bu controller oradan kopyalandigi icin fark gozden kacti.)
            //
            // Ayni duzeltme `EmployeeCheckInsController` icinde zaten vardi.
            CheckOutLatitude = 0,
            CheckOutLongitude = 0,
            CheckInAccuracy = request.Accuracy,
            CreateUser = username,
            CreateTime = now
        };
        await _geocoder.FillCheckInAsync(newRow, cancellationToken);
        _dbContext.EmployeeCheckIns.Add(newRow);

        await _dbContext.SaveChangesAsync(cancellationToken);
        await AttendanceSuspicionDetector.InspectAsync(_dbContext, emp.Id, newRow, false, request.Latitude, request.Longitude, request.Accuracy, "qr", cancellationToken);

        return Ok(new { success = true, data = new { employeeId = emp.Id, employeeName = empName, checkInTime = now } });
    }

    [HttpPost("check-out")]
    [AllowAnonymous]
    public async Task<IActionResult> EmployeeCheckOut([FromBody] QrDtos.EmployeeCheckOutRequest request, CancellationToken cancellationToken)
    {
        if (!ModelState.IsValid) return ValidationProblem(ModelState);

        var tenantCode = StringValuesOrNull(Request.Headers["X-Tenant-Code"]);
        if (string.IsNullOrWhiteSpace(tenantCode))
        {
            return BadRequest(new { success = false, message = "Tenant bulunamadı" });
        }

        var username = (request.Username ?? string.Empty).Trim();
        var password = (request.Password ?? string.Empty).Trim();

        if (string.IsNullOrWhiteSpace(username) || string.IsNullOrWhiteSpace(password))
        {
            return BadRequest(new { success = false, message = "Kullanıcı adı ve şifre zorunludur" });
        }

        var emp = await _dbContext.Set<Employee>()
            .FirstOrDefaultAsync(x => x.IsActive && x.Username != null && x.Username == username, cancellationToken);

        if (emp is null || string.IsNullOrWhiteSpace(emp.Password))
        {
            return Unauthorized(new { success = false, message = "Hatalı kullanıcı adı veya şifre" });
        }

        bool isPasswordValid = false;
        string storedPassword = emp.Password;
        if (PasswordHasher.IsHashed(storedPassword))
        {
            isPasswordValid = PasswordHasher.VerifyPassword(password, storedPassword);
        }
        else
        {
            isPasswordValid = (password == storedPassword);
            if (isPasswordValid)
            {
                try
                {
                    emp.Password = PasswordHasher.HashPassword(password);
                    await _dbContext.SaveChangesAsync(cancellationToken);
                }
                catch
                {
                    // Ignore
                }
            }
        }

        if (!isPasswordValid)
        {
            return Unauthorized(new { success = false, message = "Hatalı kullanıcı adı veya şifre" });
        }

        var empName = $"{emp.FirstName} {emp.LastName}".Trim();

        var openCheckIn = await _dbContext.EmployeeCheckIns
            .Where(x => x.EmployeeId == emp.Id)
            .Where(x => x.CheckOutTime == null)
            .OrderByDescending(x => x.CheckInTime)
            .FirstOrDefaultAsync(cancellationToken);

        if (openCheckIn is null)
        {
            // Çıkış yapmış personel tekrar okuttuğunda adıyla ve saatiyle söylenir (2026-10-16).
            var lastOut = await _dbContext.EmployeeCheckIns
                .AsNoTracking()
                .Where(x => x.EmployeeId == emp.Id && x.CheckOutTime != null)
                .OrderByDescending(x => x.CheckInTime)
                .Select(x => x.CheckOutTime)
                .FirstOrDefaultAsync(cancellationToken);

            return Ok(lastOut.HasValue
                ? new
                {
                    success = false,
                    code = "already_checked_out",
                    employeeName = empName,
                    message = $"{empName}, çıkışınız zaten yapıldı (saat {AttendanceLocation.LocalStamp(lastOut.Value)}). Yeni giriş yapmadan tekrar çıkış yapılamaz."
                }
                : new
                {
                    success = false,
                    code = "no_open_checkin",
                    employeeName = empName,
                    message = $"{empName}, açık bir giriş kaydınız yok. Önce giriş yapmalısınız."
                });
        }

        // KONUM KONTROLÜ ÇIKIŞTA DA UYGULANIR (kullanıcı kararı, 2026-08-17); 2026-10-16'dan
        // beri konum ZORUNLU — kapalı konumla 0,0 yazılıp "Konum Bilgisi Yok" kalıyordu.
        var geoOut = await AttendanceLocation.ValidateAsync(_dbContext, emp, request.Latitude, request.Longitude, isCheckOut: true, cancellationToken, openCheckIn);
        if (!geoOut.Ok)
        {
            return BadRequest(new { success = false, code = geoOut.Code, message = geoOut.Error });
        }

        var now = DateTime.UtcNow;
        openCheckIn.CheckOutTime = now;
        openCheckIn.CheckOutLatitude = request.Latitude;
        openCheckIn.CheckOutLongitude = request.Longitude;
        openCheckIn.CheckOutOffsite = geoOut.Offsite;
        openCheckIn.CheckOutAccuracy = request.Accuracy;
        openCheckIn.EditUser = username;
        openCheckIn.EditTime = now;
        await _geocoder.FillCheckOutAsync(openCheckIn, cancellationToken);

        await _dbContext.SaveChangesAsync(cancellationToken);
        await AttendanceSuspicionDetector.InspectAsync(_dbContext, emp.Id, openCheckIn, true, request.Latitude, request.Longitude, request.Accuracy, "qr", cancellationToken);

        return Ok(new
        {
            success = true,
            data = new
            {
                employeeId = emp.Id,
                employeeName = $"{emp.FirstName} {emp.LastName}".Trim(),
                checkOutTime = now,
                offsite = geoOut.Offsite
            }
        });
    }

    private static string? StringValuesOrNull(Microsoft.Extensions.Primitives.StringValues v)
    {
        var s = v.ToString();
        return string.IsNullOrWhiteSpace(s) ? null : s;
    }
}
