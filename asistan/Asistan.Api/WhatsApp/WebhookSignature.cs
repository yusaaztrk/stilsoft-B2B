using System.Security.Cryptography;
using System.Text;

namespace Asistan.Api.WhatsApp;

/// <summary>
/// Meta'nın webhook imzası: <c>X-Hub-Signature-256: sha256=&lt;HMAC-SHA256(ham gövde, AppSecret) hex&gt;</c>.
///
/// İmza GÖVDENİN HAM BAYTLARI üzerinden hesaplanır; JSON'u çözüp yeniden yazmak (boşluk, kaçış
/// karakterleri) imzayı bozar. Bu yüzden denetleyici gövdeyi önce bayt olarak okuyor.
///
/// İmzasız/yanlış imzalı istek İŞLENMEZ: webhook adresi herkese açık, imza olmadan herkes
/// "müşteriden mesaj geldi" diye sahte kayıt düşebilirdi.
/// </summary>
public static class WebhookSignature
{
    public static bool IsValid(byte[] body, string? header, string appSecret)
    {
        if (string.IsNullOrWhiteSpace(appSecret) || string.IsNullOrWhiteSpace(header)) return false;

        const string prefix = "sha256=";
        var value = header.Trim();
        if (!value.StartsWith(prefix, StringComparison.OrdinalIgnoreCase)) return false;

        byte[] expected;
        try
        {
            expected = Convert.FromHexString(value[prefix.Length..]);
        }
        catch (FormatException)
        {
            return false;
        }

        var actual = HMACSHA256.HashData(Encoding.UTF8.GetBytes(appSecret), body);
        // Sabit süreli karşılaştırma: farkın kaçıncı baytta olduğu süreden okunamasın.
        return CryptographicOperations.FixedTimeEquals(actual, expected);
    }

    public static string Compute(byte[] body, string appSecret) =>
        "sha256=" + Convert.ToHexString(HMACSHA256.HashData(Encoding.UTF8.GetBytes(appSecret), body)).ToLowerInvariant();
}
