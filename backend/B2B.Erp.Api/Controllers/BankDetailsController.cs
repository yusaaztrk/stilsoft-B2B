using B2B.Erp.Api.Core.Authorization;
using B2B.Erp.Api.Data;
using System.ComponentModel.DataAnnotations;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace B2B.Erp.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
[Authorize]
[AuthorizePage("users", "bankaHesapTanim")]
public sealed class BankDetailsController : ControllerBase
{
    private readonly AppDbContext _dbContext;

    public BankDetailsController(AppDbContext dbContext)
    {
        _dbContext = dbContext;
    }

    [HttpGet("dropdown")]
    [AuthorizePage("users", "bankaHesapTanim")]
    [AuthorizePage("check", "customerCheck")]
    [AuthorizePage("check", "debtCheck")]
    [AuthorizePage("check", "debtNote")]
    public async Task<IActionResult> GetDropdown([FromQuery] bool includeInactive = false, CancellationToken cancellationToken = default)
    {
        var query = _dbContext.BankDetails.AsNoTracking().AsQueryable();
        if (!includeInactive)
        {
            query = query.Where(x => x.IsActive);
        }

        var data = await query
            .OrderBy(x => x.Name)
            .ThenBy(x => x.Id)
            .Select(x => new
            {
                id = x.Id,
                name = x.Name,
                bankCode = x.BankDetailCode,
                isActive = x.IsActive
            })
            .ToListAsync(cancellationToken);

        return Ok(new { success = true, data });
    }

    [HttpGet("{id}")]
    public async Task<IActionResult> GetById([FromRoute] int id, CancellationToken cancellationToken = default)
    {
        var entity = await _dbContext.BankDetails
            .AsNoTracking()
            .FirstOrDefaultAsync(x => x.Id == id, cancellationToken);

        if (entity == null)
        {
            return NotFound(new { success = false, message = "Banka bulunamadı" });
        }

        return Ok(new
        {
            success = true,
            data = new
            {
                id = entity.Id,
                name = entity.Name,
                bankCode = entity.BankDetailCode,
                isActive = entity.IsActive
            }
        });
    }

    public sealed class CreateBankDetailRequest
    {
        [Required]
        [StringLength(200)]
        public string Name { get; set; } = string.Empty;

        [Required]
        [StringLength(20)]
        public string BankCode { get; set; } = string.Empty;

        public bool IsActive { get; set; } = true;
    }

    [HttpPost]
    public async Task<IActionResult> Create([FromBody] CreateBankDetailRequest request, CancellationToken cancellationToken = default)
    {
        if (!ModelState.IsValid)
        {
            return ValidationProblem(ModelState);
        }

        var name = (request.Name ?? string.Empty).Trim();
        var bankCode = (request.BankCode ?? string.Empty).Trim();

        if (string.IsNullOrWhiteSpace(name)) ModelState.AddModelError(nameof(request.Name), "Name is required.");
        if (string.IsNullOrWhiteSpace(bankCode)) ModelState.AddModelError(nameof(request.BankCode), "BankCode is required.");

        if (!ModelState.IsValid)
        {
            return ValidationProblem(ModelState);
        }

        var exists = await _dbContext.BankDetails
            .AsNoTracking()
            .AnyAsync(x => x.BankDetailCode == bankCode, cancellationToken);

        if (exists)
        {
            ModelState.AddModelError(nameof(request.BankCode), "BankCode must be unique.");
            return ValidationProblem(ModelState);
        }

        var entity = new Entities.BankDetail
        {
            Name = name,
            BankDetailCode = bankCode,
            IsActive = request.IsActive
        };

        _dbContext.BankDetails.Add(entity);
        await _dbContext.SaveChangesAsync(cancellationToken);

        return Ok(new
        {
            success = true,
            message = "Banka oluşturuldu",
            data = new
            {
                id = entity.Id,
                name = entity.Name,
                bankCode = entity.BankDetailCode,
                isActive = entity.IsActive
            }
        });
    }

    [HttpDelete("{id}")]
    public async Task<IActionResult> Delete([FromRoute] int id, CancellationToken cancellationToken = default)
    {
        var entity = await _dbContext.BankDetails
            .FirstOrDefaultAsync(x => x.Id == id, cancellationToken);

        if (entity == null)
        {
            return NotFound(new { success = false, message = "Banka bulunamadı" });
        }

        // Banka hesap tanımları varsa silmeyi engelle
        var hasRelatedAccounts = await _dbContext.BankAccountDefinitions
            .AsNoTracking()
            .AnyAsync(x => x.BankDetailId == id, cancellationToken);

        if (hasRelatedAccounts)
        {
            return BadRequest(new { success = false, message = "Bu bankaya ait hesap tanımları olduğu için silinemez" });
        }

        _dbContext.BankDetails.Remove(entity);
        await _dbContext.SaveChangesAsync(cancellationToken);

        return Ok(new { success = true, message = "Banka silindi" });
    }
}
