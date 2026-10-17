namespace B2B.Erp.Api.Features.InvoicePrint;

/// <summary>
/// Geometry of the product barcode label, measured off the legacy output
/// (docs/barkod-etiket-olculeri.md). Points, with the source centimetre beside each.
///
/// One label per page. The old system emitted a page per unit sold, so a line with quantity 4
/// produced four identical pages — that is what feeds a label printer.
///
/// The rows come from the legacy 5.01 x 2.50 cm label; the stock in use is 5.01 x 4.00 cm. Two
/// things follow from the extra height: a third name line, and a <see cref="VerticalOffset"/> that
/// shifts the whole block down so it sits centred rather than hugging the top edge.
/// </summary>
internal static class ProductLabelLayout
{
    public const double Cm = 28.3465;

    public const double PageWidth = 5.009 * Cm;
    public const double PageHeight = 4.0 * Cm;

    /// <summary>Product name and barcode digits.</summary>
    public const double NameFontSize = 9.8;

    /// <summary>The price line is set larger.</summary>
    public const double PriceFontSize = 12.0;

    // ---- The third name line ----------------------------------------------------------------

    /// <summary>Gap between the two name rows on the legacy label (0.497 - 0.102).</summary>
    private const double NameLineHeight = 0.395 * Cm;

    /// <summary>
    /// Everything below the name is pushed down by one row to make room for a third line.
    ///
    /// Two lines were not enough once the name wrapped on word boundaries: "…KAHVE MAKİNESİ-INOX"
    /// lost its last two words entirely. The taller stock has the room to spare.
    /// </summary>
    private const double ThirdLineShift = NameLineHeight;

    // ---- Vertical centring ----------------------------------------------------------------

    /// <summary>Top of the name and bottom of the digit row — the first and last ink on the label.</summary>
    private const double ContentTop = 0.102 * Cm;
    private const double ContentBottom = 2.088 * Cm + ThirdLineShift + NameFontSize;

    /// <summary>
    /// The label is taller than the block it carries, so every row moves down by the same amount
    /// to leave equal space above and below.
    /// </summary>
    public const double VerticalOffset = (PageHeight - (ContentBottom - ContentTop)) / 2 - ContentTop;

    // ---- Text rows (centred on the label) -----------------------------------------------

    public const double NameLine1Top = 0.102 * Cm + VerticalOffset;
    public const double NameLine2Top = 0.497 * Cm + VerticalOffset;
    public const double NameLine3Top = 0.497 * Cm + NameLineHeight + VerticalOffset;
    public const double PriceTop = 0.998 * Cm + ThirdLineShift + VerticalOffset;

    /// <summary>
    /// Width the name is allowed to fill before it wraps. Taken from the widest measured line
    /// (4.771 cm) plus the margin it left. The reference clipped mid-word here; we wrap on word
    /// boundaries instead, so "…KAHVE MAKİNESİ-INOX" stays readable rather than ending "…KAHVE M".
    /// </summary>
    public const double NameMaxWidth = 4.85 * Cm;

    /// <summary>
    /// Lines of product name the label has room for. Anything beyond is dropped. Keep in step with
    /// the NameLine*Top rows — the renderer indexes them by line number.
    /// </summary>
    public const int NameLineCount = 3;

    // ---- Barcode --------------------------------------------------------------------------

    /// <summary>Left edge of the first module.</summary>
    public const double BarsLeft = 0.5371 * Cm;

    public const double BarsTop = 1.455 * Cm + ThirdLineShift + VerticalOffset;

    /// <summary>One module. 95 of these make the symbol 4.2089 cm wide.</summary>
    public const double ModuleWidth = 0.0443 * Cm;

    public const double BarHeight = 0.571 * Cm;

    /// <summary>Guards run past the digit row, as on any EAN-13 symbol.</summary>
    public const double GuardBarHeight = 0.788 * Cm;

    // ---- Human readable digits ---------------------------------------------------------------

    public const double DigitsTop = 2.088 * Cm + ThirdLineShift + VerticalOffset;

    /// <summary>The lone first digit sits outside the symbol, left of the opening guard.</summary>
    public const double FirstDigitLeft = 0.365 * Cm;

    public const double LeftGroupLeft = 1.073 * Cm;
    public const double RightGroupLeft = 3.178 * Cm;

    /// <summary>Total width of the drawn symbol.</summary>
    public static double BarcodeWidth => Ean13.ModuleCount * ModuleWidth;
}
