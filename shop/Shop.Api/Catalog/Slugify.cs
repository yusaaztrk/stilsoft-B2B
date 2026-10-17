using System.Text;

namespace Shop.Api.Catalog;

/// <summary>
/// Ürün ve kategori adlarından adres parçası üretir.
///
/// Adresler arama motoru için ürünün ADINDAN türetiliyor (stok kodundan değil):
/// <c>/urun/ankastre-firin-72-l-inox</c> hem kullanıcıya hem Google'a ne olduğunu söyler,
/// <c>/urun/SEG70522</c> hiçbir şey söylemez.
///
/// Türkçe harfler ASCII karşılıklarına çevrilir; aksi halde adres tarayıcıda yüzde işaretli
/// bir diziye dönüşür ve paylaşılan bağlantılar okunmaz hale gelir.
/// </summary>
public static class Slugify
{
    public static string ToSlug(string? value)
    {
        var text = (value ?? string.Empty).Trim().ToLowerInvariant();
        if (text.Length == 0) return string.Empty;

        var sb = new StringBuilder(text.Length);
        var lastWasDash = false;

        foreach (var raw in text)
        {
            var ch = raw switch
            {
                'ç' => 'c',
                'ğ' => 'g',
                'ı' => 'i',
                'İ' => 'i',
                'ö' => 'o',
                'ş' => 's',
                'ü' => 'u',
                'â' => 'a',
                'î' => 'i',
                'û' => 'u',
                _ => raw
            };

            if (ch is >= 'a' and <= 'z' || ch is >= '0' and <= '9')
            {
                sb.Append(ch);
                lastWasDash = false;
            }
            else if (!lastWasDash && sb.Length > 0)
            {
                sb.Append('-');
                lastWasDash = true;
            }
        }

        var slug = sb.ToString().Trim('-');
        return slug.Length > 120 ? slug[..120].Trim('-') : slug;
    }
}
