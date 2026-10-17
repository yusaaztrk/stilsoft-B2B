namespace B2B.Erp.Api.Entities;

/// <summary>
/// Bir mesai tanımının haftalık bloğu: "pazartesi 08:00–12:00" gibi.
///
/// <para>Mesai önce günlük tek bir süre olarak tutuluyordu (pazartesi 540 dakika). Bu, gün
/// içinde birden fazla dilimi (öğle arasıyla bölünmüş mesai, akşam vardiyası, yarım gün
/// cumartesi) ve dilime özel ücreti ifade edemiyordu. Artık her gün istenildiği kadar blokla
/// tanımlanır ve her bloğun kendi ücret katsayısı olur.</para>
/// </summary>
public sealed class WorkShiftBlock : AuditableEntity
{
    public int Id { get; set; }

    public int WorkScheduleSettingId { get; set; }

    /// <summary>
    /// Haftanın günü. <see cref="System.DayOfWeek"/> ile aynı kodlama: 0 = Pazar, 1 = Pazartesi …
    /// 6 = Cumartesi. Blok, BAŞLADIĞI güne aittir; gece yarısını aşan vardiya da bu güne yazılır.
    /// </summary>
    public int DayOfWeek { get; set; }

    /// <summary>Gün başından itibaren başlangıç dakikası (0–1439). 480 = 08:00.</summary>
    public int StartMinute { get; set; }

    /// <summary>
    /// Gün başından itibaren bitiş dakikası. Gece yarısını aşan vardiyada 1440'tan büyük olur:
    /// 22:00–06:00 vardiyası 1320 → 1800 şeklinde tutulur.
    /// </summary>
    public int EndMinute { get; set; }

    /// <summary>
    /// Bu blokta çalışılan dakikanın ücret katsayısı. 1,00 = normal mesai;
    /// 1,50 = %50 zamlı; 2,00 = iki katı. Gece ve hafta sonu dilimlerine ayrı katsayı verilebilir.
    /// </summary>
    public decimal PayMultiplier { get; set; } = 1.00m;

    /// <summary>Ekranda görünen etiket ("Sabah", "Gece", "Cumartesi yarım gün").</summary>
    public string? Label { get; set; }

    public WorkScheduleSetting? WorkScheduleSetting { get; set; }

    /// <summary>Bloğun süresi (dakika).</summary>
    public int DurationMinutes => Math.Max(0, EndMinute - StartMinute);
}
