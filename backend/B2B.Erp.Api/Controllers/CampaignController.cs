using B2B.Erp.Api.Core.Interfaces;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace B2B.Erp.Api.Controllers;

[Authorize]
public sealed class CampaignController : Controller
{
    private readonly ICampaignService _campaignService;

    public CampaignController(ICampaignService campaignService)
    {
        _campaignService = campaignService;
    }

    [HttpGet("/Campaign/Details/{id:guid}")]
    public async Task<IActionResult> Details([FromRoute] Guid id, CancellationToken cancellationToken)
    {
        var vm = await _campaignService.GetDetails(id, cancellationToken);
        if (vm is null)
        {
            return NotFound();
        }

        return View(vm);
    }
}
