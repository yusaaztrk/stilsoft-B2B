using B2B.Erp.Api.Core.Enums;
using B2B.Erp.Api.Core.Helpers;
using Xunit;

namespace B2B.Erp.Api.Tests;

/// <summary>
/// Kampanya indirimi Fiyat 4'e uygulanır, carinin grubuna formülle taşınır.
///
/// Kullanıcının örneği (2026-09-18): "5.000 indirim Fiyat 4 üzerinden; 26.000'lik klima
/// 21.000'e düştü, diğer fiyatlar ona göre hesaplanacak." Buradaki beklenenler o örnekten,
/// üç firmada ortak olan 1-6 formülleriyle türetildi (KDV %20, iskonto %10).
/// </summary>
public sealed class CampaignCatalogDiscountTests
{
    private const decimal F4 = 26000m;

    // 5.000 TL'lik tutar indirimi: grup 4'te 5.000, diğer gruplarda formülün taşıdığı kadar.
    [Theory]
    [InlineData("F4", 5000.00)]                                  // 26.000 → 21.000
    [InlineData("REMOVE_KDV(F4)", 4166.67)]                      // 21.666,67 → 17.500
    [InlineData("REMOVE_KDV(F4*0.88)", 3666.67)]                 // 19.066,67 → 15.400
    [InlineData("F4*0.88", 4400.00)]                             // 22.880 → 18.480
    [InlineData("F4*(1-DISCOUNT/100)", 4500.00)]                 // 23.400 → 18.900
    [InlineData("REMOVE_KDV(F4*(1-DISCOUNT/100))", 3750.00)]     // 19.500 → 15.750
    public void TutarIndirimiFormulleTasinir(string formula, decimal beklenen)
    {
        var sonuc = CampaignCatalogDiscount.UnitDiscount(F4, formula, taxRate: 20m, discountRate: 10m, IskontoTipi.Tutar, 5000m);

        Assert.NotNull(sonuc);
        Assert.Equal(beklenen, sonuc!.Value);
    }

    // Oran indirimi: doğrusal formüllerde grup fiyatının aynı yüzdesi.
    [Theory]
    [InlineData("F4", 2600.00)]
    [InlineData("REMOVE_KDV(F4)", 2166.67)]
    [InlineData("REMOVE_KDV(F4*0.88)", 1906.67)]
    public void OranIndirimiGrupFiyatininYuzdesi(string formula, decimal beklenen)
    {
        var sonuc = CampaignCatalogDiscount.UnitDiscount(F4, formula, taxRate: 20m, discountRate: 10m, IskontoTipi.Oran, 10m);

        Assert.NotNull(sonuc);
        Assert.Equal(beklenen, sonuc!.Value);
    }

    // Formül boşsa taban grup sayılır: fark indirimin kendisidir.
    [Fact]
    public void FormulBossaF4Sayilir()
    {
        Assert.Equal(5000m, CampaignCatalogDiscount.UnitDiscount(F4, null, 20m, 0m, IskontoTipi.Tutar, 5000m));
        Assert.Equal(5000m, CampaignCatalogDiscount.UnitDiscount(F4, "   ", 20m, 0m, IskontoTipi.Tutar, 5000m));
    }

    // DEMO'ya özel sabit düşüşlü formül: fark yine tam taşınır, eksiye düşerse grup fiyatı sıfır.
    [Fact]
    public void SabitDususluFormul()
    {
        Assert.Equal(5000m, CampaignCatalogDiscount.UnitDiscount(F4, "F4-400", 20m, 0m, IskontoTipi.Tutar, 5000m));
        // 1.000 TL'lik ürün, F4-400 → 600; 800 indirim → indirimli F4 200, formül -200 → 0. Fark 600.
        Assert.Equal(600m, CampaignCatalogDiscount.UnitDiscount(1000m, "F4-400", 20m, 0m, IskontoTipi.Tutar, 800m));
    }

    // İndirim F4'ten büyükse grup fiyatı sıfıra iner; fark, grup fiyatının tamamıdır.
    [Fact]
    public void IndirimKatalogFiyatiniAsarsaTamami()
    {
        Assert.Equal(21666.67m, CampaignCatalogDiscount.UnitDiscount(F4, "REMOVE_KDV(F4)", 20m, 0m, IskontoTipi.Tutar, 30000m));
    }

    // Hesaplanamayan hâller: F4 yok, değer yok, bozuk formül → null (çağıran eski hesaba döner).
    [Fact]
    public void HesaplanamayanHallerNull()
    {
        Assert.Null(CampaignCatalogDiscount.UnitDiscount(0m, "F4", 20m, 0m, IskontoTipi.Tutar, 5000m));
        Assert.Null(CampaignCatalogDiscount.UnitDiscount(F4, "F4", 20m, 0m, IskontoTipi.Tutar, 0m));
        Assert.Null(CampaignCatalogDiscount.UnitDiscount(F4, "F4 +", 20m, 0m, IskontoTipi.Tutar, 5000m));
    }
}
