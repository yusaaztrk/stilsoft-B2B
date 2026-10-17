using System.Security.Claims;
using System.Text.Json;
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
public sealed class CashAccountTransactionsController : ControllerBase
{
    private readonly AppDbContext _dbContext;
    private readonly IMoneyServiceClient _money;

    public CashAccountTransactionsController(AppDbContext dbContext, IMoneyServiceClient money)
    {
        _dbContext = dbContext;
        _money = money;
    }

    private static string? MapCurrencyTypeIdToCode(int currencyTypeId)
        => CurrencyTypeHelper.ToCode(currencyTypeId);

    private async Task<decimal> ResolveTryRateAsync(int currencyTypeId, decimal requestedRate, CancellationToken cancellationToken)
    {
        // TRY is stored as either 0 (legacy) or 1. Checking only for 0 let a TRY cash
        // account keep a foreign rate sent by the client, which corrupted CurrencyAmount.
        if (CurrencyTypeHelper.IsTry(currencyTypeId)) return 1m;

        if (requestedRate > 0) return requestedRate;

        var code = MapCurrencyTypeIdToCode(currencyTypeId);
        if (string.IsNullOrWhiteSpace(code))
        {
            throw new InvalidOperationException("Geçersiz para birimi");
        }

        var rate = await _money.GetLatestTryRateAsync(code, cancellationToken);
        if (rate <= 0) throw new InvalidOperationException("Kur bilgisi alınamadı. Lütfen kuru elle girin.");
        return rate;
    }

    /// <summary>
    /// CurrencyAmount is the value expressed in the account's own currency.
    /// For TRY it must equal Amount; for a foreign currency it is Amount / rate.
    /// A caller supplied value is only honoured for foreign currency accounts.
    /// </summary>
    private static decimal ResolveCurrencyAmount(int accountCurrencyTypeId, decimal amount, decimal currencyRate, decimal requestedCurrencyAmount)
    {
        if (CurrencyTypeHelper.IsTry(accountCurrencyTypeId)) return amount;
        if (requestedCurrencyAmount > 0) return requestedCurrencyAmount;
        return currencyRate > 0 ? amount / currencyRate : 0m;
    }

    private static DateTime NormalizeUtc(DateTime dt)
    {
        if (dt == default) return DateTime.UtcNow;
        return dt.Kind == DateTimeKind.Utc ? dt : DateTime.SpecifyKind(dt, DateTimeKind.Utc);
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
    [AuthorizePage("cash", "kasaGirisCikis")]
    public async Task<IActionResult> List(
        [FromQuery] int? cashAccountId,
        [FromQuery] int? currencyTypeId,
        [FromQuery] int take = 200,
        CancellationToken cancellationToken = default)
    {
        // Tek kasa seçiliyse hareketlerin tamamı — bkz. BankAccountTransactionsController.List
        // (2026-10-03): kesik liste TOPLAM ve DEVİR satırını bakiyeden ayırıyordu.
        var tekKasa = cashAccountId.HasValue && cashAccountId.Value > 0;
        take = Math.Max(1, Math.Min(tekKasa ? 100_000 : 1000, take));

        var allowedCashIds = await GetUserAssignedCashAccountIdsAsync(cancellationToken);
        var q = _dbContext.CashAccountTransactions.AsNoTracking().AsQueryable();

        if (allowedCashIds != null)
        {
            if (cashAccountId.HasValue && cashAccountId.Value > 0)
            {
                if (!allowedCashIds.Contains(cashAccountId.Value))
                {
                    return Ok(new { success = true, data = Array.Empty<object>() });
                }
                q = q.Where(x => x.CashAccountId == cashAccountId.Value);
            }
            else
            {
                q = q.Where(x => allowedCashIds.Contains(x.CashAccountId));
            }
        }
        else if (cashAccountId.HasValue && cashAccountId.Value > 0)
        {
            q = q.Where(x => x.CashAccountId == cashAccountId.Value);
        }

        if (currencyTypeId.HasValue && currencyTypeId.Value >= 0)
        {
            // TL iki ayrı değerle yazılmış (eski/POS kayıtları 0, hesap ekranları 1). Tam
            // eşitlik arandığı için TL listesi 1 ile süzülünce 0 ile yazılmış eski satırlar
            // kayboluyordu. Banka kardeşi bunu zaten normalize ediyor; kasa tarafı atlanmıştı.
            // Sorgu Postgres'e gittiği için Normalize çağrılamıyor, karşılığı açıkça yazıldı.
            var wanted = B2B.Erp.Api.Core.Helpers.CurrencyTypeHelper.Normalize(currencyTypeId.Value);
            q = wanted == B2B.Erp.Api.Core.Helpers.CurrencyTypeHelper.Try
                ? q.Where(x => x.CurrencyTypeId == B2B.Erp.Api.Core.Helpers.CurrencyTypeHelper.Try || x.CurrencyTypeId == 0)
                : q.Where(x => x.CurrencyTypeId == wanted);
        }

        var data = await (
                from tx in q
                join cash in _dbContext.CashAccounts.AsNoTracking() on tx.CashAccountId equals cash.Id
                orderby tx.Date descending, tx.Id descending
                select new CashAccountTransactionListItemResponse
                {
                    Id = tx.Id,
                    CashAccountId = tx.CashAccountId,
                    CashAccountCode = cash.Code,
                    CashAccountName = cash.Name,
                    Date = tx.Date,
                    Direction = tx.Direction,
                    ReferenceType = tx.ReferenceType,
                    ReferenceId = tx.ReferenceId,
                    Amount = tx.Amount,
                    CurrencyTypeId = tx.CurrencyTypeId,
                    CurrencyRate = tx.CurrencyRate,
                    CurrencyAmount = tx.CurrencyAmount,
                    CounterpartyType = tx.CounterpartyType,
                    CounterpartyCode = tx.CounterpartyCode,
                    CounterpartyName = tx.CounterpartyName,
                    Description = tx.Description,
                    CreateUser = tx.CreateUser
                })
            .Take(take)
            .ToListAsync(cancellationToken);

        return Ok(new { success = true, data });
    }

    [HttpPost]
    [AuthorizePage("cash", "kasaGirisCikis")]
    public async Task<IActionResult> Create([FromBody] CreateCashAccountTransactionRequest request, CancellationToken cancellationToken)
    {
        if (!ModelState.IsValid) return ValidationProblem(ModelState);

        var allowedCashIds = await GetUserAssignedCashAccountIdsAsync(cancellationToken);
        if (allowedCashIds != null && !allowedCashIds.Contains(request.CashAccountId))
        {
            return StatusCode(403, new { success = false, message = "Atanan kasalarınız haricinde başka bir kasaya işlem yapma yetkiniz bulunmamaktadır." });
        }

        if (request.Direction != CashAccountTransactionDirection.In && request.Direction != CashAccountTransactionDirection.Out)
        {
            return BadRequest(new { success = false, message = "Geçersiz işlem yönü" });
        }

        var cashAcc = await _dbContext.CashAccounts
            .AsNoTracking()
            .Select(x => new { x.Id, x.CurrencyTypeId, x.Code, x.Name })
            .FirstOrDefaultAsync(x => x.Id == request.CashAccountId, cancellationToken);

        if (cashAcc is null)
        {
            return BadRequest(new { success = false, message = "Kasa bulunamadı" });
        }

        var now = DateTime.UtcNow;
        var username = User.FindFirst(ClaimTypes.Name)?.Value;
        if (string.IsNullOrWhiteSpace(username)) username = "System";

        var date = NormalizeUtc(request.Date);

        // A movement always belongs to the cash account's own currency
        var accountCurrencyTypeId = CurrencyTypeHelper.Normalize(cashAcc.CurrencyTypeId);
        var currencyRate = request.CurrencyRate;

        try
        {
            currencyRate = await ResolveTryRateAsync(accountCurrencyTypeId, currencyRate, cancellationToken);
        }
        catch (InvalidOperationException ex)
        {
            return StatusCode(StatusCodes.Status503ServiceUnavailable, new { success = false, message = ex.Message });
        }

        // GELEN PARA İLE HESAP AYRI OLABİLİR (2026-08-17): müşteri 1.000 DOLAR getirir, para
        // TL kasaya günün kuruyla yazılır. Gelen para bildirilmezse çevrim yoktur ve bütün
        // tutarlar eskisi gibi hesabın para biriminden yürür.
        var tenderCurrencyTypeId = request.TenderCurrencyTypeId > 0
            ? CurrencyTypeHelper.Normalize(request.TenderCurrencyTypeId)
            : accountCurrencyTypeId;

        var tenderRate = request.TenderRate;
        if (tenderCurrencyTypeId != accountCurrencyTypeId)
        {
            try
            {
                // Kur ELLE girilebilir (anlaşma kuru); girilmezse günün kuru çekilir.
                tenderRate = await ResolveTryRateAsync(tenderCurrencyTypeId, tenderRate, cancellationToken);
            }
            catch (InvalidOperationException ex)
            {
                return StatusCode(StatusCodes.Status503ServiceUnavailable, new { success = false, message = ex.Message });
            }
        }

        decimal amount;
        decimal currencyAmount;
        string? exchangeCode = null;

        if (tenderCurrencyTypeId != accountCurrencyTypeId && request.TenderAmount > 0m)
        {
            // Çevrimli hareket: TL çapası GELEN PARADAN üretilir, hesap tutarı da o çapadan.
            var conv = TenderConversion.Resolve(
                accountCurrencyTypeId, currencyRate,
                tenderCurrencyTypeId, tenderRate, request.TenderAmount);

            amount = conv.TryAmount;
            currencyAmount = conv.AccountAmount;
            tenderRate = conv.TenderRate;
            exchangeCode = await ExchangeCodeGenerator.NextAsync(_dbContext, date, cancellationToken);
        }
        else
        {
            // Çevrim yok — eski davranışın birebir aynısı.
            // Amount is the TRY value, CurrencyAmount the account-currency value.
            // For a TRY account they are the same — never take a client supplied value there.
            amount = request.Amount;
            currencyAmount = ResolveCurrencyAmount(accountCurrencyTypeId, request.Amount, currencyRate, request.CurrencyAmount);
            tenderCurrencyTypeId = accountCurrencyTypeId;
            tenderRate = currencyRate;
        }

        var entity = new CashAccountTransaction
        {
            CashAccountId = request.CashAccountId,
            Date = date,
            Direction = request.Direction,
            Amount = amount,
            CurrencyTypeId = accountCurrencyTypeId,
            CurrencyRate = currencyRate,
            CurrencyAmount = currencyAmount,
            TenderCurrencyTypeId = tenderCurrencyTypeId,
            TenderRate = tenderRate,
            TenderAmount = request.TenderAmount > 0m ? request.TenderAmount : currencyAmount,
            ExchangeCode = exchangeCode,
            CounterpartyType = request.CounterpartyType,
            CounterpartyCode = (request.CounterpartyCode ?? string.Empty).Trim(),
            CounterpartyName = (request.CounterpartyName ?? string.Empty).Trim(),
            ReferenceType = CashAccountTransactionReferenceType.Manual,
            ReferenceId = null,
            Description = string.IsNullOrWhiteSpace(request.Description) ? null : request.Description.Trim(),
            CreateUser = username,
            CreateTime = now
        };

        await using var tx = await _dbContext.Database.BeginTransactionAsync(cancellationToken);
        _dbContext.CashAccountTransactions.Add(entity);
        await _dbContext.SaveChangesAsync(cancellationToken);

        if (request.CounterpartyType == CashAccountTransactionCounterpartyType.Bank)
        {
            var bankCode = (request.CounterpartyCode ?? string.Empty).Trim();
            if (string.IsNullOrWhiteSpace(bankCode))
            {
                return BadRequest(new { success = false, message = "Banka hesabı seçiniz" });
            }

            var bankAcc = await _dbContext.BankAccountDefinitions
                .AsNoTracking()
                .Select(x => new { x.Id, x.AccountCode, x.AccountName, x.CurrencyTypeId })
                .FirstOrDefaultAsync(x => x.AccountCode == bankCode, cancellationToken);

            if (bankAcc is null)
            {
                return BadRequest(new { success = false, message = "Banka hesabı bulunamadı" });
            }

            var bankCurrencyTypeId = bankAcc.CurrencyTypeId;
            decimal bankRate;
            try
            {
                bankRate = await ResolveTryRateAsync(bankCurrencyTypeId, 0m, cancellationToken);
            }
            catch (InvalidOperationException ex)
            {
                return StatusCode(StatusCodes.Status503ServiceUnavailable, new { success = false, message = ex.Message });
            }

            var bankCurrencyAmount = bankCurrencyTypeId == 0 ? entity.Amount : (bankRate > 0 ? entity.Amount / bankRate : 0m);
            var bankDir = entity.Direction == CashAccountTransactionDirection.Out
                ? BankAccountTransactionDirection.In
                : BankAccountTransactionDirection.Out;

            var bankTx = new BankAccountTransaction
            {
                BankAccountDefinitionId = bankAcc.Id,
                Date = date,
                Direction = bankDir,
                Amount = entity.Amount,
                CurrencyTypeId = bankCurrencyTypeId,
                CurrencyRate = bankRate,
                CurrencyAmount = bankCurrencyAmount,
                CounterpartyType = BankAccountTransactionCounterpartyType.Bank,
                CounterpartyCode = (cashAcc.Code ?? string.Empty).Trim(),
                CounterpartyName = (cashAcc.Name ?? string.Empty).Trim(),
                Description = entity.Description,
                IsPosFee = false,
                CreateUser = username,
                CreateTime = now
            };

            _dbContext.BankAccountTransactions.Add(bankTx);
            await _dbContext.SaveChangesAsync(cancellationToken);

            entity.LinkedBankAccountTransactionId = bankTx.Id;
            await _dbContext.SaveChangesAsync(cancellationToken);
        }
        else if (request.CounterpartyType == CashAccountTransactionCounterpartyType.Customer)
        {
            var customerCode = (request.CounterpartyCode ?? string.Empty).Trim();
            if (string.IsNullOrWhiteSpace(customerCode))
            {
                return BadRequest(new { success = false, message = "Müşteri/Cari kodu seçiniz" });
            }

            var customer = await _dbContext.Customers
                .AsNoTracking()
                .Select(x => new { x.CustomerCode, x.Name, x.CurrencyTypeId })
                .FirstOrDefaultAsync(x => x.CustomerCode == customerCode, cancellationToken);

            if (customer is null)
            {
                return BadRequest(new { success = false, message = "Müşteri bulunamadı" });
            }

            var ledgerDir = entity.Direction == CashAccountTransactionDirection.In
                ? CustomerLedgerEntryDirection.Credit
                : CustomerLedgerEntryDirection.Debit;

            var cashLabel = !string.IsNullOrWhiteSpace(cashAcc.Name)
                ? $"{cashAcc.Code} - {cashAcc.Name}"
                : cashAcc.Code;

            var description = string.IsNullOrWhiteSpace(entity.Description)
                ? $"Kasa İşlemi ({cashLabel})"
                : $"{entity.Description.Trim()} ({cashLabel})";

            // ═══════════════════════════════════════════════════════════════════════
            // CARİ HAREKETİ ÖDEMENİN KENDİ PARA BİRİMİNDE YAZILIR (2026-08-19).
            //
            // Burada ÇAPRAZ KUR vardı: satır, ekrandan seçilen "cari hesap dövizi"ne
            // çevriliyordu. Kanıt (DEMOTEST ekstre 128): kasaya 1.500 £ girildi, ekstreye
            // **31,66 €** düştü — £→€ çapraz kuru 0,021107 ile. Üstelik o kur TERS YÖNDE
            // (1/47) saklanıyordu; sistemin kuralı kur DAİMA "1 döviz = X ₺" yönündedir.
            //
            // Kullanıcı kuralı (2026-08-17): HER İŞLEM KENDİ PARA BİRİMİNDE YÜRÜR. Para
            // birimini İŞLEM belirler, ekranda seçilen hesap değil. Dövizler arası kapatma
            // ayrı bir çözümdür.
            //
            // SATIR, SEÇİLEN CARİ HESABIN PARA BİRİMİNE TL ÇAPASINDAN ÇEVRİLİR
            // (2026-08-20 kullanıcı kararı).
            //
            // Bir ara "tutar kendi para biriminde kalsın" denenmişti: kullanıcı TL hesabını
            // seçip 1.500 £ girdiğinde satır GBP kovasına düşüyordu — seçim damgalanıyor ama
            // dikkate alınmıyordu. Doğru davranış: paranın TL karşılığı bulunur, sonra hedef
            // hesabın GÜNCEL kuruyla o hesabın para birimine çevrilir.
            //
            // ÇAPRAZ KUR YOK: her iki bacak da "1 döviz = X ₺" yönünde. Eskiden £→€ çapraz
            // kuru (üstelik ters yönde saklanmış) kullanılıyordu ve 1.500 £ ekstreye 31,66 €
            // düşüyordu. TL üzerinden gitmek o hatayı yapısal olarak imkânsız kılar.
            // ═══════════════════════════════════════════════════════════════════════
            // ÖDEME DÖVİZİ (TENDER): gelen/çıkan paranın gerçek para birimi.
            var tenderTypeId = CurrencyTypeHelper.Normalize(
                entity.TenderCurrencyTypeId > 0 ? entity.TenderCurrencyTypeId : cashAcc.CurrencyTypeId);
            var tenderAmount = entity.TenderAmount > 0m ? entity.TenderAmount : (entity.CurrencyAmount > 0m ? entity.CurrencyAmount : entity.Amount);

            // Ödeme dövizinin TL kuru — yön DAİMA "1 döviz = X ₺".
            var tenderTryRate = CurrencyTypeHelper.IsTry(tenderTypeId)
                ? 1m
                : (entity.TenderRate > 0m ? entity.TenderRate : await ResolveTryRateAsync(tenderTypeId, 0m, cancellationToken));

            // TL ÇAPASI: gelen paranın TL karşılığı. Hem satırın `Amount`'ı hem de hedef
            // hesaba çevrimin girdisi budur.
            var tenderAmountTry = Math.Round(tenderAmount * tenderTryRate, 2, MidpointRounding.AwayFromZero);

            var activePeriodId = await _dbContext.AccountingPeriods
                .AsNoTracking()
                .Where(p => p.IsActive)
                .Select(p => (int?)p.Id)
                .FirstOrDefaultAsync(cancellationToken);

            // Hedef cari hesabı: ekrandan gelen seçim; yoksa/bilinmiyorsa ödemenin para birimi.
            var targetAccountCurrencyTypeId =
                request.CustomerAccountCurrencyTypeId is int reqTarget && CurrencyTypeHelper.IsKnown(reqTarget)
                    ? CurrencyTypeHelper.Normalize(reqTarget)
                    : tenderTypeId;

            // Hedef hesabın TL kuru — yine "1 döviz = X ₺".
            var targetTryRate = CurrencyTypeHelper.IsTry(targetAccountCurrencyTypeId)
                ? 1m
                : await ResolveTryRateAsync(targetAccountCurrencyTypeId, 0m, cancellationToken);

            // TL çapasından hedef hesabın parasına. Kur çekilemezse (0) çevrim yapılmaz;
            // uydurma bir kurla tutarı bozmaktansa gelen tutar olduğu gibi kalır.
            var cariAmountInTargetCurrency = targetTryRate > 0m
                ? Math.Round(tenderAmountTry / targetTryRate, 2, MidpointRounding.AwayFromZero)
                : tenderAmount;

            // Cari tarafında ÇEVRİM VARSA hareket ile ekstre satırı aynı çevrim koduyla
            // bağlanır; muhasebe kur farkını bu kodla ayıklıyor. Kasa tarafında kod zaten
            // üretilmişse (kasa dövizi ≠ ödeme dövizi) o kod korunur, ikinci kod üretilmez.
            var cariConversionHappened = !CurrencyTypeHelper.SameCurrency(targetAccountCurrencyTypeId, tenderTypeId);
            if (cariConversionHappened && string.IsNullOrWhiteSpace(entity.ExchangeCode))
            {
                entity.ExchangeCode = await ExchangeCodeGenerator.NextAsync(_dbContext, date, cancellationToken);
            }

            var customerLedgerEntry = new CustomerLedgerEntry
            {
                CustomerCode = customerCode,
                TargetAccountCurrencyTypeId = targetAccountCurrencyTypeId,
                Date = date,
                DueDate = date,
                Direction = ledgerDir,
                Amount = tenderAmountTry,
                // Satırın para birimi HEDEF CARİ HESABIdır; `Payment*` alanları gelen paranın
                // ne olduğunu saklar, böylece "1.500 £ verdi, TL hesabına 97.624,50 ₺ işlendi"
                // iki uçtan da okunabilir.
                CurrencyTypeId = targetAccountCurrencyTypeId,
                CurrencyRate = targetTryRate,
                CurrencyAmount = cariAmountInTargetCurrency,
                PaymentCurrencyTypeId = tenderTypeId,
                PaymentCurrencyRate = tenderTryRate,
                PaymentCurrencyAmount = tenderAmount,
                // Çevrim kodu: kasa ile ödeme dövizi ayrıştığında ya da cari hedef hesabı
                // ödeme dövizinden farklı olduğunda dolu (yukarıda üretiliyor).
                ExchangeCode = entity.ExchangeCode,
                DocumentNo = null,
                Description = description,
                TransactionType = "Kasa",
                DeliveryCustomerCode = null,
                ReferenceType = CustomerLedgerEntryReferenceType.Cash,
                ReferenceId = entity.Id,
                AccountingPeriodId = activePeriodId,
                CreateUser = username,
                CreateTime = now
            };

            _dbContext.CustomerLedgerEntries.Add(customerLedgerEntry);
            await _dbContext.SaveChangesAsync(cancellationToken);
        }

        await tx.CommitAsync(cancellationToken);
        return StatusCode(StatusCodes.Status201Created, new { success = true, data = new { id = entity.Id } });
    }

    [HttpPut("{id:int}")]
    [AuthorizePage("cash", "kasaGirisCikis")]
    public async Task<IActionResult> Update([FromRoute] int id, [FromBody] UpdateCashAccountTransactionRequest request, CancellationToken cancellationToken)
    {
        if (id <= 0) return BadRequest(new { success = false, message = "Geçersiz id" });
        if (!ModelState.IsValid) return ValidationProblem(ModelState);

        var entity = await _dbContext.CashAccountTransactions.FirstOrDefaultAsync(x => x.Id == id, cancellationToken);
        if (entity is null) return NotFound(new { success = false, message = "Kayıt bulunamadı" });

        if (entity.ReferenceType != CashAccountTransactionReferenceType.Manual)
        {
            return BadRequest(new { success = false, message = "Sistem kaydı düzenlenemez" });
        }

        if (await PersonnelPaymentLock.IsLockedAsync(_dbContext, PersonnelPaymentLock.KindCash, id, cancellationToken))
        {
            return BadRequest(new { success = false, message = PersonnelPaymentLock.Message });
        }

        if (request.Direction != CashAccountTransactionDirection.In && request.Direction != CashAccountTransactionDirection.Out)
        {
            return BadRequest(new { success = false, message = "Geçersiz işlem yönü" });
        }

        var now = DateTime.UtcNow;
        var username = User.FindFirst(ClaimTypes.Name)?.Value;
        if (string.IsNullOrWhiteSpace(username)) username = "System";

        var date = NormalizeUtc(request.Date);

        var cashAcc = await _dbContext.CashAccounts
            .AsNoTracking()
            .Select(x => new { x.Id, x.CurrencyTypeId, x.Code, x.Name })
            .FirstOrDefaultAsync(x => x.Id == entity.CashAccountId, cancellationToken);

        if (cashAcc is null)
        {
            return BadRequest(new { success = false, message = "Kasa bulunamadı" });
        }

        var accountCurrencyTypeId = CurrencyTypeHelper.Normalize(cashAcc.CurrencyTypeId);
        var currencyRate = request.CurrencyRate;

        try
        {
            currencyRate = await ResolveTryRateAsync(accountCurrencyTypeId, currencyRate, cancellationToken);
        }
        catch (InvalidOperationException ex)
        {
            return StatusCode(StatusCodes.Status503ServiceUnavailable, new { success = false, message = ex.Message });
        }

        var currencyAmount = ResolveCurrencyAmount(accountCurrencyTypeId, request.Amount, currencyRate, request.CurrencyAmount);

        // ÖDEME ÜÇLÜSÜ GÜNCELLEMEDE DE YAZILMALI (2026-08-26 bildirimi).
        //
        // `TenderCurrencyTypeId` / `TenderRate` / `TenderAmount` yalnızca OLUŞTURMA yolunda
        // yazılıyordu; güncelleme yolu bu üçüne hiç dokunmuyordu. Sonuç: tutar düzeltilen
        // kayıtta `Amount` yeni değere geçiyor ama `TenderAmount` ESKİ değerde kalıyordu.
        //
        // Cari ekstre satırı aşağıda `TenderAmount`tan hesaplanıyor
        // (`tenderAmount = entity.TenderAmount > 0 ? ... `), dolayısıyla kasa 2,00 olurken
        // ekstre 1,00'de kalıyordu — canlı örnek: kasa hareketi 92 / ekstre 1101.
        //
        // Çevrim mantığı OLUŞTURMA yolundakiyle birebir aynıdır; iki dalın ayrışmaması şart.
        var tenderCurrencyTypeId = request.TenderCurrencyTypeId > 0
            ? CurrencyTypeHelper.Normalize(request.TenderCurrencyTypeId)
            : accountCurrencyTypeId;

        var tenderRate = request.TenderRate;
        if (tenderCurrencyTypeId != accountCurrencyTypeId)
        {
            try
            {
                tenderRate = await ResolveTryRateAsync(tenderCurrencyTypeId, tenderRate, cancellationToken);
            }
            catch (InvalidOperationException ex)
            {
                return StatusCode(StatusCodes.Status503ServiceUnavailable, new { success = false, message = ex.Message });
            }
        }

        var updAmount = request.Amount;
        var updCurrencyAmount = currencyAmount;
        var updTenderAmount = request.TenderAmount > 0m ? request.TenderAmount : currencyAmount;

        if (tenderCurrencyTypeId != accountCurrencyTypeId && request.TenderAmount > 0m)
        {
            var conv = TenderConversion.Resolve(
                accountCurrencyTypeId, currencyRate,
                tenderCurrencyTypeId, tenderRate, request.TenderAmount);

            updAmount = conv.TryAmount;
            updCurrencyAmount = conv.AccountAmount;
            tenderRate = conv.TenderRate;

            // Çevrim kodu KORUNUR: kayıt zaten bir çevrimle açıldıysa kasa/banka ucuyla
            // eşleşen kodu değiştirmek iki ucu birbirinden koparır.
            if (string.IsNullOrWhiteSpace(entity.ExchangeCode))
            {
                entity.ExchangeCode = await ExchangeCodeGenerator.NextAsync(_dbContext, date, cancellationToken);
            }
        }
        else
        {
            tenderCurrencyTypeId = accountCurrencyTypeId;
            tenderRate = currencyRate;
            updTenderAmount = currencyAmount;
            entity.ExchangeCode = null;
        }

        await using var tx = await _dbContext.Database.BeginTransactionAsync(cancellationToken);

        entity.Date = date;
        entity.Direction = request.Direction;
        entity.Amount = updAmount;
        entity.CurrencyTypeId = accountCurrencyTypeId;
        entity.CurrencyRate = currencyRate;
        entity.CurrencyAmount = updCurrencyAmount;
        entity.TenderCurrencyTypeId = tenderCurrencyTypeId;
        entity.TenderRate = tenderRate;
        entity.TenderAmount = updTenderAmount;
        entity.CounterpartyType = request.CounterpartyType;
        entity.CounterpartyCode = (request.CounterpartyCode ?? string.Empty).Trim();
        entity.CounterpartyName = (request.CounterpartyName ?? string.Empty).Trim();
        entity.Description = string.IsNullOrWhiteSpace(request.Description) ? null : request.Description.Trim();
        entity.EditUser = username;
        entity.EditTime = now;

        if (entity.CounterpartyType == CashAccountTransactionCounterpartyType.Bank)
        {
            var bankCode = entity.CounterpartyCode;
            if (!string.IsNullOrWhiteSpace(bankCode))
            {
                var bankAcc = await _dbContext.BankAccountDefinitions
                    .AsNoTracking()
                    .Select(x => new { x.Id, x.AccountCode, x.AccountName, x.CurrencyTypeId })
                    .FirstOrDefaultAsync(x => x.AccountCode == bankCode, cancellationToken);

                if (bankAcc is not null)
                {
                    var bankCurrencyTypeId = bankAcc.CurrencyTypeId;
                    decimal bankRate;
                    try
                    {
                        bankRate = await ResolveTryRateAsync(bankCurrencyTypeId, 0m, cancellationToken);
                    }
                    catch (InvalidOperationException ex)
                    {
                        return StatusCode(StatusCodes.Status503ServiceUnavailable, new { success = false, message = ex.Message });
                    }

                    var bankCurrencyAmount = bankCurrencyTypeId == 0 ? entity.Amount : (bankRate > 0 ? entity.Amount / bankRate : 0m);
                    var bankDir = entity.Direction == CashAccountTransactionDirection.Out
                        ? BankAccountTransactionDirection.In
                        : BankAccountTransactionDirection.Out;

                    BankAccountTransaction? linked = null;
                    if (entity.LinkedBankAccountTransactionId.HasValue && entity.LinkedBankAccountTransactionId.Value > 0)
                    {
                        linked = await _dbContext.BankAccountTransactions
                            .FirstOrDefaultAsync(x => x.Id == entity.LinkedBankAccountTransactionId.Value, cancellationToken);
                    }

                    if (linked is null)
                    {
                        linked = new BankAccountTransaction
                        {
                            BankAccountDefinitionId = bankAcc.Id,
                            Date = date,
                            Direction = bankDir,
                            Amount = entity.Amount,
                            CurrencyTypeId = bankCurrencyTypeId,
                            CurrencyRate = bankRate,
                            CurrencyAmount = bankCurrencyAmount,
                            CounterpartyType = BankAccountTransactionCounterpartyType.Bank,
                            CounterpartyCode = (cashAcc.Code ?? string.Empty).Trim(),
                            CounterpartyName = (cashAcc.Name ?? string.Empty).Trim(),
                            Description = entity.Description,
                            IsPosFee = false,
                            CreateUser = username,
                            CreateTime = now
                        };
                        _dbContext.BankAccountTransactions.Add(linked);
                        await _dbContext.SaveChangesAsync(cancellationToken);
                        entity.LinkedBankAccountTransactionId = linked.Id;
                    }
                    else
                    {
                        linked.BankAccountDefinitionId = bankAcc.Id;
                        linked.Date = date;
                        linked.Direction = bankDir;
                        linked.Amount = entity.Amount;
                        linked.CurrencyTypeId = bankCurrencyTypeId;
                        linked.CurrencyRate = bankRate;
                        linked.CurrencyAmount = bankCurrencyAmount;
                        linked.CounterpartyType = BankAccountTransactionCounterpartyType.Bank;
                        linked.CounterpartyCode = (cashAcc.Code ?? string.Empty).Trim();
                        linked.CounterpartyName = (cashAcc.Name ?? string.Empty).Trim();
                        linked.Description = entity.Description;
                    }
                }
            }
        }
        else
        {
            if (entity.LinkedBankAccountTransactionId.HasValue && entity.LinkedBankAccountTransactionId.Value > 0)
            {
                var linked = await _dbContext.BankAccountTransactions
                    .FirstOrDefaultAsync(x => x.Id == entity.LinkedBankAccountTransactionId.Value, cancellationToken);
                if (linked is not null)
                {
                    _dbContext.BankAccountTransactions.Remove(linked);
                }
                entity.LinkedBankAccountTransactionId = null;
            }
        }

        var existingLedger = await _dbContext.CustomerLedgerEntries
            .FirstOrDefaultAsync(x => x.ReferenceType == CustomerLedgerEntryReferenceType.Cash && x.ReferenceId == entity.Id, cancellationToken);

        if (entity.CounterpartyType == CashAccountTransactionCounterpartyType.Customer)
        {
            var customerCode = (entity.CounterpartyCode ?? string.Empty).Trim();
            if (string.IsNullOrWhiteSpace(customerCode))
            {
                return BadRequest(new { success = false, message = "Müşteri/Cari kodu seçiniz" });
            }

            var customer = await _dbContext.Customers
                .AsNoTracking()
                .Select(x => new { x.CustomerCode, x.Name, x.CurrencyTypeId })
                .FirstOrDefaultAsync(x => x.CustomerCode == customerCode, cancellationToken);

            if (customer is null)
            {
                return BadRequest(new { success = false, message = "Müşteri bulunamadı" });
            }

            var ledgerDir = entity.Direction == CashAccountTransactionDirection.In
                ? CustomerLedgerEntryDirection.Credit
                : CustomerLedgerEntryDirection.Debit;

            var cashLabel = !string.IsNullOrWhiteSpace(cashAcc.Name)
                ? $"{cashAcc.Code} - {cashAcc.Name}"
                : cashAcc.Code;

            var description = string.IsNullOrWhiteSpace(entity.Description)
                ? $"Kasa İşlemi ({cashLabel})"
                : $"{entity.Description.Trim()} ({cashLabel})";

            // GÜNCELLEME YOLU DA ÖDEMENİN KENDİ PARA BİRİMİNDE (2026-08-19).
            // Oluşturma yolundaki notun aynısı geçerli; çapraz kur burada da kaldırıldı.
            // Bu ikinci yol atlanırsa kayıt doğru açılıp DÜZENLENİNCE yeniden bozuluyordu.
            var tenderTypeId = CurrencyTypeHelper.Normalize(
                entity.TenderCurrencyTypeId > 0 ? entity.TenderCurrencyTypeId : cashAcc.CurrencyTypeId);
            var tenderAmount = entity.TenderAmount > 0m ? entity.TenderAmount : (entity.CurrencyAmount > 0m ? entity.CurrencyAmount : entity.Amount);

            var tenderTryRate = CurrencyTypeHelper.IsTry(tenderTypeId)
                ? 1m
                : (entity.TenderRate > 0m ? entity.TenderRate : await ResolveTryRateAsync(tenderTypeId, 0m, cancellationToken));

            var cariAmountInTargetCurrency = tenderAmount;
            var tenderAmountTry = Math.Round(tenderAmount * tenderTryRate, 2, MidpointRounding.AwayFromZero);

            var activePeriodId = await _dbContext.AccountingPeriods
                .AsNoTracking()
                .Where(p => p.IsActive)
                .Select(p => (int?)p.Id)
                .FirstOrDefaultAsync(cancellationToken);

            if (existingLedger is null)
            {
                existingLedger = new CustomerLedgerEntry
                {
                    ReferenceType = CustomerLedgerEntryReferenceType.Cash,
                    ReferenceId = entity.Id,
                    CreateUser = username,
                    CreateTime = now
                };
                _dbContext.CustomerLedgerEntries.Add(existingLedger);
            }

            existingLedger.CustomerCode = customerCode;
            existingLedger.Date = date;
            existingLedger.DueDate = date;
            existingLedger.Direction = ledgerDir;
            existingLedger.Amount = tenderAmountTry;
            existingLedger.CurrencyTypeId = tenderTypeId;
            existingLedger.CurrencyRate = tenderTryRate;
            existingLedger.CurrencyAmount = cariAmountInTargetCurrency;
            existingLedger.PaymentCurrencyTypeId = tenderTypeId;
            existingLedger.PaymentCurrencyRate = tenderTryRate;
            existingLedger.PaymentCurrencyAmount = tenderAmount;
            existingLedger.ExchangeCode = entity.ExchangeCode;
            existingLedger.Description = description;
            existingLedger.TransactionType = "Kasa";
            existingLedger.AccountingPeriodId = existingLedger.AccountingPeriodId ?? activePeriodId;
            existingLedger.EditUser = username;
            existingLedger.EditTime = now;
        }
        else
        {
            if (existingLedger is not null)
            {
                _dbContext.CustomerLedgerEntries.Remove(existingLedger);
            }
        }

        await _dbContext.SaveChangesAsync(cancellationToken);
        await tx.CommitAsync(cancellationToken);
        return Ok(new { success = true });
    }

    [HttpDelete("{id:int}")]
    [AuthorizePage("cash", "kasaGirisCikis")]
    public async Task<IActionResult> Delete([FromRoute] int id, CancellationToken cancellationToken)
    {
        if (id <= 0) return BadRequest(new { success = false, message = "Geçersiz id" });

        var entity = await _dbContext.CashAccountTransactions.FirstOrDefaultAsync(x => x.Id == id, cancellationToken);
        if (entity is null) return NotFound(new { success = false, message = "Kayıt bulunamadı" });

        if (entity.ReferenceType != CashAccountTransactionReferenceType.Manual && entity.ReferenceType != CashAccountTransactionReferenceType.Invoice)
        {
            return BadRequest(new { success = false, message = "Sistem kaydı silinemez" });
        }

        if (await PersonnelPaymentLock.IsLockedAsync(_dbContext, PersonnelPaymentLock.KindCash, id, cancellationToken))
        {
            return BadRequest(new { success = false, message = PersonnelPaymentLock.Message });
        }

        var silmeKurali = await this.DeleteRuleViolationAsync(_dbContext, entity, "deleteRule/kasaHareket", cancellationToken);
        if (silmeKurali is not null) return silmeKurali;

        await using var tx = await _dbContext.Database.BeginTransactionAsync(cancellationToken);

        var custLedgers = new List<CustomerLedgerEntry>();
        var supLedgers = new List<SupplierLedgerEntry>();

        if (entity.ReferenceType == CashAccountTransactionReferenceType.Invoice)
        {
            if (entity.ReferenceId.HasValue && entity.ReferenceId.Value > 0)
            {
                var invoice = await _dbContext.Set<Invoice>()
                    .FirstOrDefaultAsync(x => x.Id == entity.ReferenceId.Value, cancellationToken);
                if (invoice is not null)
                {
                    invoice.IsManuallyPaid = false;
                    _dbContext.Set<Invoice>().Update(invoice);
                }

                // Delete payment CustomerLedgerEntries (whether invoice exists or has been deleted)
                custLedgers = await _dbContext.CustomerLedgerEntries
                    .Where(x => x.ReferenceType == CustomerLedgerEntryReferenceType.Invoice 
                                && x.ReferenceId == entity.ReferenceId.Value 
                                && (x.TransactionType == "Kasa" 
                                    || (x.TransactionType == "İade Faturası" 
                                        && x.Description != null 
                                        && x.Description.StartsWith("Kasa "))))
                    .ToListAsync(cancellationToken);
                if (custLedgers.Count > 0)
                {
                    _dbContext.CustomerLedgerEntries.RemoveRange(custLedgers);
                }

                // Delete payment SupplierLedgerEntries (whether invoice exists or has been deleted)
                var docNo = invoice?.InvoiceNo;
                if (string.IsNullOrWhiteSpace(docNo) && entity.Description != null)
                {
                    var match = System.Text.RegularExpressions.Regex.Match(entity.Description, @"[A-Za-z0-9]{5,20}");
                    if (match.Success) docNo = match.Value;
                }

                supLedgers = await _dbContext.SupplierLedgerEntries
                    .Where(x => (x.ReferenceType == SupplierLedgerEntryReferenceType.CashTransaction || x.ReferenceType == SupplierLedgerEntryReferenceType.Invoice)
                                && (x.ReferenceId == entity.ReferenceId.Value || (!string.IsNullOrEmpty(docNo) && x.DocumentNo == docNo))
                                && (x.TransactionType == "Kasa" 
                                    || (x.TransactionType == "İade Faturası" 
                                        && x.Description != null 
                                        && x.Description.StartsWith("Kasa "))))
                    .ToListAsync(cancellationToken);
                if (supLedgers.Count > 0)
                {
                    _dbContext.SupplierLedgerEntries.RemoveRange(supLedgers);
                }
            }
        }
        else
        {
            if (entity.LinkedBankAccountTransactionId.HasValue && entity.LinkedBankAccountTransactionId.Value > 0)
            {
                var linked = await _dbContext.BankAccountTransactions
                    .FirstOrDefaultAsync(x => x.Id == entity.LinkedBankAccountTransactionId.Value, cancellationToken);
                if (linked is not null)
                {
                    _dbContext.BankAccountTransactions.Remove(linked);
                }
            }

            var existingLedger = await _dbContext.CustomerLedgerEntries
                .FirstOrDefaultAsync(x => x.ReferenceType == CustomerLedgerEntryReferenceType.Cash && x.ReferenceId == entity.Id, cancellationToken);
            if (existingLedger is not null)
            {
                _dbContext.CustomerLedgerEntries.Remove(existingLedger);
                custLedgers.Add(existingLedger);
            }
        }

        var backupData = new
        {
            entity.Id,
            entity.CashAccountId,
            entity.Date,
            entity.Direction,
            entity.Amount,
            entity.CurrencyTypeId,
            entity.CurrencyRate,
            entity.CurrencyAmount,
            entity.CounterpartyType,
            entity.CounterpartyCode,
            entity.CounterpartyName,
            entity.ReferenceType,
            entity.ReferenceId,
            entity.Description,
            entity.CreateUser,
            entity.CreateTime,
            CustomerLedgerEntries = custLedgers.Select(cle => new
            {
                cle.CustomerCode,
                cle.Date,
                cle.DueDate,
                cle.Direction,
                cle.Amount,
                cle.CurrencyTypeId,
                cle.CurrencyRate,
                cle.CurrencyAmount,
                cle.DocumentNo,
                cle.Description,
                cle.TransactionType,
                cle.DeliveryCustomerCode,
                cle.ReferenceType,
                cle.ReferenceId,
                cle.CreateUser,
                cle.CreateTime
            }).ToList(),
            SupplierLedgerEntries = supLedgers.Select(sle => new
            {
                sle.SupplierCode,
                sle.Date,
                sle.DueDate,
                sle.Direction,
                sle.Amount,
                sle.CurrencyTypeId,
                sle.CurrencyRate,
                sle.CurrencyAmount,
                sle.DocumentNo,
                sle.Description,
                sle.TransactionType,
                sle.ReferenceType,
                sle.ReferenceId,
                sle.CreateUser,
                sle.CreateTime
            }).ToList()
        };

        var username = User.FindFirst(ClaimTypes.Name)?.Value ?? "";
        if (string.IsNullOrWhiteSpace(username)) username = "System";

        _dbContext.Set<DeletionLog>().Add(new DeletionLog
        {
            ModuleKey = "cash",
            PageKey = "kasaGirisCikis",
            RecordType = "KasaHareketi",
            RecordId = entity.Id.ToString(),
            ParentType = null,
            ParentId = null,
            Description = $"Kasa hareketi silindi: {entity.Amount:N2} TL ({entity.Description})",
            DetailsJson = JsonSerializer.Serialize(backupData),
            CreateUser = username,
            CreateTime = DateTime.UtcNow
        });

        _dbContext.CashAccountTransactions.Remove(entity);
        await _dbContext.SaveChangesAsync(cancellationToken);
        await tx.CommitAsync(cancellationToken);

        return Ok(new { success = true });
    }

    [HttpGet("{id:int}/invoice")]
    [AuthorizePage("cash", "kasaGirisCikis")]
    public async Task<IActionResult> GetLinkedInvoice([FromRoute] int id, CancellationToken cancellationToken)
    {
        if (id <= 0) return BadRequest(new { success = false, message = "Geçersiz id" });

        var tx = await _dbContext.CashAccountTransactions
            .AsNoTracking()
            .Where(x => x.Id == id)
            .Select(x => new { x.ReferenceType, x.ReferenceId })
            .FirstOrDefaultAsync(cancellationToken);

        if (tx is null) return NotFound(new { success = false, message = "Kayıt bulunamadı" });

        if (tx.ReferenceType != CashAccountTransactionReferenceType.Invoice || tx.ReferenceId is null || tx.ReferenceId.Value <= 0)
        {
            return BadRequest(new { success = false, message = "Bu kayıt bir fatura kaydı değil" });
        }

        var invoiceId = tx.ReferenceId.Value;
        var invoice = await _dbContext.Set<Invoice>()
            .AsNoTracking()
            .Where(x => x.Id == invoiceId)
            .Select(x => new
            {
                Id = x.Id,
                FaturaNo = x.InvoiceNo,
                CariKodu = x.CustomerCode,
                FaturaAcik = x.CustomerInvoiceTypeOverride,
                Aciklama = x.Description,
                Tarih = x.Date,
                GenelToplam = x.GrandTotal
            })
            .FirstOrDefaultAsync(cancellationToken);

        if (invoice is null) return NotFound(new { success = false, message = "Fatura bulunamadı" });

        return Ok(new { success = true, data = invoice });
    }

    [HttpGet("{id:int}/invoice-lines")]
    [AuthorizePage("cash", "kasaGirisCikis")]
    public async Task<IActionResult> GetLinkedInvoiceLines([FromRoute] int id, CancellationToken cancellationToken)
    {
        if (id <= 0) return BadRequest(new { success = false, message = "Geçersiz id" });

        var tx = await _dbContext.CashAccountTransactions
            .AsNoTracking()
            .Where(x => x.Id == id)
            .Select(x => new { x.ReferenceType, x.ReferenceId })
            .FirstOrDefaultAsync(cancellationToken);

        if (tx is null) return NotFound(new { success = false, message = "Kayıt bulunamadı" });

        if (tx.ReferenceType != CashAccountTransactionReferenceType.Invoice || tx.ReferenceId is null || tx.ReferenceId.Value <= 0)
        {
            return BadRequest(new { success = false, message = "Bu kayıt bir fatura kaydı değil" });
        }

        var invoiceId = tx.ReferenceId.Value;

        var data = await (
                from invLine in _dbContext.Set<InvoiceLine>().AsNoTracking()
                join product in _dbContext.Set<Product>().AsNoTracking() on invLine.StockCode equals product.StockCode into productJoin
                from product in productJoin.DefaultIfEmpty()
                where invLine.InvoiceId == invoiceId
                orderby invLine.LineNo
                select new
                {
                    Id = invLine.Id,
                    StockCode = invLine.StockCode,
                    StockName = product != null ? product.Name : string.Empty,
                    Description = invLine.Description,
                    VatRate = invLine.VatRate,
                    Quantity = invLine.Quantity,
                    UnitPrice = invLine.UnitPrice,
                    Total = invLine.Quantity * invLine.UnitPrice
                })
            .ToListAsync(cancellationToken);

        return Ok(new { success = true, data });
    }
}
