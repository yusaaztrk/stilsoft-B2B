using System.ComponentModel.DataAnnotations;
using System.Security.Claims;
using B2B.Erp.Api.Core.Authorization;
using B2B.Erp.Api.Core.Helpers;
using B2B.Erp.Api.Core.Interfaces;
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
public sealed class CashAccountTransfersController : ControllerBase
{
    private readonly AppDbContext _dbContext;

    private readonly IMoneyServiceClient _money;

    public CashAccountTransfersController(AppDbContext dbContext, IMoneyServiceClient money)
    {
        _dbContext = dbContext;
        _money = money;
    }

    private static string? MapCurrencyTypeIdToCode(int currencyTypeId)
        => CurrencyTypeHelper.ToCode(currencyTypeId);

    private static DateTime NormalizeUtc(DateTime dt)
    {
        if (dt == default) return DateTime.UtcNow;
        return dt.Kind == DateTimeKind.Utc ? dt : DateTime.SpecifyKind(dt, DateTimeKind.Utc);
    }

    public sealed class CreateCashAccountTransferRequest
    {
        [Range(1, int.MaxValue)]
        public int SourceCashAccountId { get; set; }

        [Range(1, int.MaxValue)]
        public int TargetCashAccountId { get; set; }

        [Required]
        public DateTime Date { get; set; }

        [Range(0.01, double.MaxValue)]
        public decimal Amount { get; set; }

        [MaxLength(2000)]
        public string? Description { get; set; }

        [Range(0, double.MaxValue)]
        public decimal SourceCurrencyRate { get; set; } = 0m;

        [Range(0, double.MaxValue)]
        public decimal TargetCurrencyRate { get; set; } = 0m;
    }

    [HttpGet]
    [AuthorizePage("cash", "kasalarArasiTransfer")]
    public async Task<IActionResult> List(
        [FromQuery] int? cashAccountId,
        [FromQuery] int take = 200,
        [FromQuery] int skip = 0,
        CancellationToken cancellationToken = default)
    {
        take = Math.Max(1, Math.Min(1000, take));
        // Sayfalı okuma (2026-10-08): ekran 'son N' yerine skip ile hepsini çekiyor; eski kayıtlar
        // aramada/süzgeçte görünmüyordu (alış faturalarında 25.08 faturası bulunamadı).
        skip = Math.Max(0, skip);

        List<CashAccountTransferListItemResponse> data;

        if (cashAccountId.HasValue && cashAccountId.Value > 0)
        {
            var selectedId = cashAccountId.Value;
            data = await (
                    from tx in _dbContext.CashAccountTransactions.AsNoTracking()
                    join tr in _dbContext.CashAccountTransfers.AsNoTracking() on tx.ReferenceId equals tr.Id
                    where tx.ReferenceType == CashAccountTransactionReferenceType.Transfer
                          && tx.CashAccountId == selectedId
                    orderby tx.Date descending, tr.Id descending
                    select new CashAccountTransferListItemResponse
                    {
                        Id = tr.Id,
                        SourceCashAccountId = tr.SourceCashAccountId,
                        TargetCashAccountId = tr.TargetCashAccountId,
                        Date = tr.Date,
                        Amount = tr.Amount,
                        SelectedCashAccountId = selectedId,
                        SelectedDirection = (int)tx.Direction,
                        SelectedTryAmount = tx.Amount,
                        SelectedCurrencyTypeId = tx.CurrencyTypeId,
                        SelectedCurrencyRate = tx.CurrencyRate,
                        SelectedCurrencyAmount = tx.CurrencyAmount,
                        Description = tr.Description,
                        CreateUser = tr.CreateUser
                    })
                .Skip(skip).Take(take)
                .ToListAsync(cancellationToken);
        }
        else
        {
            data = await _dbContext.CashAccountTransfers
                .AsNoTracking()
                .OrderByDescending(x => x.Date)
                .ThenByDescending(x => x.Id)
                .Skip(skip).Take(take)
                .Select(x => new CashAccountTransferListItemResponse
                {
                    Id = x.Id,
                    SourceCashAccountId = x.SourceCashAccountId,
                    TargetCashAccountId = x.TargetCashAccountId,
                    Date = x.Date,
                    Amount = x.Amount,
                    Description = x.Description,
                    CreateUser = x.CreateUser
                })
                .ToListAsync(cancellationToken);
        }

        return Ok(new { success = true, data });
    }

    [HttpPost]
    [AuthorizePage("cash", "kasalarArasiTransfer")]
    public async Task<IActionResult> Create([FromBody] CreateCashAccountTransferRequest request, CancellationToken cancellationToken)
    {
        if (!ModelState.IsValid) return ValidationProblem(ModelState);

        if (request.SourceCashAccountId == request.TargetCashAccountId)
        {
            return BadRequest(new { success = false, message = "Çıkış kasa ve giriş kasa aynı olamaz" });
        }

        var sourceExists = await _dbContext.CashAccounts
            .AsNoTracking()
            .Select(x => new { x.Id, x.Code, x.Name, x.CurrencyTypeId })
            .FirstOrDefaultAsync(x => x.Id == request.SourceCashAccountId, cancellationToken);

        var targetExists = await _dbContext.CashAccounts
            .AsNoTracking()
            .Select(x => new { x.Id, x.Code, x.Name, x.CurrencyTypeId })
            .FirstOrDefaultAsync(x => x.Id == request.TargetCashAccountId, cancellationToken);

        if (sourceExists is null) return BadRequest(new { success = false, message = "Çıkış kasa bulunamadı" });
        if (targetExists is null) return BadRequest(new { success = false, message = "Giriş kasa bulunamadı" });

        var now = DateTime.UtcNow;
        var username = User.FindFirst(ClaimTypes.Name)?.Value;
        if (string.IsNullOrWhiteSpace(username)) username = "System";

        var date = NormalizeUtc(request.Date);

        var sourceCurrencyTypeId = sourceExists.CurrencyTypeId;
        var targetCurrencyTypeId = targetExists.CurrencyTypeId;

        // request.Amount is interpreted as the amount in the SOURCE cash account currency.
        var sourceAmount = request.Amount;
        if (sourceAmount <= 0)
        {
            return BadRequest(new { success = false, message = "Tutar zorunlu" });
        }

        // We store Amount as TRY amount for consistency across the system,
        // and CurrencyAmount as the account's native currency amount.
        decimal sourceTryRate;
        if (CurrencyTypeHelper.IsTry(sourceCurrencyTypeId))
        {
            sourceTryRate = 1m;
        }
        else
        {
            var code = MapCurrencyTypeIdToCode(sourceCurrencyTypeId);
            if (string.IsNullOrWhiteSpace(code)) return BadRequest(new { success = false, message = "Geçersiz çıkış kasa para birimi" });
            sourceTryRate = request.SourceCurrencyRate;
            // TL OLMAYAN PARADA KUR ASLA <= 1 OLAMAZ (EUR/GBP/USD -> TRY hepsi >> 1).
            // Aynı para birimli kasa aktarımında (EUR->EUR) ekran "çevrim yok" deyip kur=1
            // gönderiyordu; bu değer olduğu gibi kabul edilince TL çapası (Amount) döviz
            // tutarına eşit yazılıyordu (5.000 EUR -> "5.000 TL"). Denetimde bulundu
            // (HASPOLAT/MAĞAZA EURO KASA). 1 ve altı = geçersiz, günün kuru çekilir.
            if (sourceTryRate <= 1m)
            {
                sourceTryRate = await _money.GetLatestTryRateAsync(code, cancellationToken);
            }
            if (sourceTryRate <= 0) return StatusCode(StatusCodes.Status503ServiceUnavailable, new { success = false, message = "Kur bilgisi alınamadı (Çıkış kasa)." });
        }

        decimal targetTryRate;
        if (CurrencyTypeHelper.IsTry(targetCurrencyTypeId))
        {
            targetTryRate = 1m;
        }
        else
        {
            var code = MapCurrencyTypeIdToCode(targetCurrencyTypeId);
            if (string.IsNullOrWhiteSpace(code)) return BadRequest(new { success = false, message = "Geçersiz giriş kasa para birimi" });
            targetTryRate = request.TargetCurrencyRate;
            // Kaynak taraftakiyle aynı gerekçe: TL olmayan parada kur <= 1 geçersiz.
            if (targetTryRate <= 1m)
            {
                targetTryRate = await _money.GetLatestTryRateAsync(code, cancellationToken);
            }
            if (targetTryRate <= 0) return StatusCode(StatusCodes.Status503ServiceUnavailable, new { success = false, message = "Kur bilgisi alınamadı (Giriş kasa)." });
        }

        // Convert source amount -> TRY -> target currency.
        // Yuvarlama şart: çapraz kurda (100 EUR → USD) sonuç 8+ basamaklı küsurat çıkıyor ve
        // ham hâliyle kasa hareketine yazılınca bakiye/mizan kuruş tutmuyordu.
        var tryAmount = CurrencyTypeHelper.IsTry(sourceCurrencyTypeId)
            ? sourceAmount
            : Math.Round(sourceAmount * sourceTryRate, 2, MidpointRounding.AwayFromZero);
        var targetAmount = CurrencyTypeHelper.IsTry(targetCurrencyTypeId)
            ? tryAmount
            : Math.Round(tryAmount / targetTryRate, 2, MidpointRounding.AwayFromZero);

        await using var tx = await _dbContext.Database.BeginTransactionAsync(cancellationToken);

        var transfer = new CashAccountTransfer
        {
            SourceCashAccountId = request.SourceCashAccountId,
            TargetCashAccountId = request.TargetCashAccountId,
            Date = date,
            Amount = sourceAmount,
            CurrencyTypeId = sourceCurrencyTypeId,
            Description = string.IsNullOrWhiteSpace(request.Description) ? null : request.Description.Trim(),
            CreateUser = username,
            CreateTime = now
        };

        _dbContext.CashAccountTransfers.Add(transfer);
        await _dbContext.SaveChangesAsync(cancellationToken);

        _dbContext.CashAccountTransactions.Add(new CashAccountTransaction
        {
            CashAccountId = transfer.SourceCashAccountId,
            Date = transfer.Date,
            Direction = CashAccountTransactionDirection.Out,
            Amount = tryAmount,
            CurrencyTypeId = sourceCurrencyTypeId,
            CurrencyRate = sourceTryRate,
            CurrencyAmount = sourceAmount,
            CounterpartyType = CashAccountTransactionCounterpartyType.Muhtelif,
            CounterpartyCode = (targetExists.Code ?? string.Empty).Trim(),
            CounterpartyName = (targetExists.Name ?? string.Empty).Trim(),
            ReferenceType = CashAccountTransactionReferenceType.Transfer,
            ReferenceId = transfer.Id,
            Description = transfer.Description,
            CreateUser = username,
            CreateTime = now
        });

        _dbContext.CashAccountTransactions.Add(new CashAccountTransaction
        {
            CashAccountId = transfer.TargetCashAccountId,
            Date = transfer.Date,
            Direction = CashAccountTransactionDirection.In,
            Amount = tryAmount,
            CurrencyTypeId = targetCurrencyTypeId,
            CurrencyRate = targetTryRate,
            CurrencyAmount = targetAmount,
            CounterpartyType = CashAccountTransactionCounterpartyType.Muhtelif,
            CounterpartyCode = (sourceExists.Code ?? string.Empty).Trim(),
            CounterpartyName = (sourceExists.Name ?? string.Empty).Trim(),
            ReferenceType = CashAccountTransactionReferenceType.Transfer,
            ReferenceId = transfer.Id,
            Description = transfer.Description,
            CreateUser = username,
            CreateTime = now
        });

        await _dbContext.SaveChangesAsync(cancellationToken);
        await tx.CommitAsync(cancellationToken);

        return StatusCode(StatusCodes.Status201Created, new { success = true, data = new { id = transfer.Id } });
    }

    [HttpDelete("{id:int}")]
    [AuthorizePage("cash", "kasalarArasiTransfer")]
    public async Task<IActionResult> Delete([FromRoute] int id, CancellationToken cancellationToken)
    {
        if (id <= 0) return BadRequest(new { success = false, message = "Geçersiz id" });

        var transfer = await _dbContext.CashAccountTransfers.FirstOrDefaultAsync(x => x.Id == id, cancellationToken);
        if (transfer is null) return NotFound(new { success = false, message = "Kayıt bulunamadı" });

        var silmeKurali = await this.DeleteRuleViolationAsync(_dbContext, transfer, "deleteRule/kasaTransfer", cancellationToken);
        if (silmeKurali is not null) return silmeKurali;

        var txRows = await _dbContext.CashAccountTransactions
            .Where(x => x.ReferenceType == CashAccountTransactionReferenceType.Transfer && x.ReferenceId == id)
            .ToListAsync(cancellationToken);

        if (txRows.Count > 0) _dbContext.CashAccountTransactions.RemoveRange(txRows);

        _dbContext.CashAccountTransfers.Remove(transfer);
        await _dbContext.SaveChangesAsync(cancellationToken);

        return Ok(new { success = true });
    }
}
