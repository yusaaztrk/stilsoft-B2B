using Xunit;

namespace B2B.Erp.Api.Tests;

/// <summary>
/// AÇIK → FATURA dönüşümünde montaj bedelinin korunması (2026-09-02 canlı bulgu).
///
/// <para>
/// `InvoicesController` üst bilgi güncellemesinde açık hesap faturası resmi faturaya
/// çevrilirken satır fiyatı F4 tabanından YENİDEN türetilir. Montaj bedeli ayrı bir satır
/// değil, sepette ürünün birim fiyatına katılmış olduğu için bu türetmede siliniyordu:
/// fatura A00000000041302'de sipariş 24.885,71 iken fatura 23.428,57 yazdı.
/// </para>
///
/// <para>
/// Buradaki testler hesabın kendisini sabitler. Fiyatlama kodu denetleyicinin içinde
/// gömülü olduğu için formül birebir yeniden yazılmıştır; testin değeri, DOĞRU SONUCU
/// rakamla çivilemesidir — biri "montajı bölmeden önce ekleyelim" derse kırılır.
/// </para>
/// </summary>
public class AcikFaturaMontajTests
{
    private static decimal KdvyiCikar(decimal fiyat, decimal kdvOrani)
    {
        var payda = 1m + (kdvOrani / 100m);
        return payda <= 0m ? fiyat : fiyat / payda;
    }

    /// <summary>Düzeltilmiş akış: önce KDV çıkarılır, SONRA montajın neti eklenir.</summary>
    private static decimal YeniBirimFiyat(decimal f4Brut, decimal kdvOrani, decimal montajBrut, bool montajVar)
    {
        var fiyat = KdvyiCikar(f4Brut, kdvOrani);
        if (montajVar && montajBrut > 0m) fiyat += KdvyiCikar(montajBrut, kdvOrani);
        return decimal.Round(fiyat, 2, MidpointRounding.AwayFromZero);
    }

    [Fact]
    public void MontajliSatirdaBedelKorunur_CanliOrnek()
    {
        // ST-55GTV4K QLED: katalog (F4) 24.600,00 · KDV %5 · montaj 300,00 (KDV dahil)
        var fiyat = YeniBirimFiyat(24_600m, 5m, 300m, montajVar: true);

        Assert.Equal(23_714.29m, fiyat);

        // ASIL ÖLÇÜT: müşterinin ödeyeceği brüt = katalog + montaj = 24.900,00
        var brut = decimal.Round(fiyat * 1.05m, 2, MidpointRounding.AwayFromZero);
        Assert.Equal(24_900.00m, brut);
    }

    [Fact]
    public void MontajsizSatirDegismez()
    {
        var fiyat = YeniBirimFiyat(24_600m, 5m, 300m, montajVar: false);

        // Canlıda gözlenen ve DOĞRU olan değer; montajsız satır bu düzeltmeden etkilenmez.
        Assert.Equal(23_428.57m, fiyat);
    }

    /// <summary>
    /// Bedeli bölmeden ÖNCE eklemek montajın KDV'sini ikinci kez düşürür. Sepetin
    /// 26.08.2026'da düzelttiği hata tam olarak buydu; dönüşümde tekrarlanmamalı.
    /// </summary>
    [Fact]
    public void BedeliBolmedenOnceEklemekYanlisSonucVerir()
    {
        var yanlis = decimal.Round(KdvyiCikar(24_600m + KdvyiCikar(300m, 5m), 5m), 2, MidpointRounding.AwayFromZero);
        var dogru = YeniBirimFiyat(24_600m, 5m, 300m, montajVar: true);

        Assert.NotEqual(dogru, yanlis);
        Assert.Equal(23_700.68m, yanlis);

        // Yanlış yolun brütü katalog+montaj toplamını TUTTURAMAZ.
        Assert.NotEqual(24_900.00m, decimal.Round(yanlis * 1.05m, 2, MidpointRounding.AwayFromZero));
    }

    [Fact]
    public void MontajBedeliSifirsaFiyatDegismez()
    {
        Assert.Equal(
            YeniBirimFiyat(24_600m, 5m, 0m, montajVar: false),
            YeniBirimFiyat(24_600m, 5m, 0m, montajVar: true));
    }

    /// <summary>KDV %0 (askeriye/muaf) satırda bedel bölünmeden, olduğu gibi eklenir.</summary>
    [Fact]
    public void KdvSifirdaBedelOlduguGibiEklenir()
    {
        var fiyat = YeniBirimFiyat(24_600m, 0m, 300m, montajVar: true);
        Assert.Equal(24_900.00m, fiyat);
    }
}
