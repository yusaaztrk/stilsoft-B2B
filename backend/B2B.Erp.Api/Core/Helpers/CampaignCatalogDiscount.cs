using B2B.Erp.Api.Core.Enums;

namespace B2B.Erp.Api.Core.Helpers;

/// <summary>
/// Kampanya indirimi KATALOG FİYATINA (Fiyat 4) uygulanır; carinin gördüğü fiyat, düşmüş F4'ten
/// kendi fiyat grubunun formülüyle yeniden türer.
///
/// <para>
/// 2026-09-18 kullanıcı kuralı: "yazılan 5.000 indirim Fiyat 4 üzerinden yapılacak; 26.000'lik
/// klima 21.000'e düştü, diğer fiyatlar da ona göre hesaplanacak." Eskiden indirim carinin
/// kendi grup fiyatından düşülüyordu: 5.000 TL, grup 2'de de 5.000 TL düşüyordu. Oysa grup 2
/// <c>REMOVE_KDV(F4*0.88)</c> olduğu için doğru düşüş 5.000 × 0,88 / 1,20 = 3.666,67 TL'dir.
/// </para>
///
/// <para>
/// <b>Neden "yeni fiyat = Formül(F4')" değil de "fark = Formül(F4) − Formül(F4')":</b> iki hesap
/// formülle tutarlı veride birebir aynı sonucu verir. Elle yazılmış grup fiyatında (ör. bütün
/// grupları 1.111 girilmiş test ürünü) ilki carinin fiyatını formül fiyatına ÇEKER ve %10'luk
/// kampanya %34 indirim gibi görünür; fark yaklaşımı ise kampanyanın etkisini olduğu gibi
/// taşır. Para kaybı riski olan taraf ilkiydi.
/// </para>
///
/// <para>
/// Formül boşsa taban grup (4) sayılır, yani fark = indirimin kendisi. Formül hesaplanamıyorsa
/// <c>null</c> döner; çağıran eski davranışa (birim fiyattan doğrudan düşme) düşer.
/// Ekrandaki karşılığı <c>frontend/src/utils/priceFormula.ts → kampanyaKatalogIndirimi</c>;
/// ikisi aynı kalmalı, yoksa kartta görünen fiyat sepettekinden farklı çıkar.
/// </para>
/// </summary>
public static class CampaignCatalogDiscount
{
    /// <summary>
    /// Bir birim için, F4'e uygulanan indirimin carinin fiyat grubuna formülle taşınmış karşılığı.
    /// </summary>
    /// <param name="catalogPrice">Fiyat 4 (katalog) birim fiyatı; indirimle AYNI para biriminde.</param>
    /// <param name="formula">Carinin fiyat grubu formülü (<c>PriceGroups.Formula</c>); boşsa <c>F4</c>.</param>
    /// <param name="taxRate">Ürünün KDV oranı (formüldeki <c>KDV</c> / <c>REMOVE_KDV</c>).</param>
    /// <param name="discountRate">Ürünün iskonto oranı (formüldeki <c>DISCOUNT</c>).</param>
    /// <param name="type">Oran mı tutar mı.</param>
    /// <param name="value">Oran ise yüzde, tutar ise F4 para biriminde tutar.</param>
    public static decimal? UnitDiscount(
        decimal catalogPrice,
        string? formula,
        decimal taxRate,
        decimal discountRate,
        IskontoTipi type,
        decimal value)
    {
        if (catalogPrice <= 0m || value <= 0m) return null;

        var discountedCatalog = type == IskontoTipi.Oran
            ? catalogPrice * (1m - value / 100m)
            : catalogPrice - value;
        if (discountedCatalog < 0m) discountedCatalog = 0m;

        var expr = (formula ?? string.Empty).Trim();
        if (expr.Length == 0) expr = "F4";

        var before = PriceFormulaEvaluator.Evaluate(expr, catalogPrice, taxRate, discountRate);
        if (!before.HasValue) return null;

        // Evaluate sıfır/negatif sonuçta null döner; indirimli katalog fiyatı sıfıra inmişse
        // (tutar F4'ten büyük) grup fiyatı da sıfırdır — "hesaplanamadı" değil.
        var after = discountedCatalog <= 0m
            ? 0m
            : (PriceFormulaEvaluator.Evaluate(expr, discountedCatalog, taxRate, discountRate) ?? 0m);

        var diff = before.Value - after;
        if (diff <= 0m) return 0m;
        return Math.Round(diff, 2, MidpointRounding.AwayFromZero);
    }
}
