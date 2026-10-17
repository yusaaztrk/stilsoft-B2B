namespace Shop.Api.Members;

/// <summary>
/// Mağaza yalnızca KKTC'ye satış/teslimat yapıyor. Bu kural storefront tarafında
/// (`lib/cyprusLocation.ts`) JS ile uygulanıyordu, ama adres kaydı arayüz hiç kullanılmadan
/// doğrudan API'ye atılan istekle de oluşturulabiliyor — istemci tarafı kontrol tek başına
/// yeterli değildi (2026-09-05 denetiminde bulundu). Aynı kural burada, sunucuda tekrar edilir.
/// </summary>
public static class KktcCityValidator
{
    private static readonly string[] KktcCityNames =
    {
        "Lefkoşa", "Girne", "Gazimağusa", "Güzelyurt", "İskele", "Lefke",
    };

    private static readonly string[] ForbiddenKeywords =
    {
        "turkiye", "turkey", "istanbul", "ankara", "izmir", "bursa",
        "antalya", "adana", "konya", "gaziantep", "mersin", "diyarbakir",
    };

    private static readonly Dictionary<string, string> Aliases = new()
    {
        ["magusa"] = "gazimagusa",
        ["nicosia"] = "lefkosa",
        ["kyrenia"] = "girne",
        ["famagusta"] = "gazimagusa",
        ["morphou"] = "guzelyurt",
        ["trikomo"] = "iskele",
    };

    /// <summary>
    /// Türkçe harfleri ASCII'ye indirger. Kültüre bağlı `ToLower`/`ToUpper` Türkçe'de "I"/"ı"
    /// yüzünden tutarsız sonuç verir (bkz. proje hafızası); bu yüzden karakter karşılığı elle
    /// eşleniyor — sunucunun kültür ayarından bağımsız, her zaman aynı sonucu verir.
    /// </summary>
    private static string Fold(string value)
    {
        var chars = value.Trim().Select(c => char.ToLowerInvariant(c) switch
        {
            'ı' => 'i',
            'ş' => 's',
            'ğ' => 'g',
            'ü' => 'u',
            'ö' => 'o',
            'ç' => 'c',
            var other => other,
        }).ToArray();
        return new string(chars);
    }

    public static bool IsValidCity(string? city)
    {
        if (string.IsNullOrWhiteSpace(city)) return false;

        var folded = Fold(city);
        if (Aliases.TryGetValue(folded, out var mapped)) folded = mapped;

        return KktcCityNames.Any(c => Fold(c) == folded || folded.Contains(Fold(c)));
    }

    /// <summary>Null dönerse adres kabul edilir; değilse mesaj kullanıcıya gösterilecek ret sebebidir.</summary>
    public static string? CheckEligibility(string? city, string? address)
    {
        var text = Fold($"{city} {address}");

        foreach (var keyword in ForbiddenKeywords)
        {
            if (text.Contains(keyword))
            {
                return "Teslimat adresiniz KKTC dışında görünüyor. Mağazamız yalnızca Kuzey Kıbrıs Türk Cumhuriyeti sınırları içerisine satış ve teslimat yapmaktadır.";
            }
        }

        if (!string.IsNullOrWhiteSpace(city) && !IsValidCity(city))
        {
            return $"Seçilen şehir ({city}) KKTC sınırları dışında görünüyor. Lütfen KKTC şehirlerinden birini seçin.";
        }

        return null;
    }
}
