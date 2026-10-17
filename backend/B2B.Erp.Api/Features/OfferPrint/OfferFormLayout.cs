namespace B2B.Erp.Api.Features.OfferPrint;

/// <summary>
/// The customer offer form, laid out from column widths rather than copied cell by cell.
///
/// The first attempt reproduced the legacy ruling rectangle for rectangle. That looked right on
/// a single-product page and fell apart everywhere else: the totals frame belonged to the same
/// fixed grid, so it printed as an empty box on every page but the last, and the header cells
/// were sized around one customer's name and were crossed by longer ones.
///
/// Here every rule is derived from the columns below, so a cell is always as wide as the space
/// it was given, and the parts that belong to the last page are drawn only there. The page size,
/// the typeface and the header banner stay as they were.
/// </summary>
internal static class OfferFormLayout
{
    public const double Cm = 28.3465;

    /// <summary>US Letter, as both the legacy output and the user's stock use.</summary>
    public const double PageWidth = 21.590 * Cm;
    public const double PageHeight = 27.940 * Cm;

    /// <summary>Printable area; everything is drawn between these.</summary>
    public const double MarginLeft = 0.397 * Cm;
    public const double MarginRight = 21.193 * Cm;

    public const double BodyFontSize = 9.5;
    public const double SmallFontSize = 8.5;
    public const double NoteFontSize = 8.0;
    public const double HeadFontSize = 9.0;

    /// <summary>Hairline weight, matching the legacy 0.26 mm rule.</summary>
    public const double LineWidth = 0.0265 * Cm;

    // ---- Header banner -----------------------------------------------------------------------

    public const double BannerLeft = MarginLeft;
    public const double BannerTop = 0.005 * Cm;
    public const double BannerWidth = MarginRight - MarginLeft;
    public const double BannerHeight = 3.202 * Cm;
    public const string BannerFileName = "teklif-baslik.png";
    public const string LogoFileName = "stilsoft-logo.png";

    // ---- Customer box ------------------------------------------------------------------------

    /// <summary>Three rows: trading name, contact, phone — each with a document field beside it.</summary>
    public const double InfoTop = 3.609 * Cm;
    public const double InfoRowHeight = 0.635 * Cm;
    public const int InfoRows = 3;
    public const double InfoBottom = InfoTop + InfoRows * InfoRowHeight;

    /// <summary>
    /// Where the box splits. The left half carries the customer, the right the document — wide
    /// enough that a full company name fits without crossing the rule.
    /// </summary>
    public const double InfoSplit = 11.400 * Cm;

    /// <summary>Padding inside every cell.</summary>
    public const double CellPad = 0.12 * Cm;

    // ---- Item table --------------------------------------------------------------------------

    public const double TableTop = InfoBottom + 0.30 * Cm;

    /// <summary>Two caption rows, so two-word headings do not need abbreviating.</summary>
    public const double HeadRowHeight = 0.50 * Cm;
    public const double TableHeadBottom = TableTop + 2 * HeadRowHeight;

    // ---- Totals ------------------------------------------------------------------------------

    public const double TotalsRowHeight = 0.635 * Cm;
    public const int TotalsRows = 8;

    /// <summary>Right-aligned block, sized so the widest label and figure both fit.</summary>
    public const double TotalsLeft = 12.100 * Cm;
    public const double TotalsValueSplit = 17.400 * Cm;
    public const double TotalsTop = PageHeight - 1.000 * Cm - TotalsRows * TotalsRowHeight;

    /// <summary>
    /// Bottom of the item area, derived from where the totals begin rather than written out.
    /// Fixing both by hand had the table ending at 21.90 and the totals starting at 21.86, so
    /// the two frames printed over each other by a fraction of a millimetre.
    /// </summary>
    public const double TableBottom = TotalsTop - 0.45 * Cm;

    public static double TotalsRowTop(int row) => TotalsTop + row * TotalsRowHeight;

    // ---- Standing notes ------------------------------------------------------------------------

    public const double NoteLeft = MarginLeft + CellPad;
    public const double NoteRowHeight = 0.480 * Cm;

    /// <summary>Set against the top of the totals block, so the two read as one footer.</summary>
    public static double NoteTop(int row) => TotalsTop + 0.10 * Cm + row * NoteRowHeight;

    public static readonly string[] Notes =
    {
        "FİYAT TEKLİFİ 7 GÜN GEÇERLİDİR",
        "ÜRÜNLERİMİZ 3 YIL GARANTİLİDİR",
        "TELEVİZYONLARDA ASKI APARATI VE MONTAJ DAHİL DEĞİLDİR",
        "ÖDEME ŞEKLİ PEŞİNDİR"
    };
}

/// <summary>One column of the item table.</summary>
/// <param name="Left">Left rule of the column.</param>
/// <param name="Right">Right rule.</param>
/// <param name="Caption1">First caption row.</param>
/// <param name="Caption2">Second caption row; empty when the heading is one word.</param>
/// <param name="Align">How the cell's content sits in it.</param>
internal readonly record struct OfferColumn(
    double Left,
    double Right,
    string Caption1,
    string Caption2,
    OfferAlign Align)
{
    public double Width => Right - Left;
}

internal enum OfferAlign
{
    Left,
    Centre,
    Right
}

/// <summary>The plain form: a row per product.</summary>
internal static class PlainOfferLayout
{
    private const double Cm = OfferFormLayout.Cm;

    public const double RowHeight = 0.560 * Cm;

    /// <summary>
    /// Columns, left to right. The widths give the figures what they need and leave the rest to
    /// the product name, which is by far the longest field.
    /// </summary>
    public static readonly OfferColumn[] Columns =
    {
        new(0.397 * Cm, 3.100 * Cm, "BARKOD", "", OfferAlign.Left),
        new(3.100 * Cm, 11.900 * Cm, "STOK ADI", "", OfferAlign.Left),
        new(11.900 * Cm, 13.100 * Cm, "ADET", "", OfferAlign.Centre),
        new(13.100 * Cm, 14.500 * Cm, "KDV", "", OfferAlign.Centre),
        new(14.500 * Cm, 16.800 * Cm, "BİRİM", "FİYAT", OfferAlign.Right),
        new(16.800 * Cm, 19.000 * Cm, "İNDİRİMLİ", "FİYAT", OfferAlign.Right),
        new(19.000 * Cm, 21.193 * Cm, "ARA", "TOPLAM", OfferAlign.Right)
    };

    public static int RowsPerPage =>
        (int)((OfferFormLayout.TableBottom - OfferFormLayout.TableHeadBottom) / RowHeight);
}

/// <summary>The featured form: one product per page, with its picture and feature list.</summary>
internal static class FeaturedOfferLayout
{
    private const double Cm = OfferFormLayout.Cm;

    public static readonly OfferColumn[] Columns =
    {
        new(0.397 * Cm, 4.900 * Cm, "ÜRÜN", "GÖRSELİ", OfferAlign.Centre),
        new(4.900 * Cm, 7.400 * Cm, "BARKOD", "STOK KODU", OfferAlign.Centre),
        new(7.400 * Cm, 13.100 * Cm, "STOK ADI", "ÜRÜN ÖZELLİKLERİ", OfferAlign.Left),
        new(13.100 * Cm, 14.300 * Cm, "ADET", "", OfferAlign.Centre),
        new(14.300 * Cm, 15.600 * Cm, "KDV", "", OfferAlign.Centre),
        new(15.600 * Cm, 17.700 * Cm, "BİRİM", "FİYAT", OfferAlign.Right),
        new(17.700 * Cm, 19.500 * Cm, "İNDİRİMLİ", "FİYAT", OfferAlign.Right),
        new(19.500 * Cm, 21.193 * Cm, "ARA", "TOPLAM", OfferAlign.Right)
    };

    /// <summary>
    /// One product fills the item area. That is what makes it the featured form: the picture and
    /// the feature list need the room, and the legacy output gives each product a page too.
    /// </summary>
    public static readonly double RowHeight =
        OfferFormLayout.TableBottom - OfferFormLayout.TableHeadBottom;

    public const double ImagePad = 0.20 * Cm;
    public const double ImageMaxHeight = 4.200 * Cm;

    public const double TextLineHeight = 0.420 * Cm;

    /// <summary>Feature lines that fit before the row would overflow.</summary>
    public static int MaxTextLines => (int)((RowHeight - 0.4 * Cm) / TextLineHeight);

    public const int BlocksPerPage = 1;
}
