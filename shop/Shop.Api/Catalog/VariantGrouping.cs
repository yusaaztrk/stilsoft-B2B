using System.Text;
using System.Text.RegularExpressions;

namespace Shop.Api.Catalog;

/// <summary>
/// Aynı ürünün RENK seçeneklerini tek gruba toplar (2026-09-20).
///
/// SORUN: ERP'de her renk ayrı stok kodu. Vitrinde aynı ürün iki (bazen üç) ayrı kart olarak
/// duruyordu:
/// <code>
///   ST-AO-6041GR BLACK KRISTAL CAM OCAK
///   ST-AO-6041GR WHITE KRISTAL CAM OCAK
/// </code>
/// Müşteri hangisinin ne olduğunu çözemiyor, liste aynı üründen doluyor ve arama motoru
/// neredeyse aynı iki sayfayı birbirine rakip sayıp ikisini birden zayıflatıyor.
///
/// YÖNTEM: ad, renk kelimelerinden ARINDIRILIR; kalan metin grup anahtarı, çıkarılan renkler
/// de seçenek etiketi olur. Renk içermeyen ürün hiç gruplanmaz.
///
/// YANLIŞ GRUPLAMAKTANSA GRUPLAMAMAK: bir grupta AYNI renk iki kez geçiyorsa o grup bozuktur
/// (büyük ihtimalle farklı iki ürün aynı anahtara düşmüş) ve grup tamamen iptal edilir.
/// Ölçüm (166 ürünlük gerçek katalog): 20 grup / 42 ürün, çakışma 0. Gruplanamayan bazı
/// gerçek varyantlar var ("ROZE", "SEDEFLİ MAVİ" gibi renk sözlüğünde olmayan bitişler) —
/// onlar eskisi gibi ayrı kart olarak duruyor, bu bilinçli.
/// </summary>
public static class VariantGrouping
{
    /// <summary>Anahtar bundan kısaysa güvenilmez (renk dışında neredeyse hiçbir şey kalmamış).</summary>
    private const int MinKeyLength = 4;

    /// <summary>
    /// ERP adlarında geçen renk kelimeleri -> vitrinde yazılacak hâli.
    /// İngilizce karşılıklar da var: kartlarda "BLACK/WHITE" yazımı yaygın.
    /// </summary>
    private static readonly Dictionary<string, string> Colors = new(StringComparer.Ordinal)
    {
        ["BLACK"] = "Siyah", ["WHITE"] = "Beyaz", ["SILVER"] = "Gümüş", ["GREY"] = "Gri",
        ["GRAY"] = "Gri", ["RED"] = "Kırmızı", ["BLUE"] = "Mavi", ["GREEN"] = "Yeşil",
        ["CREAM"] = "Krem", ["GOLD"] = "Gold", ["ROSE"] = "Rose", ["COPPER"] = "Bakır",
        ["SIYAH"] = "Siyah", ["BEYAZ"] = "Beyaz", ["GRI"] = "Gri", ["KIRMIZI"] = "Kırmızı",
        ["MAVI"] = "Mavi", ["YESIL"] = "Yeşil", ["INOX"] = "Inox", ["BAKIR"] = "Bakır",
        ["AHSAP"] = "Ahşap", ["KREM"] = "Krem", ["MAT"] = "Mat", ["ANTRASIT"] = "Antrasit",
        ["CELIK"] = "Çelik", ["GUMUS"] = "Gümüş", ["ALTIN"] = "Altın", ["BRONZ"] = "Bronz",
    };

    private static readonly Regex StPrefix = new(@"^\s*(YP\s*-\s*)?ST\s*-\s*", RegexOptions.IgnoreCase | RegexOptions.Compiled);
    private static readonly Regex Spaces = new(@"\s+", RegexOptions.Compiled);
    private static readonly Regex NonKey = new(@"[^A-Z0-9 ]", RegexOptions.Compiled);

    /// <summary>
    /// Renkleri ayırır. Grup anahtarı ve renk etiketi döner; ürün renk içermiyorsa false.
    /// </summary>
    public static bool TryParse(string? name, out string key, out string colorLabel)
    {
        key = string.Empty;
        colorLabel = string.Empty;
        if (string.IsNullOrWhiteSpace(name)) return false;

        var text = StPrefix.Replace(name.Trim(), string.Empty);

        /*
         * Renk kelimesi tireyle yapışık gelebiliyor ve öyle kalırsa ayrı bir jeton olmadığı
         * için ayıklanamaz: "VANTILATOR-SIYAH", "(E)NF-INOX", "640-E-BLACK". Önce boşlukla
         * ayırıyoruz. Peşine HARF gelmesi durumu dışlanıyor ("INOXIDABLE" gibi bir kelimenin
         * içindeki "INOX" renk sayılmasın).
         */
        foreach (var color in Colors.Keys)
        {
            text = Regex.Replace(text, @"[-\s]+(" + color + @")(?![A-Za-z])", " " + color + " ",
                RegexOptions.IgnoreCase);
        }

        text = Spaces.Replace(text, " ").Trim(' ', '-');

        var colors = new List<string>();
        var rest = new List<string>();
        foreach (var token in text.Split(' ', StringSplitOptions.RemoveEmptyEntries))
        {
            var folded = Fold(token.Trim(',', '&'));
            if (Colors.TryGetValue(folded, out var pretty))
            {
                if (!colors.Contains(pretty, StringComparer.Ordinal)) colors.Add(pretty);
            }
            else
            {
                rest.Add(folded);
            }
        }

        if (colors.Count == 0) return false;

        var candidate = NonKey.Replace(string.Join(' ', rest), string.Empty);
        candidate = Spaces.Replace(candidate, " ").Trim();
        if (candidate.Length < MinKeyLength) return false;

        key = candidate;
        colorLabel = string.Join(" & ", colors);
        return true;
    }

    /// <summary>
    /// Listeyi gruplar. Dönen sözlükte YALNIZCA güvenilir gruplar var: en az iki ürün ve
    /// her ürünün AYRI rengi. Gruplanmayan ürün sözlükte hiç geçmez.
    /// </summary>
    public static Dictionary<string, List<CatalogItem>> Build(IEnumerable<CatalogItem> items)
    {
        var buckets = new Dictionary<string, List<CatalogItem>>(StringComparer.Ordinal);

        foreach (var item in items)
        {
            if (!TryParse(item.Name, out var key, out var label)) continue;
            item.VariantGroupKey = key;
            item.VariantLabel = label;
            if (!buckets.TryGetValue(key, out var list)) buckets[key] = list = new List<CatalogItem>();
            list.Add(item);
        }

        var result = new Dictionary<string, List<CatalogItem>>(StringComparer.Ordinal);
        foreach (var (key, list) in buckets)
        {
            if (list.Count < 2) continue;

            // Aynı renk iki kez -> anahtar iki farklı ürünü birleştirmiş olmalı; grubu iptal et.
            var distinct = list.Select(x => x.VariantLabel).Distinct(StringComparer.Ordinal).Count();
            if (distinct != list.Count) continue;

            result[key] = list;
        }

        // Güvenilir gruba girmeyen üründe alanları temizle: kart "1 renk" yazmasın.
        foreach (var item in items)
        {
            if (item.VariantGroupKey is null) continue;
            if (result.ContainsKey(item.VariantGroupKey)) continue;
            item.VariantGroupKey = null;
            item.VariantLabel = null;
        }

        return result;
    }

    /// <summary>Türkçe harfleri ASCII'ye indirip BÜYÜK harfe çevirir ("Şilte" ve "SILTE" aynı olsun).</summary>
    private static string Fold(string s)
    {
        var sb = new StringBuilder(s.Length);
        foreach (var ch in s)
        {
            sb.Append(ch switch
            {
                'ç' or 'Ç' => 'C',
                'ğ' or 'Ğ' => 'G',
                'ı' => 'I',
                'İ' => 'I',
                'ö' or 'Ö' => 'O',
                'ş' or 'Ş' => 'S',
                'ü' or 'Ü' => 'U',
                _ => char.ToUpperInvariant(ch)
            });
        }
        return sb.ToString();
    }
}
