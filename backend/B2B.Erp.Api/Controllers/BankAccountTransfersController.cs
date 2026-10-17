using System.ComponentModel.DataAnnotations;
using System.Security.Claims;
using B2B.Erp.Api.Core.Authorization;
using B2B.Erp.Api.Core.Helpers;
using B2B.Erp.Api.Core.Interfaces;
using B2B.Erp.Api.Data;
using B2B.Erp.Api.Entities;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace B2B.Erp.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
[Authorize]
public sealed class BankAccountTransfersController : ControllerBase
{
    private readonly AppDbContext _dbContext;
    private readonly IMoneyServiceClient _money;

    public BankAccountTransfersController(AppDbContext dbContext, IMoneyServiceClient money)
    {
        _dbContext = dbContext;
        _money = money;
    }

    public sealed class CreateBankAccountTransferRequest
    {
        [Range(1, int.MaxValue)]
        public int SourceBankAccountDefinitionId { get; set; }

        [Range(1, int.MaxValue)]
        public int TargetBankAccountDefinitionId { get; set; }

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

        [Range(0, double.MaxValue)]
        public decimal PosFee { get; set; } = 0m;

        [MaxLength(2000)]
        public string? PosFeeDescription { get; set; }

        /*
          POS MASRAFI VERGİ ORANLARI (2026-08-20 kullanıcı kararı, denetim md. A4).
          Yüzde olarak girilir (5 = %5); ikisi de elle ayarlanır. Boş/0 = ayrıştırma yok.
          `PosFee` daima BRÜT'tür — bu oranlar hesaptan düşen tutarı DEĞİŞTİRMEZ.
        */
        [Range(0, 100)]
        public decimal? PosFeeBsmvRate { get; set; }

        [Range(0, 100)]
        public decimal? PosFeeVatRate { get; set; }
    }

    private static string? MapCurrencyTypeIdToCode(int currencyTypeId)
        => CurrencyTypeHelper.ToCode(currencyTypeId);

    private static DateTime NormalizeUtc(DateTime dt)
    {
        if (dt == default) return DateTime.UtcNow;
        return dt.Kind == DateTimeKind.Utc ? dt : DateTime.SpecifyKind(dt, DateTimeKind.Utc);
    }

    [HttpPost]
    [AuthorizePage("bank", "bankaHavaleEft")]
    public async Task<IActionResult> Create([FromBody] CreateBankAccountTransferRequest request, CancellationToken cancellationToken)
    {
        if (!ModelState.IsValid) return ValidationProblem(ModelState);

        if (request.SourceBankAccountDefinitionId == request.TargetBankAccountDefinitionId)
        {
            return BadRequest(new { success = false, message = "Çıkış hesap ve giriş hesap aynı olamaz" });
        }

        var source = await _dbContext.BankAccountDefinitions
            .AsNoTracking()
            .Select(x => new { x.Id, x.AccountCode, x.AccountName, x.CurrencyTypeId })
            .FirstOrDefaultAsync(x => x.Id == request.SourceBankAccountDefinitionId, cancellationToken);

        var target = await _dbContext.BankAccountDefinitions
            .AsNoTracking()
            .Select(x => new { x.Id, x.AccountCode, x.AccountName, x.CurrencyTypeId })
            .FirstOrDefaultAsync(x => x.Id == request.TargetBankAccountDefinitionId, cancellationToken);

        if (source is null) return BadRequest(new { success = false, message = "Çıkış banka hesabı bulunamadı" });
        if (target is null) return BadRequest(new { success = false, message = "Giriş banka hesabı bulunamadı" });

        var amountSource = request.Amount;

        var now = DateTime.UtcNow;
        var username = User.FindFirst(ClaimTypes.Name)?.Value;
        if (string.IsNullOrWhiteSpace(username)) username = "System";

        var dateUtc = NormalizeUtc(request.Date);
        var date = DateTime.SpecifyKind(dateUtc.Date + now.TimeOfDay, DateTimeKind.Utc);

        var sourceCurrencyTypeId = source.CurrencyTypeId;
        var targetCurrencyTypeId = target.CurrencyTypeId;

        decimal sourceTryRate;
        if (CurrencyTypeHelper.IsTry(sourceCurrencyTypeId))
        {
            sourceTryRate = 1m;
        }
        else
        {
            sourceTryRate = request.SourceCurrencyRate;
            // TL OLMAYAN PARADA KUR <= 1 GEÇERSİZ (EUR/GBP/USD -> TRY hepsi >> 1). Aynı para
            // birimli aktarımda ekran kur=1 gönderiyor; olduğu gibi kabul edilirse TL çapası
            // döviz tutarına eşit yazılıyor. Kasa aktarımında bu hata denetimde bulundu.
            if (sourceTryRate <= 1m)
            {
                var code = MapCurrencyTypeIdToCode(sourceCurrencyTypeId);
                if (string.IsNullOrWhiteSpace(code)) return BadRequest(new { success = false, message = "Geçersiz çıkış para birimi" });
                try
                {
                    sourceTryRate = await _money.GetLatestTryRateAsync(code, cancellationToken);
                }
                catch
                {
                    return StatusCode(StatusCodes.Status503ServiceUnavailable, new { success = false, message = "Kur bilgisi alınamadı. Lütfen kuru elle girin." });
                }

                if (sourceTryRate <= 0)
                {
                    return StatusCode(StatusCodes.Status503ServiceUnavailable, new { success = false, message = "Kur bilgisi alınamadı. Lütfen kuru elle girin." });
                }
            }
        }

        decimal targetTryRate;
        if (CurrencyTypeHelper.IsTry(targetCurrencyTypeId))
        {
            targetTryRate = 1m;
        }
        else
        {
            targetTryRate = request.TargetCurrencyRate;
            // Kaynak taraftakiyle aynı gerekçe: TL olmayan parada kur <= 1 geçersiz.
            if (targetTryRate <= 1m)
            {
                var code = MapCurrencyTypeIdToCode(targetCurrencyTypeId);
                if (string.IsNullOrWhiteSpace(code)) return BadRequest(new { success = false, message = "Geçersiz giriş para birimi" });
                try
                {
                    targetTryRate = await _money.GetLatestTryRateAsync(code, cancellationToken);
                }
                catch
                {
                    return StatusCode(StatusCodes.Status503ServiceUnavailable, new { success = false, message = "Kur bilgisi alınamadı. Lütfen kuru elle girin." });
                }

                if (targetTryRate <= 0)
                {
                    return StatusCode(StatusCodes.Status503ServiceUnavailable, new { success = false, message = "Kur bilgisi alınamadı. Lütfen kuru elle girin." });
                }
            }
        }

        // Çapraz kur sonucu 2 basamağa yuvarlanmadan yazılıyordu: 100 EUR → USD virmanında
        // hesaba 8+ basamaklı küsurat düşüyor, kasa/banka bakiyesi kuruş kaçırıyordu.
        var tryAmount = CurrencyTypeHelper.IsTry(sourceCurrencyTypeId)
            ? amountSource
            : Math.Round(amountSource * sourceTryRate, 2, MidpointRounding.AwayFromZero);
        var targetAmount = CurrencyTypeHelper.IsTry(targetCurrencyTypeId)
            ? tryAmount
            : Math.Round(tryAmount / targetTryRate, 2, MidpointRounding.AwayFromZero);

        var baseDesc = string.IsNullOrWhiteSpace(request.Description) ? null : request.Description.Trim();

        await using var tx = await _dbContext.Database.BeginTransactionAsync(cancellationToken);

        var outTx = new BankAccountTransaction
        {
            BankAccountDefinitionId = source.Id,
            Date = date,
            Direction = BankAccountTransactionDirection.Out,
            Amount = tryAmount,
            // Do NOT collapse GBP(4) onto USD(3): the balance query matches the movement
            // against the account's own currency, so a rewritten id makes the money vanish.
            CurrencyTypeId = CurrencyTypeHelper.Normalize(sourceCurrencyTypeId),
            CurrencyRate = sourceTryRate,
            CurrencyAmount = amountSource,
            CounterpartyType = BankAccountTransactionCounterpartyType.Bank,
            CounterpartyCode = (target.AccountCode ?? string.Empty).Trim(),
            CounterpartyName = (target.AccountName ?? string.Empty).Trim(),
            Description = baseDesc,
            IsPosFee = false,
            CreateUser = username,
            CreateTime = now
        };

        var inTx = new BankAccountTransaction
        {
            BankAccountDefinitionId = target.Id,
            Date = date,
            Direction = BankAccountTransactionDirection.In,
            Amount = tryAmount,
            CurrencyTypeId = CurrencyTypeHelper.Normalize(targetCurrencyTypeId),
            CurrencyRate = targetTryRate,
            CurrencyAmount = targetAmount,
            CounterpartyType = BankAccountTransactionCounterpartyType.Bank,
            CounterpartyCode = (source.AccountCode ?? string.Empty).Trim(),
            CounterpartyName = (source.AccountName ?? string.Empty).Trim(),
            Description = baseDesc,
            IsPosFee = false,
            CreateUser = username,
            CreateTime = now
        };

        _dbContext.BankAccountTransactions.Add(outTx);
        _dbContext.BankAccountTransactions.Add(inTx);

        BankAccountTransaction? posFeeTx = null;
        if (request.PosFee > 0)
        {
            // Brütün içindeki BSMV/KDV ayrıştırılır (denetim md. A4); oranlar elle girilir.
            // Tutarlar hesabın para biriminde saklanır, yani `CurrencyAmount` ile aynı ölçekte.
            var posFeeGrossInAccountCurrency = B2B.Erp.Api.Core.Helpers.CurrencyTypeHelper.IsTry(sourceCurrencyTypeId)
                ? request.PosFee
                : (sourceTryRate > 0 ? Math.Round(request.PosFee / sourceTryRate, 2, MidpointRounding.AwayFromZero) : request.PosFee);

            var posFeeVergi = B2B.Erp.Api.Core.Helpers.PosFeeTaxBreakdown.Split(
                posFeeGrossInAccountCurrency, request.PosFeeBsmvRate ?? 0m, request.PosFeeVatRate ?? 0m);

            posFeeTx = new BankAccountTransaction
            {
                BankAccountDefinitionId = source.Id,
                Date = date,
                Direction = BankAccountTransactionDirection.Out,
                // Masrafın TUTARI TL olarak giriliyor (Amount = TL çapası), ama hareket
                // KAYNAK hesabın satırıdır ve o hesabın para biriminde damgalanmalıdır:
                // sabit TL yazılınca dövizli hesabın ekstre süzgecinde satır görünmüyor,
                // bakiye sorgusu farklı para birimini atladığı için masraf hesaptan hiç
                // düşmüyordu. TL hesapta sonuç birebir aynı (kur 1).
                Amount = request.PosFee,
                CurrencyTypeId = CurrencyTypeHelper.Normalize(sourceCurrencyTypeId),
                CurrencyRate = sourceTryRate,
                CurrencyAmount = CurrencyTypeHelper.IsTry(sourceCurrencyTypeId)
                    ? request.PosFee
                    : Math.Round(request.PosFee / sourceTryRate, 2, MidpointRounding.AwayFromZero),
                CounterpartyType = BankAccountTransactionCounterpartyType.Bank,
                CounterpartyCode = (source.AccountCode ?? string.Empty).Trim(),
                CounterpartyName = (source.AccountName ?? string.Empty).Trim(),
                Description = !string.IsNullOrWhiteSpace(request.PosFeeDescription)
                    ? request.PosFeeDescription.Trim()
                    : $"Havale/EFT Masrafı: {(source.AccountName ?? source.AccountCode ?? string.Empty).Trim()} → {(target.AccountName ?? target.AccountCode ?? string.Empty).Trim()}",
                /*
                  AKTARIM MASRAFI DA HAVALE/EFT MASRAFIDIR (2026-08-23).

                  Kardeşi olan Havale/EFT ucu düzeltildiğinde burası atlanmıştı: iki banka
                  hesabı arasındaki aktarım AYRI bir uçtan geçiyor ve masrafı hâlâ POS
                  damgalıyordu. Ekranda "Havale/EFT Masrafı" seçilip kaydedilen satır Banka
                  Masrafları'nda POS Masrafı hesabına düşmeye devam ediyordu.

                  `IsPosFee` false: varlıktaki kural `IsPosFee == (ExpenseType == PosFee)`.
                */
                IsPosFee = false,
                ExpenseType = (int)B2B.Erp.Api.Entities.BankExpenseType.TransferFee,
                PosFeeBsmvRate = request.PosFeeBsmvRate ?? 0m,
                PosFeeVatRate = request.PosFeeVatRate ?? 0m,
                PosFeeBsmvAmount = posFeeVergi.BsmvAmount,
                PosFeeVatAmount = posFeeVergi.VatAmount,
                CreateUser = username,
                CreateTime = now
            };

            _dbContext.BankAccountTransactions.Add(posFeeTx);
        }
        await _dbContext.SaveChangesAsync(cancellationToken);
        await tx.CommitAsync(cancellationToken);

        return StatusCode(StatusCodes.Status201Created, new
        {
            success = true,
            data = new
            {
                outId = outTx.Id,
                inId = inTx.Id,
                posFeeId = posFeeTx?.Id
            }
        });
    }
}
