using B2B.Erp.Api.Core.Enums;
using B2B.Erp.Api.Entities;

namespace B2B.Erp.Api.Entities;

public sealed class Campaign : AuditableEntity, ISoftDeletable
{
    public Guid Id { get; set; } = Guid.NewGuid();

    public string Name { get; set; } = string.Empty;

    public string? Description { get; set; }

    public DateTime? StartDate { get; set; }

    public DateTime? EndDate { get; set; }

    public bool IsIndefinite { get; set; }

    public int Priority { get; set; }

    public bool IsActive { get; set; } = true;

    public KampanyaTipi KampanyaTipi { get; set; } = KampanyaTipi.SepetIndirimi;

    public string? SubeKodu { get; set; }

    public bool StopNext { get; set; }

    public bool IsDeleted { get; set; }

    /// <summary>
    /// E-ticaret vitrininde de uygulansın mı (2026-09-19). Varsayılan KAPALI: B2B'de açılan
    /// kampanya, panelden anahtar açılmadan vitrine sızmaz. Yalnız ürün / kategori indirimleri
    /// vitrine gider; indirim F4'e uygulanır (vitrin fiyatı zaten F4).
    /// </summary>
    public bool EcommerceEnabled { get; set; }

    public ICollection<CampaignCondition> CampaignConditions { get; set; } = new List<CampaignCondition>();

    public ICollection<CampaignAction> CampaignActions { get; set; } = new List<CampaignAction>();

    public ICollection<CampaignTarget> CampaignTargets { get; set; } = new List<CampaignTarget>();

    public ICollection<CampaignDiscount> CampaignDiscounts { get; set; } = new List<CampaignDiscount>();

    public ICollection<CampaignBuyRule> CampaignBuyRules { get; set; } = new List<CampaignBuyRule>();
}
