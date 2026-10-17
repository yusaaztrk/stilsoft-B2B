using PdfSharp.Fonts;

namespace B2B.Erp.Api.Features.InvoicePrint;

/// <summary>
/// Supplies the fonts the printed forms are measured in: Courier New for the invoice, Times New
/// Roman for the product label.
///
/// This is not a cosmetic choice. The invoice's alignment relies on Courier being monospaced at
/// exactly 0.6 em, and both faces must carry the Turkish letters İ Ş Ğ Ç Ö Ü. A font missing
/// those glyphs does not merely render them wrong: the missing advance pulls the rest of the
/// line left, so every field after the first Turkish character lands off its printed box. That
/// was reproduced during layout verification, where a base-14 Courier shifted a line by 1.4 mm.
///
/// Each face is looked up on the host and, failing that, in the application's own Fonts folder,
/// so a Linux container without the Microsoft fonts can carry a copy rather than silently
/// falling back to something metrically different.
/// </summary>
internal sealed class CourierFontResolver : IFontResolver
{
    public const string MonospaceFamily = "Courier New";
    public const string SerifFamily = "Times New Roman";

    private static readonly Dictionary<string, string[]> Candidates = new(StringComparer.Ordinal)
    {
        ["CourierNew#Bold"] = new[]
        {
            @"C:\Windows\Fonts\courbd.ttf",
            "/usr/share/fonts/truetype/msttcorefonts/Courier_New_Bold.ttf",
            "/usr/share/fonts/truetype/liberation/LiberationMono-Bold.ttf",
            "/usr/share/fonts/liberation/LiberationMono-Bold.ttf"
        },
        ["CourierNew#Regular"] = new[]
        {
            @"C:\Windows\Fonts\cour.ttf",
            "/usr/share/fonts/truetype/msttcorefonts/Courier_New.ttf",
            "/usr/share/fonts/truetype/liberation/LiberationMono-Regular.ttf",
            "/usr/share/fonts/liberation/LiberationMono-Regular.ttf"
        },
        ["TimesNewRoman#Bold"] = new[]
        {
            @"C:\Windows\Fonts\timesbd.ttf",
            "/usr/share/fonts/truetype/msttcorefonts/Times_New_Roman_Bold.ttf",
            "/usr/share/fonts/truetype/liberation/LiberationSerif-Bold.ttf",
            "/usr/share/fonts/liberation/LiberationSerif-Bold.ttf"
        },
        ["TimesNewRoman#Regular"] = new[]
        {
            @"C:\Windows\Fonts\times.ttf",
            "/usr/share/fonts/truetype/msttcorefonts/Times_New_Roman.ttf",
            "/usr/share/fonts/truetype/liberation/LiberationSerif-Regular.ttf",
            "/usr/share/fonts/liberation/LiberationSerif-Regular.ttf"
        }
    };

    /// <summary>Local copies, checked before the system ones so output matches off Windows.</summary>
    private static readonly Dictionary<string, string> LocalFiles = new(StringComparer.Ordinal)
    {
        ["CourierNew#Bold"] = "courbd.ttf",
        ["CourierNew#Regular"] = "cour.ttf",
        ["TimesNewRoman#Bold"] = "timesbd.ttf",
        ["TimesNewRoman#Regular"] = "times.ttf"
    };

    private static readonly Dictionary<string, byte[]> Cache = new(StringComparer.Ordinal);
    private static readonly object Gate = new();
    private static int _installed;

    /// <summary>
    /// Registers this resolver once for the process. GlobalFontSettings is process-wide and
    /// throws if assigned twice, so both renderers route through here.
    /// </summary>
    public static void Install()
    {
        if (Interlocked.Exchange(ref _installed, 1) == 0)
        {
            GlobalFontSettings.FontResolver ??= new CourierFontResolver();
        }
    }

    public FontResolverInfo? ResolveTypeface(string familyName, bool isBold, bool isItalic)
    {
        var family = familyName.Replace(" ", string.Empty);
        // Anything unexpected falls back to the serif face rather than to PDFsharp's default,
        // which would not be embedded and would not carry the Turkish glyphs.
        if (!family.Equals("CourierNew", StringComparison.OrdinalIgnoreCase))
        {
            family = "TimesNewRoman";
        }

        return new FontResolverInfo($"{family}#{(isBold ? "Bold" : "Regular")}");
    }

    public byte[]? GetFont(string faceName)
    {
        lock (Gate)
        {
            if (Cache.TryGetValue(faceName, out var cached)) return cached;

            var bytes = Load(faceName);
            Cache[faceName] = bytes;
            return bytes;
        }
    }

    private static byte[] Load(string faceName)
    {
        var paths = new List<string>();

        if (LocalFiles.TryGetValue(faceName, out var local))
        {
            paths.Add(Path.Combine(AppContext.BaseDirectory, "Fonts", local));
        }

        if (Candidates.TryGetValue(faceName, out var system))
        {
            paths.AddRange(system);
        }

        foreach (var path in paths.Where(p => !string.IsNullOrWhiteSpace(p) && File.Exists(p)))
        {
            return File.ReadAllBytes(path);
        }

        // Failing loudly: a substituted font would produce a document that looks plausible on
        // screen and prints across the pre-printed boxes, or a barcode that will not scan.
        throw new FileNotFoundException(
            $"Basım için gereken yazı tipi bulunamadı ({faceName}). " +
            "Sunucuya Courier New ve Times New Roman kurun ya da dosyaları uygulamanın Fonts klasörüne koyun.");
    }
}
