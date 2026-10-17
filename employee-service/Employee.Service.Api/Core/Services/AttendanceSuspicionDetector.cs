using B2B.Erp.Api.Data;
using B2B.Erp.Api.Entities;
using Microsoft.EntityFrameworkCore;

namespace B2B.Erp.Api.Core.Services;

/// <summary>
/// SAHTE KONUM (FAKE GPS) TESPİTİ — şüpheli işlem kaydı (2026-10-16 kullanıcı isteği; örnek:
/// PatronPDKS "şüpheli işlem algılama").
///
/// <para><b>Neden kural tabanlı:</b> tarayıcı, telefonun konumu sahte bir uygulamadan mı
/// aldığını bildirmez (Android'in "mock location" bayrağı yalnız yerel uygulamaya açık). Sahte
/// konumun izi ise kayıtta kalır; aşağıdaki kurallar o izi arar.</para>
///
/// <list type="bullet">
/// <item><b>ayni_koordinat</b> — farklı bir günde BİREBİR aynı koordinat (6 ondalık ≈ 10 cm).
///   Gerçek GPS her okumada birkaç metre oynar; aynı noktanın günler sonra santimine kadar
///   tekrarlanması sahte konum uygulamasının sabit noktasıdır.</item>
/// <item><b>merkez_kopyasi</b> — koordinat, mesai bölgesinin merkeziyle santimine kadar aynı:
///   bölge merkezi elle girilip sahte konuma yapıştırılmış.</item>
/// <item><b>imkansiz_hiz</b> — bir önceki kayıttan bu kayda saatte 150 km'den hızlı gidilmiş
///   (en az 3 km): "ışınlanma".</item>
/// <item><b>kusursuz_hassasiyet</b> — telefon hassasiyeti ≤ 1 m bildiriyor; tarayıcıda gerçek
///   GPS bunu vermez, sahte konum uygulamaları çoğunlukla 0/1 yazar.</item>
/// <item><b>dusuk_hassasiyet</b> — hassasiyet 1.000 m'den kötü: konum GPS'ten değil ağdan/IP'den
///   geliyor, bölge kontrolü güvenilir değil.</item>
/// </list>
///
/// <para>Şüphe giriş/çıkışı ENGELLEMEZ (yanlış alarmda personel mağdur olmasın); kayıt
/// yöneticinin "Şüpheli İşlemler" listesine düşer. Tespit hatası mesai kaydını asla düşürmez.</para>
/// </summary>
public static class AttendanceSuspicionDetector
{
    public const string RuleExactRepeat = "ayni_koordinat";
    public const string RuleCenterCopy = "merkez_kopyasi";
    public const string RuleImpossibleSpeed = "imkansiz_hiz";
    public const string RulePerfectAccuracy = "kusursuz_hassasiyet";
    public const string RuleLowAccuracy = "dusuk_hassasiyet";

    private const decimal SamePointTolerance = 0.0000015m;  // ~15 cm (kolon 6 ondalık)
    private const double MaxSpeedKmh = 150;
    private const double MinJumpMeters = 3000;
    private const double PerfectAccuracyMeters = 1;
    private const double LowAccuracyMeters = 1000;

    public static string RuleLabel(string code) => code switch
    {
        RuleExactRepeat => "Aynı koordinat tekrarı",
        RuleCenterCopy => "Bölge merkezinin kopyası",
        RuleImpossibleSpeed => "İmkânsız hız (ışınlanma)",
        RulePerfectAccuracy => "Kusursuz hassasiyet",
        RuleLowAccuracy => "Düşük konum hassasiyeti",
        _ => code
    };

    /// <summary>
    /// Kaydedilmiş bir giriş/çıkışı inceler, şüphe varsa yazar. Kendi SaveChanges'ını yapar;
    /// her hata yutulur — mesai kaydı zaten kaydedilmiş olmalıdır.
    /// </summary>
    public static async Task<int> InspectAsync(
        AppDbContext db,
        int employeeId,
        EmployeeCheckIn row,
        bool isCheckOut,
        decimal latitude,
        decimal longitude,
        double? accuracy,
        string source,
        CancellationToken cancellationToken)
    {
        try
        {
            if (latitude == 0m || longitude == 0m) return 0;

            var eventTime = isCheckOut ? (row.CheckOutTime ?? DateTime.UtcNow) : row.CheckInTime;
            var eventDay = Time.TurkeyTime.LocalDate(eventTime);
            var kind = isCheckOut ? "Çıkış" : "Giriş";
            var found = new List<(string Code, string Detail)>();

            // Önceki olaylar (son 60 gün): her satırın girişi ve varsa çıkışı ayrı bir nokta.
            var since = eventTime.AddDays(-60);
            var rows = await db.EmployeeCheckIns
                .AsNoTracking()
                .Where(x => x.EmployeeId == employeeId && x.CheckInTime >= since)
                .Select(x => new { x.Id, x.CheckInTime, x.Latitude, x.Longitude, x.CheckOutTime, x.CheckOutLatitude, x.CheckOutLongitude })
                .ToListAsync(cancellationToken);

            var points = new List<(DateTime Time, decimal Lat, decimal Lng)>();
            foreach (var r in rows)
            {
                var isThisEventCheckIn = r.Id == row.Id && !isCheckOut;
                var isThisEventCheckOut = r.Id == row.Id && isCheckOut;
                if (!isThisEventCheckIn && r.Latitude != 0m && r.Longitude != 0m)
                    points.Add((r.CheckInTime, r.Latitude, r.Longitude));
                if (!isThisEventCheckOut && r.CheckOutTime.HasValue && (r.CheckOutLatitude ?? 0m) != 0m && (r.CheckOutLongitude ?? 0m) != 0m)
                    points.Add((r.CheckOutTime.Value, r.CheckOutLatitude!.Value, r.CheckOutLongitude!.Value));
            }

            // 1) Farklı günde birebir aynı koordinat.
            var repeat = points
                .Where(p => Time.TurkeyTime.LocalDate(p.Time) != eventDay
                            && Math.Abs(p.Lat - latitude) <= SamePointTolerance
                            && Math.Abs(p.Lng - longitude) <= SamePointTolerance)
                .OrderByDescending(p => p.Time)
                .ToList();
            if (repeat.Count > 0)
            {
                found.Add((RuleExactRepeat,
                    $"{kind} koordinatı ({latitude:0.000000}, {longitude:0.000000}) {repeat.Count} farklı kayıtta santimine kadar aynı " +
                    $"(son: {AttendanceLocation.LocalStamp(repeat[0].Time)}). Gerçek GPS her okumada oynar; sabit nokta sahte konum belirtisidir."));
            }

            // 2) Bölge merkezinin birebir kopyası.
            var centers = await db.Set<EmployeeLocationSetting>()
                .AsNoTracking()
                .Select(x => new { x.Name, x.Latitude, x.Longitude })
                .ToListAsync(cancellationToken);
            var copied = centers.FirstOrDefault(c =>
                Math.Abs(c.Latitude - latitude) <= SamePointTolerance && Math.Abs(c.Longitude - longitude) <= SamePointTolerance);
            if (copied is not null)
            {
                found.Add((RuleCenterCopy,
                    $"{kind} koordinatı \"{(string.IsNullOrWhiteSpace(copied.Name) ? "mesai bölgesi" : copied.Name)}\" merkezinin tıpatıp aynısı. " +
                    "Telefon bölge merkezine santimine kadar oturmaz; koordinat elle girilmiş olabilir."));
            }

            // 3) İmkânsız hız: bu olaydan önceki en yakın nokta (12 saat içinde).
            var previous = points
                .Where(p => p.Time < eventTime && p.Time >= eventTime.AddHours(-12))
                .OrderByDescending(p => p.Time)
                .Select(p => ((DateTime Time, decimal Lat, decimal Lng)?)p)
                .FirstOrDefault();
            if (previous is { } prev)
            {
                var meters = AttendanceLocation.DistanceInMeters(prev.Lat, prev.Lng, latitude, longitude);
                var hours = Math.Max((eventTime - prev.Time).TotalHours, 1.0 / 3600);
                var kmh = meters / 1000 / hours;
                if (meters >= MinJumpMeters && kmh > MaxSpeedKmh)
                {
                    found.Add((RuleImpossibleSpeed,
                        $"{AttendanceLocation.LocalStamp(prev.Time)} kaydından {Math.Round(meters / 1000, 1)} km uzağa " +
                        $"{Math.Round((eventTime - prev.Time).TotalMinutes)} dakikada gelinmiş (~{Math.Round(kmh)} km/sa)."));
                }
            }

            // 4-5) Hassasiyet.
            if (accuracy is { } acc)
            {
                if (acc <= PerfectAccuracyMeters)
                {
                    found.Add((RulePerfectAccuracy,
                        $"Telefon konum hassasiyetini {acc:0.#} m bildirdi. Tarayıcıda gerçek GPS bu kadar kesin olmaz; sahte konum uygulamaları genelde 0-1 m yazar."));
                }
                else if (acc > LowAccuracyMeters)
                {
                    found.Add((RuleLowAccuracy,
                        $"Konum hassasiyeti {Math.Round(acc)} m: konum GPS'ten değil ağdan geliyor, bölge kontrolü güvenilir değil (GPS kapalı ya da masaüstü tarayıcı)."));
                }
            }

            if (found.Count == 0) return 0;

            var now = DateTime.UtcNow;
            foreach (var (code, detail) in found)
            {
                db.Set<EmployeeAttendanceSuspicion>().Add(new EmployeeAttendanceSuspicion
                {
                    EmployeeId = employeeId,
                    CheckInId = row.Id,
                    EventKind = kind,
                    RuleCode = code,
                    Detail = detail.Length <= 500 ? detail : detail[..500],
                    Source = source,
                    Latitude = latitude,
                    Longitude = longitude,
                    Accuracy = accuracy,
                    CreateTime = now
                });
            }
            await db.SaveChangesAsync(cancellationToken);
            return found.Count;
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            Console.Error.WriteLine("[WARN] AttendanceSuspicionDetector: " + ex.Message);
            return 0;
        }
    }
}
