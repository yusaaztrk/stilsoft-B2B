using System.ComponentModel.DataAnnotations;
using System.Text.Json;
using B2B.Erp.Api.Core.Authorization;
using B2B.Erp.Api.Data;
using B2B.Erp.Api.Entities;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace B2B.Erp.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
[Authorize]
public sealed class BankAccountDefinitionsController : ControllerBase
{
    private readonly AppDbContext _dbContext;

    public BankAccountDefinitionsController(AppDbContext dbContext)
    {
        _dbContext = dbContext;
    }

    public sealed class CreateBankAccountDefinitionRequest
    {
        [Required]
        [Range(1, int.MaxValue)]
        public int BankDetailId { get; set; }

        [Required]
        [StringLength(50)]
        public string AccountCode { get; set; } = string.Empty;

        [Required]
        [StringLength(200)]
        public string AccountName { get; set; } = string.Empty;

        [Required]
        [StringLength(50)]
        public string AccountNo { get; set; } = string.Empty;

        [Required]
        public int AccountType { get; set; }

        [Required]
        public int CurrencyTypeId { get; set; }

        public decimal Budget { get; set; }

        /// <summary>Hesap kesim tarihi. Boş bırakılabilir; yalnız kredi kartı hesaplarında dolu.</summary>
        public DateOnly? StatementDate { get; set; }
    }

    public sealed class UpdateBankAccountDefinitionRequest
    {
        [Required]
        [Range(1, int.MaxValue)]
        public int BankDetailId { get; set; }

        [Required]
        [StringLength(50)]
        public string AccountCode { get; set; } = string.Empty;

        [Required]
        [StringLength(200)]
        public string AccountName { get; set; } = string.Empty;

        [Required]
        [StringLength(50)]
        public string AccountNo { get; set; } = string.Empty;

        [Required]
        public int AccountType { get; set; }

        [Required]
        public int CurrencyTypeId { get; set; }

        public decimal Budget { get; set; }

        /// <summary>Hesap kesim tarihi. Boş bırakılabilir; yalnız kredi kartı hesaplarında dolu.</summary>
        public DateOnly? StatementDate { get; set; }
    }

    private async Task<List<int>?> GetUserAssignedBankAccountIdsAsync(CancellationToken cancellationToken)
    {
        var isSuperAdmin = User.FindFirst("IsSuperAdmin")?.Value == "1" || User.FindFirst("IsSuperSuperAdmin")?.Value == "1";
        if (isSuperAdmin) return null;

        var username = User.Identity?.Name;
        if (string.IsNullOrWhiteSpace(username)) return null;

        var u = await _dbContext.Users
            .AsNoTracking()
            .Include(x => x.UserBankAccounts)
            .FirstOrDefaultAsync(x => x.Username == username, cancellationToken);

        if (u is null) return new List<int>();

        var ids = u.UserBankAccounts.Select(x => x.BankAccountId).Distinct().ToList();
        if (u.DefaultBankAccountId.HasValue && !ids.Contains(u.DefaultBankAccountId.Value))
        {
            ids.Add(u.DefaultBankAccountId.Value);
        }

        return ids;
    }

    [HttpGet]
    [AuthorizePage("users", "bankaHesapTanim")]
    [AuthorizePage("invoice", "faturaDokum")]
    [AuthorizePage("invoice", "satisFatura")]
    [AuthorizePage("invoice", "alis")]
    [AuthorizePage("cash", "kasaGirisCikis")]
    [AuthorizePage("cash", "kasalarArasiTransfer")]
    [AuthorizePage("bank", "bankaHavaleEft")]
    [AuthorizePage("check", "customerCheck")]
    [AuthorizePage("check", "debtCheck")]
    [AuthorizePage("check", "debtNote")]
    [AuthorizePage("reports", "bankaRaporlari")]
    public async Task<IActionResult> GetAll(CancellationToken cancellationToken)
    {
        var allowedBankIds = await GetUserAssignedBankAccountIdsAsync(cancellationToken);
        var q = _dbContext.BankAccountDefinitions
            .AsNoTracking()
            .Include(x => x.BankDetail)
            .AsQueryable();

        if (allowedBankIds != null)
        {
            q = q.Where(x => allowedBankIds.Contains(x.Id));
        }

        var list = await q
            .OrderByDescending(x => x.Id)
            .ToListAsync(cancellationToken);

        var data = list.Select(x =>
        {
            var name = (x.AccountName ?? string.Empty).ToUpperInvariant();
            var code = (x.AccountCode ?? string.Empty).ToUpperInvariant();
            var full = $"{name} {code}";

            /*
              KAYITLI PARA BİRİMİ KAZANIR — AD TAHMİNİ YALNIZCA YEDEKTİR (2026-08-24).

              Burada hesabın ADINDA "USD/DOLAR/EUR/GBP" geçiyorsa kayıtlı değer EZİLİYORDU.
              Sonuç: kullanıcı hesabı TL yapıp kaydediyor, kayıt gerçekten TL oluyor, ama liste
              adı okuyup yine "DOLAR" gösteriyordu. Kullanıcı bunu "hesabın dövizini
              değiştiremiyorum" diye yaşadı ve çekler yanlış para biriminde sanıldı
              (`102.2.1 ASBANK USD ÇEK TEMİNAT HESAP` — kayıtta TL, ekranda DOLAR).

              Üstelik sistemin geri kalanı (bakiye, hareket, rapor) KAYITLI değeri kullanıyor;
              yani yalnızca bu liste ayrı bir gerçek anlatıyordu.

              Ad tahmini bütünüyle atılmıyor: para birimi hiç atanmamış ESKİ kayıtlarda
              (`CurrencyTypeId == 0`) hâlâ tek ipucu o. Ama atanmış bir değeri asla ezmez.
            */
            int cur = x.CurrencyTypeId;
            if (cur == 0)
            {
                if (full.Contains("USD") || full.Contains("DOLAR")) cur = 3;
                else if (full.Contains("EUR") || full.Contains("EURO")) cur = 2;
                else if (full.Contains("GBP") || full.Contains("STERLİN") || full.Contains("STERLIN")) cur = 4;
                else cur = 1;
            }

            return new
            {
                id = x.Id,
                bankDetailId = x.BankDetailId,
                bankCode = x.BankDetail != null ? x.BankDetail.BankDetailCode : string.Empty,
                bankName = x.BankDetail != null ? x.BankDetail.Name : string.Empty,
                accountCode = x.AccountCode,
                accountName = x.AccountName,
                accountNo = x.AccountNo,
                accountType = x.AccountType,
                currencyTypeId = cur,
                budget = x.Budget,
                statementDate = x.StatementDate,
                createTime = x.CreateTime,
                createUser = x.CreateUser
            };
        }).ToList();

        return Ok(new { success = true, data });
    }

    [HttpPost]
    [AuthorizePage("users", "bankaHesapTanim")]
    public async Task<IActionResult> Create([FromBody] CreateBankAccountDefinitionRequest request, CancellationToken cancellationToken)
    {
        if (!ModelState.IsValid)
        {
            return ValidationProblem(ModelState);
        }

        var accountCode = (request.AccountCode ?? string.Empty).Trim();
        var accountName = (request.AccountName ?? string.Empty).Trim();
        var accountNo = (request.AccountNo ?? string.Empty).Trim();

        if (string.IsNullOrWhiteSpace(accountCode)) ModelState.AddModelError(nameof(request.AccountCode), "AccountCode is required.");
        if (string.IsNullOrWhiteSpace(accountName)) ModelState.AddModelError(nameof(request.AccountName), "AccountName is required.");
        if (string.IsNullOrWhiteSpace(accountNo)) ModelState.AddModelError(nameof(request.AccountNo), "AccountNo is required.");

        if (!ModelState.IsValid)
        {
            return ValidationProblem(ModelState);
        }

        var bankExists = await _dbContext.BankDetails
            .AsNoTracking()
            .AnyAsync(x => x.Id == request.BankDetailId, cancellationToken);

        if (!bankExists)
        {
            ModelState.AddModelError(nameof(request.BankDetailId), "BankDetailId is invalid.");
            return ValidationProblem(ModelState);
        }

        var uniqueExists = await _dbContext.BankAccountDefinitions
            .AsNoTracking()
            .AnyAsync(x => x.BankDetailId == request.BankDetailId && x.AccountCode == accountCode, cancellationToken);

        if (uniqueExists)
        {
            ModelState.AddModelError(nameof(request.AccountCode), "AccountCode must be unique per bank.");
            return ValidationProblem(ModelState);
        }

        // PARA BİRİMİ DOĞRULANIR. Doğrulanmadığında istemciden gelen her sayı (99, -1) hesaba
        // yazılabiliyordu; kur çözümleyen her yol o hesabı görünce ya patlıyor ya da sessizce
        // TL'ye düşüyordu. `0` sistemde TL'nin eski yazımıdır, normalize edilerek kabul edilir.
        if (!B2B.Erp.Api.Core.Helpers.CurrencyTypeHelper.IsKnown(request.CurrencyTypeId))
        {
            ModelState.AddModelError(nameof(request.CurrencyTypeId), "Geçersiz döviz tipi.");
            return ValidationProblem(ModelState);
        }

        var entity = new BankAccountDefinition
        {
            BankDetailId = request.BankDetailId,
            AccountCode = accountCode,
            AccountName = accountName,
            AccountNo = accountNo,
            AccountType = request.AccountType,
            CurrencyTypeId = B2B.Erp.Api.Core.Helpers.CurrencyTypeHelper.Normalize(request.CurrencyTypeId),
            Budget = request.Budget,
            StatementDate = request.StatementDate,
            CreateUser = User.Identity?.Name ?? "System",
            CreateTime = DateTime.UtcNow
        };

        _dbContext.BankAccountDefinitions.Add(entity);
        await _dbContext.SaveChangesAsync(cancellationToken);

        var created = await _dbContext.BankAccountDefinitions
            .AsNoTracking()
            .Include(x => x.BankDetail)
            .FirstOrDefaultAsync(x => x.Id == entity.Id, cancellationToken);

        return Ok(new
        {
            success = true,
            message = "Hesap oluşturuldu",
            data = created == null
                ? null
                : new
                {
                    id = created.Id,
                    bankDetailId = created.BankDetailId,
                    bankCode = created.BankDetail != null ? created.BankDetail.BankDetailCode : string.Empty,
                    bankName = created.BankDetail != null ? created.BankDetail.Name : string.Empty,
                    accountCode = created.AccountCode,
                    accountName = created.AccountName,
                    accountNo = created.AccountNo,
                    accountType = created.AccountType,
                    currencyTypeId = created.CurrencyTypeId,
                    budget = created.Budget,
                    statementDate = created.StatementDate,
                    createTime = created.CreateTime,
                    createUser = created.CreateUser
                }
        });
    }

    [HttpPut("{id:int}")]
    [AuthorizePage("users", "bankaHesapTanim")]
    public async Task<IActionResult> Update([FromRoute] int id, [FromBody] UpdateBankAccountDefinitionRequest request, CancellationToken cancellationToken)
    {
        if (!ModelState.IsValid)
        {
            return ValidationProblem(ModelState);
        }

        var entity = await _dbContext.BankAccountDefinitions.FirstOrDefaultAsync(x => x.Id == id, cancellationToken);
        if (entity is null)
        {
            return NotFound();
        }

        var accountCode = (request.AccountCode ?? string.Empty).Trim();
        var accountName = (request.AccountName ?? string.Empty).Trim();
        var accountNo = (request.AccountNo ?? string.Empty).Trim();

        if (string.IsNullOrWhiteSpace(accountCode)) ModelState.AddModelError(nameof(request.AccountCode), "AccountCode is required.");
        if (string.IsNullOrWhiteSpace(accountName)) ModelState.AddModelError(nameof(request.AccountName), "AccountName is required.");
        if (string.IsNullOrWhiteSpace(accountNo)) ModelState.AddModelError(nameof(request.AccountNo), "AccountNo is required.");

        if (!ModelState.IsValid)
        {
            return ValidationProblem(ModelState);
        }

        var bankExists = await _dbContext.BankDetails
            .AsNoTracking()
            .AnyAsync(x => x.Id == request.BankDetailId, cancellationToken);

        if (!bankExists)
        {
            ModelState.AddModelError(nameof(request.BankDetailId), "BankDetailId is invalid.");
            return ValidationProblem(ModelState);
        }

        var uniqueExists = await _dbContext.BankAccountDefinitions
            .AsNoTracking()
            .AnyAsync(x => x.Id != id && x.BankDetailId == request.BankDetailId && x.AccountCode == accountCode, cancellationToken);

        if (uniqueExists)
        {
            ModelState.AddModelError(nameof(request.AccountCode), "AccountCode must be unique per bank.");
            return ValidationProblem(ModelState);
        }

        // Ekleme ucuyla aynı doğrulama (kardeş yol).
        if (!B2B.Erp.Api.Core.Helpers.CurrencyTypeHelper.IsKnown(request.CurrencyTypeId))
        {
            ModelState.AddModelError(nameof(request.CurrencyTypeId), "Geçersiz döviz tipi.");
            return ValidationProblem(ModelState);
        }

        entity.BankDetailId = request.BankDetailId;
        entity.AccountCode = accountCode;
        entity.AccountName = accountName;
        entity.AccountNo = accountNo;
        entity.AccountType = request.AccountType;
        entity.CurrencyTypeId = B2B.Erp.Api.Core.Helpers.CurrencyTypeHelper.Normalize(request.CurrencyTypeId);
        entity.Budget = request.Budget;
        entity.StatementDate = request.StatementDate;
        entity.EditUser = User.Identity?.Name ?? "System";
        entity.EditTime = DateTime.UtcNow;

        await _dbContext.SaveChangesAsync(cancellationToken);

        var updated = await _dbContext.BankAccountDefinitions
            .AsNoTracking()
            .Include(x => x.BankDetail)
            .FirstOrDefaultAsync(x => x.Id == id, cancellationToken);

        return Ok(new
        {
            success = true,
            message = "Hesap güncellendi",
            data = updated == null
                ? null
                : new
                {
                    id = updated.Id,
                    bankDetailId = updated.BankDetailId,
                    bankCode = updated.BankDetail != null ? updated.BankDetail.BankDetailCode : string.Empty,
                    bankName = updated.BankDetail != null ? updated.BankDetail.Name : string.Empty,
                    accountCode = updated.AccountCode,
                    accountName = updated.AccountName,
                    accountNo = updated.AccountNo,
                    accountType = updated.AccountType,
                    currencyTypeId = updated.CurrencyTypeId,
                    budget = updated.Budget,
                    statementDate = updated.StatementDate,
                    createTime = updated.CreateTime,
                    createUser = updated.CreateUser
                }
        });
    }

    [HttpDelete("{id:int}")]
    [AuthorizePage("users", "bankaHesapTanim")]
    public async Task<IActionResult> Delete([FromRoute] int id, CancellationToken cancellationToken)
    {
        if (id <= 0) return BadRequest(new { success = false, message = "Geçersiz id" });

        var hasTransactions = await _dbContext.BankAccountTransactions
            .AsNoTracking()
            .AnyAsync(x => x.BankAccountDefinitionId == id, cancellationToken);

        if (hasTransactions)
        {
            return BadRequest(new
            {
                success = false,
                message = "Bu hesaba ait banka hareketleri bulunduğu için silinemez. (Öneri: Hesabı pasife alın veya önce hareketleri temizleyin.)"
            });
        }

        var entity = await _dbContext.BankAccountDefinitions
            .Include(x => x.BankDetail)
            .FirstOrDefaultAsync(x => x.Id == id, cancellationToken);

        if (entity is null)
        {
            return NotFound();
        }

        var detailsJson = JsonSerializer.Serialize(new
        {
            entity.Id,
            entity.BankDetailId,
            bankCode = entity.BankDetail?.BankDetailCode,
            bankName = entity.BankDetail?.Name,
            entity.AccountCode,
            entity.AccountName,
            entity.AccountNo,
            entity.AccountType,
            entity.CurrencyTypeId,
            entity.Budget,
            entity.StatementDate
        });

        _dbContext.BankAccountDefinitions.Remove(entity);

        _dbContext.DeletionLogs.Add(new DeletionLog
        {
            ModuleKey = "users",
            PageKey = "bankaHesapTanim",
            RecordType = nameof(BankAccountDefinition),
            RecordId = id.ToString(),
            Description = $"Bank account deleted: {entity.AccountCode}",
            DetailsJson = detailsJson,
            CreateUser = User.Identity?.Name ?? "System",
            CreateTime = DateTime.UtcNow
        });

        try
        {
            await _dbContext.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException ex) when (ex.InnerException is Npgsql.PostgresException pgEx && pgEx.SqlState == "23503")
        {
            return BadRequest(new
            {
                success = false,
                message = "Bu hesaba ait kayıtlar (banka hareketleri vb.) bulunduğu için silinemez."
            });
        }

        return Ok(new { success = true, message = "Silme tamamlandı" });
    }
}
