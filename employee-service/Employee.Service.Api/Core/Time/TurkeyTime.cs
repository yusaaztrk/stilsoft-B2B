namespace B2B.Erp.Api.Core.Time;

/// <summary>
/// Yerel (Türkiye) gün dönüşümleri.
///
/// <para>Veritabanındaki bütün zaman damgaları UTC. Puantaj ise GÜN bazlı çalışır ve gün
/// Türkiye saatine göre başlar. Eskiden takvim doğrudan UTC tarihinden üretiliyordu:
/// gece 01:30'da atılan giriş UTC'de bir önceki güne düştüğü için takvimde yanlış güne
/// yazılıyor, ay başı/sonu kayıtları yanlış aya kayıyordu. Vardiyalı çalışanda puantaj
/// doğrudan hatalı çıkıyordu.</para>
///
/// <para>Türkiye 2016'dan beri kalıcı UTC+03:00 (yaz saati uygulaması yok). Yine de işletim
/// sistemi saat dilimi tanımı varsa o kullanılır; yoksa sabit +03:00'a düşülür (Linux
/// konteynerlerde tzdata paketi bulunmayabiliyor).</para>
/// </summary>
public static class TurkeyTime
{
    private static readonly TimeZoneInfo Zone = ResolveZone();

    private static TimeZoneInfo ResolveZone()
    {
        foreach (var id in new[] { "Europe/Istanbul", "Turkey Standard Time" })
        {
            try
            {
                return TimeZoneInfo.FindSystemTimeZoneById(id);
            }
            catch (TimeZoneNotFoundException)
            {
            }
            catch (InvalidTimeZoneException)
            {
            }
        }

        return TimeZoneInfo.CreateCustomTimeZone("TR-Fixed", TimeSpan.FromHours(3), "Türkiye", "Türkiye");
    }

    /// <summary>UTC zaman damgasını Türkiye yerel saatine çevirir.</summary>
    public static DateTime ToLocal(DateTime utc)
    {
        var asUtc = utc.Kind == DateTimeKind.Utc ? utc : DateTime.SpecifyKind(utc, DateTimeKind.Utc);
        return TimeZoneInfo.ConvertTimeFromUtc(asUtc, Zone);
    }

    /// <summary>UTC zaman damgasının denk geldiği Türkiye yerel günü.</summary>
    public static DateOnly LocalDate(DateTime utc) => DateOnly.FromDateTime(ToLocal(utc));

    /// <summary>Yerel günün 00:00'ının UTC karşılığı.</summary>
    public static DateTime StartOfDayUtc(DateOnly localDate)
    {
        var local = localDate.ToDateTime(TimeOnly.MinValue);
        return TimeZoneInfo.ConvertTimeToUtc(DateTime.SpecifyKind(local, DateTimeKind.Unspecified), Zone);
    }

    /// <summary>Yerel günün bitişinin (ertesi gün 00:00) UTC karşılığı.</summary>
    public static DateTime EndOfDayUtc(DateOnly localDate) => StartOfDayUtc(localDate.AddDays(1));

    /// <summary>"yyyy-MM" dönemini yerel ay sınırlarına çevirir.</summary>
    public static (DateOnly FirstDay, DateOnly LastDay) MonthRange(string period)
    {
        var (year, month) = ParsePeriod(period);
        var first = new DateOnly(year, month, 1);
        return (first, first.AddMonths(1).AddDays(-1));
    }

    /// <summary>"yyyy-MM" ayrıştırır; geçersizse içinde bulunulan yerel aya döner.</summary>
    public static (int Year, int Month) ParsePeriod(string? period)
    {
        var s = (period ?? string.Empty).Trim();
        if (s.Length == 7 && s[4] == '-'
            && int.TryParse(s.AsSpan(0, 4), out var y)
            && int.TryParse(s.AsSpan(5, 2), out var m)
            && y is >= 2000 and <= 2100
            && m is >= 1 and <= 12)
        {
            return (y, m);
        }

        var nowLocal = ToLocal(DateTime.UtcNow);
        return (nowLocal.Year, nowLocal.Month);
    }

    public static string PeriodOf(DateOnly date) => $"{date.Year:D4}-{date.Month:D2}";

    public static string Ymd(DateOnly date) => $"{date.Year:D4}-{date.Month:D2}-{date.Day:D2}";
}
