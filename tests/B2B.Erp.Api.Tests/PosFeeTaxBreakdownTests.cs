using B2B.Erp.Api.Core.Helpers;

namespace B2B.Erp.Api.Tests;

/// <summary>
/// POS komisyonunun BSMV/KDV ayrıştırmasını çiviler (denetim md. A4).
///
/// <para>
/// Buradaki asıl korunan şey <b>para hareketinin değişmemesi</b>: bankanın hesaptan çektiği
/// brüt tutar sabittir, ayrıştırma yalnızca o tutarın içini açıklar. Üç bileşenin toplamı
/// brütten bir kuruş bile sapamaz — saparsa banka bakiyesi ile gider kaydı ayrışır.
/// </para>
/// </summary>
public sealed class PosFeeTaxBreakdownTests
{
    [Fact]
    public void OranGirilmezse_AyristirmaYapilmaz()
    {
        // Kullanıcı oran girmediyse bir şey uydurulmaz: eski davranış birebir korunur.
        var r = PosFeeTaxBreakdown.Split(1000m, 0m, 0m);

        Assert.Equal(1000m, r.Net);
        Assert.Equal(0m, r.BsmvAmount);
        Assert.Equal(0m, r.VatAmount);
    }

    [Fact]
    public void BsmvVeKdv_DisaridanIceriSoyulur()
    {
        // 100 komisyon → +%5 BSMV = 105 → +%20 KDV = 126. Brütten geri giderken aynı yere.
        var r = PosFeeTaxBreakdown.Split(126m, 5m, 20m);

        Assert.Equal(100m, r.Net);
        Assert.Equal(5m, r.BsmvAmount);
        Assert.Equal(21m, r.VatAmount);
    }

    [Fact]
    public void SadeceKdv_BsmvSifirKalir()
    {
        var r = PosFeeTaxBreakdown.Split(120m, 0m, 20m);

        Assert.Equal(100m, r.Net);
        Assert.Equal(0m, r.BsmvAmount);
        Assert.Equal(20m, r.VatAmount);
    }

    [Fact]
    public void SadeceBsmv_KdvSifirKalir()
    {
        var r = PosFeeTaxBreakdown.Split(105m, 5m, 0m);

        Assert.Equal(100m, r.Net);
        Assert.Equal(5m, r.BsmvAmount);
        Assert.Equal(0m, r.VatAmount);
    }

    [Theory]
    [InlineData(126)]
    [InlineData(37.77)]
    [InlineData(0.03)]
    [InlineData(999999.99)]
    [InlineData(1)]
    public void ToplamDaimaBrutuVerir_YuvarlamaArtigiKaybolmaz(double brutRaw)
    {
        // Kuruş artığı net tarafa yazılır; toplam hesaptan düşen tutarla birebir tutmalı.
        var brut = (decimal)brutRaw;
        var r = PosFeeTaxBreakdown.Split(brut, 5m, 20m);

        Assert.Equal(decimal.Round(brut, 2, MidpointRounding.AwayFromZero),
            r.Net + r.BsmvAmount + r.VatAmount);
    }

    [Fact]
    public void SifirVeNegatifBrut_HicbirSeyUretmez()
    {
        Assert.Equal(new PosFeeTaxBreakdown.Result(0m, 0m, 0m), PosFeeTaxBreakdown.Split(0m, 5m, 20m));
        Assert.Equal(new PosFeeTaxBreakdown.Result(0m, 0m, 0m), PosFeeTaxBreakdown.Split(-10m, 5m, 20m));
    }

    [Fact]
    public void NegatifOran_YokSayilir_TutarBozulmaz()
    {
        // Hatalı bir oran yüzünden gider tutarının bozulmasındansa ayrıştırma yapılmaması yeğdir.
        var r = PosFeeTaxBreakdown.Split(500m, -5m, -20m);

        Assert.Equal(500m, r.Net);
        Assert.Equal(0m, r.BsmvAmount);
        Assert.Equal(0m, r.VatAmount);
    }
}
