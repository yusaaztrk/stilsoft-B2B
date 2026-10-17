using B2B.Erp.Api.Core.Helpers;
using Xunit;

namespace B2B.Erp.Api.Tests;

/// <summary>
/// `PriceGroups.Formula` değerlendiricisi.
///
/// Beklenen sonuçlar EKRANDAKİ hesapla aynı olmak zorunda: ürünü tek tek düzenlemekle toplu
/// güncellemek farklı fiyat üretirse kimse fark etmez, fiyatlar sessizce ayrışır.
/// Buradaki formüller üç firmanın veritabanından birebir alındı.
/// </summary>
public sealed class PriceFormulaEvaluatorTests
{
    // 140*200 TIMIDO BAZA: F4 = 14.500, KDV 10, iskonto 20 — ekrandaki değerlerle doğrulandı.
    [Theory]
    [InlineData("F4", 14500.00)]
    [InlineData("REMOVE_KDV(F4)", 13181.82)]
    [InlineData("REMOVE_KDV(F4*0.88)", 11600.00)]
    [InlineData("F4*0.88", 12760.00)]
    [InlineData("F4*(1-DISCOUNT/100)", 11600.00)]
    [InlineData("REMOVE_KDV(F4*(1-DISCOUNT/100))", 10545.45)]
    public void YatakUrunuFormulleri(string formula, decimal beklenen)
    {
        var sonuc = PriceFormulaEvaluator.Evaluate(formula, 14500m, taxRate: 10m, discountRate: 20m);

        Assert.NotNull(sonuc);
        Assert.Equal(beklenen, decimal.Round(sonuc!.Value, 2, MidpointRounding.AwayFromZero));
    }

    // TV: KDV 5, iskonto 15 — KDV'si farklı bir üründe bölenin değiştiğini doğrular.
    [Theory]
    [InlineData("REMOVE_KDV(F4)", 10380.95)]
    [InlineData("F4*(1-DISCOUNT/100)", 9265.00)]
    [InlineData("REMOVE_KDV(F4*(1-DISCOUNT/100))", 8823.81)]
    public void FarkliKdvVeIskonto(string formula, decimal beklenen)
    {
        var sonuc = PriceFormulaEvaluator.Evaluate(formula, 10900m, taxRate: 5m, discountRate: 15m);

        Assert.NotNull(sonuc);
        Assert.Equal(beklenen, decimal.Round(sonuc!.Value, 2, MidpointRounding.AwayFromZero));
    }

    // DEMO'nun firmaya özel grupları — "7 = Fiyat 3" varsayımının neden yanlış olduğunu tutar.
    [Fact]
    public void SabitIndirimliFirmayaOzelFormuller()
    {
        Assert.Equal(9700m, PriceFormulaEvaluator.Evaluate("F4-400", 10100m, 10m, 20m));
        Assert.Equal(9500m, PriceFormulaEvaluator.Evaluate("F4-600", 10100m, 10m, 20m));

        // REMOVE_KDV(F4*(1-DISCOUNT/100)-300) = (10100*0.8 - 300) / 1.1
        var sonuc = PriceFormulaEvaluator.Evaluate("REMOVE_KDV(F4*(1-DISCOUNT/100)-300)", 10100m, 10m, 20m);
        Assert.NotNull(sonuc);
        Assert.Equal(7072.73m, decimal.Round(sonuc!.Value, 2, MidpointRounding.AwayFromZero));
    }

    [Fact]
    public void KdvSifirsaBolenBire_Duser()
    {
        Assert.Equal(1000m, PriceFormulaEvaluator.Evaluate("REMOVE_KDV(F4)", 1000m, taxRate: 0m, discountRate: 0m));
    }

    /// <summary>
    /// Bozuk ya da boş formül fiyat YAZDIRMAZ — grup atlanır, eski fiyat korunur.
    /// Aksi halde tek bir yazım hatası bütün ürünlerin o grubunu sıfırlardı.
    /// </summary>
    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("F4 * ")]
    [InlineData("REMOVE_KDV(F4")]
    [InlineData("BILINMEYEN(F4)")]
    [InlineData("F4 + BILINMEYENDEGISKEN")]
    [InlineData("F4/0")]
    public void GecersizFormulNullDoner(string? formula)
    {
        Assert.Null(PriceFormulaEvaluator.Evaluate(formula, 1000m, 10m, 20m));
    }

    /// <summary>Sıfır/negatif sonuç yazılmaz: eksi fiyat yerine gruba dokunulmaz.</summary>
    [Theory]
    [InlineData("F4-400", 400)]
    [InlineData("F4-600", 100)]
    public void NegatifVeyaSifirSonucYazilmaz(string formula, double f4)
    {
        Assert.Null(PriceFormulaEvaluator.Evaluate(formula, (decimal)f4, 10m, 20m));
    }

    /// <summary>İşlem önceliği ve parantez — çarpma toplamadan önce gelmeli.</summary>
    [Fact]
    public void IslemOnceligiDogru()
    {
        Assert.Equal(1200m, PriceFormulaEvaluator.Evaluate("F4+100*2", 1000m, 0m, 0m));
        Assert.Equal(2200m, PriceFormulaEvaluator.Evaluate("(F4+100)*2", 1000m, 0m, 0m));
        Assert.Equal(900m, PriceFormulaEvaluator.Evaluate("F4-100", 1000m, 0m, 0m));
    }

    /// <summary>İskonto 0-100 aralığına kırpılır; bozuk veri fiyatı ters çeviremez.</summary>
    [Fact]
    public void IskontoAraligaKirpilir()
    {
        Assert.Equal(1000m, PriceFormulaEvaluator.Evaluate("F4*(1-DISCOUNT/100)", 1000m, 0m, discountRate: -50m));
        Assert.Null(PriceFormulaEvaluator.Evaluate("F4*(1-DISCOUNT/100)", 1000m, 0m, discountRate: 150m));
    }
}
