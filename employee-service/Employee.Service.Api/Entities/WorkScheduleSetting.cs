namespace B2B.Erp.Api.Entities;

/// <summary>
/// İş günü (mesai) tanımı. Haftalık düzen <see cref="Blocks"/> içindeki bloklarla kurulur:
/// "pazartesi 08:00–12:00" + "pazartesi 13:00–18:00" gibi. Her bloğun kendi ücret katsayısı
/// olabilir. Puantaj, fazla mesai, izin gün sayımı ve hakediş hesabının tamamı buna dayanır.
///
/// <para>Birden fazla tanım olabilir (ör. "Ofis", "Vardiyalı", "Yarı Zamanlı"); personel
/// <c>Employee.WorkScheduleSettingId</c> ile bağlanır, boşsa <c>IsDefault</c> olan kullanılır.</para>
///
/// <para>ESKİ ALANLAR: <c>MondayMinutes</c> … <c>SundayMinutes</c> günlük tek süre tutan ilk
/// tasarımdan kalmadır. Blok tanımı olmayan kayıtlar için hâlâ okunur (bkz.
/// <c>WorkCalendarService.GetScheduleAsync</c>, bloklar yoksa bu sürelerden blok üretir), böylece
/// mevcut tanımlar bozulmadan yeni düzene taşınır. Yeni kayıtlarda bloklar esastır.</para>
/// </summary>
public sealed class WorkScheduleSetting : AuditableEntity
{
    public int Id { get; set; }

    public string Name { get; set; } = "Varsayılan Mesai";

    public int MondayMinutes { get; set; } = 600;

    public int TuesdayMinutes { get; set; } = 600;

    public int WednesdayMinutes { get; set; } = 600;

    public int ThursdayMinutes { get; set; } = 600;

    public int FridayMinutes { get; set; } = 600;

    public int SaturdayMinutes { get; set; } = 420;

    public int SundayMinutes { get; set; }

    /// <summary>Günlük mesaiden düşülen mola süresi.</summary>
    public int BreakMinutes { get; set; } = 60;

    /// <summary>
    /// Eski tasarımın mesai başlangıcı. Blok tanımı olmayan kayıtlarda blok üretilirken
    /// başlangıç noktası olarak kullanılır; blok varsa geç kalma bloğun kendi başlangıcına göre
    /// belirlenir.
    /// </summary>
    public int StartTimeMinutes { get; set; } = 480;

    /// <summary>
    /// GİRİŞ toleransı: mesai başlangıcından bu kadar sonra gelen personel tam saatinde
    /// gelmiş sayılır. Yalnızca "geç geldi" etiketini değil, DAKİKA HESABINI da etkiler —
    /// 09:00 mesaide 15 dk toleransla 09:12'de giren, 09:00'dan itibaren çalışmış sayılır.
    /// Bir süre yalnızca etiket için kullanılıyordu, hakedişten dakika kesiliyordu.
    /// </summary>
    public int LateToleranceMinutes { get; set; } = 15;

    /// <summary>
    /// ÇIKIŞ toleransı: mesai bitişinden bu kadar önce çıkan personel tam saatinde çıkmış
    /// sayılır. 18:00 bitişte 15 dk toleransla 17:50'de çıkan, 18:00'a kadar çalışmış sayılır.
    /// </summary>
    public int EarlyLeaveToleranceMinutes { get; set; } = 15;

    /// <summary>
    /// Hiçbir bloğa denk gelmeyen (plan dışı) çalışmanın ücret katsayısı.
    /// 4857 sayılı kanunda fazla mesai %50 zamlıdır = 1,50.
    /// </summary>
    public decimal OvertimeMultiplier { get; set; } = 1.50m;

    /// <summary>Resmî tatiller iş günü sayılsın mı? Varsayılan: hayır.</summary>
    public bool CountHolidaysAsWorkDay { get; set; }

    public bool IsDefault { get; set; }

    public bool IsActive { get; set; } = true;

    public List<WorkShiftBlock> Blocks { get; set; } = new();

    /// <summary>Eski düzendeki günlük süre. Blok bulunmayan tanımlar için geçerlidir.</summary>
    public int LegacyMinutesFor(DayOfWeek day) => day switch
    {
        DayOfWeek.Monday => MondayMinutes,
        DayOfWeek.Tuesday => TuesdayMinutes,
        DayOfWeek.Wednesday => WednesdayMinutes,
        DayOfWeek.Thursday => ThursdayMinutes,
        DayOfWeek.Friday => FridayMinutes,
        DayOfWeek.Saturday => SaturdayMinutes,
        _ => SundayMinutes
    };

    /// <summary>Belirtilen günün blokları (başlangıç saatine göre sıralı).</summary>
    public IEnumerable<WorkShiftBlock> BlocksFor(DayOfWeek day) =>
        Blocks.Where(x => x.DayOfWeek == (int)day).OrderBy(x => x.StartMinute);

    /// <summary>O gün beklenen toplam mesai dakikası.</summary>
    public int MinutesFor(DayOfWeek day) =>
        Blocks.Count > 0 ? BlocksFor(day).Sum(x => x.DurationMinutes) : LegacyMinutesFor(day);

    /// <summary>Haftalık toplam beklenen mesai dakikası.</summary>
    public int WeeklyMinutes =>
        Enum.GetValues<DayOfWeek>().Sum(MinutesFor);

    /// <summary>
    /// Ücret ağırlıklı haftalık dakika: her blok kendi katsayısıyla çarpılır.
    /// Bordro tarafında haftalık maliyeti göstermek için kullanılır.
    /// </summary>
    public decimal WeightedWeeklyMinutes =>
        Blocks.Count > 0
            ? Blocks.Sum(x => x.DurationMinutes * x.PayMultiplier)
            : WeeklyMinutes;
}
