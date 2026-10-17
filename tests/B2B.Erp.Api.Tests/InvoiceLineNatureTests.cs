using B2B.Erp.Api.Core.Accounting;

namespace B2B.Erp.Api.Tests;

/// <summary>
/// Fatura satırının MAL/HİZMET ayrımını çiviler (denetim md. E3).
///
/// <para>
/// Korunan şey 600 / 600.20 kırılımı: aynı faturadaki parça satırı ile işçilik satırı farklı
/// hesaba gitmek zorunda. Buradaki bir kayma, KDV beyanını değil ama gelir tablosunu bozar.
/// </para>
/// </summary>
public sealed class InvoiceLineNatureTests
{
    [Fact]
    public void UrunKarti_Olan_Satir_MALdir()
    {
        Assert.Equal(InvoiceLineNature.Goods, InvoiceLineNatureResolver.Resolve("SEG53031", "URUN"));
    }

    [Fact]
    public void YedekParca_Da_MALdir()
    {
        // Yedek parça bir hizmet değil, satılan bir maldır — 600'e gider.
        Assert.Equal(InvoiceLineNature.Goods, InvoiceLineNatureResolver.Resolve("YP-1001", "YEDEKPARCA"));
    }

    [Fact]
    public void UrunKarti_Olmayan_Satir_HIZMETtir()
    {
        // `productType == null` = stok kartı yok. Serbest metinle girilen işçilik satırı.
        Assert.Equal(InvoiceLineNature.Service, InvoiceLineNatureResolver.Resolve("HİZ-TAMİR", null));
    }

    [Theory]
    [InlineData("HIZMET")]
    [InlineData("HİZMET")]
    [InlineData("hizmet")]
    [InlineData("SERVIS")]
    public void HizmetTipli_UrunKarti_HIZMETtir(string productType)
    {
        Assert.Equal(InvoiceLineNature.Service, InvoiceLineNatureResolver.Resolve("ISCILIK", productType));
    }

    [Fact]
    public void BosStokKodu_HIZMETtir()
    {
        // Stok kodu olmayan satır bir mal olamaz; deftere mal diye yazılması yanlış olurdu.
        Assert.Equal(InvoiceLineNature.Service, InvoiceLineNatureResolver.Resolve("   ", "URUN"));
    }

    [Fact]
    public void HesapKodu_Karsiliklari()
    {
        Assert.Equal("600", InvoiceLineNatureResolver.ToRevenueAccountCode(InvoiceLineNature.Goods));
        Assert.Equal("600.20", InvoiceLineNatureResolver.ToRevenueAccountCode(InvoiceLineNature.Service));

        // Damgalanmamış eski satır mal SAYILMAZ diye 600'e düşer; aktarım modülü bu satırları
        // "çözülmedi" olarak ayıklamalı — varsayılan değere güvenip defterlememeli.
        Assert.Equal("600", InvoiceLineNatureResolver.ToRevenueAccountCode(InvoiceLineNature.Unspecified));
    }
}
