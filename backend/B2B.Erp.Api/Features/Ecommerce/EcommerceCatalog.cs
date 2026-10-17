namespace B2B.Erp.Api.Features.Ecommerce;

/// <summary>
/// E-ticaret vitrininin ERP tarafındaki sabitleri.
///
/// Tek satırlık ama TEK YERDE durması şart: aynı sayı üç ayrı yerde kullanılıyor —
/// yeni e-ticaret carisi açılırken (fiyat grubu ataması), sipariş fiyatlanırken ve
/// mağazanın kendi katalog sorgusunda. Üçü ayrılırsa müşteri ekranda bir fiyat görüp
/// başka bir fiyattan sipariş verir; bu hata ekranda hiç görünmez, ancak ekstrede fark
/// edilir.
/// </summary>
public static class EcommerceCatalog
{
    /// <summary>
    /// Vitrin fiyatlarının okunduğu fiyat grubunun KODU (kimliği değil). 1 = KATALOG F.
    ///
    /// Mağaza tarafındaki karşılığı <c>Shop:CatalogPriceGroupCode</c> (shop/Shop.Api/appsettings.json).
    /// İkisi AYNI olmak zorunda: biri değişip diğeri kalırsa gösterilen fiyatla tahsil edilen
    /// fiyat ayrışır.
    /// </summary>
    public const int PriceGroupCode = 1;
}
