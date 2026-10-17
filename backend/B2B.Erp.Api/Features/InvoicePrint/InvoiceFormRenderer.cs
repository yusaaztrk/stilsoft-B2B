using PdfSharp.Drawing;
using PdfSharp.Pdf;
using static B2B.Erp.Api.Features.InvoicePrint.InvoiceFormLayout;

namespace B2B.Erp.Api.Features.InvoicePrint;

/// <summary>
/// Draws the invoice onto pre-printed stock.
///
/// The paper already carries the frame, the captions and the invoice serial, so this renders the
/// variable data only — no borders, no headings, no logo. The reference printouts contain a
/// single full-page white rectangle and text; anything else this drew would land on top of
/// something already on the page.
/// </summary>
public sealed class InvoiceFormRenderer
{
    public byte[] Render(InvoicePrintModel model)
    {
        ArgumentNullException.ThrowIfNull(model);
        CourierFontResolver.Install();

        using var document = new PdfDocument();
        var page = document.AddPage();
        page.Width = XUnit.FromPoint(PageWidth);
        page.Height = XUnit.FromPoint(PageHeight);

        using var gfx = XGraphics.FromPdfPage(page);
        var font = new XFont(CourierFontResolver.MonospaceFamily, FontSize, XFontStyleEx.Bold);
        var grandTotalFont = new XFont(CourierFontResolver.MonospaceFamily, GrandTotalFontSize, XFontStyleEx.Bold);

        // Açık faturada kaşe basılmaz — bkz. InvoicePrintModel.AcikFatura.
        if (!model.AcikFatura) DrawStamp(gfx);
        DrawHeader(gfx, font, model);
        DrawLines(gfx, font, model);
        DrawTotals(gfx, font, grandTotalFont, model);
        DrawFooter(gfx, font, model);

        using var buffer = new MemoryStream();
        document.Save(buffer, false);
        return buffer.ToArray();
    }

    /// <summary>
    /// Places the company stamp at the coordinates every reference invoice uses.
    ///
    /// Missing is not fatal — an invoice without the stamp is still a correct invoice, and
    /// failing the whole print over a missing asset would be worse than printing it. The
    /// omission is logged by its absence rather than by throwing.
    /// </summary>
    private static void DrawStamp(XGraphics gfx)
    {
        var path = Path.Combine(AppContext.BaseDirectory, "Assets", StampFileName);
        if (!File.Exists(path)) return;

        using var image = XImage.FromFile(path);
        gfx.DrawImage(image, StampLeft, StampTop, StampWidth, StampHeight);
    }

    private static void DrawHeader(XGraphics gfx, XFont font, InvoicePrintModel m)
    {
        Left(gfx, font, InvoiceFormLayout.Left, CariNameTop, m.CariAdi);

        // Adres sığmıyorsa alt satıra geçer (2026-09-16): e-ticaret müşterisinin kendi yazdığı
        // adres tek satıra sığmayıp sayfanın sağına taşıyordu.
        var adresSatirlari = Wrap(m.Adres ?? string.Empty, InvoiceFormLayout.AddressWrapColumn);
        for (var i = 0; i < adresSatirlari.Count && i < InvoiceFormLayout.AddressMaxLines; i++)
        {
            Left(gfx, font, InvoiceFormLayout.Left,
                AddressTop + i * InvoiceFormLayout.AddressLineHeight, adresSatirlari[i]);
        }

        // Always joined by '/', even when one side is blank — the reference shows "/GİRNE" for a
        // customer with no district and "GİRNE/GİRNE" when both are set.
        var ilceSatirlari = Wrap($"{m.Ilce}/{m.Il}", InvoiceFormLayout.AddressWrapColumn);
        for (var i = 0; i < ilceSatirlari.Count && i < InvoiceFormLayout.DistrictMaxLines; i++)
        {
            Left(gfx, font, InvoiceFormLayout.Left,
                DistrictTop + i * InvoiceFormLayout.AddressLineHeight, ilceSatirlari[i]);
        }

        if (m.Tarih.HasValue)
        {
            Left(gfx, font, DateLeft, DateTop, m.Tarih.Value.ToString("dd.MM.yyyy"));
        }

        // One string, not four fields: the "VERGİ NO" caption sits three spaces after whatever
        // VDAIRE happens to be, so placing it at a fixed x would break for every other customer.
        // Verified against three invoices with different VDAIRE lengths.
        Left(gfx, font, InvoiceFormLayout.Left, TaxLineTop,
            $"VERGİ DAİRESİ : {m.VergiDairesi}   VERGİ NO : {m.VergiNo}");
    }

    private static void DrawLines(XGraphics gfx, XFont font, InvoicePrintModel m)
    {
        var top = FirstItemTop;

        // Sığmayan adlar için küçük yazı. Döngü dışında bir kez kuruluyor.
        var smallFont = new XFont(CourierFontResolver.MonospaceFamily, ItemNameSmallFontSize, XFontStyleEx.Bold);

        foreach (var line in m.Lines)
        {
            // Barcode and name are one left-aligned string separated by two spaces. A 13-digit
            // barcode therefore puts the name at column 15; a blank one puts it at column 2,
            // which is how service lines print.
            var adMetni = $"{line.Barkod}  {line.StokAdi}";

            // AD SÜTUNU TAŞMIYOR (2026-08-21 kullanıcı bildirimi).
            //
            // Ad sınırsız yazılıyordu; sağdaki '%', miktar, birim fiyat ve tutar sütunları SABİT
            // konumda olduğu için uzun ad onların üstüne biniyor ve fatura okunmaz hale
            // geliyordu. Servis kalemlerinde açıklama artık müşteri adı ve telefonunu da
            // taşıdığı için (ör. "MESUT DEMİR - 0555 555 5555 - Servis Onarım İşçilik Bedeli -
            // ST-BİKAHVE MAXİ ...") bu her faturada oluyor.
            //
            // Kullanıcı kuralı: sığmıyorsa KIRPMA, aynı satır yüksekliğinde daha küçük iki
            // satır olarak yaz. Kırpılmış ad müşteriye ne aldığını söylemez.
            if (adMetni.Length <= ItemNameWrapColumn)
            {
                Left(gfx, font, InvoiceFormLayout.Left, top, adMetni);
            }
            else
            {
                var adSatirlari = Wrap(adMetni, ItemNameSmallWrapColumn);
                for (var i = 0; i < adSatirlari.Count && i < ItemNameMaxLines; i++)
                {
                    Left(gfx, smallFont, InvoiceFormLayout.Left, top + i * ItemNameSmallLineHeight, adSatirlari[i]);
                }
            }

            Left(gfx, font, VatMarkLeft, top, "%");
            Left(gfx, font, VatRateLeft, top, FormatRate(line.KdvOran));
            Right(gfx, font, QuantityRight, top, FormatQuantity(line.Miktar));
            Left(gfx, font, UnitLeft, top, line.OlcuBirimi);
            Right(gfx, font, UnitPriceRight, top, TurkishMoneyInWords.Money(line.Fiyat));
            Right(gfx, font, LineTotalRight, top, TurkishMoneyInWords.Money(line.Tutar));

            top += ItemRowHeight;
        }
    }

    private static void DrawTotals(XGraphics gfx, XFont font, XFont grandFont, InvoicePrintModel m)
    {
        Left(gfx, font, TotalsLabelLeft, GrossTop, "BRÜT TUTAR");
        Right(gfx, font, GrossRight, GrossTop, TurkishMoneyInWords.Money(m.AraToplam));

        DrawDeliveryAddress(gfx, font, m);

        // Both lines are absent altogether when nothing was discounted — the reference invoices
        // without a discount have no İNDİRİM row rather than a zero one.
        if (m.Iskonto != 0m)
        {
            Left(gfx, font, TotalsLabelLeft, DiscountTop, "İNDİRİM");
            Right(gfx, font, AmountRight, DiscountTop, TurkishMoneyInWords.Money(m.Iskonto));

            Left(gfx, font, TotalsLabelLeft, NetTop, "NET TOPLAM");
            Right(gfx, font, AmountRight, NetTop, TurkishMoneyInWords.Money(m.NetToplam));
        }

        // BOŞ KDV SATIRI BASILMAZ (2026-08-20, kullanıcı kararı).
        //
        // Üç bant eskiden her koşulda basılıyordu ("kutular kâğıtta zaten var" gerekçesiyle);
        // tek kalemli %10'luk bir faturada bile "( 0,00) K.D.V. (% 16,00) 0,00" ve aynısının
        // %5'lisi kâğıda düşüyordu. Fatura o oranlardan vergi doğmadığını iddia eden iki satır
        // taşıyordu; kullanıcı bunları istemiyor.
        //
        // ÖLÇÜT MATRAH + TUTAR: ikisi de sıfırsa satır yoktur. Yalnız tutara bakılsaydı ASKERİYE
        // (KDV muaf) faturası matrahını kaybederdi — orada matrah dolu, vergi sıfırdır ve satır
        // BASILMALIDIR. Kalan satırlar kendi sabit yerlerinde durur, yukarı kaymaz: TOPLAM K.D.V.
        // ve GENEL TOPLAM da sabit ve düzen referans faturaya oturtulmuş.
        VatRow(gfx, font, Vat16Top, m.Kdv16Matrah, "16,00", m.Kdv16);
        VatRow(gfx, font, Vat10Top, m.Kdv10Matrah, "10,00", m.Kdv10);
        VatRow(gfx, font, Vat5Top, m.Kdv5Matrah, "5,00", m.Kdv5);

        Left(gfx, font, TotalsLabelLeft, VatTotalTop, "TOPLAM K.D.V.");
        Right(gfx, font, AmountRight, VatTotalTop, TurkishMoneyInWords.Money(m.KdvToplam));

        // The one line in a larger size.
        Left(gfx, grandFont, TotalsLabelLeft, GrandTotalTop, "GENEL TOPLAM");
        Right(gfx, grandFont, GrossRight, GrandTotalTop, TurkishMoneyInWords.Money(m.GenelToplam));
    }

    /// <summary>
    /// "TESLIM : ..." — yalnız ŞUBEYE satışta, BRÜT TUTAR'ın solunda.
    ///
    /// <para>
    /// Boş alan satırı hiç çizmez: alan yalnızca teslim carisi fatura carisinden FARKLI olduğunda
    /// doluyor (bkz. <see cref="InvoicePrintModelBuilder"/>), yani şube satışı olmayan faturada
    /// kâğıtta hiçbir değişiklik olmaz.
    /// </para>
    ///
    /// <para>
    /// En fazla iki satır. Sarma sınırı sağdaki toplam bloğunun soluna kadar; taşarsa üçüncü
    /// satır YAZILMAZ, çünkü aşağıda 22,95 cm'de "TESLİM ALAN #" var ve üstüne binerdi.
    /// </para>
    /// </summary>
    private static void DrawDeliveryAddress(XGraphics gfx, XFont font, InvoicePrintModel m)
    {
        if (string.IsNullOrWhiteSpace(m.TeslimAdres)) return;

        var wrapped = Wrap($"TESLIM : {m.TeslimAdres.Trim()}", InvoiceFormLayout.DeliveryWrapColumn);

        for (var i = 0; i < wrapped.Count && i < InvoiceFormLayout.DeliveryMaxLines; i++)
        {
            Left(gfx, font, InvoiceFormLayout.Left,
                InvoiceFormLayout.DeliveryTop + i * InvoiceFormLayout.DeliveryLineHeight,
                wrapped[i]);
        }
    }

    private static void VatRow(XGraphics gfx, XFont font, double top, decimal matrah, string rate, decimal amount)
    {
        // O orandan hiç vergi doğmadıysa satır hiç çizilmez; bkz. DrawTotals'taki not.
        if (matrah == 0m && amount == 0m) return;

        Left(gfx, font, TotalsLabelLeft, top, $"( {TurkishMoneyInWords.Money(matrah)}) K.D.V. (% {rate})");
        Right(gfx, font, AmountRight, top, TurkishMoneyInWords.Money(amount));
    }

    private static void DrawFooter(XGraphics gfx, XFont font, InvoicePrintModel m)
    {
        // Two spaces before the '#', measured on invoices with both two- and three-digit
        // salesman codes so it is the separator and not the code's width.
        Left(gfx, font, InvoiceFormLayout.Left, SalesmanTop, $"{m.PlasiyerKodu} TESLİM ALAN  #");

        // Yazıyla satırı faturanın PARA BİRİMİNDE. Sabit "TL" bırakılsaydı dolar kesilmiş bir
        // fatura, lira borcu iddia eden bir belge olurdu. TL faturada çıktı değişmez.
        var words = string.IsNullOrWhiteSpace(m.Yaziyla)
            ? TurkishMoneyInWords.Format(m.GenelToplam, m.ParaBirimiTipi)
            : m.Yaziyla!;

        var wrapped = Wrap($"YALNIZ : {words}", InWordsWrapColumn);
        for (var i = 0; i < wrapped.Count; i++)
        {
            Left(gfx, font, InvoiceFormLayout.Left, InWordsTop + i * InWordsLineHeight, wrapped[i]);
        }

        // MONTAJ and NOT ride below the amount in words: when it wraps, they move down with it.
        var shift = (wrapped.Count - 1) * FlowShiftPerWrappedLine;

        // MONTAJ ve NOT SAĞDAKİ TOPLAM BLOĞUNA GİRMEZ (2026-08-21 kullanıcı bildirimi).
        //
        // İkisi de sınırsız yazılıyordu; uzun bir not TOPLAM K.D.V. ve GENEL TOPLAM sütunlarının
        // üstüne biniyordu. Sınır TESLİM ve YALNIZ satırlarıyla aynı: toplam bloğunun sol kenarı.
        //
        // MONTAJ tek satırda kalır — hemen altında NOT var, sarsaydı onun üstüne binerdi.
        // NOT en fazla iki satır; ikinci satır yazıyla satırının adımıyla aşağı iner.
        var montajSatiri = Wrap($"MONTAJ : {m.Montaj}", InvoiceFormLayout.FooterWrapColumn);
        Left(gfx, font, InvoiceFormLayout.Left, MontajTop + shift, montajSatiri[0]);

        var notSatirlari = Wrap($"NOT : {m.Not}", InvoiceFormLayout.FooterWrapColumn);
        for (var i = 0; i < notSatirlari.Count && i < InvoiceFormLayout.NoteMaxLines; i++)
        {
            Left(gfx, font, InvoiceFormLayout.Left, NoteTop + shift + i * InWordsLineHeight, notSatirlari[i]);
        }
    }

    /// <summary>
    /// Word wrap on the character grid; never splits a word.
    ///
    /// Empty entries are deliberately kept. The amount in words carries a double space before
    /// "TL", which is part of the measured layout — collapsing runs of spaces here shifted that
    /// word a full character cell to the left and everything after it with it.
    /// </summary>
    internal static List<string> Wrap(string text, int columns)
    {
        var lines = new List<string>();
        var current = string.Empty;
        var pending = new List<string>();

        foreach (var token in text.Split(' '))
        {
            pending.Add(token);
            if (token.Length == 0) continue; // part of a multi-space run; keep collecting

            var chunk = string.Join(' ', pending);
            pending.Clear();

            var candidate = current.Length == 0 ? chunk : $"{current} {chunk}";
            if (candidate.Length > columns && current.Length > 0)
            {
                lines.Add(current);
                current = token; // a wrapped line starts at the margin, without the run of spaces
            }
            else
            {
                current = candidate;
            }
        }

        if (current.Length > 0 || lines.Count == 0) lines.Add(current);
        return lines;
    }

    /// <summary>VAT rate prints without decimals on the item row: "% 5", "% 16", "% 0".</summary>
    private static string FormatRate(decimal rate)
        => decimal.Round(rate, 0, MidpointRounding.AwayFromZero).ToString("0", TurkishMoneyInWords.TrCulture);

    /// <summary>Quantity prints whole when it is whole, otherwise with two decimals.</summary>
    private static string FormatQuantity(decimal quantity)
        => quantity == decimal.Truncate(quantity)
            ? quantity.ToString("0", TurkishMoneyInWords.TrCulture)
            : quantity.ToString("#,##0.00", TurkishMoneyInWords.TrCulture);

    /// <summary>
    /// Draws with the glyph top at <paramref name="top"/>, matching how the layout was measured.
    /// PDFsharp positions from the baseline, so the ascent is added back here rather than at
    /// every call site.
    /// </summary>
    private static void Left(XGraphics gfx, XFont font, double x, double top, string? text)
    {
        if (string.IsNullOrEmpty(text)) return;
        gfx.DrawString(text, font, XBrushes.Black, x, top + Ascent(font));
    }

    private static void Right(XGraphics gfx, XFont font, double right, double top, string? text)
    {
        if (string.IsNullOrEmpty(text)) return;
        var width = gfx.MeasureString(text, font).Width;
        gfx.DrawString(text, font, XBrushes.Black, right - width, top + Ascent(font));
    }

    /// <summary>
    /// Baseline offset from the top of the line box, as a fraction of the font size.
    ///
    /// Calibrated against the legacy output rather than taken from the font's declared ascent:
    /// with 0.629 every row sat 0.22 mm high, which is a constant the whole page inherits. At
    /// 0.700 the residual is under 0.05 mm, i.e. inside one dot of a 600 dpi printer.
    /// </summary>
    private static double Ascent(XFont font) => font.Size * 0.700;
}
