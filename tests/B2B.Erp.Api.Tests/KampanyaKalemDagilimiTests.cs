using B2B.Erp.Api.Core.Accounting;
using Xunit;

namespace B2B.Erp.Api.Tests;

/// <summary>
/// Siparişten gelen kampanyalı faturada basımın KDV kırılımı (2026-09-30).
///
/// Başlık rakamları satış faturasının KENDİ hesabıyla üretiliyor (kalem kampanyası brütten ve
/// kendi oranıyla KDV'den düşer, kalan iskonto <see cref="InvoiceDiscountMath"/> ile). Test,
/// kırılımın bu başlığı kuruşu kuruşuna tutturduğunu ve eski faturalara dokunmadığını söylüyor.
/// </summary>
public class KampanyaKalemDagilimiTests
{
    private static decimal R(decimal v) => decimal.Round(v, 2, MidpointRounding.AwayFromZero);

    /// <summary>Satış faturasının yeni hesabı: kalem kampanyası kendi kaleminden, kalan iskonto KDV dahil.</summary>
    private static InvoiceDiscountMath.Sonuc YeniBaslik(IReadOnlyList<KampanyaKalemDagilimi.Kalem> kalemler, decimal kdvDahilIskonto)
    {
        var brut = kalemler.Sum(k => k.Tutar);
        var kdv = kalemler.Sum(k => k.Tutar * k.KdvOrani / 100m);
        var kampanya = kalemler.Sum(k => k.Kampanya);
        var kampanyaKdv = kalemler.Sum(k => k.Kampanya * k.KdvOrani / 100m);
        return InvoiceDiscountMath.Hesapla(brut - kampanya, kdv - kampanyaKdv, kdvDahilIskonto);
    }

    /// <summary>Basımın yaptığı gibi: kalem matrahı ve KDV'si ayrı yuvarlanır.</summary>
    private static decimal KirilimKdv(IReadOnlyList<KampanyaKalemDagilimi.Kalem> kalemler, IReadOnlyList<decimal> indirimler)
        => kalemler.Select((k, i) => R(R(k.Tutar - indirimler[i]) * k.KdvOrani / 100m)).Sum();

    [Fact]
    public void TekOranliFatura_DokunulmazKiriLimEskisiGibi()
    {
        // A00000000072141'in yeni hesapla kesilmiş hâli: 19.809,52 %5, kampanya 3.809,52 → 16.800,00
        var kalemler = new[] { new KampanyaKalemDagilimi.Kalem(19809.52m, 3809.52m, 5m) };
        var baslik = YeniBaslik(kalemler, 0m);

        Assert.Equal(16800.00m, baslik.GenelToplam);
        Assert.Null(KampanyaKalemDagilimi.KalemIndirimleri(kalemler, baslik.NetToplam, baslik.KdvToplam));
    }

    [Fact]
    public void EskiHesaplaKesilmisFatura_Dokunulmaz()
    {
        // A00000000072141 canlıdaki hâliyle (kampanya KDV dahil sayılmış): net 16.181,41 · KDV 809,07
        var kalemler = new[] { new KampanyaKalemDagilimi.Kalem(19809.52m, 3809.52m, 5m) };
        Assert.Null(KampanyaKalemDagilimi.KalemIndirimleri(kalemler, 16181.41m, 809.07m));
    }

    [Fact]
    public void CokOranliEskiFatura_OrantiliBaslik_Dokunulmaz()
    {
        // Eski hesap: kampanya dahil her şey belgenin geneline orantılı yayılmış.
        var kalemler = new[]
        {
            new KampanyaKalemDagilimi.Kalem(10000m, 1000m, 16m),
            new KampanyaKalemDagilimi.Kalem(10000m, 0m, 5m)
        };
        var eski = InvoiceDiscountMath.Hesapla(20000m, 2100m, 1000m);
        Assert.Null(KampanyaKalemDagilimi.KalemIndirimleri(kalemler, eski.NetToplam, eski.KdvToplam));
    }

    [Fact]
    public void CokOranliYeniFatura_KirilimBaslikKdvsiniTutar()
    {
        // %16'lık 10.000 (1.000 kampanya) + %5'lik 10.000 (montaj gibi) → başlık KDV 1.940,00
        var kalemler = new[]
        {
            new KampanyaKalemDagilimi.Kalem(10000m, 1000m, 16m),
            new KampanyaKalemDagilimi.Kalem(10000m, 0m, 5m)
        };
        var baslik = YeniBaslik(kalemler, 0m);
        Assert.Equal(19000.00m, baslik.NetToplam);
        Assert.Equal(1940.00m, baslik.KdvToplam);

        // Eski orantılı kırılım 9.500 × %16 + 9.500 × %5 = 1.995,00 basıyordu (TOPLAM K.D.V. ile çelişki).
        var indirimler = KampanyaKalemDagilimi.KalemIndirimleri(kalemler, baslik.NetToplam, baslik.KdvToplam);
        Assert.NotNull(indirimler);
        Assert.Equal(1000.00m, R(indirimler![0]));
        Assert.Equal(0.00m, R(indirimler[1]));
        Assert.Equal(baslik.KdvToplam, KirilimKdv(kalemler, indirimler));
    }

    [Theory]
    [InlineData(500)]
    [InlineData(1234.56)]
    [InlineData(20000)]
    public void CokOranliYeniFatura_ElleIskontoyla_KirilimBaslikiTutar(double elleIskonto)
    {
        var kalemler = new[]
        {
            new KampanyaKalemDagilimi.Kalem(24999.99m, 3809.52m, 5m),
            new KampanyaKalemDagilimi.Kalem(1500.00m, 0m, 16m),
            new KampanyaKalemDagilimi.Kalem(849.15m, 120.00m, 10m),
            new KampanyaKalemDagilimi.Kalem(0.01m, 0m, 16m) // hediye kalemi (0,01)
        };
        var baslik = YeniBaslik(kalemler, (decimal)elleIskonto);

        var indirimler = KampanyaKalemDagilimi.KalemIndirimleri(kalemler, baslik.NetToplam, baslik.KdvToplam);
        Assert.NotNull(indirimler);

        var netler = kalemler.Select((k, i) => k.Tutar - indirimler![i]).ToList();
        Assert.True(Math.Abs(netler.Sum() - baslik.NetToplam) <= 0.01m, $"net {netler.Sum()} ≠ {baslik.NetToplam}");
        Assert.True(Math.Abs(KirilimKdv(kalemler, indirimler!) - baslik.KdvToplam) <= 0.04m,
            $"kırılım {KirilimKdv(kalemler, indirimler!)} ≠ TOPLAM KDV {baslik.KdvToplam}");

        // Kampanyalı kalem kampanyasını tam alır; kampanyasız kalem yalnız elle iskontodan pay alır.
        Assert.True(indirimler![0] >= 3809.52m - 0.01m);
        Assert.True(indirimler[1] >= 0m && indirimler[1] < 1500.00m);
    }

    [Fact]
    public void KdvsizCari_Dokunulmaz()
    {
        // KDV'siz caride başlık KDV'si 0; kalemlerde oran yazılı olsa da kırılım uydurulmaz.
        var kalemler = new[]
        {
            new KampanyaKalemDagilimi.Kalem(10000m, 1000m, 16m),
            new KampanyaKalemDagilimi.Kalem(10000m, 0m, 5m)
        };
        Assert.Null(KampanyaKalemDagilimi.KalemIndirimleri(kalemler, 19000m, 0m));
    }

    [Fact]
    public void KampanyasizFatura_Dokunulmaz()
    {
        var kalemler = new[]
        {
            new KampanyaKalemDagilimi.Kalem(10000m, 0m, 16m),
            new KampanyaKalemDagilimi.Kalem(10000m, 0m, 5m)
        };
        Assert.Null(KampanyaKalemDagilimi.KalemIndirimleri(kalemler, 19000m, 1995m));
    }

    [Fact]
    public void SonradanDegismisBaslik_HicbiriTutmuyorsa_Dokunulmaz()
    {
        var kalemler = new[]
        {
            new KampanyaKalemDagilimi.Kalem(10000m, 1000m, 16m),
            new KampanyaKalemDagilimi.Kalem(10000m, 0m, 5m)
        };
        // Ne orantılı (1.995,00) ne kalem bazlı (1.940,00): elle değiştirilmiş bir başlık.
        Assert.Null(KampanyaKalemDagilimi.KalemIndirimleri(kalemler, 19000m, 1700m));
    }
}
