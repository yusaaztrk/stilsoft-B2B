using B2B.Erp.Api.Features.InvoicePrint;

namespace B2B.Erp.Api.Tests;

/// <summary>
/// Locks the invoice form down against the legacy output.
///
/// The paper is pre-printed, so these are not style assertions — a value drifting here means
/// text printing over a box on a real invoice. Every expected string was read off a reference
/// PDF produced by the old ERP (see docs/fatura-basim-olculeri.md).
/// </summary>
public class TurkishMoneyInWordsTests
{
    [Theory]
    // Straight from the reference printouts.
    [InlineData(10000.00, "ON BİN  TL SIFIR KR")]
    [InlineData(5200.00, "BEŞ BİN İKİ YÜZ  TL SIFIR KR")]
    [InlineData(31200.00, "OTUZ BİR BİN İKİ YÜZ  TL SIFIR KR")]
    [InlineData(34057.14, "OTUZ DÖRT BİN ELLİ YEDİ  TL ON DÖRT KR")]
    [InlineData(385658.95, "ÜÇ YÜZ SEKSEN BEŞ BİN ALTI YÜZ ELLİ SEKİZ  TL DOKSAN BEŞ KR")]
    public void Reproduces_every_reference_invoice(decimal amount, string expected)
        => Assert.Equal(expected, TurkishMoneyInWords.Format(amount));

    [Theory]
    // No reference invoice covers these; standard Turkish is applied. Pinned so that if a
    // legacy printout ever contradicts one, the change is deliberate and visible.
    [InlineData(1000.00, "BİN  TL SIFIR KR")]
    [InlineData(100.00, "YÜZ  TL SIFIR KR")]
    [InlineData(1000000.00, "BİR MİLYON  TL SIFIR KR")]
    [InlineData(0.00, "SIFIR  TL SIFIR KR")]
    [InlineData(0.05, "SIFIR  TL BEŞ KR")]
    [InlineData(1.01, "BİR  TL BİR KR")]
    public void Applies_standard_Turkish_where_no_sample_exists(decimal amount, string expected)
        => Assert.Equal(expected, TurkishMoneyInWords.Format(amount));

    [Fact]
    public void Rounds_to_kurus_so_words_match_the_printed_total()
    {
        // 0.999 shows as 1,00 in the totals column; the words must not say "SIFIR TL DOKSAN
        // DOKUZ KR" next to it.
        Assert.Equal("BİR  TL SIFIR KR", TurkishMoneyInWords.Format(0.999m));
    }

    [Theory]
    [InlineData(34057.14, "34.057,14")]
    [InlineData(0.00, "0,00")]
    [InlineData(385658.95, "385.658,95")]
    public void Money_uses_the_forms_separators(decimal value, string expected)
        => Assert.Equal(expected, TurkishMoneyInWords.Money(value));

    // --- Dövizli faturanın yazıyla satırı ----------------------------------------------------
    //
    // Dövizli fatura "TL" yazıyla basıldığında, dolar borcu için lira iddia eden bir yasal belge
    // çıkıyordu. Birim adları burada sabitleniyor.

    [Theory]
    [InlineData(2, "YÜZ  EURO SIFIR CENT")]
    [InlineData(3, "YÜZ  AMERİKAN DOLARI SIFIR CENT")]
    [InlineData(4, "YÜZ  STERLİN SIFIR PENİ")]
    public void Names_the_currency_of_the_document(int currencyTypeId, string expected)
        => Assert.Equal(expected, TurkishMoneyInWords.Format(100.00m, currencyTypeId));

    [Theory]
    // 0 ve 1'in ikisi de TL (bkz. CurrencyTypeHelper). Bilinmeyen kod da TL'ye düşer: yazıyla
    // satırını boş bırakmak faturayı geçersiz kılar.
    [InlineData(0)]
    [InlineData(1)]
    [InlineData(99)]
    public void Falls_back_to_lira_rather_than_leaving_the_line_blank(int currencyTypeId)
        => Assert.Equal("YÜZ  TL SIFIR KR", TurkishMoneyInWords.Format(100.00m, currencyTypeId));

    [Fact]
    public void Default_call_still_prints_lira()
    {
        // Referans faturalar karakter ızgarasında ölçüldü; TL çıktısı parametre eklenince
        // kaymamalı.
        Assert.Equal(TurkishMoneyInWords.Format(34057.14m), TurkishMoneyInWords.Format(34057.14m, 1));
    }
}

public class InvoiceFormLayoutTests
{
    private const double Tolerance = 0.01; // pt — well under a printer dot

    [Fact]
    public void Character_grid_matches_the_measured_output()
    {
        // The name of a barcoded line sits at column 15 because the barcode is 13 characters
        // and the separator is two spaces. Measured at 3.62 cm.
        Assert.Equal(3.62, InvoiceFormLayout.Column(15) / InvoiceFormLayout.Cm, 2);

        // With a blank barcode the same string starts at column 2. Measured at 1.42 cm.
        Assert.Equal(1.42, InvoiceFormLayout.Column(2) / InvoiceFormLayout.Cm, 2);
    }

    [Fact]
    public void Item_rows_land_where_the_ten_line_reference_put_them()
    {
        // yazdir (5).pdf: the ten rows were measured at 321.27 pt and 470.36 pt, i.e. 11.334 cm
        // and 16.593 cm.
        var first = InvoiceFormLayout.FirstItemTop / InvoiceFormLayout.Cm;
        var tenth = (InvoiceFormLayout.FirstItemTop + 9 * InvoiceFormLayout.ItemRowHeight) / InvoiceFormLayout.Cm;

        Assert.Equal(11.334, first, 3);
        Assert.Equal(16.593, tenth, 3);
    }

    [Fact]
    public void Page_is_A4_portrait()
    {
        Assert.Equal(21.0, InvoiceFormLayout.PageWidth / InvoiceFormLayout.Cm, 3);
        Assert.Equal(29.7, InvoiceFormLayout.PageHeight / InvoiceFormLayout.Cm, 3);
    }

    [Fact]
    public void Content_fits_inside_the_page()
    {
        // The rightmost thing printed is the grand total at 19.95 cm and the lowest is the note
        // block; both must clear A4 with room, or the printer will clip rather than misalign.
        Assert.True(InvoiceFormLayout.GrossRight < InvoiceFormLayout.PageWidth - 0.5 * InvoiceFormLayout.Cm);
        Assert.True(InvoiceFormLayout.GrandTotalTop < InvoiceFormLayout.PageHeight - 2.0 * InvoiceFormLayout.Cm);
    }

    [Fact]
    public void Fits_the_documented_number_of_item_rows()
        => Assert.Equal(17, InvoiceFormLayout.ItemsPerPage);
}

public class InvoiceFormRendererTests
{
    [Fact]
    public void Wraps_without_splitting_words()
    {
        var lines = InvoiceFormRenderer.Wrap("YALNIZ : ON BİN  TL SIFIR KR", 66);
        Assert.Single(lines);

        var longText = "YALNIZ : ÜÇ YÜZ SEKSEN BEŞ BİN ALTI YÜZ ELLİ SEKİZ  TL DOKSAN BEŞ KR";
        var wrapped = InvoiceFormRenderer.Wrap(longText, 66);

        // The reference two-line invoice broke leaving "KR" alone on the second line.
        Assert.Equal(2, wrapped.Count);
        Assert.Equal("KR", wrapped[1]);
        Assert.All(wrapped, l => Assert.True(l.Length <= 66));
    }

    [Fact]
    public void Renders_a_pdf_of_the_right_size()
    {
        var pdf = new InvoiceFormRenderer().Render(Sample());

        Assert.NotNull(pdf);
        Assert.True(pdf.Length > 500);
        Assert.Equal("%PDF", System.Text.Encoding.ASCII.GetString(pdf, 0, 4));
    }

    [Fact]
    public void Service_lines_without_a_barcode_still_render()
    {
        var model = Sample();
        model.Lines.Add(new InvoicePrintLine
        {
            Barkod = string.Empty,
            StokAdi = "MONTAJ HİZMET BEDELİ",
            KdvOran = 16m,
            Miktar = 1m,
            OlcuBirimi = "AD",
            Fiyat = 500m,
            Tutar = 500m
        });

        var pdf = new InvoiceFormRenderer().Render(model);
        Assert.True(pdf.Length > 500);
    }

    private static InvoicePrintModel Sample() => new()
    {
        CariAdi = "FUNDA MAĞRACI",
        Adres = "GİRNE",
        Ilce = "GİRNE",
        Il = "GİRNE",
        Tarih = new DateTime(2026, 8, 3),
        PlasiyerKodu = "100",
        Montaj = "FUNDA MAĞRACI",
        AraToplam = 13400m,
        Iskonto = 3400m,
        NetToplam = 10000m,
        KdvToplam = 0m,
        GenelToplam = 10000m,
        Lines =
        {
            new InvoicePrintLine
            {
                Barkod = "8681344502300",
                StokAdi = "ST-TRODOS SB-3120 BUZ MAKİNELİ SU SEBİLİ",
                KdvOran = 0m,
                Miktar = 1m,
                OlcuBirimi = "AD",
                Fiyat = 13400m,
                Tutar = 13400m
            }
        }
    };
}

public class Ean13Tests
{
    /// <summary>
    /// The exact module pattern read back off a legacy label PDF (YazdirBarkodFatura.pdf) by
    /// sampling the centre of each of its 95 bars. If the encoder reproduces this, the new
    /// labels are bit-for-bit what the old system printed.
    /// </summary>
    private const string LegacyPattern =
        "10101011110001001001100101000010011101010001101010100001011001101101100111001010000101110100101";

    [Fact]
    public void Reproduces_the_pattern_decoded_from_the_legacy_label()
        => Assert.Equal(LegacyPattern, Ean13.Encode("8681344312039"));

    [Fact]
    public void Pattern_has_the_right_shape()
    {
        var bits = Ean13.Encode("8681344312039");

        Assert.Equal(Ean13.ModuleCount, bits.Length);
        Assert.Equal("101", bits[..3]);        // left guard
        Assert.Equal("01010", bits[45..50]);   // centre guard
        Assert.Equal("101", bits[92..]);       // right guard
    }

    [Theory]
    [InlineData("8681344312039", '9')]
    [InlineData("8681344906467", '7')]
    [InlineData("8681344502300", '0')]
    public void Computes_the_check_digit_of_real_article_numbers(string code, char expected)
        => Assert.Equal(expected, Ean13.CheckDigit(code[..12]));

    [Fact]
    public void Adds_a_check_digit_to_a_twelve_digit_code()
    {
        Assert.True(Ean13.TryNormalise("868134431203", out var full));
        Assert.Equal("8681344312039", full);
    }

    [Theory]
    [InlineData("8681344312038")]   // check digit disagrees with the payload
    [InlineData("12345")]           // too short
    [InlineData("")]
    [InlineData(null)]
    public void Rejects_what_a_scanner_would_reject(string? code)
        => Assert.False(Ean13.IsValid(code));

    [Fact]
    public void Refuses_to_encode_an_invalid_code_rather_than_printing_nonsense()
        => Assert.Throws<ArgumentException>(() => Ean13.Encode("8681344312038"));

    [Fact]
    public void Splits_the_digits_the_way_the_label_prints_them()
    {
        var (first, left, right) = Ean13.SplitForDisplay("8681344312039");

        Assert.Equal("8", first);
        Assert.Equal("681344", left);
        Assert.Equal("312039", right);
    }
}
