using System.Security.Claims;
using B2B.Erp.Api.Core.Authorization;
using B2B.Erp.Api.Data;
using B2B.Erp.Api.Entities;
using B2B.Erp.Api.Features.PosAccounts;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace B2B.Erp.Api.Controllers;

[ApiController]
[Route("api/pos-accounts")]
[Authorize]
public sealed class PosAccountsController : ControllerBase
{
    private readonly AppDbContext _dbContext;
    private readonly PosAccountTransferService _transferService;

    public PosAccountsController(AppDbContext dbContext, PosAccountTransferService transferService)
    {
        _dbContext = dbContext;
        _transferService = transferService;
    }

    private string CurrentUser =>
        User.FindFirst(ClaimTypes.Name)?.Value
        ?? User.FindFirst("username")?.Value
        ?? "SYSTEM";

    /// <summary>
    /// POS accounts with their sweep configuration. Every AccountType 14 account is listed,
    /// configured or not, so an account that has never been set up is visible rather than
    /// silently absent from the screen that exists to set it up.
    /// </summary>
    [HttpGet("settings")]
    [AuthorizePage("users", "posHesapAyar")]
    public async Task<IActionResult> GetSettings(CancellationToken cancellationToken)
    {
        var posAccounts = await _dbContext.BankAccountDefinitions
            .AsNoTracking()
            .Where(x => x.AccountType == PosAccountTransferService.PosAccountType)
            .OrderBy(x => x.AccountName)
            .Select(x => new { x.Id, x.AccountCode, x.AccountName, x.AccountNo, x.BankDetailId })
            .ToListAsync(cancellationToken);

        var settings = await _dbContext.PosAccountSettings.AsNoTracking().ToListAsync(cancellationToken);

        var posDefinitions = await _dbContext.VirtualPosDefinitions
            .AsNoTracking()
            .Select(x => new { x.BankCode, x.BankName, x.NethesCode, x.PosType })
            .ToListAsync(cancellationToken);

        var data = posAccounts.Select(a =>
        {
            var s = settings.FirstOrDefault(x => x.PosBankAccountDefinitionId == a.Id);

            // Mirrors VirtualPosAccountingService.ResolvePosBankAsync: the explicit binding
            // wins, the naming convention is the fallback. The screen must show the link the
            // accounting actually uses — showing only the convention is what let a renamed
            // account read "Sanal POS yok" while money was silently failing to post.
            var bound = s?.VirtualPosBankCode == null
                ? null
                : posDefinitions.FirstOrDefault(p => p.BankCode == s.VirtualPosBankCode.Value);

            var byConvention = posDefinitions
                .FirstOrDefault(p => string.Equals(p.NethesCode, a.AccountCode, StringComparison.OrdinalIgnoreCase));

            var effective = bound ?? byConvention;

            return new
            {
                posBankAccountDefinitionId = a.Id,
                accountCode = a.AccountCode,
                accountName = a.AccountName,
                accountNo = a.AccountNo,
                targetBankAccountDefinitionId = s?.TargetBankAccountDefinitionId,
                virtualPosBankCode = s?.VirtualPosBankCode,
                transferTime = s == null ? "01:00" : s.TransferTime.ToString(@"hh\:mm"),
                isAutoTransferEnabled = s?.IsAutoTransferEnabled ?? true,
                isConfigured = s?.TargetBankAccountDefinitionId != null,
                matchedProvider = effective == null
                    ? null
                    : new { effective.BankCode, effective.BankName, effective.PosType },
                // Lets the screen distinguish "bound on purpose" from "happens to match by
                // name", so an operator can see which links are resting on the fragile one.
                matchSource = effective == null ? "none" : bound != null ? "explicit" : "convention"
            };
        }).ToList();

        var targets = await _dbContext.BankAccountDefinitions
            .AsNoTracking()
            .Where(x => x.AccountType != PosAccountTransferService.PosAccountType)
            .OrderBy(x => x.AccountName)
            .Select(x => new { x.Id, x.AccountCode, x.AccountName, x.CurrencyTypeId })
            .ToListAsync(cancellationToken);

        var providers = posDefinitions
            .OrderBy(x => x.BankName)
            .Select(x => new { x.BankCode, x.BankName, x.PosType })
            .ToList();

        return Ok(new { success = true, data = new { posAccounts = data, targetAccounts = targets, providers } });
    }

    public sealed class SaveSettingRequest
    {
        public int PosBankAccountDefinitionId { get; set; }
        public int? TargetBankAccountDefinitionId { get; set; }
        public int? VirtualPosBankCode { get; set; }
        public string TransferTime { get; set; } = "01:00";
        public bool IsAutoTransferEnabled { get; set; } = true;
    }

    [HttpPut("settings")]
    [AuthorizePage("users", "posHesapAyar")]
    public async Task<IActionResult> SaveSetting([FromBody] SaveSettingRequest request, CancellationToken cancellationToken)
    {
        if (request == null || request.PosBankAccountDefinitionId <= 0)
        {
            return BadRequest(new { success = false, message = "Geçersiz istek." });
        }

        var posAccount = await _dbContext.BankAccountDefinitions
            .FirstOrDefaultAsync(x => x.Id == request.PosBankAccountDefinitionId, cancellationToken);

        if (posAccount == null || posAccount.AccountType != PosAccountTransferService.PosAccountType)
        {
            return BadRequest(new { success = false, message = "Seçilen hesap bir POS hesabı değil." });
        }

        // Sweeping an account into itself would produce a self-cancelling pair of movements
        // and a permanently non-zero balance.
        if (request.TargetBankAccountDefinitionId == request.PosBankAccountDefinitionId)
        {
            return BadRequest(new { success = false, message = "POS hesabı kendisine aktarılamaz." });
        }

        // HEDEF HESAP GERÇEKTEN VAR MI. Doğrulanmadığında silinmiş ya da hiç var olmayan bir id
        // ayar olarak kaydedilebiliyor; hata ancak GECE, süpürme görevi çalışırken ortaya
        // çıkıyordu. Kaydederken reddetmenin bedeli yok, gece patlamanın bedeli bir günlük
        // aktarımın hiç yapılmaması.
        if (request.TargetBankAccountDefinitionId.HasValue)
        {
            var targetExists = await _dbContext.BankAccountDefinitions
                .AsNoTracking()
                .AnyAsync(x => x.Id == request.TargetBankAccountDefinitionId.Value, cancellationToken);

            if (!targetExists)
            {
                return BadRequest(new { success = false, message = "Hedef banka hesabı bulunamadı." });
            }
        }

        if (!TimeSpan.TryParse(request.TransferTime, out var transferTime)
            || transferTime < TimeSpan.Zero || transferTime >= TimeSpan.FromDays(1))
        {
            return BadRequest(new { success = false, message = "Aktarım saati geçersiz." });
        }

        // SAĞLAYICI BAĞI TEKİL OLMALI. Bu alan artık muhasebenin hangi hesaba yazacağını
        // belirliyor; iki POS hesabı aynı sağlayıcıyı sahiplenirse tahsilatın hangisine
        // düşeceği sıralamaya kalır — yani veriye göre değişir. Kaydederken reddetmek,
        // gece yanlış hesaba para yazmaktan ucuz.
        if (request.VirtualPosBankCode.HasValue)
        {
            var providerExists = await _dbContext.VirtualPosDefinitions
                .AsNoTracking()
                .AnyAsync(x => x.BankCode == request.VirtualPosBankCode.Value, cancellationToken);

            if (!providerExists)
            {
                return BadRequest(new { success = false, message = "Seçilen sanal POS sağlayıcısı bulunamadı." });
            }

            var claimedByOther = await _dbContext.PosAccountSettings
                .AsNoTracking()
                .AnyAsync(
                    x => x.VirtualPosBankCode == request.VirtualPosBankCode.Value
                         && x.PosBankAccountDefinitionId != request.PosBankAccountDefinitionId,
                    cancellationToken);

            if (claimedByOther)
            {
                return BadRequest(new { success = false, message = "Bu sanal POS sağlayıcısı başka bir POS hesabına bağlı." });
            }
        }

        var setting = await _dbContext.PosAccountSettings
            .FirstOrDefaultAsync(x => x.PosBankAccountDefinitionId == request.PosBankAccountDefinitionId, cancellationToken);

        var now = DateTime.UtcNow;

        if (setting == null)
        {
            setting = new PosAccountSetting
            {
                PosBankAccountDefinitionId = request.PosBankAccountDefinitionId,
                CreateUser = CurrentUser,
                CreateTime = now
            };
            _dbContext.PosAccountSettings.Add(setting);
        }
        else
        {
            setting.EditUser = CurrentUser;
            setting.EditTime = now;
        }

        setting.TargetBankAccountDefinitionId = request.TargetBankAccountDefinitionId;
        setting.VirtualPosBankCode = request.VirtualPosBankCode;
        setting.TransferTime = transferTime;
        setting.IsAutoTransferEnabled = request.IsAutoTransferEnabled;
        setting.IsActive = true;

        await _dbContext.SaveChangesAsync(cancellationToken);
        return Ok(new { success = true });
    }

    [HttpGet("transfers/day")]
    [AuthorizePage("users", "posAktarim")]
    public async Task<IActionResult> GetDay(
        [FromQuery] int posAccountId,
        [FromQuery] DateTime date,
        CancellationToken cancellationToken)
    {
        var summary = await _transferService.GetDayAsync(posAccountId, date, cancellationToken);
        if (summary == null) return NotFound(new { success = false, message = "POS hesabı bulunamadı." });

        return Ok(new { success = true, data = summary });
    }

    /// <summary>
    /// BÜTÜN POS HESAPLARININ O GÜNKÜ ÖZETİ — "kim, hangi hesaptan, ne kadar aktardı".
    ///
    /// Tek hesaplık <c>transfers/day</c> ekranı hangi bankada ne olduğunu görmek için hesap
    /// hesap dolaşmayı gerektiriyordu. Burada hareket satırları DÖNMEZ; amaç genel görünüm,
    /// ayrıntı için kullanıcı ilgili hesabı seçer.
    /// </summary>
    [HttpGet("transfers/day-all")]
    [AuthorizePage("users", "posAktarim")]
    public async Task<IActionResult> GetDayAll([FromQuery] DateTime date, CancellationToken cancellationToken)
    {
        var accountIds = await _dbContext.PosAccountSettings
            .AsNoTracking()
            .Where(x => x.IsActive)
            .OrderBy(x => x.PosBankAccountDefinitionId)
            .Select(x => x.PosBankAccountDefinitionId)
            .ToListAsync(cancellationToken);

        var dayStart = PosAccountTransferService.AsUtcDay(date);

        // Aktarımı YAPAN kişi özet kaydında yok; tek sorguda toplanıp eşleniyor.
        var transfers = await _dbContext.PosAccountTransfers
            .AsNoTracking()
            .Where(x => x.TransferDate == dayStart)
            .Select(x => new { x.PosBankAccountDefinitionId, x.CreateUser, x.CreateTime, x.EditUser, x.EditTime })
            .ToListAsync(cancellationToken);

        var byAccount = transfers
            .GroupBy(x => x.PosBankAccountDefinitionId)
            .ToDictionary(g => g.Key, g => g.First());

        var rows = new List<object>();
        foreach (var id in accountIds)
        {
            var summary = await _transferService.GetDayAsync(id, date, cancellationToken);
            if (summary == null) continue;

            byAccount.TryGetValue(id, out var t);

            rows.Add(new
            {
                posBankAccountDefinitionId = summary.PosBankAccountDefinitionId,
                posAccountName = summary.PosAccountName,
                targetAccountName = summary.TargetAccountName,
                openingBalance = summary.OpeningBalance,
                totalIn = summary.TotalIn,
                transferredAmount = summary.TransferredAmount,
                unsettledAmount = summary.UnsettledAmount,
                transferId = summary.TransferId,
                bySource = summary.BySource,
                // SYSTEM = otomatik süpürme; elle yapılan aktarımda kullanıcı adı yazar.
                transferUser = t?.EditUser ?? t?.CreateUser,
                transferTime = t?.EditTime ?? t?.CreateTime
            });
        }

        return Ok(new { success = true, data = rows });
    }

    public sealed class RunTransferRequest
    {
        public int PosAccountId { get; set; }
        public DateTime Date { get; set; }
    }

    [HttpPost("transfers/run")]
    [AuthorizePage("users", "posAktarim")]
    public async Task<IActionResult> RunTransfer([FromBody] RunTransferRequest request, CancellationToken cancellationToken)
    {
        if (request == null) return BadRequest(new { success = false, message = "Geçersiz istek." });

        var result = await _transferService.RunTransferAsync(
            request.PosAccountId, request.Date, CurrentUser, isAutomatic: false, cancellationToken);

        return result.Success
            ? Ok(new { success = true, message = result.Message, data = new { result.TransferId, result.Amount } })
            : BadRequest(new { success = false, message = result.Message });
    }

    public sealed class AddToTransferRequest
    {
        public int TransferId { get; set; }
        public List<int> BankAccountTransactionIds { get; set; } = new();
    }

    [HttpPost("transfers/add-items")]
    [AuthorizePage("users", "posAktarim")]
    public async Task<IActionResult> AddToTransfer([FromBody] AddToTransferRequest request, CancellationToken cancellationToken)
    {
        if (request == null) return BadRequest(new { success = false, message = "Geçersiz istek." });

        var result = await _transferService.AddToTransferAsync(
            request.TransferId, request.BankAccountTransactionIds, CurrentUser, cancellationToken);

        return result.Success
            ? Ok(new { success = true, message = result.Message, data = new { result.TransferId, result.Amount } })
            : BadRequest(new { success = false, message = result.Message });
    }

    [HttpDelete("transfers/{transferId:int}")]
    [AuthorizePage("users", "posAktarim")]
    public async Task<IActionResult> DeleteTransfer(int transferId, CancellationToken cancellationToken)
    {
        var transfer = await _dbContext.PosAccountTransfers.AsNoTracking().FirstOrDefaultAsync(x => x.Id == transferId, cancellationToken);
        if (transfer is not null)
        {
            var silmeKurali = await this.DeleteRuleViolationAsync(_dbContext, transfer, "deleteRule/posAktarim", cancellationToken);
            if (silmeKurali is not null) return silmeKurali;
        }

        var result = await _transferService.DeleteTransferAsync(transferId, cancellationToken);

        return result.Success
            ? Ok(new { success = true, message = result.Message })
            : BadRequest(new { success = false, message = result.Message });
    }
}
