using System.Runtime.CompilerServices;

// The layout constants and the wrap helper are implementation detail, but they are exactly what
// has to be pinned against the legacy output — so the tests reach them rather than the surface
// being widened for everyone.
[assembly: InternalsVisibleTo("B2B.Erp.Api.Tests")]

namespace B2B.Erp.Api.Features.InvoicePrint;

/// <summary>
/// The geometry of the pre-printed invoice form, in one place.
///
/// Every value here was measured off the legacy output with pdfplumber and is documented in
/// docs/fatura-basim-olculeri.md. They are not design choices: the paper already carries the
/// boxes and captions, so a millimetre of drift puts text on top of a printed line. Nothing in
/// this file should be "tidied" to rounder numbers.
///
/// Units are PostScript points (1/72"), because that is what the PDF is drawn in; the cm value
/// each one came from is in the comment beside it.
/// </summary>
internal static class InvoiceFormLayout
{
    /// <summary>Points per centimetre.</summary>
    public const double Cm = 28.3465;

    /// <summary>
    /// A4. The legacy report emitted US Letter (612x792) but the stock is A4, confirmed by the
    /// user. Positions are all measured from the top-left, so they carry over unchanged; the
    /// taller page only adds space below the last line. Printing must not scale.
    /// </summary>
    public const double PageWidth = 21.0 * Cm;
    public const double PageHeight = 29.7 * Cm;

    /// <summary>Body font size. Only the GENEL TOPLAM line differs.</summary>
    public const double FontSize = 8.0;
    public const double GrandTotalFontSize = 9.0;

    /// <summary>
    /// Left edge of every left-aligned field, and the monospace advance at <see cref="FontSize"/>.
    /// Courier advances at 0.6 em, so 8pt gives exactly 4.8pt per character — the whole layout
    /// sits on this grid, which is why concatenated fields land where they do.
    /// </summary>
    public const double Left = 30.66;          // 1.0816 cm
    public const double CharWidth = 4.8;       // 0.16933 cm

    /// <summary>Column n of the character grid.</summary>
    public static double Column(int n) => Left + n * CharWidth;

    // ---- Header ---------------------------------------------------------------------------

    public const double CariNameTop = 4.19 * Cm;
    public const double AddressTop = 5.20 * Cm;
    public const double DistrictTop = 6.65 * Cm;

    /// <summary>
    /// ADRES ALT SATIRA GEÇER (2026-09-16 kullanıcı isteği: "fatura basımlarında e-ticaretten
    /// gelenlerde adresler alt satıra geçmiyor").
    ///
    /// <para>
    /// Adres tek satır yazılıyordu; e-ticaret müşterisinin kendi yazdığı uzun adres sayfanın
    /// sağına taşıyordu. Sığacak yer ADRES ile İLÇE satırı arasındaki 1,45 cm: 0,32 cm'lik satır
    /// adımıyla üç satır (5,20 · 5,52 · 5,84) yazılır, dördüncüsü İLÇE satırına çarpardı.
    /// </para>
    ///
    /// <para>
    /// Genişlik TESLİM adresiyle AYNI (<see cref="DeliveryWrapColumn"/>, 66 karakter): basılı
    /// formun sol sütunu orada bitiyor, adresin sağdaki alana taşmasının sebebi de buydu.
    /// Kaşe 7,24 cm'de başladığı için bu üç satır kaşeye binmez.
    /// </para>
    /// </summary>
    public const int AddressWrapColumn = DeliveryWrapColumn;
    public const double AddressLineHeight = 0.32 * Cm;
    public const int AddressMaxLines = 3;

    /// <summary>İlçe/il satırı da taşabilir; vergi satırına (7,71 cm) çarpmadan iki satır sığar.</summary>
    public const int DistrictMaxLines = 2;
    /// <summary>
    /// The date, top right ("Düzenleme Tarihi" box on the pre-printed stock).
    ///
    /// Does not match the reference measurement (7.21 cm) and is not meant to: the position has
    /// been corrected twice against the actual paper. It was first moved 2.5 mm up, then on
    /// 2026-08-21 the user asked for 5 mm down and 3 mm right from there — so it now sits
    /// 2.5 mm BELOW the legacy row, at 7.46 cm.
    /// </summary>
    public const double DateTop = 7.46 * Cm;

    /// <summary>3 mm right of the measured 17.51 cm (user correction, 2026-08-21).</summary>
    public const double DateLeft = 17.81 * Cm;
    public const double TaxLineTop = 7.71 * Cm;

    // ---- Company stamp (kaşe) ----------------------------------------------------------------

    /// <summary>
    /// The company stamp, embedded as an image.
    ///
    /// It is not text, which is why a first pass over the reference PDFs missed it entirely —
    /// extract_words() cannot see it. Every reference invoice carries exactly one image, at
    /// identical coordinates, so this is a fixed block and not something that moves with the
    /// content around it.
    /// </summary>
    /// <summary>
    /// 0.2 cm left of the legacy position (10.03 cm), corrected against the actual stock.
    /// </summary>
    public const double StampLeft = 9.83 * Cm;

    /// <summary>
    /// Offset from the legacy position (7.44 cm), corrected against the actual stock — like the
    /// date, deliberate rather than drift. Was 0.7 cm above it; the user asked for 5 mm down on
    /// 2026-08-21, so it now sits 0.2 cm above the legacy row.
    /// </summary>
    public const double StampTop = 7.24 * Cm;
    public const double StampWidth = 4.52 * Cm;
    public const double StampHeight = 2.54 * Cm;

    /// <summary>File name of the stamp under the application's Assets folder.</summary>
    public const string StampFileName = "kase.png";

    // ---- Item rows ------------------------------------------------------------------------

    /// <summary>Top of the first item row.</summary>
    public const double FirstItemTop = 321.27;        // 11.3337 cm

    /// <summary>
    /// Row pitch, measured across the nine gaps of a ten-line invoice rather than a single gap,
    /// so the rounding of any one row does not skew it.
    /// </summary>
    public const double ItemRowHeight = 16.5656;      // 0.5844 cm

    /// <summary>Rows that fit before the totals block begins.</summary>
    public const int ItemsPerPage = (int)((21.55 * Cm - FirstItemTop) / ItemRowHeight);

    /// <summary>
    /// AD SÜTUNUNUN GERÇEK GENİŞLİĞİ — karakter olarak (2026-08-21).
    ///
    /// Ad soldan <see cref="Left"/>'te başlıyor ve hiçbir sınır tanımadan yazılıyordu; uzun ad
    /// sağdaki SABİT konumlu '%', miktar ve fiyat sütunlarının ÜSTÜNE biniyordu. Sınır, adın
    /// başlangıcı ile '%' işaretinin sol kenarı arasındaki mesafedir.
    /// </summary>
    public const int ItemNameWrapColumn = (int)((13.36 * Cm - Left) / CharWidth);

    /// <summary>
    /// Sığmayan ad, AYNI SATIR YÜKSEKLİĞİNDE iki küçük satır olarak yazılır (kullanıcı kuralı).
    ///
    /// <para>
    /// Kırpmak yerine küçültmek tercih edildi: kırpılan ad müşteriye ne aldığını söylemez.
    /// 5,6 pt, gövde yazısının %70'i — Courier 0,6 em ilerlediği için karakter genişliği
    /// 3,36 pt ve aynı sütuna 103 karakter sığıyor, iki satırla 206.
    /// </para>
    ///
    /// <para>
    /// İki satır <see cref="ItemRowHeight"/> (16,57 pt) içine sığmalı ki alttaki kalem satırına
    /// binmesin: 2 × 6,2 = 12,4 pt.
    /// </para>
    /// </summary>
    public const double ItemNameSmallFontSize = 5.6;
    public const double ItemNameSmallLineHeight = 6.2;
    public const int ItemNameSmallWrapColumn = (int)((13.36 * Cm - Left) / (ItemNameSmallFontSize * 0.6));
    public const int ItemNameMaxLines = 2;

    public const double VatMarkLeft = 13.36 * Cm;     // '%'
    public const double VatRateLeft = 13.70 * Cm;
    public const double QuantityRight = 15.26 * Cm;
    public const double UnitLeft = 15.43 * Cm;
    public const double UnitPriceRight = 17.67 * Cm;
    public const double LineTotalRight = 19.90 * Cm;

    // ---- Totals block (right) ---------------------------------------------------------------

    public const double TotalsLabelLeft = 12.40 * Cm;

    /// <summary>BRÜT TUTAR and GENEL TOPLAM sit in a slightly wider box than the rest.</summary>
    public const double GrossRight = 19.95 * Cm;
    public const double AmountRight = 19.92 * Cm;

    public const double GrossTop = 21.55 * Cm;
    public const double DiscountTop = 22.13 * Cm;     // only when there is a discount
    public const double NetTop = 22.72 * Cm;          // only when there is a discount
    public const double Vat16Top = 23.30 * Cm;
    public const double Vat10Top = 23.89 * Cm;
    public const double Vat5Top = 24.46 * Cm;
    public const double VatTotalTop = 25.05 * Cm;
    public const double GrandTotalTop = 25.64 * Cm;

    // ---- Bottom-left block ------------------------------------------------------------------

    public const double SalesmanTop = 22.95 * Cm;     // "<PLA_KODU> TESLİM ALAN #"

    /// <summary>
    /// "TESLIM : ..." — BRÜT TUTAR ile AYNI satırda, solda. Referans çıktıdan ölçüldü:
    /// PDF'te taban çizgisi y=174,2 pt (alttan), sayfa üstünden 21,79 cm; yazı yükseltisi
    /// 0,20 cm düşülünce <see cref="GrossTop"/> ile aynı 21,55 cm çıkıyor. Aynı referansta
    /// sol kenar x=30,7 pt, yani <see cref="Left"/>.
    /// </summary>
    public const double DeliveryTop = GrossTop;

    /// <summary>
    /// İkinci satırın adımı. Referansta tek satırlık örnek var (uzun adres yoktu), bu yüzden
    /// ölçülmedi: YALNIZ bloğunun satır adımı kullanılıyor — aynı gövde fontu, aynı ızgara.
    /// İki satır TESLİM ALAN'a (22,95 cm) çarpmaz: 21,55 + 0,32 = 21,87.
    /// </summary>
    public const double DeliveryLineHeight = InWordsLineHeight;

    /// <summary>
    /// En fazla iki satır. Adres üçüncü satıra taşacak kadar uzunsa kırpılır — sağdaki toplam
    /// bloğunun üstüne yazmaktansa eksik yazmak yeğdir.
    /// </summary>
    public const int DeliveryMaxLines = 2;

    /// <summary>
    /// Satır başına karakter: sol kenardan sağdaki toplam bloğunun soluna kadar
    /// (<see cref="TotalsLabelLeft"/> 12,40 cm = 351,5 pt) olan 320,8 pt, tek aralıklı
    /// yazının 4,8 pt'lik adımına bölünür → 66. Referans satır 55 karakter, rahat sığıyor.
    /// </summary>
    public const int DeliveryWrapColumn = (int)((TotalsLabelLeft - Left) / CharWidth);

    /// <summary>
    /// The YALNIZ / MONTAJ / NOT block flows: when the amount in words wraps to a second line,
    /// MONTAJ and NOT move down with it. Measured on a one-line and a two-line invoice.
    /// </summary>
    /// <summary>
    /// MONTAJ ve NOT satırlarının sarma/kırpma sınırı — sağdaki toplam bloğunun soluna kadar,
    /// yani <see cref="DeliveryWrapColumn"/> ile aynı 66 karakter.
    ///
    /// <para>
    /// NOT satırı sınırsız yazılıyordu ve uzun not sağdaki TOPLAM K.D.V. / GENEL TOPLAM
    /// sütunlarının üstüne biniyordu. NOT en fazla İKİ satır sarar; MONTAJ tek satırda kalır
    /// (hemen altında NOT var, sarsaydı onun üstüne binerdi).
    /// </para>
    /// </summary>
    public const int FooterWrapColumn = (int)((TotalsLabelLeft - Left) / CharWidth);
    public const int NoteMaxLines = 2;

    public const double InWordsTop = 24.19 * Cm;
    public const double InWordsLineHeight = 0.32 * Cm;
    public const double MontajTop = 24.78 * Cm;
    public const double NoteTop = 25.36 * Cm;

    /// <summary>
    /// How far MONTAJ and NOT slide per extra wrapped line of the YALNIZ text. The reference
    /// pair shifted 0.10 cm for one extra line, not a full line height — the label box grows
    /// rather than the lines being stacked.
    /// </summary>
    public const double FlowShiftPerWrappedLine = 0.10 * Cm;

    /// <summary>
    /// Characters of YALNIZ text that fit before it wraps. Derived from the reference: the
    /// two-line sample broke after "... DOKSAN BEŞ", leaving "KR" on the second line.
    /// </summary>
    public const int InWordsWrapColumn = 66;
}
