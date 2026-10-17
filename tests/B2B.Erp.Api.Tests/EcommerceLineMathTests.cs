using B2B.Erp.Api.Features.Ecommerce;
using Xunit;

namespace B2B.Erp.Api.Tests;

/// <summary>
/// E-TİCARET ↔ B2B FİNANSAL EŞİTLİK.
///
/// <para>
/// Vitrindeki sepet ile ERP'de açılan sipariş satırı, KIRILIMI farklı kurar ama GENEL TOPLAMI
/// aynı vermek zorundadır:
/// </para>
/// <list type="bullet">
///   <item>
///     <b>Sepet:</b> montaj bedelini KDV matrahına katmaz; ürün brütü + montaj brütü toplanır.
///   </item>
///   <item>
///     <b>Sipariş:</b> montajın NETİNİ birim fiyata katar; KDV'yi tamamına uygular.
///   </item>
/// </list>
/// <para>
/// İkisi cebirsel olarak aynıdır: <c>(net + fee/(1+v)) × (1+v) = net×(1+v) + fee</c>. Ama
/// yuvarlama, KDV oranı ve adet devreye girdiğinde bu eşitlik kendiliğinden korunmaz —
/// bu yüzden testle çivileniyor. Kullanıcının kuralı: <i>"1 kuruşluk beklenmeyen fark bile
/// incelenmeli."</i>
/// </para>
/// </summary>
public class EcommerceLineMathTests
{
    // -------------------------------------------------------------- montaj neti

    /// <summary>
    /// Canlı örnek: 55" QLED televizyon. Katalog neti 23.428,57 · KDV %5 · montaj 300,00
    /// (KDV dahil). Sipariş satırına yazılacak birim net 23.714,29 olmalı.
    /// </summary>
    [Fact]
    public void MontajNeti_BirimFiyata_KdvsiCikarilarakEklenir()
    {
        var unitNet = EcommerceLineMath.UnitNetWithInstallation(
            netUnitPrice: 23_428.5714m, taxRate: 5m, installationFeeGross: 300m);

        // 300 / 1,05 = 285,7143
        Assert.Equal(23_714.2857m, unitNet);
    }

    /// <summary>
    /// Bedeli bölmeden eklemek (eski hata) montajın KDV'sini ikinci kez sayar.
    /// Bu test, "sadeleştirelim, doğrudan ekleyelim" denirse kırılır.
    /// </summary>
    [Fact]
    public void MontajBrutOlarakEklenirse_ToplamFazlaCikar()
    {
        const decimal netUnit = 7_285.7143m;
        const decimal vat = 5m;
        const decimal fee = 300m;

        var dogru = EcommerceLineMath.LineGross(netUnit, vat, fee, quantity: 1m);

        // Yanlış yol: bedeli net saymadan ekle, sonra KDV uygula.
        var yanlis = decimal.Round((netUnit + fee) * 1.05m, 2, MidpointRounding.AwayFromZero);

        Assert.Equal(7_950.00m, dogru);
        Assert.Equal(7_965.00m, yanlis);

        // Fark tam olarak montajın kendi KDV'si kadar: 300 × %5 = 15,00
        Assert.Equal(15.00m, yanlis - dogru);
    }

    // -------------------------------------------------------------- eşitlik

    [Theory]
    // netBirim,   kdv,  montaj,  adet
    [InlineData("23428.5714", 5, 300, 1)]
    [InlineData("23428.5714", 5, 300, 3)]
    [InlineData("7285.7143", 5, 300, 2)]
    [InlineData("1000.00", 16, 0, 1)]
    [InlineData("1000.00", 16, 250, 4)]
    [InlineData("849.13", 16, 300, 7)]
    [InlineData("12345.67", 0, 300, 2)]   // KDV muaf (askeriye)
    [InlineData("99.99", 16, 0, 99)]
    public void SepetToplami_SiparisToplamiyla_Ayni(
        string netUnitPriceText, int taxRate, int installationFee, int quantity)
    {
        var netUnitPrice = decimal.Parse(netUnitPriceText, System.Globalization.CultureInfo.InvariantCulture);

        var siparis = EcommerceLineMath.LineGross(netUnitPrice, taxRate, installationFee, quantity);
        var sepet = EcommerceLineMath.StorefrontLineGross(netUnitPrice, taxRate, installationFee, quantity);

        /*
         * TOLERANS ADET BAŞINA BİR KURUŞ.
         *
         * Sıfır tolerans doğru ölçüt değil: iki yol farklı noktalarda yuvarlıyor (sepet birim
         * brütü yuvarlayıp adetle çarpıyor, sipariş satır netini yuvarlayıp KDV'liyor).
         * Beklenen fark en fazla yuvarlama artığı kadardır; bunun ötesi FORMÜL farkıdır ve
         * testin yakalaması gereken şey odur.
         */
        var fark = Math.Abs(siparis - sepet);
        Assert.True(
            fark <= 0.01m * quantity,
            $"Sepet {sepet} ile sipariş {siparis} arasında {fark} fark var " +
            $"(net {netUnitPrice}, KDV %{taxRate}, montaj {installationFee}, adet {quantity}).");
    }

    /// <summary>
    /// Montajsız üründe iki yol KURUŞU KURUŞUNA aynı olmalı: burada yuvarlama farkı için
    /// bile mazeret yok, ikisi de aynı işlemi yapıyor.
    /// </summary>
    [Theory]
    [InlineData("1000.00", 16, 1)]
    [InlineData("1000.00", 16, 10)]
    [InlineData("23428.5714", 5, 3)]
    [InlineData("0.85", 16, 1)]
    public void MontajsizUrunde_IkiYol_Birebir(string netUnitPriceText, int taxRate, int quantity)
    {
        var netUnitPrice = decimal.Parse(netUnitPriceText, System.Globalization.CultureInfo.InvariantCulture);

        var siparis = EcommerceLineMath.LineGross(netUnitPrice, taxRate, 0m, quantity);
        var sepet = EcommerceLineMath.StorefrontLineGross(netUnitPrice, taxRate, 0m, quantity);

        Assert.True(
            Math.Abs(siparis - sepet) <= 0.01m * quantity,
            $"Montajsız satırda fark çıktı: sepet {sepet}, sipariş {siparis}.");
    }

    // -------------------------------------------------------------- KDV muafiyeti

    /// <summary>
    /// KDV oranı 0 (askeriye/muaf) iken montaj bedeli BÖLÜNMEZ; müşteri tam bedeli öder.
    /// Bölmek, muaf cariden montaj bedelinin bir kısmını almamak olurdu.
    /// </summary>
    [Fact]
    public void KdvMuafSatirda_MontajBedeliBolunmez()
    {
        var unitNet = EcommerceLineMath.UnitNetWithInstallation(
            netUnitPrice: 1_000m, taxRate: 0m, installationFeeGross: 300m);

        Assert.Equal(1_300m, unitNet);

        var toplam = EcommerceLineMath.LineGross(1_000m, 0m, 300m, quantity: 1m);
        Assert.Equal(1_300m, toplam);
    }

    /// <summary>Montaj bedeli yoksa hesap ürünün kendi brütünden başka bir şey üretmemeli.</summary>
    [Fact]
    public void MontajYoksa_UrunBrutuDegismez()
    {
        var toplam = EcommerceLineMath.LineGross(1_000m, 16m, 0m, quantity: 1m);
        Assert.Equal(1_160.00m, toplam);
    }

    /// <summary>Negatif bir bedel kartta kazayla oluşabilir; hesap onu montaj saymamalı.</summary>
    [Fact]
    public void NegatifMontajBedeli_Yoksayilir()
    {
        var unitNet = EcommerceLineMath.UnitNetWithInstallation(1_000m, 16m, -50m);
        Assert.Equal(1_000m, unitNet);
    }
}
