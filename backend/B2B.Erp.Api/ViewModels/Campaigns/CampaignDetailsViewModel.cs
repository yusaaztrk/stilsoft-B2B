using B2B.Erp.Api.Core.Enums;

namespace B2B.Erp.Api.ViewModels.Campaigns;

public sealed class CampaignDetailsViewModel
{
    public Guid Id { get; set; }

    public string Name { get; set; } = string.Empty;

    public string? Description { get; set; }

    public DateTime? StartDate { get; set; }

    public DateTime? EndDate { get; set; }

    public bool IsIndefinite { get; set; }

    public int Priority { get; set; }

    public bool IsActive { get; set; }

    public bool StopNext { get; set; }

    public string ConditionSummary { get; set; } = string.Empty;

    public string ActionSummary { get; set; } = string.Empty;

    public string TargetSummary { get; set; } = string.Empty;

    public List<CampaignConditionRowViewModel> Conditions { get; set; } = new();

    public List<CampaignActionRowViewModel> Actions { get; set; } = new();

    public List<CampaignTargetRowViewModel> Targets { get; set; } = new();
}

public sealed class CampaignConditionRowViewModel
{
    public Guid Id { get; set; }

    public CampaignConditionType ConditionType { get; set; }

    public string Operator { get; set; } = string.Empty;

    public decimal Value { get; set; }

    public string? TargetId { get; set; }

    public string DisplayText { get; set; } = string.Empty;
}

public sealed class CampaignActionRowViewModel
{
    public Guid Id { get; set; }

    public CampaignActionType ActionType { get; set; }

    public decimal Value { get; set; }

    public int Quantity { get; set; }

    public Guid? TargetProductId { get; set; }

    public Guid? TargetPriceGroupId { get; set; }

    public string DisplayText { get; set; } = string.Empty;
}

public sealed class CampaignTargetRowViewModel
{
    public Guid Id { get; set; }

    public CampaignTargetType TargetType { get; set; }

    public string? TargetId { get; set; }

    public string DisplayText { get; set; } = string.Empty;
}
