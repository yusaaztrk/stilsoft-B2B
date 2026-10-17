using System.ComponentModel.DataAnnotations;
using System.Security.Claims;
using B2B.Erp.Api.Core.Authorization;
using B2B.Erp.Api.Core.Helpers;
using B2B.Erp.Api.Data;
using B2B.Erp.Api.Dtos.CashAccounts;
using B2B.Erp.Api.Entities;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace B2B.Erp.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
[Authorize]
public sealed class CashAccountsController : ControllerBase
{
    private readonly AppDbContext _dbContext;

    public CashAccountsController(AppDbContext dbContext)
    {
        _dbContext = dbContext;
    }

    private static int NormalizeCurrencyTypeId(int currencyTypeId)
        => CurrencyTypeHelper.Normalize(currencyTypeId);

    private static DateTime NormalizeUtc(DateTime dt)
    {
        if (dt == default) return DateTime.UtcNow;
        return dt.Kind == DateTimeKind.Utc ? dt : DateTime.SpecifyKind(dt, DateTimeKind.Utc);
    }

    public sealed class CashAccountReportListItemResponse
    {
        public int Id { get; set; }
        public string Code { get; set; } = string.Empty;
        public string? Name { get; set; }
        public int CurrencyTypeId { get; set; }
        public string CurrencyCode { get; set; } = "TRY";
        public decimal InAmount { get; set; }
        public decimal OutAmount { get; set; }
        public decimal Balance { get; set; }
    }

    private sealed class CashFlowSums
    {
        public decimal In { get; set; }
        public decimal Out { get; set; }
    }

    /// <summary>
    /// Sums the movements of each cash account **in that account's own currency**.
    /// Amount always carries the TRY value and CurrencyAmount the account-currency value,
    /// so a TRY account must read Amount and a foreign account CurrencyAmount. Movements
    /// booked in another currency than the account are not silently mixed in.
    /// </summary>
    private async Task<Dictionary<int, CashFlowSums>> GetFlowsByCashAccountIdAsync(
        List<int> cashAccountIds,
        Dictionary<int, int> accountCurrencyById,
        CancellationToken cancellationToken)
    {
        var result = new Dictionary<int, CashFlowSums>();
        if (cashAccountIds.Count == 0) return result;

        // Group per (account, currency) and pick the matching bucket in memory —
        // the 0/1 "both mean TRY" rule cannot be expressed in SQL.
        var grouped = await _dbContext.CashAccountTransactions
            .AsNoTracking()
            .Where(x => cashAccountIds.Contains(x.CashAccountId))
            .GroupBy(x => new { x.CashAccountId, x.CurrencyTypeId })
            .Select(g => new
            {
                g.Key.CashAccountId,
                g.Key.CurrencyTypeId,
                InTry = g.Where(x => x.Direction == CashAccountTransactionDirection.In).Sum(x => (decimal?)x.Amount) ?? 0m,
                OutTry = g.Where(x => x.Direction == CashAccountTransactionDirection.Out).Sum(x => (decimal?)x.Amount) ?? 0m,
                InCurrency = g.Where(x => x.Direction == CashAccountTransactionDirection.In).Sum(x => (decimal?)x.CurrencyAmount) ?? 0m,
                OutCurrency = g.Where(x => x.Direction == CashAccountTransactionDirection.Out).Sum(x => (decimal?)x.CurrencyAmount) ?? 0m
            })
            .ToListAsync(cancellationToken);

        foreach (var id in cashAccountIds) result[id] = new CashFlowSums();

        foreach (var g in grouped)
        {
            if (!result.TryGetValue(g.CashAccountId, out var sums)) continue;

            var accountCurrency = accountCurrencyById.TryGetValue(g.CashAccountId, out var ac)
                ? ac
                : CurrencyTypeHelper.Try;

            // Movements in a different currency than the account are not comparable — skip them
            if (!CurrencyTypeHelper.SameCurrency(accountCurrency, g.CurrencyTypeId)) continue;

            if (CurrencyTypeHelper.IsTry(accountCurrency))
            {
                sums.In += g.InTry;
                sums.Out += g.OutTry;
            }
            else
            {
                sums.In += g.InCurrency;
                sums.Out += g.OutCurrency;
            }
        }

        return result;
    }

    private async Task<Dictionary<int, decimal>> GetBalancesByCashAccountIdAsync(List<int> cashAccountIds, CancellationToken cancellationToken)
    {
        if (cashAccountIds.Count == 0) return new Dictionary<int, decimal>();

        var carries = await _dbContext.CashAccounts
            .AsNoTracking()
            .Where(x => cashAccountIds.Contains(x.Id))
            .Select(x => new { x.Id, x.LastCarryAmount, x.CurrencyTypeId })
            .ToListAsync(cancellationToken);

        var carryById = carries.ToDictionary(x => x.Id, x => (decimal)x.LastCarryAmount);
        var currencyById = carries.ToDictionary(x => x.Id, x => NormalizeCurrencyTypeId(x.CurrencyTypeId));

        var flows = await GetFlowsByCashAccountIdAsync(cashAccountIds, currencyById, cancellationToken);

        var result = new Dictionary<int, decimal>();
        foreach (var id in cashAccountIds)
        {
            var carry = carryById.TryGetValue(id, out var c) ? c : 0m;
            var f = flows.TryGetValue(id, out var ff) ? ff : new CashFlowSums();
            result[id] = carry + (f.In - f.Out);
        }

        return result;
    }

    private async Task<List<int>?> GetUserAssignedCashAccountIdsAsync(CancellationToken cancellationToken)
    {
        var isSuperAdmin = User.FindFirst("IsSuperAdmin")?.Value == "1" || User.FindFirst("IsSuperSuperAdmin")?.Value == "1";
        if (isSuperAdmin) return null;

        var username = User.Identity?.Name;
        if (string.IsNullOrWhiteSpace(username)) return null;

        var u = await _dbContext.Users
            .AsNoTracking()
            .Include(x => x.UserCashAccounts)
            .FirstOrDefaultAsync(x => x.Username == username, cancellationToken);

        if (u is null) return new List<int>();

        var ids = u.UserCashAccounts.Select(x => x.CashAccountId).Distinct().ToList();
        if (u.DefaultCashAccountId.HasValue && !ids.Contains(u.DefaultCashAccountId.Value))
        {
            ids.Add(u.DefaultCashAccountId.Value);
        }

        return ids;
    }

    [HttpGet]
    [AuthorizePage("users", "kasalarim")]
    [AuthorizePage("invoice", "faturaDokum")]
    [AuthorizePage("invoice", "satisFatura")]
    [AuthorizePage("invoice", "alis")]
    [AuthorizePage("cash", "kasaGirisCikis")]
    [AuthorizePage("cash", "kasalarArasiTransfer")]
    [AuthorizePage("bank", "bankaHavaleEft")]
    [AuthorizePage("check", "customerCheck")]
    [AuthorizePage("check", "debtCheck")]
    [AuthorizePage("check", "debtNote")]
    [AuthorizePage("reports", "kasaRaporlari")]
    public async Task<IActionResult> List(CancellationToken cancellationToken = default)
    {
        var allowedCashIds = await GetUserAssignedCashAccountIdsAsync(cancellationToken);
        var q = _dbContext.CashAccounts.AsNoTracking();
        if (allowedCashIds != null)
        {
            q = q.Where(x => allowedCashIds.Contains(x.Id));
        }

        var items = await q
            .OrderBy(x => x.Name)
            .ThenBy(x => x.Code)
            .Select(x => new
            {
                x.Id,
                x.Code,
                x.Name,
                x.LastCarryDate,
                x.LastCarryAmount,
                x.CurrencyTypeId
            })
            .ToListAsync(cancellationToken);

        var ids = items.Select(x => x.Id).ToList();
        var balances = await GetBalancesByCashAccountIdAsync(ids, cancellationToken);

        var data = items.Select(x => new CashAccountListItemResponse
        {
            Id = x.Id,
            Code = x.Code,
            Name = x.Name,
            LastCarryDate = x.LastCarryDate,
            LastCarryAmount = x.LastCarryAmount,
            CurrencyTypeId = x.CurrencyTypeId,
            Balance = balances.TryGetValue(x.Id, out var b) ? b : 0m
        }).ToList();

        return Ok(new { success = true, data });
    }

    [HttpGet("report")]
    [AuthorizePage("reports", "kasaRaporlari")]
    public async Task<IActionResult> Report(CancellationToken cancellationToken = default)
    {
        var allowedCashIds = await GetUserAssignedCashAccountIdsAsync(cancellationToken);
        var q = _dbContext.CashAccounts.AsNoTracking();
        if (allowedCashIds != null)
        {
            q = q.Where(x => allowedCashIds.Contains(x.Id));
        }

        var items = await q
            .OrderBy(x => x.Code)
            .Select(x => new { x.Id, x.Code, x.Name, x.LastCarryAmount, x.CurrencyTypeId })
            .ToListAsync(cancellationToken);

        var ids = items.Select(x => x.Id).ToList();
        if (ids.Count == 0) return Ok(new { success = true, data = Array.Empty<CashAccountReportListItemResponse>() });

        var currencyById = items.ToDictionary(x => x.Id, x => NormalizeCurrencyTypeId(x.CurrencyTypeId));
        var carryById = items.ToDictionary(x => x.Id, x => (decimal)x.LastCarryAmount);

        var flows = await GetFlowsByCashAccountIdAsync(ids, currencyById, cancellationToken);

        var data = items.Select(x =>
        {
            var carry = carryById.TryGetValue(x.Id, out var c) ? c : 0m;
            var f = flows.TryGetValue(x.Id, out var ff) ? ff : new CashFlowSums();
            var balance = carry + (f.In - f.Out);

            return new CashAccountReportListItemResponse
            {
                Id = x.Id,
                Code = x.Code,
                Name = x.Name,
                // Report the normalized id so the UI never has to guess whether 0 or 1 is TRY
                CurrencyTypeId = NormalizeCurrencyTypeId(x.CurrencyTypeId),
                CurrencyCode = CurrencyTypeHelper.ToCodeOrTry(x.CurrencyTypeId),
                InAmount = f.In,
                OutAmount = f.Out,
                Balance = balance
            };
        }).ToList();

        return Ok(new { success = true, data });
    }

    public sealed class GetBalanceResponse
    {
        public int CashAccountId { get; set; }
        public decimal Balance { get; set; }
    }

    public sealed class CurrencyBalanceDto
    {
        public int CurrencyTypeId { get; set; }
        public string CurrencyCode { get; set; } = string.Empty;
        public decimal Balance { get; set; }
    }

    public sealed class GetMultiCurrencyBalanceResponse
    {
        public int CashAccountId { get; set; }
        public List<CurrencyBalanceDto> Balances { get; set; } = new();
    }

    [HttpGet("{id:int}/balance")]
    [AuthorizePage("cash", "kasaGirisCikis")]
    public async Task<IActionResult> Balance([FromRoute] int id, CancellationToken cancellationToken = default)
    {
        if (id <= 0) return BadRequest(new { success = false, message = "Geçersiz id" });

        var exists = await _dbContext.CashAccounts
            .AsNoTracking()
            .AnyAsync(x => x.Id == id, cancellationToken);

        if (!exists) return NotFound(new { success = false, message = "Kasa bulunamadı" });

        var balances = await GetBalancesByCashAccountIdAsync(new List<int> { id }, cancellationToken);
        var bal = balances.TryGetValue(id, out var b) ? b : 0m;

        return Ok(new { success = true, data = new GetBalanceResponse { CashAccountId = id, Balance = bal } });
    }

    [HttpGet("{id:int}/balance-by-currency")]
    [AuthorizePage("cash", "kasaGirisCikis")]
    public async Task<IActionResult> BalanceByCurrency([FromRoute] int id, CancellationToken cancellationToken = default)
    {
        if (id <= 0) return BadRequest(new { success = false, message = "Geçersiz id" });

        var cashAccount = await _dbContext.CashAccounts
            .AsNoTracking()
            .FirstOrDefaultAsync(x => x.Id == id, cancellationToken);

        if (cashAccount is null) return NotFound(new { success = false, message = "Kasa bulunamadı" });

        // Get carry amount by currency (from cash account's CurrencyTypeId).
        // Normalize so the legacy 0 and the current 1 do not produce two separate TRY rows.
        var carryByCurrency = new Dictionary<int, decimal>
        {
            [CurrencyTypeHelper.Normalize(cashAccount.CurrencyTypeId)] = (decimal)cashAccount.LastCarryAmount
        };

        // Calculate transaction sums by currency. Amount holds the TRY value and
        // CurrencyAmount the foreign value, so TRY rows must read Amount.
        var rawSums = await _dbContext.CashAccountTransactions
            .AsNoTracking()
            .Where(x => x.CashAccountId == id)
            .GroupBy(x => x.CurrencyTypeId)
            .Select(g => new
            {
                CurrencyTypeId = g.Key,
                InTry = g.Where(x => x.Direction == CashAccountTransactionDirection.In).Sum(x => (decimal?)x.Amount) ?? 0m,
                OutTry = g.Where(x => x.Direction == CashAccountTransactionDirection.Out).Sum(x => (decimal?)x.Amount) ?? 0m,
                InCurrency = g.Where(x => x.Direction == CashAccountTransactionDirection.In).Sum(x => (decimal?)x.CurrencyAmount) ?? 0m,
                OutCurrency = g.Where(x => x.Direction == CashAccountTransactionDirection.Out).Sum(x => (decimal?)x.CurrencyAmount) ?? 0m
            })
            .ToListAsync(cancellationToken);

        var txSums = rawSums
            .GroupBy(x => CurrencyTypeHelper.Normalize(x.CurrencyTypeId))
            .Select(g => new
            {
                CurrencyTypeId = g.Key,
                InAmount = CurrencyTypeHelper.IsTry(g.Key) ? g.Sum(x => x.InTry) : g.Sum(x => x.InCurrency),
                OutAmount = CurrencyTypeHelper.IsTry(g.Key) ? g.Sum(x => x.OutTry) : g.Sum(x => x.OutCurrency)
            })
            .ToList();

        // Collect all currency IDs
        var allCurrencyIds = carryByCurrency.Keys
            .Union(txSums.Select(x => x.CurrencyTypeId))
            .Distinct()
            .OrderBy(x => x)
            .ToList();

        var balances = new List<CurrencyBalanceDto>();
        foreach (var currencyId in allCurrencyIds)
        {
            var carry = carryByCurrency.TryGetValue(currencyId, out var c) ? c : 0m;
            var txSum = txSums.FirstOrDefault(x => x.CurrencyTypeId == currencyId);
            var txBalance = txSum is null ? 0m : (txSum.InAmount - txSum.OutAmount);
            var totalBalance = carry + txBalance;

            balances.Add(new CurrencyBalanceDto
            {
                CurrencyTypeId = currencyId,
                CurrencyCode = CurrencyTypeHelper.ToCodeOrTry(currencyId),
                Balance = totalBalance
            });
        }

        // If no transactions or carry, at least show the account's default currency with zero balance
        if (balances.Count == 0)
        {
            balances.Add(new CurrencyBalanceDto
            {
                CurrencyTypeId = CurrencyTypeHelper.Normalize(cashAccount.CurrencyTypeId),
                CurrencyCode = CurrencyTypeHelper.ToCodeOrTry(cashAccount.CurrencyTypeId),
                Balance = 0m
            });
        }

        return Ok(new
        {
            success = true,
            data = new GetMultiCurrencyBalanceResponse
            {
                CashAccountId = id,
                Balances = balances
            }
        });
    }

    [HttpPost]
    [AuthorizePage("users", "kasalarim")]
    public async Task<IActionResult> Create([FromBody] CreateCashAccountRequest request, CancellationToken cancellationToken)
    {
        if (!ModelState.IsValid) return ValidationProblem(ModelState);

        var code = (request.Code ?? string.Empty).Trim();
        if (string.IsNullOrWhiteSpace(code))
        {
            return BadRequest(new { success = false, message = "Kasa kodu zorunludur" });
        }

        var exists = await _dbContext.CashAccounts
            .AsNoTracking()
            .AnyAsync(x => x.Code == code, cancellationToken);

        if (exists)
        {
            return Conflict(new { success = false, message = "Kasa kodu zaten mevcut" });
        }

        var now = DateTime.UtcNow;
        var username = User.FindFirst(ClaimTypes.Name)?.Value;
        if (string.IsNullOrWhiteSpace(username)) username = "System";

        var currencyTypeId = NormalizeCurrencyTypeId(request.CurrencyTypeId);
        if (currencyTypeId < 1 || currencyTypeId > 4)
        {
            return BadRequest(new { success = false, message = "Geçersiz döviz tipi" });
        }

        var entity = new CashAccount
        {
            Code = code,
            Name = string.IsNullOrWhiteSpace(request.Name) ? null : request.Name.Trim(),
            LastCarryDate = NormalizeUtc(request.LastCarryDate == default ? now : request.LastCarryDate),
            LastCarryAmount = request.LastCarryAmount,
            CurrencyTypeId = currencyTypeId,
            CreateUser = username,
            CreateTime = now
        };

        _dbContext.CashAccounts.Add(entity);
        await _dbContext.SaveChangesAsync(cancellationToken);

        return StatusCode(StatusCodes.Status201Created, new { success = true, data = new { id = entity.Id } });
    }

    [HttpPut("{id:int}")]
    [AuthorizePage("users", "kasalarim")]
    public async Task<IActionResult> Update([FromRoute] int id, [FromBody] UpdateCashAccountRequest request, CancellationToken cancellationToken)
    {
        if (id <= 0) return BadRequest(new { success = false, message = "Geçersiz id" });
        if (!ModelState.IsValid) return ValidationProblem(ModelState);

        var entity = await _dbContext.CashAccounts.FirstOrDefaultAsync(x => x.Id == id, cancellationToken);
        if (entity is null) return NotFound(new { success = false, message = "Kasa bulunamadı" });

        var code = (request.Code ?? string.Empty).Trim();
        if (string.IsNullOrWhiteSpace(code))
        {
            return BadRequest(new { success = false, message = "Kasa kodu zorunludur" });
        }

        var codeExists = await _dbContext.CashAccounts
            .AsNoTracking()
            .AnyAsync(x => x.Id != id && x.Code == code, cancellationToken);

        if (codeExists)
        {
            return Conflict(new { success = false, message = "Kasa kodu zaten mevcut" });
        }

        var now = DateTime.UtcNow;
        var username = User.FindFirst(ClaimTypes.Name)?.Value;
        if (string.IsNullOrWhiteSpace(username)) username = "System";

        // KARDEŞ YOL ASİMETRİSİ: oluşturma ucu `< 1 || > 4` diyor (satır 414), güncelleme ucu
        // `< 0 || > 3` diyordu. Sonuç: GBP (4) kasası AÇILABİLİYOR ama sonra adı bile
        // değiştirilemiyordu ("Geçersiz döviz tipi"), buna karşılık 0 kabul ediliyordu.
        var currencyTypeId = NormalizeCurrencyTypeId(request.CurrencyTypeId);
        if (currencyTypeId < 1 || currencyTypeId > 4)
        {
            return BadRequest(new { success = false, message = "Geçersiz döviz tipi" });
        }

        entity.Code = code;
        entity.Name = string.IsNullOrWhiteSpace(request.Name) ? null : request.Name.Trim();
        entity.LastCarryDate = NormalizeUtc(request.LastCarryDate == default ? entity.LastCarryDate : request.LastCarryDate);
        // DEVİR TUTARI ARTIK GÜNCELLENİYOR (2026-08-22).
        //
        // Bu satır YOKTU: tarih güncelleniyor ama tutar hiç yazılmıyordu, dolayısıyla devir
        // bakiyesi kasa oluşturulduktan sonra hiçbir şekilde düzeltilemiyordu. Ekrandaki
        // alanın kilitli olmasının sebebi de buydu.
        // NULL gelirse dokunulmaz (bkz. DTO): alanı göndermeyen bir çağıran deviri silmesin.
        if (request.LastCarryAmount.HasValue)
        {
            entity.LastCarryAmount = request.LastCarryAmount.Value;
        }
        entity.CurrencyTypeId = currencyTypeId;
        entity.EditUser = username;
        entity.EditTime = now;

        await _dbContext.SaveChangesAsync(cancellationToken);

        return Ok(new { success = true });
    }

    [HttpDelete("{id:int}")]
    [AuthorizePage("users", "kasalarim")]
    public async Task<IActionResult> Delete([FromRoute] int id, CancellationToken cancellationToken)
    {
        if (id <= 0) return BadRequest(new { success = false, message = "Geçersiz id" });

        var entity = await _dbContext.CashAccounts.FirstOrDefaultAsync(x => x.Id == id, cancellationToken);
        if (entity is null) return NotFound(new { success = false, message = "Kasa bulunamadı" });

        var hasAnyTx = await _dbContext.CashAccountTransactions
            .AsNoTracking()
            .AnyAsync(x => x.CashAccountId == id, cancellationToken);

        if (hasAnyTx)
        {
            return BadRequest(new { success = false, message = "Bu kasada işlem var, silinemez" });
        }

        _dbContext.CashAccounts.Remove(entity);
        await _dbContext.SaveChangesAsync(cancellationToken);

        return Ok(new { success = true });
    }
}
