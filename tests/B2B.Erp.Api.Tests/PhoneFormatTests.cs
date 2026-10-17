using B2B.Erp.Api.Core.Helpers;

namespace B2B.Erp.Api.Tests;

/// <summary>
/// Telefon biçimini çiviler (2026-08-20: yurt dışı numaraları).
///
/// <para>
/// Korunan iki şey var. Birincisi <b>geriye dönük uyum</b>: sistemdeki bütün numaralar
/// 11 haneli ve tek bir tanesi bile geçersize düşmemeli — düşerse o cariyi/kullanıcıyı
/// kaydetmek imkânsız hâle gelir. İkincisi <b>yurt dışı numarasının kabulü</b>, bu değişikliğin
/// asıl amacı.
/// </para>
/// </summary>
public sealed class PhoneFormatTests
{
    [Theory]
    [InlineData("0555 555 5555")]
    [InlineData("0533 000 7114")]
    [InlineData("0212 513 5351")]
    public void MevcutOnBirHaneliNumaralar_GECERLI_KALIR(string phone)
    {
        Assert.True(PhoneFormat.IsValid(phone));
    }

    [Theory]
    [InlineData("0555 555 5555 555")]   // kullanıcının verdiği yeni biçim
    [InlineData("0049 176 1234 5678")]  // Almanya, 00 ön ekiyle
    [InlineData("0044 770 0900 123")]   // Birleşik Krallık
    public void YurtDisiNumaralari_ARTIK_GECERLI(string phone)
    {
        Assert.True(PhoneFormat.IsValid(phone));
    }

    [Fact]
    public void Bos_GECERLIDIR_zorunluluk_cagirana_aittir()
    {
        // Alanın zorunlu olup olmadığı uca göre değişiyor (garanti kaydında zorunlu, caride
        // değil). Biçim doğrulaması "boş" ile "yanlış biçim"i karıştırmamalı.
        Assert.True(PhoneFormat.IsValid(null));
        Assert.True(PhoneFormat.IsValid(""));
        Assert.True(PhoneFormat.IsValid("   "));
    }

    [Theory]
    [InlineData("5555555555")]          // ayraçsız
    [InlineData("0555 555 555")]        // eksik hane
    [InlineData("1555 555 5555")]       // sıfırla başlamıyor
    [InlineData("0555-555-5555")]       // yanlış ayraç
    [InlineData("0555 555 5555 5555555")] // dördüncü grup fazla uzun
    public void Bozuk_Bicimler_REDDEDILIR(string phone)
    {
        Assert.False(PhoneFormat.IsValid(phone));
    }

    [Fact]
    public void EnUzunNumara_VeritabaniKolonuna_SIGAR()
    {
        // 17 hane + 3 ayraç = 20 karakter. `Users.Gsm` bu yüzden 30'a çıkarıldı; diğer telefon
        // kolonları zaten 30+. Bu test, biçim ileride uzatılırsa kolonu da büyütmeyi hatırlatır.
        var enUzun = "0049 176 1234 567890";
        Assert.Equal(PhoneFormat.MaxDigits, enUzun.Replace(" ", string.Empty).Length);
        Assert.True(PhoneFormat.IsValid(enUzun));
        Assert.Equal(20, enUzun.Length);
        Assert.True(enUzun.Length <= 30);
    }
}
