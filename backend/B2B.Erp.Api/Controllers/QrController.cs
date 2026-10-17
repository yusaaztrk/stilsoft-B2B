using System.Globalization;
using B2B.Erp.Api.Data;
using B2B.Erp.Api.Core.Http;
using B2B.Erp.Api.Core.Security;
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

    public QrController(AppDbContext dbContext)
    {
        _dbContext = dbContext;
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

    [AtomicRequest]
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

        // Geofence: personele atanmis konum varsa yalnizca oradan, yoksa aktif konumlardan
        // herhangi birinden giris yapilabilir.
        var geo = await ValidateGeofenceAsync(emp, request.Latitude, request.Longitude, cancellationToken);
        if (!geo.Ok)
        {
            return BadRequest(new { success = false, message = geo.Error });
        }

        // AÇIK GİRİŞ VARSA İKİNCİSİ AÇILMAZ.
        //
        // Giriş kaydı koşulsuz ekleniyordu: QR iki kez okutulduğunda (ya da ağ yavaşken
        // kullanıcı tekrar bastığında) aynı personele üst üste açık giriş satırları
        // düşüyor, çalışma saati ve puantaj hesapları bozuluyordu. Çıkış yolu açık kaydı
        // zaten `CheckOutTime == null` ile arıyor — kardeş kontrol giriş tarafında yoktu.
        var existingOpenCheckIn = await _dbContext.EmployeeCheckIns
            .AsNoTracking()
            .Where(x => x.EmployeeId == emp.Id && x.CheckOutTime == null)
            .OrderByDescending(x => x.CheckInTime)
            .FirstOrDefaultAsync(cancellationToken);

        if (existingOpenCheckIn is not null)
        {
            return BadRequest(new
            {
                success = false,
                message = "Kapatılmamış bir giriş kaydınız var. Önce çıkış yapmalısınız.",
                data = new { checkInTime = existingOpenCheckIn.CheckInTime }
            });
        }

        var now = DateTime.UtcNow;
        _dbContext.EmployeeCheckIns.Add(new EmployeeCheckIn
        {
            EmployeeId = emp.Id,
            CheckInTime = now,
            Latitude = request.Latitude,
            Longitude = request.Longitude,
            CreateUser = username,
            CreateTime = now
        });

        await _dbContext.SaveChangesAsync(cancellationToken);

        return Ok(new { success = true, data = new { employeeId = emp.Id, employeeName = $"{emp.FirstName} {emp.LastName}".Trim(), checkInTime = now } });
    }

    [AtomicRequest]
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

        // KONUM KONTROLÜ ÇIKIŞTA DA UYGULANIR (kullanıcı kararı, 2026-08-17).
        //
        // Kontrol yalnız GİRİŞTE vardı: personel iş yerinden ayrıldıktan sonra istediği yerden
        // çıkış yapabiliyordu, yani mesai bitişi denetlenemiyordu. Kural girişle birebir aynı
        // tutuldu — ayrı bir ayar yok, aynı bölge ve aynı yarıçap. Geofence kapalıysa
        // (`IsActive = false` ya da tanım yok) davranış eskisiyle aynı: kimse engellenmez.
        var geoOut = await ValidateGeofenceAsync(emp, request.Latitude, request.Longitude, cancellationToken);
        if (!geoOut.Ok)
        {
            return BadRequest(new { success = false, message = geoOut.Error });
        }

        var openCheckIn = await _dbContext.EmployeeCheckIns
            .Where(x => x.EmployeeId == emp.Id)
            .Where(x => x.CheckOutTime == null)
            .OrderByDescending(x => x.CheckInTime)
            .FirstOrDefaultAsync(cancellationToken);

        if (openCheckIn is null)
        {
            return Ok(new { success = false, message = "Açık giriş kaydı bulunamadı" });
        }

        var now = DateTime.UtcNow;
        openCheckIn.CheckOutTime = now;
        openCheckIn.CheckOutLatitude = request.Latitude;
        openCheckIn.CheckOutLongitude = request.Longitude;
        openCheckIn.EditUser = username;
        openCheckIn.EditTime = now;

        await _dbContext.SaveChangesAsync(cancellationToken);

        return Ok(new
        {
            success = true,
            data = new
            {
                employeeId = emp.Id,
                employeeName = $"{emp.FirstName} {emp.LastName}".Trim(),
                checkOutTime = now
            }
        });
    }

    private static double CalculateDistanceInMeters(decimal lat1, decimal lon1, decimal lat2, decimal lon2)
    {
        double r = 6371e3; // Earth radius in meters
        double phi1 = (double)lat1 * Math.PI / 180;
        double phi2 = (double)lat2 * Math.PI / 180;
        double deltaPhi = ((double)lat2 - (double)lat1) * Math.PI / 180;
        double deltaLambda = ((double)lon2 - (double)lon1) * Math.PI / 180;

        double a = Math.Sin(deltaPhi / 2) * Math.Sin(deltaPhi / 2) +
                   Math.Cos(phi1) * Math.Cos(phi2) *
                   Math.Sin(deltaLambda / 2) * Math.Sin(deltaLambda / 2);
        double c = 2 * Math.Atan2(Math.Sqrt(a), Math.Sqrt(1 - a));

        return r * c;
    }

    private static string? StringValuesOrNull(Microsoft.Extensions.Primitives.StringValues v)
    {
        var s = v.ToString();
        return string.IsNullOrWhiteSpace(s) ? null : s;
    }

    /// <summary>
    /// Personelin giriş yapabileceği konumları döner ve verilen koordinatın hangisine
    /// düştüğünü bulur.
    ///
    /// <para>Firmanın birden fazla noktası olabilir (mağaza, depo). Personel karti bir konuma
    /// bağlıysa YALNIZCA o konumdan giriş yapabilir; bağlı değilse aktif konumlardan
    /// herhangi biri kabul edilir. Eskiden tablodan <c>FirstOrDefault()</c> ile tek konum
    /// çekiliyordu — ikinci bir konum tanımlandığında oradaki personel giriş yapamıyordu.</para>
    /// </summary>
    private async Task<(bool Ok, string? Error)> ValidateGeofenceAsync(
        Employee emp,
        decimal latitude,
        decimal longitude,
        CancellationToken cancellationToken)
    {
        var all = await _dbContext.Set<EmployeeLocationSetting>()
            .AsNoTracking()
            .Where(x => x.IsActive)
            .ToListAsync(cancellationToken);

        // Personele atanmış konum varsa yalnızca o geçerli.
        var candidates = emp.LocationSettingId is > 0
            ? all.Where(x => x.Id == emp.LocationSettingId!.Value).ToList()
            : all;

        // Hiç aktif konum yoksa geofence uygulanmaz — tek noktalı firmayı kilitlememek için.
        if (candidates.Count == 0) return (true, null);

        if (latitude == 0 || longitude == 0)
        {
            return (false, "Konum bilgisi alınamadı. Lütfen konum izinlerini kontrol ediniz.");
        }

        var best = candidates
            .Select(x => new { Setting = x, Distance = CalculateDistanceInMeters(latitude, longitude, x.Latitude, x.Longitude) })
            .OrderBy(x => x.Distance)
            .First();

        if (best.Distance <= best.Setting.MaxDistanceInMeters) return (true, null);

        var name = string.IsNullOrWhiteSpace(best.Setting.Name) ? "giriş bölgesi" : best.Setting.Name;
        return (false,
            $"{name} dışındasınız (Mesafe: {Math.Round(best.Distance)}m, İzin verilen: {best.Setting.MaxDistanceInMeters}m). Giriş yapılamadı.");
    }
}
