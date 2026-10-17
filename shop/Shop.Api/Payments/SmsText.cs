namespace Shop.Api.Payments;

/// <summary>
/// SMS metni yardımcıları. TÜRKÇE KARAKTER YOK: tek "ç/ğ/ş" mesajı GSM-7'den UCS-2'ye düşürüp
/// 160 karakter sınırını 70'e indiriyor, her SMS iki kredi oluyor (bkz. PaymentService notu).
/// </summary>
internal static class SmsText
{
    public static string Ascii(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return string.Empty;
        const string from = "çÇğĞıİöÖşŞüÜ";
        const string to = "cCgGiIoOsSuU";
        var chars = value.Trim().ToCharArray();
        for (var i = 0; i < chars.Length; i++)
        {
            var k = from.IndexOf(chars[i]);
            if (k >= 0) chars[i] = to[k];
        }
        return new string(chars);
    }
}
