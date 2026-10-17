using B2B.Erp.Api.Data;
using B2B.Erp.Api.Entities;
using Microsoft.EntityFrameworkCore;

namespace B2B.Erp.Api.Core.Services;

/// <summary>
/// Mesai giriş/çıkışının TEK konum kapısı (2026-10-16).
///
/// <para><b>Neden:</b> konum bölgesi (geofence) yalnızca girişte ve QR çıkışında
/// denetleniyordu; yüzle çıkış ve "Mesaiyi Bitir" düğmesi konuma hiç bakmıyordu — personel
/// evden çıkış basabiliyordu. Ayrıca konumu kapalı telefon 0,0 gönderiyor, bölge tanımlı
/// değilse kayıt konumsuz oluşuyor ve ekranda "Konum Bilgisi Yok" kalıyordu. Kural artık her
/// yolda aynı: konum ZORUNLU, bölge tanımlıysa içinde olunmalı.</para>
///
/// <para>Personel kartı bir konuma bağlıysa YALNIZCA o konum, değilse aktif konumlardan
/// herhangi biri kabul edilir. Hiç aktif konum yoksa bölge denetlenmez ama konum yine istenir.</para>
/// </summary>
public static class AttendanceLocation
{
    public const string CodeLocationRequired = "location_required";
    public const string CodeOutsideArea = "outside_area";

    public const string LocationRequiredMessage =
        "Konumunuz alınamadı. Lütfen telefonunuzun konumunu (GPS) açın ve tarayıcıya konum izni verin, sonra tekrar deneyin.";

    /// <param name="Offsite">Çıkış bölge dışından, konumun "konum dışı çıkış" izniyle kabul edildi.</param>
    public sealed record Result(bool Ok, string? Code, string? Error, bool Offsite = false);

    public static async Task<Result> ValidateAsync(
        AppDbContext db,
        Employee employee,
        decimal latitude,
        decimal longitude,
        bool isCheckOut,
        CancellationToken cancellationToken,
        EmployeeCheckIn? openCheckIn = null)
    {
        if (latitude == 0m || longitude == 0m)
        {
            return new Result(false, CodeLocationRequired, LocationRequiredMessage);
        }

        var all = await db.Set<EmployeeLocationSetting>()
            .AsNoTracking()
            .Where(x => x.IsActive)
            .ToListAsync(cancellationToken);

        var candidates = employee.LocationSettingId is > 0
            ? all.Where(x => x.Id == employee.LocationSettingId!.Value).ToList()
            : all;

        if (candidates.Count == 0) return new Result(true, null, null);

        var best = candidates
            .Select(x => new { Setting = x, Distance = DistanceInMeters(latitude, longitude, x.Latitude, x.Longitude) })
            .OrderBy(x => x.Distance)
            .First();

        if (best.Distance <= best.Setting.MaxDistanceInMeters) return new Result(true, null, null);

        /*
          KONUM DIŞI ÇIKIŞ (2026-10-16): bölge dışındaki ÇIKIŞ, ilgili konumda izin açıksa kabul
          edilir ve işaretlenir. İlgili konum: personel bir konuma bağlıysa o; değilse GİRİŞİN
          yapıldığı noktaya en yakın konum (çıkış noktasına en yakını değil — evden çıkışta o
          rastgele bir konum olurdu).
        */
        if (isCheckOut)
        {
            var governing = candidates.Count == 1 || openCheckIn is null || openCheckIn.Latitude == 0m || openCheckIn.Longitude == 0m
                ? (employee.LocationSettingId is > 0 ? candidates[0] : best.Setting)
                : candidates
                    .OrderBy(x => DistanceInMeters(openCheckIn.Latitude, openCheckIn.Longitude, x.Latitude, x.Longitude))
                    .First();
            if (governing.AllowOffsiteCheckOut) return new Result(true, null, null, Offsite: true);
        }

        var name = string.IsNullOrWhiteSpace(best.Setting.Name) ? "Mesai bölgesi" : best.Setting.Name;
        var action = isCheckOut ? "Çıkış" : "Giriş";
        return new Result(false, CodeOutsideArea,
            $"{name} dışındasınız (mesafe: {Math.Round(best.Distance)} m, izin verilen: {best.Setting.MaxDistanceInMeters} m). {action} yapılamadı.");
    }

    public static double DistanceInMeters(decimal lat1, decimal lon1, decimal lat2, decimal lon2)
    {
        const double r = 6371e3;
        var phi1 = (double)lat1 * Math.PI / 180;
        var phi2 = (double)lat2 * Math.PI / 180;
        var deltaPhi = ((double)lat2 - (double)lat1) * Math.PI / 180;
        var deltaLambda = ((double)lon2 - (double)lon1) * Math.PI / 180;

        var a = Math.Sin(deltaPhi / 2) * Math.Sin(deltaPhi / 2) +
                Math.Cos(phi1) * Math.Cos(phi2) *
                Math.Sin(deltaLambda / 2) * Math.Sin(deltaLambda / 2);
        return r * 2 * Math.Atan2(Math.Sqrt(a), Math.Sqrt(1 - a));
    }

    /// <summary>"14:05" — yerel saat; "zaten giriş/çıkış yaptınız" mesajlarında kullanılır.</summary>
    public static string LocalClock(DateTime utc) => Time.TurkeyTime.ToLocal(utc).ToString("HH:mm");

    /// <summary>"14.10.2026 08:01" — bugünden farklı günse tarih de yazılır.</summary>
    public static string LocalStamp(DateTime utc)
    {
        var local = Time.TurkeyTime.ToLocal(utc);
        var today = Time.TurkeyTime.LocalDate(DateTime.UtcNow);
        return DateOnly.FromDateTime(local) == today ? local.ToString("HH:mm") : local.ToString("dd.MM.yyyy HH:mm");
    }
}
