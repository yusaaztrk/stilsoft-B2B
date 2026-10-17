using System.Globalization;
using System.Text;

namespace B2B.Erp.Api.Features.InvoicePrint;

/// <summary>
/// Produces the "YALNIZ :" line exactly as the old ERP printed it.
///
/// In the legacy system this arrived pre-rendered as the YAZIYLA column of VW_FATURA_DIZAYN_DATA,
/// so the only record of its rules is the printed output. The format was reconstructed from six
/// reference invoices:
///
///   10.000,00  -> ON BİN TL SIFIR KR
///    5.200,00  -> BEŞ BİN İKİ YÜZ TL SIFIR KR
///   31.200,00  -> OTUZ BİR BİN İKİ YÜZ TL SIFIR KR
///   34.057,14  -> OTUZ DÖRT BİN ELLİ YEDİ TL ON DÖRT KR
///  385.658,95  -> ÜÇ YÜZ SEKSEN BEŞ BİN ALTI YÜZ ELLİ SEKİZ TL DOKSAN BEŞ KR
///
/// Every sample is reproduced by this implementation (see InvoicePrintSpecTests).
///
/// Two rules had no sample to confirm them and follow standard Turkish instead: a leading "BİR"
/// is dropped before YÜZ and before the thousands BİN ("BİN", not "BİR BİN"), but kept for
/// MİLYON and above. If a legacy invoice ever shows otherwise, this is the single place to fix.
/// </summary>
public static class TurkishMoneyInWords
{
    private static readonly string[] Ones =
        { "", "BİR", "İKİ", "ÜÇ", "DÖRT", "BEŞ", "ALTI", "YEDİ", "SEKİZ", "DOKUZ" };

    private static readonly string[] Tens =
        { "", "ON", "YİRMİ", "OTUZ", "KIRK", "ELLİ", "ALTMIŞ", "YETMİŞ", "SEKSEN", "DOKSAN" };

    /// <summary>Scale names by group of three, smallest first.</summary>
    private static readonly string[] Scales =
        { "", "BİN", "MİLYON", "MİLYAR", "TRİLYON" };

    /// <summary>
    /// Formats <paramref name="amount"/> as "&lt;lira&gt; TL &lt;kuruş&gt; KR".
    /// Kuruş is always printed, as SIFIR when zero — every reference invoice does this.
    ///
    /// <para>
    /// <paramref name="currencyTypeId"/> names the units (1=TRY 2=EUR 3=USD 4=GBP). TL is the
    /// default and its output is UNCHANGED — the reference invoices are matched on a character
    /// grid and the spec tests pin it. A dövizli fatura printed with "TL" in words was a legal
    /// document claiming lira for a dollar debt; that is what this parameter closes.
    /// </para>
    /// </summary>
    public static string Format(decimal amount, int currencyTypeId = 1)
    {
        var negative = amount < 0;
        amount = Math.Abs(amount);

        // Rounded to kuruş first: otherwise 0,999 would print as "SIFIR TL DOKSAN DOKUZ KR"
        // while the totals column, which is rounded, shows 1,00.
        var total = decimal.Round(amount, 2, MidpointRounding.AwayFromZero);
        var lira = (long)decimal.Truncate(total);
        var kurus = (int)decimal.Round((total - lira) * 100m, 0, MidpointRounding.AwayFromZero);

        if (kurus == 100)
        {
            lira++;
            kurus = 0;
        }

        var (mainUnit, subUnit) = UnitNames(currencyTypeId);

        var sb = new StringBuilder();
        if (negative) sb.Append("EKSİ ");
        sb.Append(Convert(lira));

        // Two spaces before the main unit, one before the sub unit. Not a typo: measured on the
        // character grid of all five reference invoices, where TL always starts two columns after
        // the last word of the lira part. Since the layout is monospaced, getting this wrong
        // shifts the rest of the line by a whole character cell.
        sb.Append("  ");
        sb.Append(mainUnit);
        sb.Append(' ');
        sb.Append(Convert(kurus));
        sb.Append(' ');
        sb.Append(subUnit);
        return sb.ToString();
    }

    /// <summary>
    /// Unit names as the printed form spells them. Wording follows what this repo already used
    /// for the same purpose; TL keeps the short "TL"/"KR" of the reference invoices because the
    /// layout was measured around them.
    /// </summary>
    private static (string Main, string Sub) UnitNames(int currencyTypeId) => currencyTypeId switch
    {
        2 => ("EURO", "CENT"),
        3 => ("AMERİKAN DOLARI", "CENT"),
        4 => ("STERLİN", "PENİ"),
        // 0 ve 1'in ikisi de TL (bkz. CurrencyTypeHelper); bilinmeyen kod da TL'ye düşer,
        // çünkü yazıyla satırı boş bırakmak faturayı geçersiz kılar.
        _ => ("TL", "KR")
    };

    /// <summary>Number to Turkish words, uppercase, space separated. Zero is "SIFIR".</summary>
    public static string Convert(long value)
    {
        if (value == 0) return "SIFIR";

        // Split into groups of three, least significant first.
        var groups = new List<int>();
        var rest = value;
        while (rest > 0)
        {
            groups.Add((int)(rest % 1000));
            rest /= 1000;
        }

        if (groups.Count > Scales.Length)
        {
            // Beyond TRİLYON there is no reference for the wording, and a silently wrong amount
            // in words on a legal invoice is worse than an obvious failure.
            throw new ArgumentOutOfRangeException(nameof(value), value, "Yazıya çevrilemeyecek kadar büyük tutar.");
        }

        var parts = new List<string>();
        for (var i = groups.Count - 1; i >= 0; i--)
        {
            var group = groups[i];
            if (group == 0) continue;

            var words = ConvertGroup(group);

            // "BİR BİN" is not Turkish; "BİN" alone is. Higher scales keep their BİR.
            if (i == 1 && group == 1)
            {
                words = string.Empty;
            }

            if (!string.IsNullOrEmpty(words)) parts.Add(words);
            if (i > 0) parts.Add(Scales[i]);
        }

        return string.Join(' ', parts);
    }

    /// <summary>Converts 1..999. "YÜZ" carries no BİR; "İKİ YÜZ" and above do.</summary>
    private static string ConvertGroup(int value)
    {
        var parts = new List<string>();

        var hundreds = value / 100;
        if (hundreds > 0)
        {
            if (hundreds > 1) parts.Add(Ones[hundreds]);
            parts.Add("YÜZ");
        }

        var tens = value % 100 / 10;
        if (tens > 0) parts.Add(Tens[tens]);

        var ones = value % 10;
        if (ones > 0) parts.Add(Ones[ones]);

        return string.Join(' ', parts);
    }

    /// <summary>
    /// The money format used in every numeric column: thousands separated by '.', two decimals
    /// after ','. Culture is pinned rather than taken from the request, because the layout is
    /// measured in fixed character cells and a different separator would change the width.
    /// </summary>
    public static string Money(decimal value)
        => value.ToString("#,##0.00", TrCulture);

    internal static readonly CultureInfo TrCulture = CreateTrCulture();

    private static CultureInfo CreateTrCulture()
    {
        var ci = (CultureInfo)CultureInfo.InvariantCulture.Clone();
        ci.NumberFormat.NumberGroupSeparator = ".";
        ci.NumberFormat.NumberDecimalSeparator = ",";
        return ci;
    }
}
