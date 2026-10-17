using B2B.Erp.Api.Features.InvoicePrint;
using PdfSharp.Drawing;
using PdfSharp.Pdf;
using static B2B.Erp.Api.Features.OfferPrint.OfferFormLayout;

namespace B2B.Erp.Api.Features.OfferPrint;

/// <summary>
/// Draws a customer offer in either form.
///
/// Everything is built from the column widths in the layout, so a rule is always where the cell
/// it bounds ends and text is always clipped to the cell it sits in. The parts that belong to
/// the end of the document — the totals and the standing notes — are drawn on the last page and
/// nowhere else, frame included.
/// </summary>
public sealed class OfferFormRenderer
{
    public byte[] Render(OfferPrintModel model, OfferFormKind kind, bool showHeaderBanner = true, bool showTopLeftLogo = false)
    {
        ArgumentNullException.ThrowIfNull(model);
        CourierFontResolver.Install();

        var columns = kind == OfferFormKind.Featured
            ? FeaturedOfferLayout.Columns
            : PlainOfferLayout.Columns;

        var perPage = kind == OfferFormKind.Featured
            ? FeaturedOfferLayout.BlocksPerPage
            : PlainOfferLayout.RowsPerPage;

        var pages = Paginate(model.Lines.Count, perPage);

        using var document = new PdfDocument();

        for (var pageIndex = 0; pageIndex < pages.Count; pageIndex++)
        {
            var page = document.AddPage();
            page.Width = XUnit.FromPoint(PageWidth);
            page.Height = XUnit.FromPoint(PageHeight);

            using var gfx = XGraphics.FromPdfPage(page);
            var fonts = new Fonts(
                Body: new XFont(CourierFontResolver.SerifFamily, BodyFontSize),
                BodyBold: new XFont(CourierFontResolver.SerifFamily, BodyFontSize, XFontStyleEx.Bold),
                Small: new XFont(CourierFontResolver.SerifFamily, SmallFontSize),
                Head: new XFont(CourierFontResolver.SerifFamily, HeadFontSize, XFontStyleEx.Bold),
                Note: new XFont(CourierFontResolver.SerifFamily, NoteFontSize, XFontStyleEx.Bold));

            if (showHeaderBanner)
            {
                DrawBanner(gfx);
            }
            else if (showTopLeftLogo)
            {
                DrawTopLeftLogo(gfx);
            }
            DrawInfoBox(gfx, fonts, model);

            var (from, count) = pages[pageIndex];
            var slice = model.Lines.GetRange(from, count);
            var isLast = pageIndex == pages.Count - 1;

            DrawTable(gfx, fonts, columns, slice, kind);

            if (isLast)
            {
                DrawTotals(gfx, fonts, model);
                DrawNotes(gfx, fonts, model);
            }

            DrawPageNumber(gfx, fonts, pageIndex + 1, pages.Count);
        }

        using var buffer = new MemoryStream();
        document.Save(buffer, false);
        return buffer.ToArray();
    }

    private readonly record struct Fonts(XFont Body, XFont BodyBold, XFont Small, XFont Head, XFont Note);

    /// <summary>Splits the lines into pages; always at least one, even with no lines.</summary>
    private static List<(int From, int Count)> Paginate(int total, int perPage)
    {
        var pages = new List<(int, int)>();
        if (perPage < 1) perPage = 1;

        for (var i = 0; i < total; i += perPage)
        {
            pages.Add((i, Math.Min(perPage, total - i)));
        }

        if (pages.Count == 0) pages.Add((0, 0));
        return pages;
    }

    private static void DrawBanner(XGraphics gfx)
    {
        var path = Path.Combine(AppContext.BaseDirectory, "Assets", BannerFileName);
        if (!File.Exists(path))
        {
            path = Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "Assets", BannerFileName);
        }
        if (!File.Exists(path)) return;

        using var image = XImage.FromFile(path);
        gfx.DrawImage(image, BannerLeft, BannerTop, BannerWidth, BannerHeight);
    }

    private static void DrawTopLeftLogo(XGraphics gfx)
    {
        var path = Path.Combine(AppContext.BaseDirectory, "Assets", LogoFileName);
        if (!File.Exists(path))
        {
            path = Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "Assets", LogoFileName);
        }
        if (!File.Exists(path)) return;

        using var image = XImage.FromFile(path);
        gfx.DrawImage(image, MarginLeft, 0.50 * Cm, 5.20 * Cm, 1.80 * Cm);
    }

    // ---- Customer / document box ----------------------------------------------------------------

    private static void DrawInfoBox(XGraphics gfx, Fonts f, OfferPrintModel m)
    {
        var pen = Pen();

        for (var row = 0; row <= InfoRows; row++)
        {
            var y = InfoTop + row * InfoRowHeight;
            gfx.DrawLine(pen, MarginLeft, y, MarginRight, y);
        }

        gfx.DrawLine(pen, MarginLeft, InfoTop, MarginLeft, InfoBottom);
        gfx.DrawLine(pen, InfoSplit, InfoTop, InfoSplit, InfoBottom);
        gfx.DrawLine(pen, MarginRight, InfoTop, MarginRight, InfoBottom);

        var left = new[]
        {
            ("TİCARİ ÜNVAN", m.TicariUnvan),
            ("YETKİLİ", m.Yetkili),
            ("GSM", m.Gsm)
        };

        var right = new[]
        {
            ("TARİH", m.Tarih?.ToString("dd.MM.yyyy") ?? string.Empty),
            ("PI NO", m.PiNo),
            ("TEKLİF VEREN", m.TeklifVeren)
        };

        for (var row = 0; row < InfoRows; row++)
        {
            var top = InfoTop + row * InfoRowHeight;
            DrawLabelled(gfx, f, MarginLeft, InfoSplit, top, left[row].Item1, left[row].Item2);
            DrawLabelled(gfx, f, InfoSplit, MarginRight, top, right[row].Item1, right[row].Item2);
        }

        // The free-text note runs the width of the box, under it.
        if (!string.IsNullOrWhiteSpace(m.Aciklama))
        {
            var top = InfoBottom;
            gfx.DrawLine(pen, MarginLeft, top + InfoRowHeight, MarginRight, top + InfoRowHeight);
            gfx.DrawLine(pen, MarginLeft, top, MarginLeft, top + InfoRowHeight);
            gfx.DrawLine(pen, MarginRight, top, MarginRight, top + InfoRowHeight);
            DrawLabelled(gfx, f, MarginLeft, MarginRight, top, "AÇIKLAMA", m.Aciklama);
        }
    }

    /// <summary>A bold caption and its value, clipped to the cell so it cannot cross the rule.</summary>
    private static void DrawLabelled(XGraphics gfx, Fonts f, double left, double right, double top,
        string label, string value)
    {
        var baseline = top + InfoRowHeight / 2;
        var x = left + CellPad;

        gfx.DrawString(label, f.Head, XBrushes.Black,
            new XRect(x, baseline - HeadFontSize, 0, 2 * HeadFontSize),
            XStringFormats.CenterLeft);

        var labelWidth = gfx.MeasureString(label, f.Head).Width + CellPad;
        var available = right - left - labelWidth - 2 * CellPad;
        if (available <= 0 || string.IsNullOrWhiteSpace(value)) return;

        gfx.DrawString(Fit(gfx, value, f.Body, available), f.Body, XBrushes.Black,
            new XRect(x + labelWidth, baseline - BodyFontSize, available, 2 * BodyFontSize),
            XStringFormats.CenterLeft);
    }

    // ---- Item table ------------------------------------------------------------------------------

    private static void DrawTable(XGraphics gfx, Fonts f, OfferColumn[] columns,
        List<OfferPrintLine> lines, OfferFormKind kind)
    {
        var pen = Pen();
        var rowHeight = kind == OfferFormKind.Featured
            ? FeaturedOfferLayout.RowHeight
            : PlainOfferLayout.RowHeight;

        // The frame stops at the last row that carries something, so a half-empty page does not
        // trail an empty grid down to the totals.
        var bodyBottom = TableHeadBottom + Math.Max(1, lines.Count) * rowHeight;
        if (bodyBottom > TableBottom) bodyBottom = TableBottom;

        gfx.DrawLine(pen, MarginLeft, TableTop, MarginRight, TableTop);
        gfx.DrawLine(pen, MarginLeft, TableHeadBottom, MarginRight, TableHeadBottom);

        // The rule between the two caption rows is drawn per column, and only where the heading
        // actually uses both rows. Running it the full width struck a line through "ADET" and
        // "KDV", which are centred across the whole header.
        foreach (var column in columns.Where(x => !string.IsNullOrEmpty(x.Caption2)))
        {
            gfx.DrawLine(pen, column.Left, TableTop + HeadRowHeight, column.Right, TableTop + HeadRowHeight);
        }
        gfx.DrawLine(pen, MarginLeft, bodyBottom, MarginRight, bodyBottom);

        foreach (var column in columns)
        {
            gfx.DrawLine(pen, column.Left, TableTop, column.Left, bodyBottom);
        }
        gfx.DrawLine(pen, MarginRight, TableTop, MarginRight, bodyBottom);

        // Captions, centred over their column across both header rows.
        foreach (var column in columns)
        {
            var oneLine = string.IsNullOrEmpty(column.Caption2);
            if (oneLine)
            {
                Cell(gfx, column.Caption1, f.Head, column.Left, column.Right,
                    TableTop, 2 * HeadRowHeight, OfferAlign.Centre);
            }
            else
            {
                Cell(gfx, column.Caption1, f.Head, column.Left, column.Right,
                    TableTop, HeadRowHeight, OfferAlign.Centre);
                Cell(gfx, column.Caption2, f.Head, column.Left, column.Right,
                    TableTop + HeadRowHeight, HeadRowHeight, OfferAlign.Centre);
            }
        }

        var top = TableHeadBottom;
        foreach (var line in lines)
        {
            if (top + rowHeight > TableBottom + 0.01) break;

            if (kind == OfferFormKind.Featured)
            {
                DrawFeaturedRow(gfx, f, columns, line, top, rowHeight);
            }
            else
            {
                DrawPlainRow(gfx, f, columns, line, top, rowHeight);
                gfx.DrawLine(pen, MarginLeft, top + rowHeight, MarginRight, top + rowHeight);
            }

            top += rowHeight;
        }
    }

    private static void DrawPlainRow(XGraphics gfx, Fonts f, OfferColumn[] c,
        OfferPrintLine line, double top, double height)
    {
        Cell(gfx, line.Barkod, f.Body, c[0].Left, c[0].Right, top, height, c[0].Align);
        Cell(gfx, line.StokAdi, f.Body, c[1].Left, c[1].Right, top, height, c[1].Align);
        Cell(gfx, Quantity(line.Miktar), f.Body, c[2].Left, c[2].Right, top, height, c[2].Align);
        Cell(gfx, Percent(line.KdvOran), f.Body, c[3].Left, c[3].Right, top, height, c[3].Align);
        Cell(gfx, Money(line.BirimFiyat), f.Small, c[4].Left, c[4].Right, top, height, c[4].Align);
        Cell(gfx, Money(line.IndirimliFiyat), f.Small, c[5].Left, c[5].Right, top, height, c[5].Align);
        Cell(gfx, Money(line.AraToplam), f.Small, c[6].Left, c[6].Right, top, height, c[6].Align);
    }

    private static void DrawFeaturedRow(XGraphics gfx, Fonts f, OfferColumn[] c,
        OfferPrintLine line, double top, double height)
    {
        DrawProductImage(gfx, line, c[0], top);

        // Barcode over stock code, stacked in the middle of their column.
        var codeTop = top + 0.35 * Cm;
        Cell(gfx, line.Barkod, f.Body, c[1].Left, c[1].Right, codeTop, 0.45 * Cm, OfferAlign.Centre);
        Cell(gfx, line.StokKodu, f.Body, c[1].Left, c[1].Right, codeTop + 0.45 * Cm, 0.45 * Cm, OfferAlign.Centre);

        // Name in bold, then one feature per line beneath it.
        var textTop = top + 0.25 * Cm;
        Cell(gfx, line.StokAdi, f.BodyBold, c[2].Left, c[2].Right,
            textTop, FeaturedOfferLayout.TextLineHeight, OfferAlign.Left);
        textTop += FeaturedOfferLayout.TextLineHeight;

        var features = line.Ozellikler
            .Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Take(FeaturedOfferLayout.MaxTextLines - 1);

        foreach (var feature in features)
        {
            if (textTop + FeaturedOfferLayout.TextLineHeight > top + height) break;
            Cell(gfx, feature, f.Small, c[2].Left, c[2].Right,
                textTop, FeaturedOfferLayout.TextLineHeight, OfferAlign.Left);
            textTop += FeaturedOfferLayout.TextLineHeight;
        }

        // Figures sit at the top of the row, level with the name.
        var figureTop = top + 0.25 * Cm;
        var figureHeight = FeaturedOfferLayout.TextLineHeight;
        Cell(gfx, Quantity(line.Miktar), f.Body, c[3].Left, c[3].Right, figureTop, figureHeight, c[3].Align);
        Cell(gfx, Percent(line.KdvOran), f.Body, c[4].Left, c[4].Right, figureTop, figureHeight, c[4].Align);
        Cell(gfx, Money(line.BirimFiyat), f.Small, c[5].Left, c[5].Right, figureTop, figureHeight, c[5].Align);
        Cell(gfx, Money(line.IndirimliFiyat), f.Small, c[6].Left, c[6].Right, figureTop, figureHeight, c[6].Align);
        Cell(gfx, Money(line.AraToplam), f.Small, c[7].Left, c[7].Right, figureTop, figureHeight, c[7].Align);
    }

    private static void DrawProductImage(XGraphics gfx, OfferPrintLine line, OfferColumn column, double rowTop)
    {
        var path = (line.GorselYolu ?? string.Empty).Trim();
        if (path.Length == 0 || !File.Exists(path)) return;

        try
        {
            // Decoded through ImageSharp and handed on as PNG. PDFsharp reads only JPEG and PNG,
            // and the product catalogue stores .webp — passing those straight in produced offers
            // with an empty picture box and no error.
            using var decoded = SixLabors.ImageSharp.Image.Load(path);
            using var png = new MemoryStream();
            decoded.Save(png, new SixLabors.ImageSharp.Formats.Png.PngEncoder());
            png.Position = 0;

            using var image = XImage.FromStream(png);

            var boxWidth = column.Width - 2 * FeaturedOfferLayout.ImagePad;
            var boxHeight = FeaturedOfferLayout.ImageMaxHeight;

            // Fitted, not stretched: product photos are not all one shape and a squashed
            // appliance is worse than a smaller one.
            var scale = Math.Min(boxWidth / image.PixelWidth, boxHeight / image.PixelHeight);
            var w = image.PixelWidth * scale;
            var h = image.PixelHeight * scale;

            gfx.DrawImage(image,
                column.Left + (column.Width - w) / 2,
                rowTop + FeaturedOfferLayout.ImagePad + (boxHeight - h) / 2,
                w, h);
        }
        catch
        {
            // An unreadable image must not take the whole offer down with it.
        }
    }

    // ---- Totals and notes -------------------------------------------------------------------------

    private static void DrawTotals(XGraphics gfx, Fonts f, OfferPrintModel m)
    {
        var rows = new (string Label, decimal Value, bool Bold)[]
        {
            ("ARA TOPLAM", m.AraToplam, false),
            ("İNDİRİM", m.Iskonto, false),
            ("KDVSİZ TOPLAM", m.KdvsizToplam, false),
            ($"( {Money(m.Kdv16Matrah)}) K.D.V. (% 16,00)", m.Kdv16, false),
            ($"( {Money(m.Kdv10Matrah)}) K.D.V. (% 10,00)", m.Kdv10, false),
            ($"( {Money(m.Kdv5Matrah)}) K.D.V. (% 5,00)", m.Kdv5, false),
            ("KDV TOPLAM", m.KdvToplam, false),
            // Dövizli teklifte kod son satırın etiketine giriyor; TL'de etiket harfi harfine aynı
            // kalır. Etiket hücresi zaten kırpılıyor (bkz. Cell/Fit), taşma ihtimali yok.
            (m.ParaBirimiKodu.Length > 0 ? $"GENEL TOPLAM ({m.ParaBirimiKodu})" : "GENEL TOPLAM",
                m.GenelToplam, true)
        };

        var pen = Pen();
        var bottom = TotalsRowTop(TotalsRows);

        for (var row = 0; row <= TotalsRows; row++)
        {
            var y = TotalsRowTop(row);
            gfx.DrawLine(pen, TotalsLeft, y, MarginRight, y);
        }

        gfx.DrawLine(pen, TotalsLeft, TotalsTop, TotalsLeft, bottom);
        gfx.DrawLine(pen, TotalsValueSplit, TotalsTop, TotalsValueSplit, bottom);
        gfx.DrawLine(pen, MarginRight, TotalsTop, MarginRight, bottom);

        for (var row = 0; row < rows.Length; row++)
        {
            var top = TotalsRowTop(row);
            var font = rows[row].Bold ? f.BodyBold : f.Body;

            Cell(gfx, rows[row].Label, font, TotalsLeft, TotalsValueSplit,
                top, TotalsRowHeight, OfferAlign.Left);
            Cell(gfx, Money(rows[row].Value), font, TotalsValueSplit, MarginRight,
                top, TotalsRowHeight, OfferAlign.Right);
        }
    }

    private static void DrawNotes(XGraphics gfx, Fonts f, OfferPrintModel m)
    {
        for (var i = 0; i < Notes.Length; i++)
        {
            gfx.DrawString(Notes[i], f.Note, XBrushes.Black,
                new XRect(NoteLeft, NoteTop(i), TotalsLeft - NoteLeft, NoteRowHeight),
                XStringFormats.CenterLeft);
        }

        // Dövizli teklifin para birimi. Kalem fiyatları da bu paradadır ve sütun başlıklarında
        // yer yok; tek satırlık dip not tüm belgeyi bağlıyor. TL teklifte hiç çizilmez, yani
        // eski çıktı bire bir korunur. Notlar bloğu totals bloğunun SOLUNDA (TotalsLeft'e kadar)
        // durduğu için beşinci satır hiçbir çerçeveyle kesişmiyor.
        if (m.ParaBirimiAdi.Length == 0) return;

        gfx.DrawString(
            $"TÜM TUTARLAR {m.ParaBirimiAdi} ({m.ParaBirimiKodu}) CİNSİNDENDİR",
            f.Note, XBrushes.Black,
            new XRect(NoteLeft, NoteTop(Notes.Length), TotalsLeft - NoteLeft, NoteRowHeight),
            XStringFormats.CenterLeft);
    }

    private static void DrawPageNumber(XGraphics gfx, Fonts f, int page, int total)
    {
        if (total <= 1) return;

        gfx.DrawString($"Sayfa {page} / {total}", f.Note, XBrushes.Black,
            new XRect(MarginLeft, PageHeight - 0.85 * Cm, MarginRight - MarginLeft, 0.5 * Cm),
            XStringFormats.CenterRight);
    }

    // ---- Drawing helpers ---------------------------------------------------------------------------

    private static XPen Pen() => new(XColors.Black, LineWidth);

    /// <summary>
    /// Text inside a cell, vertically centred and clipped to the cell's width. Clipping here is
    /// what keeps a long product name from running across the next column's rule.
    /// </summary>
    private static void Cell(XGraphics gfx, string? text, XFont font,
        double left, double right, double top, double height, OfferAlign align)
    {
        if (string.IsNullOrEmpty(text)) return;

        var inner = right - left - 2 * CellPad;
        if (inner <= 0) return;

        var format = align switch
        {
            OfferAlign.Right => XStringFormats.CenterRight,
            OfferAlign.Centre => XStringFormats.Center,
            _ => XStringFormats.CenterLeft
        };

        gfx.DrawString(Fit(gfx, text, font, inner), font, XBrushes.Black,
            new XRect(left + CellPad, top, inner, height), format);
    }

    /// <summary>Trims with an ellipsis so nothing ever overflows its cell.</summary>
    private static string Fit(XGraphics gfx, string text, XFont font, double maxWidth)
    {
        var s = text ?? string.Empty;
        if (gfx.MeasureString(s, font).Width <= maxWidth) return s;

        while (s.Length > 1 && gfx.MeasureString(s + "…", font).Width > maxWidth)
        {
            s = s[..^1];
        }
        return s + "…";
    }

    private static string Money(decimal value) => TurkishMoneyInWords.Money(value);

    /// <summary>VAT prints as a plain percentage, without the money format's decimals.</summary>
    private static string Percent(decimal rate)
        => "%" + decimal.Round(rate, 0, MidpointRounding.AwayFromZero)
            .ToString("0", TurkishMoneyInWords.TrCulture);

    private static string Quantity(decimal q)
        => q == decimal.Truncate(q)
            ? q.ToString("0", TurkishMoneyInWords.TrCulture)
            : Money(q);
}
