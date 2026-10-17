using B2B.Erp.Api.Core.Enums;

namespace B2B.Erp.Api.Entities;

public sealed class CampaignTarget : AuditableEntity, ISoftDeletable
{
    public Guid Id { get; set; } = Guid.NewGuid();

    public Guid CampaignId { get; set; }

    public Campaign Campaign { get; set; } = null!;

    public CampaignTargetType TargetType { get; set; }

    public string? TargetId { get; set; }

    public bool IsDeleted { get; set; }
}
