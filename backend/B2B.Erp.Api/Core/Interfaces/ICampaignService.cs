using B2B.Erp.Api.Dtos.Campaigns;
using B2B.Erp.Api.ViewModels.Campaigns;

namespace B2B.Erp.Api.Core.Interfaces;

public interface ICampaignService
{
    Task<EvaluateSalesOrderResponse> EvaluateSalesOrder(EvaluateSalesOrderRequest request, CancellationToken cancellationToken = default);

    Task<CampaignDetailsViewModel?> GetDetails(Guid campaignId, CancellationToken cancellationToken = default);
}
