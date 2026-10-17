namespace B2B.Erp.Api.Entities;

public enum DailyOverrideKind
{
    Salary = 1,
    Meal = 2
}

/// <summary>
/// Tek bir GÜNÜN hakediş düzeltmesi.
///
/// <para>Hakediş dakika bazlı ilerler: gün kapandığında o günün çalışılan dakikası değerlenir ve
/// hakedişe eklenir, ertesi gün sıfırdan sayılmaya başlar. Ama gerçek hayatta gün bazında
/// düzeltme gerekir — personel çıkış yapmayı unutmuştur, yarım gün izinlidir, o güne özel bir
/// anlaşma vardır.</para>
///
/// <para>İki tür düzeltme desteklenir:</para>
/// <list type="bullet">
/// <item><see cref="OverrideMinutes"/>: o günün çalışılan dakikası bu kabul edilir, tutar
/// dakika ücretiyle yeniden hesaplanır. Unutulan çıkış için doğru olan budur.</item>
/// <item><see cref="OverrideAmount"/>: o günün TL değeri doğrudan bu olur, dakikaya bakılmaz.
/// İkisi birden verilirse tutar kazanır.</item>
/// </list>
///
/// <para>Gün + personel + tür başına tek kayıt; aynı gün yeniden düzeltilirse üzerine yazılır.
/// Düzeltme yalnızca ilgili günü etkiler, dönemin geri kalanı motorun hesabıyla yürür.</para>
/// </summary>
public sealed class EmployeeDailyAccrualOverride : AuditableEntity
{
    public int Id { get; set; }

    public int EmployeeId { get; set; }

    /// <summary>Düzeltilen gün, yerel tarih "yyyy-MM-dd". Gün sınırı TurkeyTime'a göredir.</summary>
    public string Date { get; set; } = string.Empty;

    public DailyOverrideKind Kind { get; set; } = DailyOverrideKind.Salary;

    /// <summary>O günün çalışılmış sayılacak dakikası. Null ise motorun bulduğu dakika geçerli.</summary>
    public int? OverrideMinutes { get; set; }

    /// <summary>O günün TL değeri. Doluysa dakika hesabının önüne geçer.</summary>
    public decimal? OverrideAmount { get; set; }

    public string? Description { get; set; }

    public Employee? Employee { get; set; }
}
