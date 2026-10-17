using B2B.Erp.Api.Core.Authorization;
using B2B.Erp.Api.Data;
using B2B.Erp.Api.Dtos.CustomerProductPriceOverrides;
using B2B.Erp.Api.Entities;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using System.Text.RegularExpressions;

namespace B2B.Erp.Api.Controllers;

[ApiController]
[Route("api/customer-product-price-overrides")]
[Authorize]
public sealed class CustomerProductPriceOverridesController : ControllerBase
{
    // DESTEKLENEN PARA BİRİMLERİ (2026-08-14).
    // Önceki desen `^[A-Z]{2,3}$` idi: "XXX", "ZZ", "JPY" gibi kur karşılığı OLMAYAN her kodu
    // kabul ediyordu. Böyle bir fiyat kaydedilir ama kura çevrilemez — fatura kesilirken
    // sessizce 1 kuruna düşer. Sistem dört para birimi destekliyor, doğrulama da onu yansıtmalı.
    private static readonly Regex CurrencyRegex = new("^(TL|TRY|USD|EUR|GBP)$", RegexOptions.Compiled);

    private readonly AppDbContext _dbContext;

    public CustomerProductPriceOverridesController(AppDbContext dbContext)
    {
        _dbContext = dbContext;
    }

    [HttpGet("by-customer")]
    [ProducesResponseType(typeof(List<CustomerProductPriceOverrideResponse>), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<ActionResult<List<CustomerProductPriceOverrideResponse>>> GetByCustomer(
        [FromQuery] string customerCode,
        [FromQuery] string? productIds,
        [FromQuery] Guid? priceGroupId,
        [FromQuery] bool includeInactive = false,
        CancellationToken cancellationToken = default)
    {
        customerCode = (customerCode ?? string.Empty).Trim();
        if (customerCode.Length == 0)
        {
            return BadRequest(new { success = false, message = "customerCode is required" });
        }

        // CARİ KAPSAMI: sorgulanan cari kullanıcının portföyünde olmalı. Öncesinde `customerCode`
        // serbestçe verilebiliyordu — bir bayi, rakip bayinin cari kodunu yazarak onun ürün bazlı
        // özel anlaşma fiyatlarının tamamını okuyabiliyordu. Kapsam boş/'*' ise (ofis kullanıcısı)
        // eskisi gibi sınırsız; şube ve alt hesaplar da kapsama dahil.
        if (!CustomerScope.IsUnrestrictedFor(User))
        {
            var allowed = await CustomerScope.ExpandAsync(
                _dbContext.Customers.AsNoTracking(), CustomerScope.Of(User), cancellationToken);

            if (!allowed.Contains(customerCode, StringComparer.OrdinalIgnoreCase))
            {
                return Forbid();
            }
        }

        var ids = ParseGuids(productIds);

        var query = _dbContext.CustomerProductPriceOverrides
            .AsNoTracking()
            .Where(x => x.CustomerCode == customerCode);

        if (!includeInactive)
        {
            query = query.Where(x => x.IsActive);
        }

        if (ids.Count > 0)
        {
            query = query.Where(x => ids.Contains(x.ProductId));
        }

        if (priceGroupId.HasValue && priceGroupId.Value != Guid.Empty)
        {
            query = query.Where(x => x.PriceGroupId == priceGroupId.Value);
        }

        var list = await query
            .OrderBy(x => x.CustomerCode)
            .ThenBy(x => x.ProductId)
            .ThenBy(x => x.PriceGroupId)
            .ToListAsync(cancellationToken);

        return Ok(list.Select(ToResponse).ToList());
    }

    [AuthorizePage("users", "cariEkle")]
    [HttpPost("upsert")]
    [ProducesResponseType(typeof(CustomerProductPriceOverrideResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<ActionResult<CustomerProductPriceOverrideResponse>> Upsert(
        [FromBody] UpsertCustomerProductPriceOverrideRequest request,
        CancellationToken cancellationToken)
    {
        var customerCode = (request.CustomerCode ?? string.Empty).Trim();
        if (customerCode.Length == 0)
        {
            ModelState.AddModelError(nameof(request.CustomerCode), "CustomerCode is required.");
        }

        if (request.Price <= 0)
        {
            ModelState.AddModelError(nameof(request.Price), "Price must be greater than 0.");
        }

        var currency = NormalizeCurrency(request.Currency);
        if (currency is null)
        {
            ModelState.AddModelError(nameof(request.Currency), "Para birimi TL, USD, EUR veya GBP olmalıdır.");
        }

        if (!ModelState.IsValid)
        {
            return ValidationProblem(ModelState);
        }

        var customerExists = await _dbContext.Customers
            .AsNoTracking()
            .AnyAsync(x => x.CustomerCode == customerCode, cancellationToken);

        if (!customerExists)
        {
            ModelState.AddModelError(nameof(request.CustomerCode), "CustomerCode is invalid.");
            return ValidationProblem(ModelState);
        }

        // ŞUBEYE ÖZEL FİYAT TANIMLANMAZ (2026-08-20).
        //
        // Şubede fiyat sahibi bağlı caridir (bkz. Core/Helpers/CustomerPriceOwner) — okuma
        // yolları artık oradan sorguluyor. Kaydetmeye izin verilseydi, satır yazılır ama
        // hiçbir ekranda okunmaz, sessizce ölü kayıt olurdu.
        var priceOwnerCode = await Core.Helpers.CustomerPriceOwner.ResolveAsync(_dbContext, customerCode, cancellationToken);
        if (!string.Equals(priceOwnerCode, customerCode, StringComparison.OrdinalIgnoreCase))
        {
            ModelState.AddModelError(
                nameof(request.CustomerCode),
                $"Şubeye özel fiyat tanımlanmaz; fiyat bağlı cariden ({priceOwnerCode}) gelir.");
            return ValidationProblem(ModelState);
        }

        var productExists = await _dbContext.Products
            .AsNoTracking()
            .AnyAsync(x => x.Id == request.ProductId, cancellationToken);

        if (!productExists)
        {
            ModelState.AddModelError(nameof(request.ProductId), "ProductId is invalid.");
            return ValidationProblem(ModelState);
        }

        var priceGroupExists = await _dbContext.PriceGroups
            .AsNoTracking()
            .AnyAsync(x => x.Id == request.PriceGroupId, cancellationToken);

        if (!priceGroupExists)
        {
            ModelState.AddModelError(nameof(request.PriceGroupId), "PriceGroupId is invalid.");
            return ValidationProblem(ModelState);
        }

        var existing = await _dbContext.CustomerProductPriceOverrides
            .FirstOrDefaultAsync(x => x.CustomerCode == customerCode && x.ProductId == request.ProductId && x.PriceGroupId == request.PriceGroupId, cancellationToken);

        if (existing is null)
        {
            var created = new CustomerProductPriceOverride
            {
                Id = Guid.NewGuid(),
                CustomerCode = customerCode,
                ProductId = request.ProductId,
                PriceGroupId = request.PriceGroupId,
                Price = request.Price,
                Currency = currency!,
                IsActive = true
            };

            _dbContext.CustomerProductPriceOverrides.Add(created);
            await _dbContext.SaveChangesAsync(cancellationToken);
            return Ok(ToResponse(created));
        }

        existing.Price = request.Price;
        existing.Currency = currency!;
        existing.IsActive = true;
        await _dbContext.SaveChangesAsync(cancellationToken);
        return Ok(ToResponse(existing));
    }

    [AuthorizePage("users", "cariEkle")]
    [HttpDelete("{id:guid}")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> Delete(Guid id, CancellationToken cancellationToken)
    {
        var entity = await _dbContext.CustomerProductPriceOverrides
            .FirstOrDefaultAsync(x => x.Id == id, cancellationToken);

        if (entity is null)
        {
            return NotFound();
        }

        entity.IsActive = false;
        await _dbContext.SaveChangesAsync(cancellationToken);
        return NoContent();
    }

    private static string? NormalizeCurrency(string currency)
    {
        var normalized = (currency ?? string.Empty).Trim().ToUpperInvariant();
        if (normalized.Length == 0)
        {
            return null;
        }

        if (!CurrencyRegex.IsMatch(normalized))
        {
            return null;
        }

        return normalized;
    }

    private static List<Guid> ParseGuids(string? value)
    {
        var list = new List<Guid>();
        if (string.IsNullOrWhiteSpace(value))
        {
            return list;
        }

        var parts = value.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        foreach (var part in parts)
        {
            if (Guid.TryParse(part, out var id))
            {
                list.Add(id);
            }
        }

        return list;
    }

    private static CustomerProductPriceOverrideResponse ToResponse(CustomerProductPriceOverride entity)
    {
        return new CustomerProductPriceOverrideResponse
        {
            Id = entity.Id,
            CustomerCode = entity.CustomerCode,
            ProductId = entity.ProductId,
            PriceGroupId = entity.PriceGroupId,
            Price = entity.Price,
            Currency = entity.Currency,
            IsActive = entity.IsActive
        };
    }
}
