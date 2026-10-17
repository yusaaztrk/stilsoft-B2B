namespace B2B.Erp.Api.Dtos.Campaigns;

public sealed class EvaluateSalesOrderResponse
{
    public string CustomerCode { get; set; } = string.Empty;

    public decimal Subtotal { get; set; }
    public decimal DiscountTotal { get; set; }
    public decimal TaxTotal { get; set; }
    public decimal GrandTotal { get; set; }

    public Guid? AppliedPriceGroupId { get; set; }

    public List<EvaluateSalesOrderLineResponse> Lines { get; set; } = new();
    public List<Guid> AppliedCampaignIds { get; set; } = new();

    public List<EvaluateSalesOrderAppliedCampaignDetail> AppliedCampaignDetails { get; set; } = new();
}

public sealed class EvaluateSalesOrderAppliedCampaignDetail
{
    public Guid CampaignId { get; set; }
    public int CampaignType { get; set; }
    public string CampaignName { get; set; } = string.Empty;

    public string StockCodesJson { get; set; } = "[]";
    public decimal MatchedQuantity { get; set; }

    public decimal? TierMinQuantity { get; set; }
    public decimal? TierMaxQuantity { get; set; }

    public string DiscountType { get; set; } = string.Empty;
    public decimal DiscountValue { get; set; }
    public decimal AppliedDiscountAmount { get; set; }
}

public sealed class EvaluateSalesOrderLineResponse
{
    public string StockCode { get; set; } = string.Empty;
    public string ProductName { get; set; } = string.Empty;
    public decimal Quantity { get; set; }
    public decimal UnitPrice { get; set; }
    public decimal VatRate { get; set; }

    public bool IsGift { get; set; }
    public decimal LineTotal { get; set; }
    public decimal DiscountAmount { get; set; }
    public decimal TaxAmount { get; set; }
}
