using System.Security.Claims;
using B2B.Erp.Api.Data;
using Microsoft.EntityFrameworkCore;

namespace B2B.Erp.Api.Core.Helpers;

/// <summary>
/// CARİ EKSTRE TİP YETKİSİ (2026-10-11, kullanıcı: "müdürlere tedarikçi, bayi, müşteri cari
/// ekstrelerini görüntüleme / görüntülememe yetkisi verebilmeliyim").
///
/// Kullanıcı bazında <c>Users.CariEkstreTipleri</c> (virgüllü anahtar listesi). BOŞ = kısıtlama yok —
/// alan eklenmeden önceki davranış; yani kimse bu değişiklikle bir şey kaybetmez. SSA her zaman serbest.
///
/// Sınıflandırma önce carinin TİP metnine (Customers.CustomerType), tanınmazsa KOD önekine bakar:
/// canlıda tip metinleri serbest yazılmış ("müşteri"/"Müşteri"), alt bayi kodu 120-10 gibi.
/// Ön yüzdeki karşılığı <c>frontend/src/utils/cariEkstreKapsami.ts</c> — ikisi aynı kalmalı.
/// </summary>
public static class CariEkstreKapsami
{
    public const string Bayi = "bayi";
    public const string AltBayi = "altbayi";
    public const string Musteri = "musteri";
    public const string Magaza = "magaza";
    public const string Tedarikci = "tedarikci";
    public const string Diger = "diger";

    public static readonly string[] All = { Bayi, AltBayi, Musteri, Magaza, Tedarikci, Diger };

    /// <summary>Kayıt için temizler: tanınmayanı atar; hepsi seçiliyse ya da hiçbiri yoksa null (= kısıtlama yok).</summary>
    public static string? Serialize(IEnumerable<string>? keys)
    {
        if (keys is null) return null;
        var set = keys.Select(k => (k ?? string.Empty).Trim().ToLowerInvariant()).Where(k => All.Contains(k)).Distinct().ToList();
        if (set.Count == 0 || set.Count == All.Length) return null;
        return string.Join(",", All.Where(set.Contains));
    }

    /// <summary>null = kısıtlama yok.</summary>
    public static List<string>? Parse(string? stored)
    {
        if (string.IsNullOrWhiteSpace(stored)) return null;
        var list = stored.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Select(x => x.ToLowerInvariant()).Where(All.Contains).Distinct().ToList();
        return list.Count == 0 ? null : list;
    }

    public static string ClassifyCustomer(string? customerCode, string? customerType)
    {
        var t = (customerType ?? string.Empty).Trim().ToLower(new System.Globalization.CultureInfo("tr-TR"));
        if (t.Length > 0)
        {
            if (t.Contains("alt bayi") || t.Contains("altbayi")) return AltBayi;
            if (t.Contains("bayi") || t == "şube" || t == "sube") return Bayi; // şube = bayinin şubesi
            if (t.Contains("müşteri") || t.Contains("musteri")) return Musteri;
            if (t.Contains("mağaza") || t.Contains("magaza")) return Magaza;
        }

        var c = (customerCode ?? string.Empty).Trim();
        if (c.StartsWith("120-02") || c.StartsWith("120-10")) return AltBayi;
        if (c.StartsWith("120-01") || c.StartsWith("01-")) return Bayi;
        if (c.StartsWith("120-03")) return Musteri;
        if (c.StartsWith("120-04")) return Magaza;
        if (c.StartsWith("320")) return Tedarikci;
        return Diger;
    }

    /// <summary>Oturumdaki kullanıcının izinli tipleri; null = kısıtlama yok.</summary>
    public static async Task<List<string>?> AllowedAsync(AppDbContext db, ClaimsPrincipal user, CancellationToken ct)
    {
        if (user.FindFirst("IsSuperSuperAdmin")?.Value == "1") return null;
        var idStr = user.FindFirst(ClaimTypes.NameIdentifier)?.Value ?? user.FindFirst("UserId")?.Value;
        if (!int.TryParse(idStr, out var id)) return null;
        var stored = await db.Users.AsNoTracking().Where(u => u.Id == id).Select(u => u.CariEkstreTipleri).FirstOrDefaultAsync(ct);
        return Parse(stored);
    }

    public static string Label(string key) => key switch
    {
        Bayi => "Bayi",
        AltBayi => "Alt Bayi",
        Musteri => "Müşteri",
        Magaza => "Mağaza",
        Tedarikci => "Tedarikçi",
        _ => "Diğer"
    };

    public static string DeniedMessage(string key) =>
        $"{Label(key)} carilerinin ekstresini görme yetkiniz yok. (Ayarlar → Kullanıcılar → Cari ekstre tipleri)";
}
