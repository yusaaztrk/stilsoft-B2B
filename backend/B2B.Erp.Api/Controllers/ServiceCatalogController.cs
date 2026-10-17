using System.ComponentModel.DataAnnotations;
using B2B.Erp.Api.Core.Authorization;
using B2B.Erp.Api.Data;
using B2B.Erp.Api.Entities;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace B2B.Erp.Api.Controllers;

[ApiController]
[Route("api/service-catalog")]
[Authorize]
[AuthorizePage("invoice", "alis")]
public sealed class ServiceCatalogController : ControllerBase
{
    private readonly AppDbContext _dbContext;

    public ServiceCatalogController(AppDbContext dbContext)
    {
        _dbContext = dbContext;
    }

    public sealed class ServiceCatalogItemResponse
    {
        public int Id { get; set; }
        public string Code { get; set; } = string.Empty;
        public string Name { get; set; } = string.Empty;
        public bool IsActive { get; set; }

        /// <summary>0/1 = TRY, 2 = EUR, 3 = USD, 4 = GBP (bkz. CurrencyTypeHelper).</summary>
        public int CurrencyTypeId { get; set; }
    }

    public sealed class CreateServiceCatalogItemRequest
    {
        [StringLength(50)]
        public string? Code { get; set; }

        [Required]
        [StringLength(200)]
        public string Name { get; set; } = string.Empty;

        public bool IsActive { get; set; } = true;

        /// <summary>
        /// Hizmetin para birimi. 0/1 = TRY, 2 = EUR, 3 = USD, 4 = GBP.
        /// Gonderilmezse 0 (TL) — eski istemciler aynen calisir.
        /// </summary>
        public int CurrencyTypeId { get; set; }
    }

    [HttpGet]
    public async Task<IActionResult> List([FromQuery] bool includeInactive = false, CancellationToken cancellationToken = default)
    {
        var q = _dbContext.Set<ServiceCatalogItem>().AsNoTracking();
        if (!includeInactive)
        {
            q = q.Where(x => x.IsActive);
        }

        var data = await q
            .OrderBy(x => x.Code)
            .Select(x => new ServiceCatalogItemResponse
            {
                Id = x.Id,
                Code = x.Code,
                Name = x.Name,
                IsActive = x.IsActive,
                CurrencyTypeId = x.CurrencyTypeId
            })
            .ToListAsync(cancellationToken);

        return Ok(new { success = true, data });
    }

    [HttpPost]
    public async Task<IActionResult> Create([FromBody] CreateServiceCatalogItemRequest request, CancellationToken cancellationToken)
    {
        if (!ModelState.IsValid)
        {
            return ValidationProblem(ModelState);
        }

        var name = (request.Name ?? string.Empty).Trim();
        if (string.IsNullOrWhiteSpace(name))
        {
            ModelState.AddModelError(nameof(request.Name), "Name zorunludur.");
            return ValidationProblem(ModelState);
        }

        var codeRaw = (request.Code ?? string.Empty).Trim().ToUpperInvariant();
        if (string.IsNullOrWhiteSpace(codeRaw))
        {
            codeRaw = "HIZ-";
        }

        if (!codeRaw.StartsWith("HIZ-", StringComparison.OrdinalIgnoreCase))
        {
            codeRaw = "HIZ-" + codeRaw.TrimStart('-');
        }

        if (codeRaw.Equals("HIZ-", StringComparison.OrdinalIgnoreCase))
        {
            // auto-generate suffix from name
            var suffix = new string(name
                .ToUpperInvariant()
                .Select(ch => char.IsLetterOrDigit(ch) ? ch : '-')
                .ToArray());

            suffix = suffix.Replace("--", "-");
            suffix = suffix.Trim('-');
            if (suffix.Length > 30) suffix = suffix.Substring(0, 30);
            if (string.IsNullOrWhiteSpace(suffix)) suffix = "GENEL";

            codeRaw = "HIZ-" + suffix;
        }

        if (codeRaw.Length > 50)
        {
            ModelState.AddModelError(nameof(request.Code), "Code çok uzun.");
            return ValidationProblem(ModelState);
        }

        var exists = await _dbContext.Set<ServiceCatalogItem>()
            .AsNoTracking()
            .AnyAsync(x => x.Code == codeRaw, cancellationToken);

        if (exists)
        {
            return Conflict(new { success = false, message = "Bu hizmet kodu zaten mevcut." });
        }

        // Bilinmeyen bir kod gelirse TL'ye dusurulur; ekrandan yalnizca dort secenek gonderilir
        // ama uc dogrudan da cagrilabiliyor.
        var currencyTypeId = Core.Helpers.CurrencyTypeHelper.IsKnown(request.CurrencyTypeId)
            ? request.CurrencyTypeId
            : 0;

        var username = User.Identity?.Name ?? "System";
        var entity = new ServiceCatalogItem
        {
            Code = codeRaw,
            Name = name,
            IsActive = request.IsActive,
            CurrencyTypeId = currencyTypeId,
            CreateUser = username,
            CreateTime = DateTime.UtcNow
        };

        _dbContext.Set<ServiceCatalogItem>().Add(entity);
        await _dbContext.SaveChangesAsync(cancellationToken);

        return Ok(new
        {
            success = true,
            data = new ServiceCatalogItemResponse
            {
                Id = entity.Id,
                Code = entity.Code,
                Name = entity.Name,
                IsActive = entity.IsActive,
                CurrencyTypeId = entity.CurrencyTypeId
            }
        });
    }
}
