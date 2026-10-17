using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using Ecommerce.Api.Infrastructure.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Ecommerce.Api.Controllers;

[ApiController]
[Route("api/admin/campaigns")]
[Authorize(Roles = "Owner,Admin")]
public sealed class AdminCampaignsController : ControllerBase
{
    private readonly CampaignsRepository _repo;

    public AdminCampaignsController(CampaignsRepository repo)
    {
        _repo = repo;
    }

    [HttpGet]
    public async Task<IActionResult> List(CancellationToken cancellationToken)
    {
        var campaigns = await _repo.ListAllAsync(cancellationToken);
        return Ok(new { success = true, data = campaigns });
    }

    [HttpGet("stats")]
    public async Task<IActionResult> Stats(CancellationToken cancellationToken)
    {
        var stats = await _repo.GetStatsAsync(cancellationToken);
        return Ok(new { success = true, data = stats });
    }

    [HttpGet("{id:guid}")]
    public async Task<IActionResult> Get([FromRoute] Guid id, CancellationToken cancellationToken)
    {
        var campaign = await _repo.GetAsync(id, cancellationToken);
        if (campaign == null)
        {
            return NotFound(new { success = false, message = "Kampanya bulunamadı." });
        }
        return Ok(new { success = true, data = campaign });
    }

    [HttpPost]
    public async Task<IActionResult> Create([FromBody] SaveCampaignRequest request, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(request.Name))
        {
            return BadRequest(new { success = false, message = "Kampanya adı boş olamaz." });
        }

        var campaign = new Campaign
        {
            Id = Guid.NewGuid(),
            Name = request.Name,
            Description = request.Description,
            Type = request.Type,
            Scope = request.Scope,
            IsActive = request.IsActive,
            StartDate = request.StartDate.ToUniversalTime(),
            EndDate = request.EndDate.ToUniversalTime(),
            Priority = request.Priority,
            ImageUrl = request.ImageUrl,
            MinOrderAmount = request.MinOrderAmount,
            MaxDiscountAmount = request.MaxDiscountAmount,
            DiscountValue = request.DiscountValue,
            GiftProductId = request.GiftProductId,
            BuyXGetYType = request.BuyXGetYType,
            BuyQuantity = request.BuyQuantity,
            GiftQuantity = request.GiftQuantity,
            BuyXGetYScale = request.BuyXGetYScale,
            TargetProductIds = request.TargetProductIds,
            TargetCategoryIds = request.TargetCategoryIds,
            TargetBrandNames = request.TargetBrandNames,
            BrandRules = request.BrandRules
        };

        await _repo.SaveAsync(campaign, cancellationToken);
        return Ok(new { success = true, data = campaign });
    }

    [HttpPut("{id:guid}")]
    public async Task<IActionResult> Update([FromRoute] Guid id, [FromBody] SaveCampaignRequest request, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(request.Name))
        {
            return BadRequest(new { success = false, message = "Kampanya adı boş olamaz." });
        }

        var existing = await _repo.GetAsync(id, cancellationToken);
        if (existing == null)
        {
            return NotFound(new { success = false, message = "Kampanya bulunamadı." });
        }

        existing.Name = request.Name;
        existing.Description = request.Description;
        existing.Type = request.Type;
        existing.Scope = request.Scope;
        existing.IsActive = request.IsActive;
        existing.StartDate = request.StartDate.ToUniversalTime();
        existing.EndDate = request.EndDate.ToUniversalTime();
        existing.Priority = request.Priority;
        existing.ImageUrl = request.ImageUrl;
        existing.MinOrderAmount = request.MinOrderAmount;
        existing.MaxDiscountAmount = request.MaxDiscountAmount;
        existing.DiscountValue = request.DiscountValue;
        existing.GiftProductId = request.GiftProductId;
        existing.BuyXGetYType = request.BuyXGetYType;
        existing.BuyQuantity = request.BuyQuantity;
        existing.GiftQuantity = request.GiftQuantity;
        existing.BuyXGetYScale = request.BuyXGetYScale;
        existing.TargetProductIds = request.TargetProductIds;
        existing.TargetCategoryIds = request.TargetCategoryIds;
        existing.TargetBrandNames = request.TargetBrandNames;
        existing.BrandRules = request.BrandRules;

        await _repo.SaveAsync(existing, cancellationToken);
        return Ok(new { success = true, data = existing });
    }

    [HttpDelete("{id:guid}")]
    public async Task<IActionResult> Delete([FromRoute] Guid id, CancellationToken cancellationToken)
    {
        var existing = await _repo.GetAsync(id, cancellationToken);
        if (existing == null)
        {
            return NotFound(new { success = false, message = "Kampanya bulunamadı." });
        }

        await _repo.DeleteAsync(id, cancellationToken);
        return Ok(new { success = true, message = "Kampanya silindi." });
    }
}

public sealed class SaveCampaignRequest
{
    public string Name { get; set; } = string.Empty;
    public string? Description { get; set; }
    public string Type { get; set; } = "Percentage";
    public string Scope { get; set; } = "Product";
    public bool IsActive { get; set; } = true;
    public DateTime StartDate { get; set; }
    public DateTime EndDate { get; set; }
    public int Priority { get; set; } = 0;
    public string? ImageUrl { get; set; }
    public decimal MinOrderAmount { get; set; } = 0;
    public decimal? MaxDiscountAmount { get; set; }
    public decimal DiscountValue { get; set; } = 0;
    public Guid? GiftProductId { get; set; }
    public string? BuyXGetYType { get; set; }
    public int? BuyQuantity { get; set; }
    public int? GiftQuantity { get; set; }
    public bool? BuyXGetYScale { get; set; }
    public List<Guid> TargetProductIds { get; set; } = new();
    public List<Guid> TargetCategoryIds { get; set; } = new();
    public List<string> TargetBrandNames { get; set; } = new();
    public List<BrandDiscountRule> BrandRules { get; set; } = new();
}
