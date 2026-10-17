using B2B.Erp.Api.Core.Helpers;

namespace B2B.Erp.Api.Tests;

/// <summary>
/// Para birimi kodlamasını çiviler: <b>1=TRY 2=EUR 3=USD 4=GBP</b> (0 = TL, eski varsayılan).
///
/// <para>
/// Bu dosya bir "yardımcı sınıf testi" değil, bir <b>regresyon bariyeridir.</b> Projede aynı
/// hata defalarca çıktı: sistem eski bir kodlamadan (<c>43=USD, 3=GBP</c> / <c>1=USD 2=EUR
/// 3=GBP</c>) göç etti, ama tek tek yerlerde eski tablo kaldı. Bulunanlar:
/// çek oluşturma formu · denetim/silme kaydı · üç ürün ekranı · maliyet güncelleme belgesi.
/// Hepsinde sonuç aynıydı: <b>dolar sterline, TL dolara dönüyordu</b> — sessizce, çünkü sayı
/// geçerli görünüyor.
/// </para>
///
/// <para>
/// Aşağıdaki testler eski kodlamanın hangi biçimi olursa olsun geri sızmasını yakalar.
/// </para>
/// </summary>
public class CurrencyEncodingTests
{
    [Theory]
    [InlineData(1, "TRY")]
    [InlineData(2, "EUR")]
    [InlineData(3, "USD")]
    [InlineData(4, "GBP")]
    public void Encoding_is_pinned(int currencyTypeId, string expected)
        => Assert.Equal(expected, CurrencyTypeHelper.ToCode(currencyTypeId));

    [Fact]
    public void Three_is_dollars_not_pounds()
    {
        // Eski ürün kodlamasında 3 = GBP idi. Göçten sonra 3 = USD. Bu tek satır, projede
        // dört ayrı yerde çıkan "dolar ürün sterlin görünüyor" hatasının tamamını yakalar.
        Assert.Equal("USD", CurrencyTypeHelper.ToCode(3));
        Assert.NotEqual("GBP", CurrencyTypeHelper.ToCode(3));
    }

    [Fact]
    public void One_is_lira_not_dollars()
    {
        // Çek formundaki kodlama 1 = USD sanıyordu: dolar çeki veritabanına TL yazılıyordu.
        Assert.Equal("TRY", CurrencyTypeHelper.ToCode(1));
        Assert.True(CurrencyTypeHelper.IsTry(1));
    }

    [Fact]
    public void Legacy_forty_three_is_not_a_currency_anymore()
    {
        // Eski kodlamada 43 = USD idi; göç sonrası hiçbir kayıtta kalmadı ve tanınmamalı.
        // Tanınırsa, eski belgeye bakıp 43 gönderen bir istemci doğrulamadan geçerdi.
        Assert.Null(CurrencyTypeHelper.ToCode(43));
        Assert.False(CurrencyTypeHelper.IsKnown(43));
    }

    // --- 0 ile 1'in ikisi de TL --------------------------------------------------------------
    //
    // Ham `CurrencyTypeId` ile gruplamak TL'yi İKİYE böler: dönem kapanışında aynı cariye iki
    // açılış satırı, bakiye ekranında "CURR-0" diye ikinci bir satır çıkıyordu.

    [Theory]
    [InlineData(0)]
    [InlineData(1)]
    public void Zero_and_one_are_both_lira(int currencyTypeId)
    {
        Assert.True(CurrencyTypeHelper.IsTry(currencyTypeId));
        Assert.Equal(CurrencyTypeHelper.Try, CurrencyTypeHelper.Normalize(currencyTypeId));
        Assert.Equal("TRY", CurrencyTypeHelper.ToCode(currencyTypeId));
    }

    [Fact]
    public void Zero_and_one_are_the_same_currency()
    {
        // Hesabın para birimi 1, hareketinki 0 ise eşleşmeleri şart — eşleşmezse hesabın
        // bakiyesi kendi hareketlerini süzgeçte eleyip sıfır görünüyordu.
        Assert.True(CurrencyTypeHelper.SameCurrency(0, 1));
        Assert.True(CurrencyTypeHelper.SameCurrency(1, 0));
    }

    [Theory]
    [InlineData(2)]
    [InlineData(3)]
    [InlineData(4)]
    public void Foreign_currencies_are_not_lira(int currencyTypeId)
    {
        Assert.False(CurrencyTypeHelper.IsTry(currencyTypeId));
        Assert.False(CurrencyTypeHelper.SameCurrency(CurrencyTypeHelper.Try, currencyTypeId));
        Assert.False(CurrencyTypeHelper.SameCurrency(0, currencyTypeId));
    }

    [Fact]
    public void Distinct_currencies_never_collapse_onto_each_other()
    {
        int[] all = { 1, 2, 3, 4 };
        foreach (var a in all)
        {
            foreach (var b in all)
            {
                if (a == b) continue;
                Assert.False(CurrencyTypeHelper.SameCurrency(a, b));
            }
        }
    }

    // --- İki yardımcı, tek kaynak -------------------------------------------------------------

    [Theory]
    [InlineData(0)]
    [InlineData(1)]
    [InlineData(2)]
    [InlineData(3)]
    [InlineData(4)]
    [InlineData(43)]
    [InlineData(99)]
    public void ProductCurrencyHelper_delegates_and_never_diverges(int currencyTypeId)
    {
        // `ProductCurrencyHelper` bir zamanlar AYNI işi yapan İKİNCİ bir "tek doğru kaynak"tı.
        // Birleştirildi; bu test ikisinin tekrar ayrışmasını engelliyor.
        Assert.Equal(
            CurrencyTypeHelper.Normalize(currencyTypeId),
            ProductCurrencyHelper.Normalize(currencyTypeId));

        Assert.Equal(
            CurrencyTypeHelper.ToCodeOrTry(currencyTypeId),
            ProductCurrencyHelper.MapCurrencyTypeIdToIsoCode(currencyTypeId));

        Assert.Equal(
            CurrencyTypeHelper.IsKnown(currencyTypeId),
            ProductCurrencyHelper.IsValid(currencyTypeId));
    }

    [Theory]
    [InlineData("USD", 3)]
    [InlineData("EUR", 2)]
    [InlineData("GBP", 4)]
    [InlineData("TRY", 1)]
    [InlineData("TL", 1)]
    public void Iso_code_round_trips(string code, int expectedTypeId)
    {
        var typeId = ProductCurrencyHelper.MapCurrencyStringToCurrencyTypeId(code);
        Assert.Equal(expectedTypeId, typeId);
        Assert.Equal(code is "TL" ? "TRY" : code, CurrencyTypeHelper.ToCode(typeId));
    }

    [Fact]
    public void Unknown_code_falls_back_instead_of_guessing()
    {
        // "XXX"/"JPY" gibi kur karşılığı olmayan kodlar sessizce bir para birimine
        // eşlenmemeli — eşlenirse tutar yanlış para biriminde defterlenir.
        Assert.Equal(CurrencyTypeHelper.Try, ProductCurrencyHelper.MapCurrencyStringToCurrencyTypeId("XXX"));
        Assert.Equal(CurrencyTypeHelper.Try, ProductCurrencyHelper.MapCurrencyStringToCurrencyTypeId(null));
        Assert.Equal(CurrencyTypeHelper.Try, ProductCurrencyHelper.MapCurrencyStringToCurrencyTypeId("   "));
    }

    // --- Ekran simgeleri ---------------------------------------------------------------------

    [Theory]
    [InlineData(0, "₺")]
    [InlineData(1, "₺")]
    [InlineData(2, "€")]
    [InlineData(3, "$")]
    [InlineData(4, "£")]
    public void Symbols_follow_the_same_encoding(int currencyTypeId, string expected)
        => Assert.Equal(expected, ProductCurrencyHelper.MapCurrencyTypeIdToSymbol(currencyTypeId));

    [Fact]
    public void Display_code_says_TL_while_the_rate_service_says_TRY()
    {
        // Kur servisi ISO ister ("TRY"), ekran Türkçe kısaltma gösterir ("TL"). İkisi ayrı
        // yardımcı; karıştırılırsa ekranda "TRY", kur çağrısında "TL" çıkar.
        Assert.Equal("TL", ProductCurrencyHelper.MapCurrencyTypeIdToCode(1));
        Assert.Equal("TRY", ProductCurrencyHelper.MapCurrencyTypeIdToIsoCode(1));
    }
}
