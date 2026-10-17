using B2B.Erp.Api.Core.Enums;
using B2B.Erp.Api.Features.Ecommerce;
using Xunit;

namespace B2B.Erp.Api.Tests;

/// <summary>
/// E-ticaret siparişindeki kampanya indirimi vitrinle (Shop.Api CampaignPricing) aynı sayıyı
/// vermeli: KDV dahil fark = F4 − F4'. Kapsam kuralı B2B rozetiyle aynı.
/// </summary>
public sealed class EcommerceCampaignPricingTests
{
    private static EcommerceCampaignPricing.LiveDiscount Row(
        string? stock = null, string? group = null, IskontoTipi tip = IskontoTipi.Oran, decimal value = 10m,
        KampanyaTipi type = KampanyaTipi.UrunIndirimi, string[]? condStocks = null, string[]? condCats = null,
        string? brandField = null, string? brandCode = null)
        => new("QA", type, stock, group, tip, value, condStocks ?? Array.Empty<string>(), condCats ?? Array.Empty<string>(), brandField, brandCode);

    private static readonly EcommerceCampaignPricing.ProductFacts Klima =
        new("SBE92002", 42000m, "BYZ-ESYA", "KLIMA", "KAMP", "KAMP:1");

    [Fact]
    public void OranIndirimiF4Uzerinden()
    {
        var d = EcommerceCampaignPricing.GrossUnitDiscount(Klima, new[] { Row(stock: "SBE92002") }, out var name);
        Assert.Equal(4200m, d);   // 42.000 × %10
        Assert.Equal("QA", name);
    }

    [Fact]
    public void TutarIndirimiF4Uzerinden()
    {
        var d = EcommerceCampaignPricing.GrossUnitDiscount(Klima, new[] { Row(stock: "SBE92002", tip: IskontoTipi.Tutar, value: 5000m) }, out _);
        Assert.Equal(5000m, d);   // 42.000 → 37.000
    }

    [Fact]
    public void UrunluSatirBaskaUrunuKapsamaz()
    {
        var komsu = Klima with { StockCode = "61516G" };
        // Satırda stok kodu var + grup kodu da dolu (eski tip kayıt): grup yayılmaz.
        var d = EcommerceCampaignPricing.GrossUnitDiscount(komsu, new[] { Row(stock: "SBE92002", group: "BYZ-ESYA") }, out _);
        Assert.Equal(0m, d);
    }

    [Fact]
    public void KategoriIndirimiKategoriyiKapsar()
    {
        var rows = new[] { Row(group: "BYZ-ESYA", type: KampanyaTipi.KategoriMarkaIndirimi, tip: IskontoTipi.Tutar, value: 1000m) };
        Assert.Equal(1000m, EcommerceCampaignPricing.GrossUnitDiscount(Klima, rows, out _));
        Assert.Equal(0m, EcommerceCampaignPricing.GrossUnitDiscount(Klima with { MainKey = "MOBILYA", SubKey = "BAZA" }, rows, out _));
    }

    [Fact]
    public void MarkaSuzgeciKod4()
    {
        var rows = new[] { Row(type: KampanyaTipi.KategoriMarkaIndirimi, condCats: new[] { "BYZ-ESYA" }, brandField: "KOD4", brandCode: "KAMP") };
        Assert.Equal(4200m, EcommerceCampaignPricing.GrossUnitDiscount(Klima, rows, out _));
        Assert.Equal(0m, EcommerceCampaignPricing.GrossUnitDiscount(Klima with { Kod4 = "BASKA" }, rows, out _));
    }

    [Fact]
    public void BirdenCokKampanyadaMusteriLehine()
    {
        var rows = new[] { Row(stock: "SBE92002", value: 5m), Row(stock: "SBE92002", tip: IskontoTipi.Tutar, value: 5000m) };
        Assert.Equal(5000m, EcommerceCampaignPricing.GrossUnitDiscount(Klima, rows, out _));
    }

    [Fact]
    public void F4YoksaIndirimYok()
    {
        Assert.Equal(0m, EcommerceCampaignPricing.GrossUnitDiscount(Klima with { CatalogPrice = null }, new[] { Row(stock: "SBE92002") }, out _));
    }
}
