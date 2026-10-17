using System.Runtime.InteropServices;

namespace B2B.Erp.Api.Core.Helpers;

/// <summary>
/// FİRMANIN SAATİ (2026-08-20 kullanıcı kararı, denetim md. D1).
///
/// <para>
/// Sistemde her damga UTC. Bu doğru ve değiştirilmemeli — ama "gün" kavramı UTC takvim
/// gününden okunduğunda firmanın gerçek günüyle örtüşmüyordu. KKTC (UTC+3) örneği: yerel
/// saat 01:30'da alınan bir POS tahsilatının UTC damgası bir ÖNCEKİ günün 22:30'udur,
/// dolayısıyla o tahsilat bir önceki günün süpürme havuzuna düşüyordu. Kasa gününü kapatan
/// için bu, hesabı tutmayan bir gün demek.
/// </para>
///
/// <para>
/// Saat dilimi yapılandırmadan okunur (<c>Company:TimeZone</c>). Tanımsızsa <b>sunucunun
/// yerel saat dilimi</b> kullanılır: bugüne kadarki fiili davranış budur ve ayar
/// girilmeden kimsenin günü kaymaz. Tanınmayan bir kimlik yazılırsa yine yerel saate
/// düşülür — yanlış bir kimlik yüzünden bütün günlük işlerin durması, sessizce eski
/// davranışa dönmekten çok daha kötüdür.
/// </para>
///
/// <para>
/// Kimlik hem Windows ("GTB Standard Time") hem IANA ("Europe/Istanbul") biçiminde
/// yazılabilir; .NET 8 iki biçimi de tanır, tanımıyorsa çevirmeyi dener.
/// </para>
/// </summary>
public sealed class CompanyClock
{
    private readonly TimeZoneInfo _timeZone;

    public CompanyClock(IConfiguration configuration)
    {
        _timeZone = Resolve(configuration?["Company:TimeZone"]);
    }

    private CompanyClock(TimeZoneInfo timeZone)
    {
        _timeZone = timeZone;
    }

    /// <summary>Testler ve yapılandırmaya erişimi olmayan çağrılar için.</summary>
    public static CompanyClock For(TimeZoneInfo timeZone) => new(timeZone);

    public TimeZoneInfo TimeZone => _timeZone;

    private static TimeZoneInfo Resolve(string? id)
    {
        if (string.IsNullOrWhiteSpace(id)) return TimeZoneInfo.Local;

        try
        {
            return TimeZoneInfo.FindSystemTimeZoneById(id.Trim());
        }
        catch (TimeZoneNotFoundException)
        {
            // Windows kimliği Linux'ta (ya da tersi) bulunamayabilir: karşılığı denenir.
            try
            {
                if (TimeZoneInfo.TryConvertIanaIdToWindowsId(id.Trim(), out var windowsId) && windowsId is not null)
                {
                    return TimeZoneInfo.FindSystemTimeZoneById(windowsId);
                }

                if (TimeZoneInfo.TryConvertWindowsIdToIanaId(id.Trim(), out var ianaId) && ianaId is not null)
                {
                    return TimeZoneInfo.FindSystemTimeZoneById(ianaId);
                }
            }
            catch
            {
                // yutulur: aşağıdaki yerel saate düşme dalı zaten doğru davranış.
            }

            return TimeZoneInfo.Local;
        }
        catch (InvalidTimeZoneException)
        {
            return TimeZoneInfo.Local;
        }
    }

    /// <summary>UTC damgasının firmanın saatindeki karşılığı.</summary>
    public DateTime ToCompanyTime(DateTime utc)
        => TimeZoneInfo.ConvertTimeFromUtc(DateTime.SpecifyKind(utc, DateTimeKind.Utc), _timeZone);

    /// <summary>Firmanın takvim günü (saat bileşeni sıfırlanmış, Kind=Unspecified).</summary>
    public DateTime CompanyDateOf(DateTime utc) => ToCompanyTime(utc).Date;

    /// <summary>Şu an firmanın takvim gününde hangi gündeyiz.</summary>
    public DateTime TodayCompanyDate() => CompanyDateOf(SystemTime.UtcNow);

    /// <summary>
    /// Bugünün BELGE TARİHİ damgası: firmanın takvim günü, sistemdeki "yalnız tarih" alanlarının
    /// konvansiyonuna uygun biçimde (gece yarısı, <c>Kind=Utc</c>) döner.
    ///
    /// <para>
    /// Fatura/irsaliye/virman gibi belgelerde tarih alanı saat taşımaz; kod bunu her yerde
    /// <c>SpecifyKind(x.Date, Utc)</c> ile yazıyor. Buradaki tek değişiklik <b>hangi günün</b>
    /// yazıldığı: <c>DateTime.UtcNow.Date</c> UTC takvim günüdür ve KKTC'de (UTC+3) yerel
    /// 00:00–03:00 arasında kesilen belge BİR ÖNCEKİ güne damgalanıyordu. Depodan mal çıkmış,
    /// belge dünün tarihini taşıyor — kapanmış bir güne belge girmiş oluyordu.
    /// </para>
    ///
    /// <para>
    /// Saklama biçimi DEĞİŞMEZ (yine Utc gece yarısı); mevcut kayıtlarla ve sorgularla
    /// karşılaştırma aynen çalışır.
    /// </para>
    /// </summary>
    public DateTime TodayAsDocumentDate() => DateTime.SpecifyKind(TodayCompanyDate(), DateTimeKind.Utc);

    /// <summary>
    /// Verilen takvim gününün firmadaki 00:00'ının UTC karşılığı — yani o günün başladığı an.
    /// Sorgular UTC damgalarla karşılaştırma yaptığı için gün penceresi bu değerlerle kurulur.
    /// </summary>
    public DateTime CompanyDayStartUtc(DateTime companyDate)
    {
        var local = DateTime.SpecifyKind(companyDate.Date, DateTimeKind.Unspecified);

        // Yaz saati geçişinde var olmayan saat: o gün 00:00 yoksa geçerli ilk ana kaydırılır.
        if (_timeZone.IsInvalidTime(local))
        {
            local = local.AddHours(1);
        }

        return TimeZoneInfo.ConvertTimeToUtc(local, _timeZone);
    }

    /// <summary>Günün bittiği an (ertesi günün başlangıcı) — pencere [start, end) olarak kullanılır.</summary>
    public DateTime CompanyDayEndUtc(DateTime companyDate)
        => CompanyDayStartUtc(companyDate.Date.AddDays(1));
}
