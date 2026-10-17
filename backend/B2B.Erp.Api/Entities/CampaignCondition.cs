using B2B.Erp.Api.Core.Enums;

namespace B2B.Erp.Api.Entities;

public sealed class CampaignCondition : AuditableEntity, ISoftDeletable
{
    public Guid Id { get; set; } = Guid.NewGuid();

    public Guid CampaignId { get; set; }

    public Campaign Campaign { get; set; } = null!;

    public CampaignConditionType ConditionType { get; set; }

    public string? TargetId { get; set; }

    public string Operator { get; set; } = string.Empty;

    public decimal Value { get; set; }

    public CampaignConditionMetric? Metric { get; set; }

    /// <summary>
    /// Tutar eşiği — <b>her zaman TL</b>.
    ///
    /// <para>
    /// <b>Kampanya motoru para birimi TAŞIMAZ</b> ve taşıması da gerekmiyor: sözleşme şu ki
    /// <c>EvaluateSalesOrder</c>'a verilen <c>UnitPrice</c> TL'dir, dolayısıyla buradaki eşik
    /// de TL'dir. <see cref="CampaignAction.Value"/> (sabit tutarlı indirim) aynı kurala tabidir.
    /// </para>
    ///
    /// <para>
    /// <b>Bu sözleşme bir kez kırıldı:</b> fatura ve sipariş yolları motora TL besliyordu ama
    /// iki sepet yolu satırın KENDİ dövizini besliyordu. Sonuç: 500 $'lık sepet 10.000 TL
    /// eşiğine takılmıyor (müşteri sepette "kampanya yok" görüp faturada indirim alıyor), ve
    /// sabit tutarlı indirim dolarlı satıra dolar olarak uygulanıp satırı sıfırlıyordu —
    /// üstelik <c>UserBasketItem.DiscountAmount</c>'a öyle KAYDEDİLİYORDU.
    /// <b>Motora yeni bir çağrı ekleyen, fiyatı önce TL'ye çevirmek zorundadır.</b>
    /// </para>
    /// </summary>
    public decimal? Minimum { get; set; }

    /// <summary>Tutar üst sınırı — TL. Bkz. <see cref="Minimum"/>.</summary>
    public decimal? Maximum { get; set; }

    public string? CategoryCode { get; set; }

    public string? BrandField { get; set; }

    public string? BrandCode { get; set; }

    public string? PackageItemsJson { get; set; }

    public string? ProductStockCodesJson { get; set; }

    public bool IsDeleted { get; set; }
}
