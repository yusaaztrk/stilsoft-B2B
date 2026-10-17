using System;

namespace B2B.Erp.Api.Entities;

public sealed class CampaignBuyRule : AuditableEntity, ISoftDeletable
{
    public Guid Id { get; set; } = Guid.NewGuid();

    public Guid CampaignId { get; set; }

    public Campaign Campaign { get; set; } = null!;

    public Guid ProductId { get; set; }

    public Product Product { get; set; } = null!;

    public int RequiredQuantity { get; set; } = 1;

    public bool IsDeleted { get; set; }
}
