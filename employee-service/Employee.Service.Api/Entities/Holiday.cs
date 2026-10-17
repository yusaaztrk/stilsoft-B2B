namespace B2B.Erp.Api.Entities;

/// <summary>
/// Resmî tatil / firma tatili. İş günü sayımında ve hakediş hesabında bu tablo esas alınır.
///
/// <para>Eskiden iş günü "pazar hariç tüm günler" diye sayılıyordu; 29 Ekim ya da bayramlar
/// iş günü kabul ediliyor, cumartesi tam gün sayılıyordu. Artık takvim bu tablodan okunur.</para>
/// </summary>
public sealed class Holiday : AuditableEntity
{
    public int Id { get; set; }

    /// <summary>Tatil günü (saat bilgisi yok, yerel gün).</summary>
    public DateOnly Date { get; set; }

    public string Name { get; set; } = string.Empty;

    /// <summary>Yarım gün tatil (ör. arife günleri) — beklenen mesainin yarısı uygulanır.</summary>
    public bool IsHalfDay { get; set; }

    /// <summary>
    /// Her yıl aynı gün tekrar eden sabit tatil (23 Nisan, 29 Ekim ...). Dinî bayramlar
    /// her yıl kaydığı için bunlarda <c>false</c> kalmalı ve yıl yıl girilmeli.
    /// </summary>
    public bool IsRecurringYearly { get; set; }
}
