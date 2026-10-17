namespace B2B.Erp.Api.Features.Ecommerce;

/// <summary>
/// E-ticaret sipariş satırının para hesabı — TEK YER.
///
/// NEDEN AYRI BİR SINIF: aynı hesap üç yerde yaşıyor ve üçünün aynı sonucu vermesi gerekiyor:
/// <list type="number">
///   <item>vitrindeki sepet (mağaza API'si, <c>CartService</c>),</item>
///   <item>ERP'de açılan sipariş satırı (<c>SalesOrdersController.CreateEcommerceOrder</c>),</item>
///   <item>siparişten kesilen satış faturası.</item>
/// </list>
/// Denetleyicinin içine gömülü kaldığı sürece test edilemiyordu ve mağaza tarafı formülü
/// elle kopyalamak zorundaydı. Kopyalanan formül er geç ayrışır; ayrıştığında müşteri
/// ekranda bir tutar görüp kartından başka tutar çekilir.
///
/// MONTAJ BEDELİ KURALI (B2B sipariş ekranıyla birebir):
/// <c>Products.InstallationFee</c> KDV DAHİL, sabit bir tutardır. Satır fiyatına eklenmeden
/// ÖNCE ürünün kendi KDV oranıyla nete çevrilir. Aksi hâlde sunucu bu satıra KDV'yi bir kez
/// daha uygular ve montajın KDV'si İKİ KEZ sayılır — B2B'de tam olarak bu hata yaşandı
/// (ürün 7.285,71 + montaj 300,00 → 7.965,00 çıkıyordu; doğrusu 7.950,00).
/// </summary>
public static class EcommerceLineMath
{
    /// <summary>Kuruş yuvarlaması: para tutarları her yerde aynı yönde yuvarlanmalı.</summary>
    private static decimal Round2(decimal value)
        => Math.Round(value, 2, MidpointRounding.AwayFromZero);

    /// <summary>
    /// Birim fiyat hesabında 4 hane tutuluyor: satır toplamı adetle çarpıldıktan SONRA
    /// kuruşa yuvarlanıyor. Erken yuvarlamak, 10 adetlik satırda kuruşları büyütür.
    /// </summary>
    private static decimal Round4(decimal value)
        => Math.Round(value, 4, MidpointRounding.AwayFromZero);

    /// <summary>
    /// KDV DAHİL bir tutarın net karşılığı. Oran 0 ise (askeriye/muaf) tutar aynen kalır —
    /// bölme yapmak muaf satırda bedeli sebepsiz küçültürdü.
    /// </summary>
    public static decimal ToNet(decimal grossAmount, decimal taxRate)
    {
        var divisor = 1m + (taxRate / 100m);
        return divisor <= 0m ? grossAmount : grossAmount / divisor;
    }

    /// <summary>KDV hariç tutarın KDV dahil karşılığı.</summary>
    public static decimal ToGross(decimal netAmount, decimal taxRate)
        => netAmount * (1m + (taxRate / 100m));

    /// <summary>
    /// Montaj bedeli katılmış BİRİM NET fiyat — siparişe bu tutar yazılır.
    /// </summary>
    /// <param name="netUnitPrice">Ürünün KDV hariç birim fiyatı (TL çapası).</param>
    /// <param name="taxRate">Ürünün KDV oranı (5, 16 …).</param>
    /// <param name="installationFeeGross">
    /// Ürün kartındaki montaj bedeli, KDV DAHİL. 0 ise montaj ücretsiz ya da yok.
    /// </param>
    public static decimal UnitNetWithInstallation(
        decimal netUnitPrice,
        decimal taxRate,
        decimal installationFeeGross)
    {
        if (installationFeeGross <= 0m) return Round4(netUnitPrice);

        /*
         * HEDEF BRÜTTEN GERİYE HESAPLANIYOR — 1 KURUŞ FARKININ KAPATILMASI (2026-09-08).
         *
         * Önceki hâl "net + bedelin neti" idi: `23.428,57 + 300/1,05 = 23.714,2843`.
         * Satır neti 23.714,28'e yuvarlanıyor, KDV'si 1.185,71 çıkıyor ve genel toplam
         * **24.899,99** oluyordu. Oysa hem vitrindeki sepet hem B2B sipariş ekranı aynı
         * satır için **24.900,00** gösteriyor: ikisi de ürünün brütünü ÖNCE yuvarlıyor
         * (23.428,57 × 1,05 = 24.599,9985 → 24.600,00) ve bedeli o yuvarlanmış tutara
         * ekliyor.
         *
         * Fark tek kuruştu ama yönü kötüydü: müşteri ekranda 24.900,00 görüp kartından
         * 24.899,99 çekilecekti — gösterilen tutarla tahsil edilen tutar ayrı demek.
         * Uçtan uca ödeme testi (shop/odeme-zinciri-testi.py) bunu ilk koşuda yakaladı.
         *
         * Artık hedef brüt önce kuruluyor (yuvarlanmış ürün brütü + bedel), sonra tek
         * seferde nete çevriliyor. Sonuç: sepet = sipariş = B2B, kuruşu kuruşuna.
         *
         * Montajın KDV'sinin iki kez sayılmaması kuralı KORUNUYOR: bedel brüt hâliyle
         * hedefe ekleniyor ve tamamı bir kez nete çevriliyor.
         */
        var productGross = Round2(ToGross(netUnitPrice, taxRate));
        return Round4(ToNet(productGross + installationFeeGross, taxRate));
    }

    /// <summary>
    /// Satırın müşteriye yansıyan KDV DAHİL toplamı.
    ///
    /// Bu değer, vitrindeki sepetin gösterdiği tutarla BİREBİR aynı olmak zorundadır. Sepet
    /// kırılımı farklı kuruyor (montajı KDV matrahına katmıyor, brüt hâliyle topluyor) ama
    /// genel toplam ikisinde de aynı çıkar; testler bunu çiviliyor.
    /// </summary>
    public static decimal LineGross(
        decimal netUnitPrice,
        decimal taxRate,
        decimal installationFeeGross,
        decimal quantity)
    {
        var unitNet = UnitNetWithInstallation(netUnitPrice, taxRate, installationFeeGross);
        var lineNet = Round2(unitNet * quantity);
        var lineVat = Round2(lineNet * taxRate / 100m);
        return lineNet + lineVat;
    }

    /// <summary>
    /// Vitrin sepetinin kurduğu toplam: ürün brütü + montaj brütü.
    /// Ayrı bir metot olarak duruyor ki testler iki yolu KARŞILAŞTIRABİLSİN — aynı sonucu
    /// vermeleri gerektiğini kod değil, test söylüyor.
    /// </summary>
    public static decimal StorefrontLineGross(
        decimal netUnitPrice,
        decimal taxRate,
        decimal installationFeeGross,
        decimal quantity)
    {
        var productGrossUnit = Round2(ToGross(netUnitPrice, taxRate));
        var productTotal = Round2(productGrossUnit * quantity);
        var installationTotal = Round2(Math.Max(0m, installationFeeGross) * quantity);
        return productTotal + installationTotal;
    }

    /// <summary>
    /// Vitrinde gösterilen ÜRÜN brütü (birim, montaj hariç). Sepet bu tutarı gösteriyor ve
    /// sipariş hesabı da bunun üzerine kuruluyor — ikisinin aynı yuvarlamayı kullanması
    /// gösterilen ile tahsil edilen tutarın eşitliğinin şartı.
    /// </summary>
    public static decimal ProductGrossUnit(decimal netUnitPrice, decimal taxRate)
        => Round2(ToGross(netUnitPrice, taxRate));
}
