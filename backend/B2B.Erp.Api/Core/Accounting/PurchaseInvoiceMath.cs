using B2B.Erp.Api.Core.Helpers;

namespace B2B.Erp.Api.Core.Accounting;

/// <summary>
/// Alış faturasının para matematiği.
///
/// <para>
/// Ayrı sınıf olmasının sebebi ÖLÇÜLEBİLİRLİK — <see cref="InvoiceDiscountMath"/> ile aynı
/// gerekçe. Bu hesaplar controller içinde gömülüydü ve test edilemiyordu; 2026-08-29'da alış
/// faturasına döviz beyanı eklenirken üç ayrı yerde tekrarlandıkları görüldü.
/// </para>
///
/// <para>
/// Merkezî kural: <b>kayıtta tutarlar TL çapasıdır</b>, belgenin kendi para birimindeki değer
/// kalemin <c>CurrencyUnitPrice</c> alanında ayrıca durur. Çevrim belgenin KENDİ kuruyla
/// yapılır, günün kuruyla değil — fatura kesildikten sonra kur oynadığında geçmiş maliyet
/// kaymasın.
/// </para>
/// </summary>
public static class PurchaseInvoiceMath
{
    /// <summary>
    /// Belge para birimindeki bir tutarın TL çapası.
    /// TL belgede tutar aynen döner; dövizli belgede belgenin kuruyla çarpılır.
    /// </summary>
    public static decimal TlCapasi(decimal belgeTutari, int dovizTipi, decimal kur)
    {
        if (CurrencyTypeHelper.IsTry(dovizTipi)) return belgeTutari;
        var gecerliKur = kur > 0m ? kur : 1m;
        return decimal.Round(belgeTutari * gecerliKur, 4, MidpointRounding.AwayFromZero);
    }

    /// <summary>
    /// Fatura toplamını cari defter satırının iki kolonuna çevirir:
    /// TL çapası ve CARİNİN para birimindeki karşılık.
    ///
    /// <para>
    /// <b>Çifte çevrim kapısı:</b> beyan edilmiş (damgalı) faturada <c>GrandTotal</c> ZATEN
    /// TL'dir; kurla bir kez daha çarpmak tedarikçi borcunu kur katı şişirirdi. Damgası
    /// olmayan ESKİ faturalarda ise tutar faturanın kendi para birimindedir ve çarpım
    /// doğru olandır. İki nesil kayıt bir arada duruyor; ayrım damgadan yapılır.
    /// </para>
    /// </summary>
    public static (decimal TryAmount, decimal CustomerCurrencyAmount) Ledger(
        decimal grandTotal,
        int invoiceCurrencyTypeId,
        decimal invoiceRate,
        int customerCurrencyTypeId,
        decimal customerRate)
    {
        var beyanli = CurrencyTypeHelper.IsKnown(invoiceCurrencyTypeId);

        var tryAmount = (beyanli || CurrencyTypeHelper.IsTry(invoiceCurrencyTypeId))
            ? grandTotal
            : grandTotal * (invoiceRate > 0m ? invoiceRate : 1m);

        var customerAmount = CurrencyTypeHelper.IsTry(customerCurrencyTypeId)
            ? tryAmount
            : (customerRate > 0m ? decimal.Round(tryAmount / customerRate, 4) : 0m);

        return (tryAmount, customerAmount);
    }

    /// <summary>Kalem indirim tipi — controller enum'undan bağımsız tutuldu ki sınıf test edilebilsin.</summary>
    public enum IskontoTipi
    {
        Yok = 0,
        Tutar = 1,
        Yuzde = 2
    }

    public readonly record struct SatirSonuc(decimal Brut, decimal Iskonto, decimal Net, decimal Kdv);

    /// <summary>
    /// Bir kalemin TL çapasındaki brüt / iskonto / net / KDV değerleri.
    ///
    /// <paramref name="tlBirimFiyat"/> zaten TL çapasıdır (bkz. <see cref="TlCapasi"/>).
    /// Tutar iskontosu ise BELGENİN para biriminde girilir, o yüzden burada çevrilir.
    /// Yüzde iskontosu para biriminden bağımsızdır.
    ///
    /// <para>
    /// <b>Tutar iskontosu ADET BAŞINADIR</b> (kullanıcı kuralı — bkz. [[indirim-kurallari]]):
    /// kullanıcı <paramref name="iskontoDegeri"/>'ni TEK ürün için girer, satırın tamamı için
    /// değil. Ekranın "Alış Siparişleri" listesi ve düzenleme formunun özet kutusu bu çarpımı
    /// ZATEN yapıyordu (`calcInvoiceTotalsWithConversion`); burası yapmadığı için kaydedilen
    /// `GrandTotal` ve ondan türeyen cari ekstre "İade Faturası" alacağı ekranda görülenden
    /// düşük iskonto/yüksek tutarla kayda giriyordu (2026-09-10 canlı kanıtı: İA260910102928V,
    /// 3×19.914,29 ₺, adet başı iskonto 2.956,98 ₺ → doğrusu 3×2.956,98 = 8.870,94 ₺).
    /// </para>
    /// </summary>
    public static SatirSonuc Satir(
        decimal miktar,
        decimal tlBirimFiyat,
        IskontoTipi iskontoTipi,
        decimal iskontoDegeri,
        int dovizTipi,
        decimal kur,
        decimal kdvOrani,
        bool kdvIstisna)
    {
        var brut = miktar * tlBirimFiyat;

        var iskonto = iskontoTipi switch
        {
            IskontoTipi.Tutar => TlCapasi(iskontoDegeri, dovizTipi, kur) * miktar,
            IskontoTipi.Yuzde => (brut * iskontoDegeri) / 100m,
            _ => 0m
        };

        if (iskonto < 0m) iskonto = 0m;
        if (iskonto > brut) iskonto = brut;

        var net = brut - iskonto;
        var kdv = kdvIstisna ? 0m : (net * kdvOrani) / 100m;

        return new SatirSonuc(brut, iskonto, net, kdv);
    }
}
