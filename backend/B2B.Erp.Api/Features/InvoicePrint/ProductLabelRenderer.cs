using PdfSharp.Drawing;
using PdfSharp.Pdf;
using static B2B.Erp.Api.Features.InvoicePrint.ProductLabelLayout;

namespace B2B.Erp.Api.Features.InvoicePrint;

/// <summary>One label: a product, its price, and its barcode.</summary>
public sealed class ProductLabel
{
    public string StokAdi { get; set; } = string.Empty;
    public string Barkod { get; set; } = string.Empty;

    /// <summary>
    /// Null prints the label without a price row, which is what the "Etiket Basım (Fiyatsız)"
    /// screen wants. The row is left empty rather than closed up, so a priced and an unpriced
    /// label put their barcode in exactly the same place on the roll.
    /// </summary>
    public decimal? Fiyat { get; set; }

    /// <summary>
    /// Fiyatın para birimi kodu. Boş bırakılırsa "TL" basılır ve davranış eskisiyle aynıdır.
    ///
    /// Etiket sabit "TL" yazıyordu: dolar fiyatlı bir ürünün rafına lira etiketi çıkıyordu.
    /// </summary>
    public string? ParaBirimi { get; set; }

    /// <summary>How many copies to print. One page each, as the label printer expects.</summary>
    public int Adet { get; set; } = 1;
}

/// <summary>
/// Draws product barcode labels.
///
/// The barcode is drawn as bars rather than rendered to an image, the same way the legacy output
/// did: at this size a rasterised symbol loses whole modules to rounding and stops scanning.
/// Each bar is a filled rectangle on the module grid.
/// </summary>
public sealed class ProductLabelRenderer
{
    /// <summary>
    /// Renders one page per copy. Labels whose barcode is not valid EAN-13 are skipped rather
    /// than printed wrong — a label that will not scan is worse than a missing one, because it
    /// looks fine until it reaches a till.
    /// </summary>
    public byte[] Render(IEnumerable<ProductLabel> labels, out int skipped)
    {
        ArgumentNullException.ThrowIfNull(labels);
        CourierFontResolver.Install();

        using var document = new PdfDocument();
        var skippedCount = 0;

        foreach (var label in labels)
        {
            if (!Ean13.TryNormalise(label.Barkod, out var code))
            {
                skippedCount++;
                continue;
            }

            var copies = Math.Max(1, label.Adet);
            for (var i = 0; i < copies; i++)
            {
                DrawLabel(document, label, code);
            }
        }

        skipped = skippedCount;

        if (document.PageCount == 0)
        {
            // A PDF with no pages cannot be opened at all; one blank page at least reaches the
            // viewer, and the caller reports why it is empty.
            document.AddPage();
        }

        using var buffer = new MemoryStream();
        document.Save(buffer, false);
        return buffer.ToArray();
    }

    private static void DrawLabel(PdfDocument document, ProductLabel label, string code)
    {
        var page = document.AddPage();
        page.Width = XUnit.FromPoint(PageWidth);
        page.Height = XUnit.FromPoint(PageHeight);

        using var gfx = XGraphics.FromPdfPage(page);
        var nameFont = new XFont(CourierFontResolver.SerifFamily, NameFontSize, XFontStyleEx.Bold);
        var priceFont = new XFont(CourierFontResolver.SerifFamily, PriceFontSize, XFontStyleEx.Bold);

        DrawName(gfx, nameFont, label.StokAdi);

        if (label.Fiyat is { } fiyat)
        {
            var rawUnit = string.IsNullOrWhiteSpace(label.ParaBirimi) ? "TL" : label.ParaBirimi!.Trim().ToUpperInvariant();
            var unit = rawUnit switch
            {
                "EUR" or "2" or "€" => "EUR",
                "USD" or "3" or "$" => "USD",
                "GBP" or "4" or "£" => "GBP",
                _ => "TL"
            };
            Centred(gfx, priceFont, PriceTop, $"{TurkishMoneyInWords.Money(fiyat)} {unit}");
        }

        DrawBars(gfx, code);
        DrawDigits(gfx, nameFont, code);
    }

    /// <summary>
    /// Fills the name across the available lines, wrapping at word boundaries.
    ///
    /// The reference label broke wherever the width ran out and left words cut in half
    /// ("…KAHVE M"), which is unreadable on the shelf. A single word wider than the line still
    /// has to be broken by character — otherwise it would never fit and the name would vanish.
    /// </summary>
    private static void DrawName(XGraphics gfx, XFont font, string name)
    {
        var tops = new[] { NameLine1Top, NameLine2Top, NameLine3Top };
        var words = (name ?? string.Empty).Split(default(char[]), StringSplitOptions.RemoveEmptyEntries);

        var row = 0;
        var line = string.Empty;

        foreach (var word in words)
        {
            var rest = word;

            while (rest.Length > 0 && row < NameLineCount)
            {
                var candidate = line.Length == 0 ? rest : line + ' ' + rest;
                if (Fits(gfx, font, candidate))
                {
                    line = candidate;
                    break;
                }

                if (line.Length > 0)
                {
                    // Send the line as it stands and try the word again on the next one.
                    Centred(gfx, font, tops[row++], line);
                    line = string.Empty;
                    continue;
                }

                // The word alone overflows an empty line: take as much of it as fits.
                var take = rest.Length;
                while (take > 1 && !Fits(gfx, font, rest[..take])) take--;

                Centred(gfx, font, tops[row++], rest[..take]);
                rest = rest[take..];
            }

            if (row >= NameLineCount) return;
        }

        if (line.Length > 0) Centred(gfx, font, tops[row], line);
    }

    private static bool Fits(XGraphics gfx, XFont font, string text)
        => gfx.MeasureString(text, font).Width <= NameMaxWidth;

    private static void DrawBars(XGraphics gfx, string code)
    {
        var pattern = Ean13.Encode(code);

        for (var i = 0; i < pattern.Length; i++)
        {
            if (pattern[i] != '1') continue;

            var height = Ean13.IsGuardModule(i) ? GuardBarHeight : BarHeight;
            gfx.DrawRectangle(XBrushes.Black, BarsLeft + i * ModuleWidth, BarsTop, ModuleWidth, height);
        }
    }

    private static void DrawDigits(XGraphics gfx, XFont font, string code)
    {
        var (first, left, right) = Ean13.SplitForDisplay(code);

        At(gfx, font, FirstDigitLeft, DigitsTop, first);
        At(gfx, font, LeftGroupLeft, DigitsTop, left);
        At(gfx, font, RightGroupLeft, DigitsTop, right);
    }

    private static void Centred(XGraphics gfx, XFont font, double top, string text)
    {
        if (string.IsNullOrEmpty(text)) return;
        var width = gfx.MeasureString(text, font).Width;
        At(gfx, font, (PageWidth - width) / 2, top, text);
    }

    /// <summary>
    /// Baseline offset from the top of the line box, as a fraction of the font size.
    ///
    /// Calibrated for Times New Roman against the legacy label, the same way the invoice's was
    /// for Courier — the two faces have different ascents, and reusing the invoice's 0.700 put
    /// every row of the label 0.28 mm high.
    /// </summary>
    private const double AscentFactor = 0.781;

    /// <summary>Top-left positioning, matching how the layout was measured.</summary>
    private static void At(XGraphics gfx, XFont font, double x, double top, string text)
    {
        if (string.IsNullOrEmpty(text)) return;
        gfx.DrawString(text, font, XBrushes.Black, x, top + font.Size * AscentFactor);
    }
}
