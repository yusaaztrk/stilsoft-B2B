using System.ComponentModel.DataAnnotations;
using B2B.Erp.Api.Core.Enums;

namespace B2B.Erp.Api.Dtos.Campaigns;

public sealed class CreateCampaignRequest
{
    [Required]
    [StringLength(200)]
    public string Name { get; set; } = null!;

    [StringLength(2000)]
    public string? Description { get; set; }

    /// <summary>
    /// Kampanyanın uygulanacağı bayiler (cari kodları). BOŞ/NULL = tüm bayiler.
    /// Bkz. CampaignsController.ApplyDealerTargets.
    /// </summary>
    public List<string>? DealerCodes { get; set; }

    public DateTime? StartDate { get; set; }

    public DateTime? EndDate { get; set; }

    public bool IsIndefinite { get; set; }

    public int Priority { get; set; }

    public bool IsActive { get; set; } = true;

    public bool StopNext { get; set; }

    [MinLength(1)]
    public List<CampaignConditionRequest> Conditions { get; set; } = new();

    [MinLength(1)]
    public List<CampaignActionRequest> Actions { get; set; } = new();

    public List<CampaignTargetRequest> Targets { get; set; } = new();
}

public sealed class CampaignConditionRequest
{
    [Required]
    public CampaignConditionType ConditionType { get; set; } = CampaignConditionType.CategoryBased;

    [Required]
    public CampaignConditionMetric Metric { get; set; }

    [Range(0.0000000001d, double.MaxValue)]
    public decimal Minimum { get; set; }

    [Range(0d, double.MaxValue)]
    public decimal? Maximum { get; set; }

    [Required]
    [StringLength(100)]
    public string CategoryCode { get; set; } = null!;

    public List<string> ProductStockCodes { get; set; } = new();
}

public sealed class CampaignActionRequest
{
    [Required]
    public CampaignActionType ActionType { get; set; }

    public Guid? TargetProductId { get; set; }

    public Guid? TargetPriceGroupId { get; set; }

    public decimal Value { get; set; }

    public int Quantity { get; set; }
}

public sealed class CampaignTargetRequest
{
    [Required]
    public CampaignTargetType TargetType { get; set; }

    [StringLength(100)]
    public string? TargetId { get; set; }
}
