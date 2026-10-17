using B2B.Erp.Api.Core.Enums;

namespace B2B.Erp.Api.Entities;

public sealed class CampaignDiscount : AuditableEntity, ISoftDeletable
{
    public Guid Id { get; set; } = Guid.NewGuid();

    public Guid CampaignId { get; set; }

    public Campaign Campaign { get; set; } = null!;

    public string? StokKodu { get; set; }

    public string? GrupKodu { get; set; }

    public decimal MinSepetTutari { get; set; }

    public IskontoTipi IskontoTipi { get; set; }

    public decimal Deger { get; set; }

    public decimal? IskontoFiyat1 { get; set; }

    public decimal? IskontoFiyat2 { get; set; }

    public decimal? IskontoFiyat3 { get; set; }

    public decimal? IskontoFiyat4 { get; set; }

    public decimal? IskontoFiyat5 { get; set; }

    public decimal? IskontoFiyat6 { get; set; }
    public decimal? RewardQuantity { get; set; }

    /// <summary>
    /// ÜRÜNE ÖZEL KAMPANYALI FİYAT (2026-10-07) — Seçili Ürün İndirimi'nde satırın hedef F4'ü
    /// (F4 para biriminde, KDV dahil). Doluysa indirim her okumada <c>güncel F4 − HedefFiyat</c>
    /// olarak türetilir (bkz. <see cref="B2B.Erp.Api.Core.Helpers.CampaignTargetPrice"/>);
    /// <see cref="Deger"/> kayıt anındaki farkı tutar. Boşsa satır eski oran/tutar mantığıyla çalışır.
    /// </summary>
    public decimal? HedefFiyat { get; set; }

    public bool IsDeleted { get; set; }

    /// <summary>
    /// Hangi fiyat gruplarına uygulanacağı. IskontoFiyat1..6'nın yerini alan, sınırsız
    /// sayıda fiyat grubunu destekleyen kaynak. Bkz. <see cref="CampaignDiscountPriceGroup"/>.
    /// </summary>
    public ICollection<CampaignDiscountPriceGroup> PriceGroups { get; set; } = new List<CampaignDiscountPriceGroup>();
}
