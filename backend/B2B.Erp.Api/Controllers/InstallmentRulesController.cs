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
public sealed class InstallmentRulesController : ControllerBase
{
    private readonly AppDbContext _dbContext;

    public InstallmentRulesController(AppDbContext dbContext)
    {
        _dbContext = dbContext;
    }

    public sealed class CreateInstallmentRuleRequest
    {
        [Required]
        [StringLength(200)]
        public string BankName { get; set; } = string.Empty;

        [Required]
        [StringLength(2000)]
        public string InstallmentText { get; set; } = string.Empty;

        [Required]
        [StringLength(2000)]
        public string MinAmountText { get; set; } = string.Empty;

        [Required]
        [StringLength(4000)]
        public string DescriptionText { get; set; } = string.Empty;

        public int? SortOrder { get; set; }
    }

    public sealed class UpdateInstallmentRuleRequest
    {
        [Required]
        [StringLength(200)]
        public string BankName { get; set; } = string.Empty;

        [Required]
        [StringLength(2000)]
        public string InstallmentText { get; set; } = string.Empty;

        [Required]
        [StringLength(2000)]
        public string MinAmountText { get; set; } = string.Empty;

        [Required]
        [StringLength(4000)]
        public string DescriptionText { get; set; } = string.Empty;

        public int? SortOrder { get; set; }

        public bool? IsActive { get; set; }
    }

    /// <summary>
    /// TAKSİT ORANLARINI OKUMAK SAYFA YETKİSİ İSTEMEZ (2026-08-27 kullanıcı kararı:
    /// "o tablo okunmalı, sadece ayar kapalı olmalı").
    ///
    /// <para>Bu uç, Kredi Kartı ile Ödeme sayfasının altındaki "Taksit Oranları" tablosunu
    /// besliyor. Tablo, ödemeyi yapan kişiye hangi bankada kaç taksit olduğunu gösteren
    /// BİLGİDİR; gizli veri değil.</para>
    ///
    /// <para>Uç eskiden yönetim sayfasının yetkisini (<c>pos.taksitOranlari</c> /
    /// <c>users.installmentRules</c>) istiyordu. Canlıda o anahtar YALNIZCA SuperAdmin'de
    /// açıktı — Bayi, Yönetim, Müdür, Muhasebe dahil 13 rolün hiçbirinde yoktu. Sonuç: uç
    /// 403 dönüyor, istemci hatayı yutup boş tablo gösteriyordu; kullanıcı "hiç gelmiyor"
    /// diye bildiriyordu.</para>
    ///
    /// <para>YAZMA UÇLARI DEĞİŞMEDİ: oran eklemek/değiştirmek/silmek hâlâ aynı iki sayfa
    /// yetkisinden birini ister. Açılan yalnızca okumadır; sınıf düzeyindeki
    /// <c>[Authorize]</c> hâlâ oturum arıyor, uç anonim değil.</para>
    /// </summary>
    [HttpGet]
    public async Task<IActionResult> GetAll([FromQuery] bool includeInactive = false, CancellationToken cancellationToken = default)
    {
        var query = _dbContext.InstallmentRules.AsNoTracking();
        if (!includeInactive)
        {
            query = query.Where(x => x.IsActive);
        }

        var data = await query
            .OrderBy(x => x.SortOrder)
            .ThenBy(x => x.BankName)
            .Select(x => new
            {
                id = x.Id,
                bankName = x.BankName,
                installmentText = x.InstallmentText,
                minAmountText = x.MinAmountText,
                descriptionText = x.DescriptionText,
                sortOrder = x.SortOrder,
                isActive = x.IsActive
            })
            .ToListAsync(cancellationToken);

        return Ok(new { success = true, data });
    }

    [HttpPost]
    [AuthorizePage("pos", "taksitOranlari")]
    [AuthorizePage("users", "installmentRules")]
    [ProducesResponseType(StatusCodes.Status201Created)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<IActionResult> Create([FromBody] CreateInstallmentRuleRequest request, CancellationToken cancellationToken)
    {
        var bankName = (request.BankName ?? string.Empty).Trim();
        var inst = (request.InstallmentText ?? string.Empty).Trim();
        var min = (request.MinAmountText ?? string.Empty).Trim();
        var desc = (request.DescriptionText ?? string.Empty).Trim();

        if (string.IsNullOrWhiteSpace(bankName)) ModelState.AddModelError(nameof(request.BankName), "BankName is required.");
        if (string.IsNullOrWhiteSpace(inst)) ModelState.AddModelError(nameof(request.InstallmentText), "InstallmentText is required.");
        if (min.Length == 0) ModelState.AddModelError(nameof(request.MinAmountText), "MinAmountText is required.");
        if (desc.Length == 0) ModelState.AddModelError(nameof(request.DescriptionText), "DescriptionText is required.");

        if (!ModelState.IsValid)
        {
            return ValidationProblem(ModelState);
        }

        var nextSort = request.SortOrder;
        if (nextSort is null)
        {
            var max = await _dbContext.InstallmentRules.AsNoTracking().MaxAsync(x => (int?)x.SortOrder, cancellationToken);
            nextSort = (max ?? 0) + 1;
        }

        var entity = new Entities.InstallmentRule
        {
            Id = Guid.NewGuid(),
            BankName = bankName,
            InstallmentText = inst,
            MinAmountText = min,
            DescriptionText = desc,
            SortOrder = nextSort.Value,
            IsActive = true
        };

        _dbContext.InstallmentRules.Add(entity);
        await _dbContext.SaveChangesAsync(cancellationToken);

        return CreatedAtAction(nameof(GetAll), new { id = entity.Id }, new
        {
            id = entity.Id,
            bankName = entity.BankName,
            installmentText = entity.InstallmentText,
            minAmountText = entity.MinAmountText,
            descriptionText = entity.DescriptionText,
            sortOrder = entity.SortOrder,
            isActive = entity.IsActive
        });
    }

    [HttpPut("{id:guid}")]
    [AuthorizePage("pos", "taksitOranlari")]
    [AuthorizePage("users", "installmentRules")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> Update(Guid id, [FromBody] UpdateInstallmentRuleRequest request, CancellationToken cancellationToken)
    {
        var entity = await _dbContext.InstallmentRules.FirstOrDefaultAsync(x => x.Id == id, cancellationToken);
        if (entity is null)
        {
            return NotFound();
        }

        var bankName = (request.BankName ?? string.Empty).Trim();
        var inst = (request.InstallmentText ?? string.Empty).Trim();
        var min = (request.MinAmountText ?? string.Empty).Trim();
        var desc = (request.DescriptionText ?? string.Empty).Trim();

        if (string.IsNullOrWhiteSpace(bankName))
        {
            ModelState.AddModelError(nameof(request.BankName), "BankName is required.");
            return ValidationProblem(ModelState);
        }

        entity.BankName = bankName;
        entity.InstallmentText = inst;
        entity.MinAmountText = min;
        entity.DescriptionText = desc;

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
            bankName = entity.BankName,
            installmentText = entity.InstallmentText,
            minAmountText = entity.MinAmountText,
            descriptionText = entity.DescriptionText,
            sortOrder = entity.SortOrder,
            isActive = entity.IsActive
        });
    }

    [HttpDelete("{id:guid}")]
    [AuthorizePage("pos", "taksitOranlari")]
    [AuthorizePage("users", "installmentRules")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> Delete(Guid id, CancellationToken cancellationToken)
    {
        var entity = await _dbContext.InstallmentRules.FirstOrDefaultAsync(x => x.Id == id, cancellationToken);
        if (entity is null)
        {
            return NotFound();
        }

        entity.IsActive = false;
        await _dbContext.SaveChangesAsync(cancellationToken);
        return NoContent();
    }

    [HttpDelete("{id:guid}/hard")]
    [AuthorizePage("pos", "taksitOranlari")]
    [AuthorizePage("users", "installmentRules")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> HardDelete(Guid id, CancellationToken cancellationToken)
    {
        var entity = await _dbContext.InstallmentRules.FirstOrDefaultAsync(x => x.Id == id, cancellationToken);
        if (entity is null)
        {
            return NotFound();
        }

        _dbContext.InstallmentRules.Remove(entity);
        await _dbContext.SaveChangesAsync(cancellationToken);
        return NoContent();
    }
}


