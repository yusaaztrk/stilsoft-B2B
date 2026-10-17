using B2B.Erp.Api.Core.Authorization;
using B2B.Erp.Api.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using System.ComponentModel.DataAnnotations;

namespace B2B.Erp.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
[Authorize]
public sealed class PriceGroupsController : ControllerBase
{
    private readonly AppDbContext _dbContext;

    public PriceGroupsController(AppDbContext dbContext)
    {
        _dbContext = dbContext;
    }

    public sealed class CreatePriceGroupRequest
    {
        [Required]
        [Range(1, int.MaxValue)]
        public int Code { get; set; }

        [Required]
        [StringLength(200)]
        public string Name { get; set; } = null!;

        [StringLength(50)]
        public string? InvoiceType { get; set; }

        [StringLength(500)]
        public string? Formula { get; set; }

        public int? SortOrder { get; set; }
    }

    public sealed class UpdatePriceGroupRequest
    {
        [Required]
        [StringLength(200)]
        public string Name { get; set; } = null!;

        [StringLength(50)]
        public string? InvoiceType { get; set; }

        [StringLength(500)]
        public string? Formula { get; set; }

        public int? SortOrder { get; set; }

        public bool? IsActive { get; set; }
    }

    private static string NormalizeInvoiceType(string? value)
    {
        var s = (value ?? string.Empty).Trim().ToUpperInvariant();
        if (s == "ACIK") return "ACIK";
        if (s == "FATURA") return "FATURA";
        return string.Empty;
    }

    [HttpGet]
    public async Task<IActionResult> GetAll([FromQuery] bool includeInactive = false, CancellationToken cancellationToken = default)
    {
        var query = _dbContext.PriceGroups.AsNoTracking();
        if (!includeInactive)
        {
            query = query.Where(x => x.IsActive);
        }

        var data = await query
            .OrderBy(x => x.SortOrder)
            .ThenBy(x => x.Code)
            .Select(x => new
            {
                id = x.Id,
                code = x.Code,
                name = x.Name,
                invoiceType = x.InvoiceType,
                formula = x.Formula,
                sortOrder = x.SortOrder,
                isActive = x.IsActive
            })
            .ToListAsync(cancellationToken);

        return Ok(new { success = true, data });
    }

    [AuthorizePage("users", "fiyatKategorileri")]
    [HttpPost]
    [ProducesResponseType(StatusCodes.Status201Created)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<IActionResult> Create(CreatePriceGroupRequest request, CancellationToken cancellationToken)
    {
        var code = request.Code;
        var name = (request.Name ?? string.Empty).Trim();
        var invoiceType = NormalizeInvoiceType(request.InvoiceType);

        if (code <= 0) ModelState.AddModelError(nameof(request.Code), "Code must be greater than 0.");
        if (string.IsNullOrWhiteSpace(name))
        {
            ModelState.AddModelError(nameof(request.Name), "Name is required.");
        }

        if (code is >= 4 and <= 6)
        {
            invoiceType = "ACIK";
        }
        else
        {
            if (string.IsNullOrWhiteSpace(invoiceType)) invoiceType = "FATURA";
            if (invoiceType != "ACIK" && invoiceType != "FATURA")
            {
                ModelState.AddModelError(nameof(request.InvoiceType), "InvoiceType must be ACIK or FATURA.");
            }
        }

        if (!ModelState.IsValid)
        {
            return ValidationProblem(ModelState);
        }

        var codeExists = await _dbContext.PriceGroups
            .AsNoTracking()
            .AnyAsync(x => x.Code == code, cancellationToken);

        if (codeExists)
        {
            ModelState.AddModelError(nameof(request.Code), "Code must be unique.");
            return ValidationProblem(ModelState);
        }

        var nextSort = request.SortOrder;
        if (nextSort is null)
        {
            nextSort = code;
        }

        var entity = new Entities.PriceGroup
        {
            Id = Guid.NewGuid(),
            Code = code,
            Name = name,
            InvoiceType = invoiceType,
            Formula = string.IsNullOrWhiteSpace(request.Formula) ? null : request.Formula.Trim(),
            SortOrder = nextSort.Value,
            IsActive = true
        };

        _dbContext.PriceGroups.Add(entity);
        await _dbContext.SaveChangesAsync(cancellationToken);

        return CreatedAtAction(nameof(GetAll), new { id = entity.Id }, new
        {
            id = entity.Id,
            code = entity.Code,
            name = entity.Name,
            invoiceType = entity.InvoiceType,
            formula = entity.Formula,
            sortOrder = entity.SortOrder,
            isActive = entity.IsActive
        });
    }

    [AuthorizePage("users", "fiyatKategorileri")]
    [HttpPut("{id:guid}")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> Update(Guid id, UpdatePriceGroupRequest request, CancellationToken cancellationToken)
    {
        var entity = await _dbContext.PriceGroups.FirstOrDefaultAsync(x => x.Id == id, cancellationToken);
        if (entity is null)
        {
            return NotFound();
        }

        var name = (request.Name ?? string.Empty).Trim();
        var invoiceType = NormalizeInvoiceType(request.InvoiceType);
        if (string.IsNullOrWhiteSpace(name))
        {
            ModelState.AddModelError(nameof(request.Name), "Name is required.");
            return ValidationProblem(ModelState);
        }

        if (entity.Code is >= 4 and <= 6)
        {
            invoiceType = "ACIK";
        }
        else if (!string.IsNullOrWhiteSpace(request.InvoiceType))
        {
            if (invoiceType != "ACIK" && invoiceType != "FATURA")
            {
                ModelState.AddModelError(nameof(request.InvoiceType), "InvoiceType must be ACIK or FATURA.");
                return ValidationProblem(ModelState);
            }
        }

        entity.Name = name;
        if (!string.IsNullOrWhiteSpace(invoiceType))
        {
            entity.InvoiceType = invoiceType;
        }
        entity.Formula = string.IsNullOrWhiteSpace(request.Formula) ? null : request.Formula.Trim();
        if (request.SortOrder.HasValue)
        {
            entity.SortOrder = request.SortOrder.Value;
        }
        if (request.IsActive.HasValue)
        {
            entity.IsActive = request.IsActive.Value;
        }

        await _dbContext.SaveChangesAsync(cancellationToken);

        return Ok(new
        {
            id = entity.Id,
            code = entity.Code,
            name = entity.Name,
            invoiceType = entity.InvoiceType,
            formula = entity.Formula,
            sortOrder = entity.SortOrder,
            isActive = entity.IsActive
        });
    }

    [AuthorizePage("users", "fiyatKategorileri")]
    [HttpDelete("{id:guid}")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> Delete(Guid id, CancellationToken cancellationToken)
    {
        var entity = await _dbContext.PriceGroups.FirstOrDefaultAsync(x => x.Id == id, cancellationToken);
        if (entity is null)
        {
            return NotFound();
        }

        var isUsedInCustomers = await _dbContext.Customers
            .AsNoTracking()
            .AnyAsync(x => x.PriceGroupId == id, cancellationToken);

        if (isUsedInCustomers)
        {
            return Conflict(new { success = false, message = "Bu fiyat kategorisi müşteri kartlarında kullanıldığı için silinemez." });
        }

        await using var tx = await _dbContext.Database.BeginTransactionAsync(cancellationToken);
        try
        {
            var productPrices = await _dbContext.ProductPrices
                .Where(x => x.PriceGroupId == id)
                .ToListAsync(cancellationToken);

            if (productPrices.Count > 0)
            {
                _dbContext.ProductPrices.RemoveRange(productPrices);
            }

            var customerOverrides = await _dbContext.CustomerProductPriceOverrides
                .Where(x => x.PriceGroupId == id)
                .ToListAsync(cancellationToken);

            if (customerOverrides.Count > 0)
            {
                _dbContext.CustomerProductPriceOverrides.RemoveRange(customerOverrides);
            }

            _dbContext.PriceGroups.Remove(entity);

            await _dbContext.SaveChangesAsync(cancellationToken);
            await tx.CommitAsync(cancellationToken);
            return NoContent();
        }
        catch (DbUpdateException)
        {
            await tx.RollbackAsync(cancellationToken);
            return Conflict(new { success = false, message = "Bu fiyat kategorisi başka kayıtlarda kullanıldığı için silinemedi." });
        }
    }
}
