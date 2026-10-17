namespace B2B.Erp.Api.Core.Accounting;

/// <summary>
/// Fatura SATIRININ muhasebe niteliği (denetim md. E3).
///
/// <para>
/// <b>Neden satır seviyesinde?</b> <see cref="InvoiceNature"/> faturanın tamamını
/// sınıflandırır (600 mal / 600.20 hizmet). Ama tek bir fatura hem mal hem hizmet satırı
/// taşıyabiliyor — servisten gelen bir faturada hem değişen parça hem işçilik vardır.
/// Fatura seviyesindeki tek nitelik bu faturayı ya tamamen 600'e ya tamamen 600.20'ye
/// yazardı; ikisi de yanlış. Kırılım ancak satırda tutulabilir.
/// </para>
/// </summary>
public enum InvoiceLineNature
{
    /// <summary>Henüz damgalanmamış satır (eski kayıt). Aktarımda çözülmesi gerekir.</summary>
    Unspecified = 0,

    /// <summary>Mal. 600 Yurtiçi Satışlar / 153 Ticari Mallar.</summary>
    Goods = 1,

    /// <summary>Hizmet. 600.20 Yurtiçi Hizmet Satışları.</summary>
    Service = 2
}

/// <summary>
/// Satır niteliğini çözen TEK KAPI. Kural birden çok yere kopyalanırsa aktarım ile ekran
/// birbirini tutmaz; her çağıran buradan geçer.
/// </summary>
public static class InvoiceLineNatureResolver
{
    /// <summary>
    /// Hizmet sayılan ürün tipleri. Bugün ürün kartında yalnız <c>URUN</c> ve
    /// <c>YEDEKPARCA</c> kullanılıyor (ikisi de MAL); <c>HIZMET</c> ileride ürün kartına
    /// eklenirse kural kendiliğinden çalışsın diye şimdiden tanınıyor.
    /// </summary>
    private static readonly HashSet<string> ServiceProductTypes =
        new(StringComparer.OrdinalIgnoreCase) { "HIZMET", "HİZMET", "SERVIS", "SERVİS" };

    /// <summary>
    /// <paramref name="productType"/> <c>null</c> ise satırın stok kodu ÜRÜN KARTINDA YOK
    /// demektir.
    ///
    /// <para>
    /// Kartı olmayan satır hizmettir: serbest metinle girilen işçilik/servis bedeli satırları
    /// (<c>HİZ-TAMİR</c>, <c>SERVIS-BEDELI</c> …) stok kartı açılmadan faturaya yazılıyor.
    /// Raporlar da bu satırları zaten "ürünü olmayan hizmet satırı" olarak ele alıyor
    /// (<c>CariSatisReportController</c>'daki LEFT JOIN notu).
    /// </para>
    ///
    /// <para>
    /// <b>Silinmiş ürün tuzağı:</b> kartı sonradan silinen bir MAL satırı da "kart yok"
    /// görünür. Bu yüzden nitelik satıra YAZILIR (<c>InvoiceLine.Nature</c>) — fatura
    /// kesilirken, kart hâlâ ortadayken. Sonradan hesaplanmaya kalkılsaydı geçmiş fatura
    /// ürün silindiği gün 600'den 600.20'ye kayardı.
    /// </para>
    /// </summary>
    public static InvoiceLineNature Resolve(string? stockCode, string? productType)
    {
        if (string.IsNullOrWhiteSpace(stockCode)) return InvoiceLineNature.Service;

        if (productType is null) return InvoiceLineNature.Service;

        return ServiceProductTypes.Contains(productType.Trim())
            ? InvoiceLineNature.Service
            : InvoiceLineNature.Goods;
    }

    /// <summary>
    /// Ürün kartı AÇIKÇA hizmet tipinde mi (<c>HIZMET</c> / <c>SERVIS</c>). Kart yok / boş
    /// tip için <c>false</c> döner — o durumu <see cref="Resolve"/>'un serbest-metin kuralı
    /// ele alır. Stok hareketi yazılıp yazılmayacağına karar veren yerler bunu kullanır:
    /// hizmet kartının (ör. MONTAJ-BEDELI) faturası envanteri hareket ettirmemeli.
    /// </summary>
    public static bool IsServiceProductType(string? productType)
        => productType is not null && ServiceProductTypes.Contains(productType.Trim());

    /// <summary>Muhasebe hesap kodu karşılığı — aktarım modülünün okuyacağı değer.</summary>
    public static string ToRevenueAccountCode(InvoiceLineNature nature) => nature switch
    {
        InvoiceLineNature.Service => "600.20",
        _ => "600"
    };
}
