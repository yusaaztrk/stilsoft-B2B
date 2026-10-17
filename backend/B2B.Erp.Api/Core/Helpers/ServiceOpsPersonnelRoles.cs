namespace B2B.Erp.Api.Core.Helpers;

/// <summary>
/// Servis personeli (teknisyen) sayılan roller.
///
/// Bu kişilerin B2B tarafında da bir kullanıcı satırı var — teknisyen eklenirken açılıyor —
/// ama yönetildikleri yer Servis'teki Teknisyenler sekmesi. Ayarlar > Kullanıcılar listesinde
/// de görünmeleri aynı kişiyi iki ayrı yerden düzenlenebilir gösteriyordu; liste onlara göre
/// tasarlanmadığı için de depo/kasa atamaları oradan yarım yapılabiliyordu.
///
/// NOT: bu PERSONEL listesidir. "Saha teknisyeni mi" ayrı bir karardır ve ServiceOps tarafında
/// FieldTechnicianRoleCodes ile veriliyor — ServisMudur oraya EKLENMEMELİ.
/// </summary>
public static class ServiceOpsPersonnelRoles
{
    public static readonly string[] Codes =
    {
        "ServisPersonel", "Technician", "Teknisyen",
        "KlimaEkibi", "SahaMontajEkibi", "ServisMudur", "MontajMudur"
    };

    public static bool IsPersonnel(string? roleCode, string? roleName)
    {
        return Contains(roleCode) || Contains(roleName);
    }

    private static bool Contains(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return false;
        var trimmed = value.Trim();
        return Codes.Any(x => string.Equals(x, trimmed, StringComparison.OrdinalIgnoreCase));
    }
}
