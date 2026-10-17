using System.Text;

namespace B2B.Erp.Api.Features.InvoicePrint;

/// <summary>
/// EAN-13 encoding.
///
/// Written rather than taken from a library because the label has to reproduce what the old ERP
/// printed, module for module — the decoded bar pattern of a legacy label is used as a test
/// vector (see Ean13Tests). It also removes the guesswork the browser-side printing had, where a
/// 13-digit article number was handed to JsBarcode as CODE128 whenever the product record
/// happened not to say EAN13; that scans as a different symbology and does not match the article
/// number a till expects.
/// </summary>
public static class Ean13
{
    /// <summary>Total modules in an EAN-13 symbol: 3 + 42 + 5 + 42 + 3.</summary>
    public const int ModuleCount = 95;

    private static readonly string[] LeftOdd =
    {
        "0001101", "0011001", "0010011", "0111101", "0100011",
        "0110001", "0101111", "0111011", "0110111", "0001011"
    };

    private static readonly string[] LeftEven =
    {
        "0100111", "0110011", "0011011", "0100001", "0011101",
        "0111001", "0000101", "0010001", "0001001", "0010111"
    };

    private static readonly string[] Right =
    {
        "1110010", "1100110", "1101100", "1000010", "1011100",
        "1001110", "1010000", "1000100", "1001000", "1110100"
    };

    /// <summary>
    /// Which of the first six digits use the even (G) table. The first digit is not drawn as
    /// bars at all — it is carried entirely by this pattern, which is why it prints outside the
    /// left guard.
    /// </summary>
    private static readonly string[] Parity =
    {
        "LLLLLL", "LLGLGG", "LLGGLG", "LLGGGL", "LGLLGG",
        "LGGLLG", "LGGGLL", "LGLGLG", "LGLGGL", "LGGLGL"
    };

    /// <summary>Whether <paramref name="value"/> can be printed as EAN-13.</summary>
    public static bool IsValid(string? value)
        => TryNormalise(value, out _);

    /// <summary>
    /// Accepts 12 or 13 digits. With 12 the check digit is computed; with 13 it is verified,
    /// because printing a barcode whose check digit disagrees with its own digits produces a
    /// label that scanners reject outright.
    /// </summary>
    public static bool TryNormalise(string? value, out string normalised)
    {
        normalised = string.Empty;
        var digits = new string((value ?? string.Empty).Where(char.IsDigit).ToArray());

        if (digits.Length == 12)
        {
            normalised = digits + CheckDigit(digits);
            return true;
        }

        if (digits.Length == 13 && CheckDigit(digits[..12]) == digits[12])
        {
            normalised = digits;
            return true;
        }

        return false;
    }

    /// <summary>Standard EAN check digit: alternating weights of 1 and 3 from the left.</summary>
    public static char CheckDigit(string first12)
    {
        var sum = 0;
        for (var i = 0; i < 12; i++)
        {
            sum += (first12[i] - '0') * (i % 2 == 0 ? 1 : 3);
        }
        return (char)('0' + (10 - sum % 10) % 10);
    }

    /// <summary>
    /// The 95-module pattern, '1' where a bar is drawn. Throws for anything that is not a valid
    /// EAN-13 payload — a silently wrong barcode is worse than a failed print.
    /// </summary>
    public static string Encode(string value)
    {
        if (!TryNormalise(value, out var code))
        {
            throw new ArgumentException($"'{value}' geçerli bir EAN-13 barkodu değil.", nameof(value));
        }

        var parity = Parity[code[0] - '0'];
        var sb = new StringBuilder(ModuleCount);

        sb.Append("101"); // left guard
        for (var i = 0; i < 6; i++)
        {
            var digit = code[i + 1] - '0';
            sb.Append(parity[i] == 'L' ? LeftOdd[digit] : LeftEven[digit]);
        }

        sb.Append("01010"); // centre guard
        for (var i = 0; i < 6; i++)
        {
            sb.Append(Right[code[i + 7] - '0']);
        }

        sb.Append("101"); // right guard
        return sb.ToString();
    }

    /// <summary>
    /// Module indices whose bars run long. The guards descend past the digit row on a real
    /// EAN-13 symbol, and the legacy labels do the same.
    /// </summary>
    public static bool IsGuardModule(int index)
        => index < 3 || (index >= 45 && index < 50) || index >= 92;

    /// <summary>Human-readable form, grouped the way it is printed: "8 681344 312039".</summary>
    public static (string First, string Left, string Right) SplitForDisplay(string code)
        => (code[..1], code[1..7], code[7..13]);
}
