using B2B.Erp.Api.Features.Uploads;

namespace B2B.Erp.Api.Tests;

/// <summary>
/// Yetim dosya temizliğinin eşleşme mantığını çiviler (denetim md. E5).
///
/// <para>
/// Korunan şey tek: <b>kayıtta adı geçen dosya asla yetim sayılmamalı</b>. Buradaki bir
/// kaçırma, hâlâ ekranda görünen bir ürün resminin silinmesi demektir — geri dönüşü yok.
/// Bu yüzden testler "fazla yakalıyor mu" diye değil, "kaçırıyor mu" diye bakar.
/// </para>
/// </summary>
public sealed class OrphanUploadScannerTests
{
    [Fact]
    public void MutlakUrl_DosyaAdiniVerir()
    {
        // Yükleme uçları mutlak URL döndürüyor; kayıtta duran biçim budur.
        var names = OrphanUploadScanner.ExtractFileNames(
            "https://erp.firma.com/uploads/images/9f1c2d3e4a5b6c7d8e9f0a1b2c3d4e5f.webp");

        Assert.Contains("9f1c2d3e4a5b6c7d8e9f0a1b2c3d4e5f.webp", names);
    }

    [Fact]
    public void GoreliUrl_DosyaAdiniVerir()
    {
        // Ürün resmi ucu göreli yol yazıyor (`/uploads/products/...`); ikisi de kayıtta var.
        var names = OrphanUploadScanner.ExtractFileNames("/uploads/products/abc123.webp");

        Assert.Contains("abc123.webp", names);
    }

    [Fact]
    public void JsonDizi_ButunAdlariVerir()
    {
        // `ImageUrlsJson` bir JSON dizi; tek bir adı kaçırmak o resmi siler.
        var names = OrphanUploadScanner.ExtractFileNames(
            "[\"/uploads/products/bir.webp\",\"https://eski-alan-adi.com/uploads/products/iki.webp\",\"/uploads/products/uc.webp\"]");

        Assert.Contains("bir.webp", names);
        Assert.Contains("iki.webp", names);
        Assert.Contains("uc.webp", names);

        // Süzgeç alan adını da ("eski-alan-adi.com") dosya adı görünümünde yakalar. Bu KASITLI:
        // fazla yakalanan bir ad yalnızca aynı adlı bir dosyayı korur, hiçbir şeyi silmez.
        // Ayrıştırmayı kusursuzlaştırmaya çalışmak, kaçırma riskini almak demekti.
        Assert.Contains("eski-alan-adi.com", names);
    }

    [Fact]
    public void EskiAlanAdiyla_YazilmisUrlDeSayilir()
    {
        // Sunucu taşındığında kayıtlardaki URL eski adresle kaldı. Eşleşme ADA baktığı için
        // dosya yine korunur — tam URL karşılaştırılsaydı bu dosya yetim sanılırdı.
        var names = OrphanUploadScanner.ExtractFileNames("http://localhost:5000/uploads/images/eski.webp");

        Assert.Contains("eski.webp", names);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void BosDeger_HicAdVermez(string? raw)
    {
        Assert.Empty(OrphanUploadScanner.ExtractFileNames(raw));
    }

    [Fact]
    public void BuyukKucukHarf_AyriAdSayilmaz()
    {
        // Windows dosya sistemi harf duyarsız: `ABC.WEBP` ile `abc.webp` aynı dosyadır.
        var names = OrphanUploadScanner.ExtractFileNames("/uploads/products/ABC.WEBP");

        Assert.Contains("abc.webp", names);
    }

    [Fact]
    public void EticaretKlasorleri_TaramaKapsamiDisinda()
    {
        // Aynı diske kurulmuş e-ticaret uygulamasının klasörlerinin sahibi BAŞKA bir
        // veritabanı; buradan bakınca hepsi yetim görünür. Beyaz liste bunu engeller.
        Assert.Equal(new[] { "images", "products", "videos", "montaj" }, OrphanUploadScanner.OwnedFolders);
        Assert.DoesNotContain("categories", OrphanUploadScanner.OwnedFolders);
        Assert.DoesNotContain("ecommerce", OrphanUploadScanner.OwnedFolders);
        Assert.DoesNotContain("invoices", OrphanUploadScanner.OwnedFolders);
    }
}
