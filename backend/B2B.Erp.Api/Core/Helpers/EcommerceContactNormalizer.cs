using System.Text.RegularExpressions;

namespace B2B.Erp.Api.Core.Helpers;

/// <summary>
/// E-TİCARETTEN GELEN İLETİŞİM BİLGİSİNİN NORMALİZASYONU (2026-09-16 kullanıcı isteği:
/// "e-ticaret müşterilerinin numaralarına normalizasyon yapmamız lazım, oluşturma arayüzünde
/// bize normalize edilmiş hâli gelmeli; adres ilçe yazan yere düşmüş").
///
/// <para>
/// Mağaza formunu MÜŞTERİ dolduruyor: telefonu bitişik yazıyor (<c>05428750029</c>), adresin
/// tamamını "Mahalle/Semt" kutusuna yazıp Adres kutusunu boş bırakabiliyor. Cari kartı ise
/// B2B'nin biçimini bekliyor (<c>0542 875 0029</c>) ve fatura basımı Adres ile İlçe'yi AYRI
/// satırlara yazıyor — bu yüzden ham veri hem ekranda hem kâğıtta yanlış yere düşüyordu.
/// </para>
///
/// <para>
/// Düzeltme KAYIT ANINDA yapılır, gösterim anında değil: cari kartını bayi de düzenliyor,
/// raporlar ve fatura basımı da aynı alanları okuyor. Tek yerde düzeltilmezse her okuyan
/// kendi tahminini yapar.
/// </para>
/// </summary>
public static class EcommerceContactNormalizer
{
    /// <summary>
    /// Adresin ilçe kutusuna yazıldığını kabul etme eşiği. KKTC'de ilçe/semt adları kısadır
    /// ("Hamitköy", "Küçük Kaymaklı"); bu uzunluğun üstü adrestir.
    /// </summary>
    private const int DistrictMaxLength = 30;

    private static readonly Regex Spaces = new(@"\s+", RegexOptions.Compiled);

    /// <summary>
    /// İl/ilçe kutusuna yazılmış "seçilmedi" metinleri. Canlıda 120-11-000016'nın ilçesi
    /// düpedüz <c>Seçiniz</c> yazıyordu; bu metin cari kartında ve fatura basımında ilçe gibi
    /// görünüyordu. Boş kabul edilir.
    /// </summary>
    private static readonly string[] Placeholders =
    {
        "seciniz", "seciniz...", "secim", "secim yapiniz", "sec", "select", "-", "--", "yok", "belirtilmemis"
    };

    private static bool IsPlaceholder(string value)
    {
        var v = value.Trim().ToLowerInvariant()
            .Replace('ı', 'i').Replace('ş', 's').Replace('ğ', 'g')
            .Replace('ü', 'u').Replace('ö', 'o').Replace('ç', 'c')
            .Replace("İ", "i");
        return Array.IndexOf(Placeholders, v) >= 0;
    }

    /// <summary>Baştaki/sondaki boşluk atılır, aradaki boşluk yığınları tek boşluğa iner.</summary>
    public static string? Clean(string? value)
    {
        var v = (value ?? string.Empty).Trim();
        if (v.Length == 0) return null;
        return Spaces.Replace(v, " ");
    }

    /// <summary>
    /// Telefonu B2B biçimine çevirir: <c>0555 555 5555</c> (yurt dışında dördüncü grup,
    /// bkz. <see cref="PhoneFormat"/>).
    ///
    /// <para>
    /// Rakam dışındaki her şey atılır. <c>+90</c> / <c>0090</c> / <c>90</c> ön ekiyle gelen
    /// KKTC-Türkiye numarası yerel biçime indirilir, başında 0 yoksa eklenir; çünkü B2B deseni
    /// 0 ile başlamayan numarayı reddediyor ve numara kartta ham kalıyordu.
    /// </para>
    ///
    /// <para>Biçimlenemeyecek kadar kısa/uzunsa ham değer (kırpılmış) geri döner — kayıt bu
    /// yüzden düşmemeli, numara kullanıcı için yine de bir bilgidir.</para>
    /// </summary>
    public static string? NormalizePhone(string? value)
    {
        var raw = Clean(value);
        if (raw is null) return null;

        var digits = new string(raw.Where(char.IsDigit).ToArray());
        if (digits.Length == 0) return raw;

        // Uluslararası ön ekler: 00 90 ... / 90 ... / +90 ... (+ zaten rakam süzgecinde düştü)
        if (digits.StartsWith("0090", StringComparison.Ordinal)) digits = digits[4..];
        else if (digits.Length > 11 && digits.StartsWith("90", StringComparison.Ordinal)) digits = digits[2..];
        // YURT DIŞI NUMARASI (2026-09-27): "+44 7700 900123" başına tek 0 eklenince aranamayan
        // "0447 700 9001 23" oluyordu. `+` ile yazılmış yabancı numara KKTC'den dışarıyı arama
        // önekiyle (00) saklanır: "0044 770 0900 123". E-ticarette SMS gidemeyen yabancı müşteri
        // artık e-postayla üye olabildiği için bu numaralar cariye düşmeye başladı.
        else if (raw.TrimStart().StartsWith('+') && !digits.StartsWith("00", StringComparison.Ordinal)) digits = "00" + digits;

        if (!digits.StartsWith("0", StringComparison.Ordinal)) digits = "0" + digits;
        if (digits.Length > PhoneFormat.MaxDigits) digits = digits[..PhoneFormat.MaxDigits];

        // 11 haneden kısa numara gruplanamaz (0 + 4-3-4); ham hâliyle bırakılır.
        if (digits.Length < 11) return digits;

        var formatted = $"{digits[..4]} {digits[4..7]} {digits[7..11]}";
        if (digits.Length > 11) formatted += " " + digits[11..];

        return PhoneFormat.IsValid(formatted) ? formatted : digits;
    }

    /// <summary>
    /// Adres / ilçe kutularını yerine oturtur.
    ///
    /// <list type="bullet">
    /// <item>Adres boş ve ilçe uzunsa (müşteri her şeyi oraya yazmış), metin ADRESE taşınır ve
    /// ilçe boşaltılır — fatura basımında adres kendi satırında çıksın diye.</item>
    /// <item>İkisi de doluysa dokunulmaz; ilçe uzun olsa bile veri kaybı riski alınmaz.</item>
    /// </list>
    /// </summary>
    public static (string? City, string? District, string? Address) NormalizeAddress(string? city, string? district, string? address)
    {
        var c = Clean(city);
        var d = Clean(district);
        var a = Clean(address);

        // "Seçiniz" gibi seçilmemiş değerler ilçe/il sayılmaz.
        if (c is not null && IsPlaceholder(c)) c = null;
        if (d is not null && IsPlaceholder(d)) d = null;

        if (a is null && d is not null && d.Length > DistrictMaxLength)
        {
            a = d;
            d = null;
        }

        return (c, d, a);
    }
}
