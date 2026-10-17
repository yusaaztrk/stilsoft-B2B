using System;

namespace B2B.Erp.Api.Entities;

/// <summary>
/// Personelin mesai başlatabileceği konum (mağaza, depo, şantiye...).
///
/// <para>Tek kayıtlık bir ayardı; firmanın birden fazla noktası olduğu için ÇOKLU kayda
/// çevrildi. Personel karti bir konuma bağlanır (<c>Employees.LocationSettingId</c>);
/// bağlanmamış personel aktif konumlardan HERHANGİ birinden giriş yapabilir.</para>
/// </summary>
public sealed class EmployeeLocationSetting : AuditableEntity
{
    public int Id { get; set; }

    /// <summary>Konumun adı — "Mağaza", "Depo" gibi. Personel atamasında bu ad görünür.</summary>
    public string Name { get; set; } = string.Empty;
    public decimal Latitude { get; set; }
    public decimal Longitude { get; set; }
    public double MaxDistanceInMeters { get; set; }
    public bool IsActive { get; set; } = true;

    /// <summary>
    /// KONUM DIŞI ÇIKIŞ (2026-10-16 kullanıcı isteği): mesai bitince bölgeye uğramadan doğrudan
    /// eve/sahaya giden personel için. Açıksa bu konuma bağlı (ya da girişini bu konumda yapmış)
    /// personel bölge dışından çıkış yapabilir; konum yine ZORUNLUDUR ve çıkış "konum dışı" diye
    /// işaretlenir (<see cref="EmployeeCheckIn.CheckOutOffsite"/>). Giriş kuralı değişmez.
    /// </summary>
    public bool AllowOffsiteCheckOut { get; set; }
}
