using System.Text.RegularExpressions;

namespace B2B.Erp.Api.Core.Helpers;

/// <summary>
/// TELEFON BİÇİMİ — YURT DIŞI NUMARALARINI DA ALIR (2026-08-20 kullanıcı isteği).
///
/// <para>
/// Sunucu doğrulaması <c>^0\d{3} \d{3} \d{4}$</c> ile TAM 11 haneyi dayatıyordu; bu,
/// Türkiye/KKTC numarasının uzunluğu. Yurt dışından müşterisi olan bir firmada daha uzun
/// numara kaydetmek mümkün değildi — ekran numarayı sessizce kırpıyor, sunucu da kırpılmamış
/// olanı reddediyordu.
/// </para>
///
/// <para>
/// Dördüncü grup İSTEĞE BAĞLI: <c>0555 555 5555</c> aynen geçerli kalır, tek bir mevcut kayıt
/// bile geçersize düşmez. <c>0555 555 5555 555</c> ve daha uzunu artık kabul edilir.
/// </para>
///
/// <para>
/// <b>Neden tek yerde:</b> aynı desen altı ayrı DTO ve denetleyicide kopyalanmıştı. Birini
/// gevşetip diğerini unutmak, ekranın kabul ettiği numaranın kaydederken reddedilmesi
/// demekti — kullanıcıya "geçersiz telefon" diyen ama neyin geçersiz olduğunu söylemeyen
/// bir hata.
/// </para>
/// </summary>
public static class PhoneFormat
{
    /// <summary>
    /// En fazla 17 hane: uluslararası numara standardı (E.164) 15 hanedir, Türkiye'de yurt
    /// dışı numarası <c>00</c> ön ekiyle yazıldığı için 15 + 2. Biçimlenmiş hâli 20 karakter
    /// eder ve en dar telefon kolonuna tam sığar.
    /// </summary>
    public const int MaxDigits = 17;

    /// <summary>Doğrulama deseni. Dördüncü grup isteğe bağlıdır (yurt dışı).</summary>
    public const string Pattern = @"^0\d{3} \d{3} \d{4}( \d{1,6})?$";

    public const string Message = "Telefon 0555 555 5555 biçiminde olmalıdır (yurt dışı için 0555 555 5555 555).";

    private static readonly Regex Compiled = new(Pattern, RegexOptions.Compiled);

    /// <summary>Boş değer GEÇERLİDİR; alanın zorunlu olup olmadığına çağıran karar verir.</summary>
    public static bool IsValid(string? value)
    {
        var v = (value ?? string.Empty).Trim();
        return v.Length == 0 || Compiled.IsMatch(v);
    }
}
