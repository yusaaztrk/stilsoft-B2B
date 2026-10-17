using System.Security.Claims;
using System.Text.Json;
using B2B.Erp.Api.Core.Authorization;
using B2B.Erp.Api.Core.Helpers;
using B2B.Erp.Api.Core.Interfaces;
using B2B.Erp.Api.Data;
using B2B.Erp.Api.Dtos.BankAccounts;
using B2B.Erp.Api.Entities;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace B2B.Erp.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
[Authorize]
public sealed class BankAccountTransactionsController : ControllerBase
{
    private readonly AppDbContext _dbContext;
    private readonly IMoneyServiceClient _money;

    public BankAccountTransactionsController(AppDbContext dbContext, IMoneyServiceClient money)
    {
        _dbContext = dbContext;
        _money = money;
    }

    private async Task<decimal> ResolveTryRateAsync(int currencyTypeId, decimal requestedRate, CancellationToken cancellationToken)
    {
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

    [HttpGet("{id:int}/balance-by-currency")]
    [AuthorizePage("bank", "bankaHavaleEft")]
    public async Task<IActionResult> BalanceByCurrency([FromRoute] int id, CancellationToken cancellationToken = default)
    {
        if (id <= 0) return BadRequest(new { success = false, message = "Geçersiz id" });

        var bank = await _dbContext.BankAccountDefinitions
            .AsNoTracking()
            .Select(x => new { x.Id, x.Budget, x.CurrencyTypeId })
            .FirstOrDefaultAsync(x => x.Id == id, cancellationToken);

        if (bank is null) return NotFound(new { success = false, message = "Banka hesabı bulunamadı" });

        var rawSums = await _dbContext.BankAccountTransactions
            .AsNoTracking()
            .Where(x => x.BankAccountDefinitionId == id)
            .GroupBy(x => x.CurrencyTypeId)
            .Select(g => new
            {
                CurrencyTypeId = g.Key,
                InTry = g.Where(x => x.Direction == BankAccountTransactionDirection.In).Sum(x => (decimal?)x.Amount) ?? 0m,
                OutTry = g.Where(x => x.Direction == BankAccountTransactionDirection.Out).Sum(x => (decimal?)x.Amount) ?? 0m,
                InCurrency = g.Where(x => x.Direction == BankAccountTransactionDirection.In).Sum(x => (decimal?)x.CurrencyAmount) ?? 0m,
                OutCurrency = g.Where(x => x.Direction == BankAccountTransactionDirection.Out).Sum(x => (decimal?)x.CurrencyAmount) ?? 0m
            })
            .ToListAsync(cancellationToken);

        // Collapse the legacy 0 onto 1 so TRY does not appear as two rows, and read
        // Amount (the TRY value) for TRY buckets / CurrencyAmount for foreign ones.
        var balances = rawSums
            .GroupBy(x => CurrencyTypeHelper.Normalize(x.CurrencyTypeId))
            .Select(g => new CurrencyBalanceDto
            {
                CurrencyTypeId = g.Key,
                CurrencyCode = CurrencyTypeHelper.ToCode(g.Key) ?? $"CUR{g.Key}",
                Balance = CurrencyTypeHelper.IsTry(g.Key)
                    ? g.Sum(x => x.InTry) - g.Sum(x => x.OutTry)
                    : g.Sum(x => x.InCurrency) - g.Sum(x => x.OutCurrency)
            })
            .ToList();

        /*
          AÇILIŞ (DEVİR) BAKİYESİ HER ZAMAN KATILIR (2026-08-23).

          Önceki hâli deviri yalnızca `balances.Count == 0` iken, yani hesapta HİÇ hareket
          yokken ekliyordu — ilk hareket girilir girilmez açılış bakiyesi bu kutudan sessizce
          düşüyordu. Üstelik eklenen o tek satır her zaman TRY damgalanıyordu: dövizli bir
          hesabın açılışı yanlış para biriminde görünüyordu.

          Devir, hesabın KENDİ para biriminde tutulur (tek-bakiye ucu da `Budget + giren -
          çıkan` derken bunu varsayar; bkz. Balance). Bu yüzden hesabın para birimi kovasına
          eklenir, o kova yoksa açılır. Hareketi olmayan hesapta sonuç eskisiyle aynıdır —
          tek fark, TL değil hesabın kendi parası yazması.
        */
        var accountCurrency = CurrencyTypeHelper.Normalize(bank.CurrencyTypeId);
        var openingBucket = balances.FirstOrDefault(x => x.CurrencyTypeId == accountCurrency);
        if (openingBucket is null)
        {
            balances.Add(new CurrencyBalanceDto
            {
                CurrencyTypeId = accountCurrency,
                CurrencyCode = CurrencyTypeHelper.ToCode(accountCurrency) ?? $"CUR{accountCurrency}",
                Balance = bank.Budget
            });
        }
        else
        {
            openingBucket.Balance += bank.Budget;
        }

        balances = balances.OrderBy(x => x.CurrencyTypeId).ToList();

        return Ok(new { success = true, data = new GetMultiCurrencyBalanceResponse { BankAccountDefinitionId = id, Balances = balances } });
    }

    private static string? MapCurrencyTypeIdToCode(int currencyTypeId)
        => CurrencyTypeHelper.ToCode(currencyTypeId);

    private static DateTime NormalizeUtc(DateTime dt)
    {
        if (dt == default) return DateTime.UtcNow;
        return dt.Kind == DateTimeKind.Utc ? dt : DateTime.SpecifyKind(dt, DateTimeKind.Utc);
    }

    private static string GetCategory(string? description)
    {
        var d = (description ?? string.Empty).ToLowerInvariant();

        if (d.Contains("çek tahsil")) return "Müşteri Çeki";
        if (d.Contains("borç çeki")) return "Borç Çeki";
        if (d.Contains("borç senedi")) return "Borç Senedi";

        return "Diğer";
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
    [AuthorizePage("bank", "bankaHavaleEft")]
    public async Task<IActionResult> List(
        [FromQuery] int? bankAccountDefinitionId,
        [FromQuery] int? currencyTypeId,
        [FromQuery] bool? isPosFee,
        [FromQuery] DateTime? startDate,
        [FromQuery] DateTime? endDate,
        [FromQuery] int take = 200,
        CancellationToken cancellationToken = default)
    {
        /*
          TEK HESAP SEÇİLİYSE HAREKETLERİN TAMAMI (2026-10-03, kullanıcı bildirimi: "200 kayıtta
          sınırlıyor, kafamız karışıyor").

          Ekran son 200 hareketi çekiyor, alttaki TOPLAM satırı yalnız onları topluyor ve
          DEVİR satırını 200. satırın altına "en eski hareket" diye ekliyordu; üstteki bakiye ise
          bütün hareketlerden hesaplanıyor. İki rakam hiçbir zaman tutmuyordu. Tek hesap
          seçiliyken üst sınır kaldırılıyor (100.000 güvenlik payı); hesap seçilmeden yapılan
          toplu listeleme eski sınırında kalır.
        */
        var tekHesap = bankAccountDefinitionId.HasValue && bankAccountDefinitionId.Value > 0;
        take = Math.Max(1, Math.Min(tekHesap ? 100_000 : 1000, take));

        var allowedBankIds = await GetUserAssignedBankAccountIdsAsync(cancellationToken);
        var q = _dbContext.BankAccountTransactions.AsNoTracking().AsQueryable();

        if (allowedBankIds != null)
        {
            if (bankAccountDefinitionId.HasValue && bankAccountDefinitionId.Value > 0)
            {
                if (!allowedBankIds.Contains(bankAccountDefinitionId.Value))
                {
                    return Ok(new { success = true, data = Array.Empty<object>() });
                }
                q = q.Where(x => x.BankAccountDefinitionId == bankAccountDefinitionId.Value);
            }
            else
            {
                q = q.Where(x => allowedBankIds.Contains(x.BankAccountDefinitionId));
            }
        }
        else if (bankAccountDefinitionId.HasValue && bankAccountDefinitionId.Value > 0)
        {
            q = q.Where(x => x.BankAccountDefinitionId == bankAccountDefinitionId.Value);
        }

        if (currencyTypeId.HasValue && currencyTypeId.Value >= 0)
        {
            // TL İKİ AYRI DEĞERLE YAZILMIŞ: eski/POS kayıtları 0, hesap tanımı ekranları 1.
            // Burada tam eşitlik aranıyordu ve sonucu şuydu: POS masrafı satırları
            // (CurrencyTypeId = 0 ile yazılıyorlar) TL hesabın listesi 1 ile süzüldüğü için
            // HİÇ GÖRÜNMÜYORDU. Masraf kaydediliyor, bakiyeden düşüyor, ama ekranda yok —
            // kullanıcı tarafından "POS masraf çalışmıyor" diye görülüyordu.
            //
            // CurrencyTypeHelper.Normalize ile iki kova tek kovaya iniyor. Sorgu Postgres'e
            // gittiği için Normalize'ı çağıramıyoruz; karşılığı olan koşul açıkça yazıldı.
            var wanted = CurrencyTypeHelper.Normalize(currencyTypeId.Value);
            q = wanted == CurrencyTypeHelper.Try
                ? q.Where(x => x.CurrencyTypeId == CurrencyTypeHelper.Try || x.CurrencyTypeId == 0)
                : q.Where(x => x.CurrencyTypeId == wanted);
        }

        if (isPosFee.HasValue)
        {
            q = q.Where(x => x.IsPosFee == isPosFee.Value);
        }

        // TARİH SÜZGECİ SUNUCUDA (denetim md. 29).
        //
        // POS masrafı ekranı sunucuda tarih süzgeci olmadığı için "son 1000 hareket"i çekip
        // aralığı tarayıcıda uyguluyordu: masraf satırı sayısı 1000'i aştığında geçmiş ayların
        // masrafları listeden sessizce düşüyor ve kullanıcı "o ay masraf yokmuş" sanıyordu.
        // Aralık artık sorguya veriliyor; parametre gönderilmezse davranış eskisiyle aynı.
        if (startDate.HasValue)
        {
            var startUtc = DateTime.SpecifyKind(startDate.Value.Date, DateTimeKind.Utc);
            q = q.Where(x => x.Date >= startUtc);
        }

        if (endDate.HasValue)
        {
            var endUtc = DateTime.SpecifyKind(endDate.Value.Date, DateTimeKind.Utc).AddDays(1).AddTicks(-1);
            q = q.Where(x => x.Date <= endUtc);
        }

        var data = await (
                from tx in q
                join bankAcc in _dbContext.BankAccountDefinitions.AsNoTracking() on tx.BankAccountDefinitionId equals bankAcc.Id
                // Avoid Date.Date expression to let Postgres use index (BankAccountDefinitionId, Date)
                orderby tx.Date descending, tx.CreateTime descending, tx.Id descending
                select new BankAccountTransactionListItemResponse
                {
                    Id = tx.Id,
                    BankAccountDefinitionId = tx.BankAccountDefinitionId,
                    BankAccountCode = bankAcc.AccountCode,
                    BankAccountName = bankAcc.AccountName,
                    Date = tx.Date,
                    Direction = tx.Direction,
                    Amount = tx.Amount,
                    CurrencyTypeId = tx.CurrencyTypeId,
                    CurrencyRate = tx.CurrencyRate,
                    CurrencyAmount = tx.CurrencyAmount,
                    CounterpartyType = tx.CounterpartyType,
                    CounterpartyCode = tx.CounterpartyCode,
                    CounterpartyName = tx.CounterpartyName,
                    DocumentNo = tx.DocumentNo,
                    MaturityDate = tx.MaturityDate,
                    Description = tx.Description,
                    Category = GetCategory(tx.Description),
                    IsPosFee = tx.IsPosFee,
                    PosFeeBsmvRate = tx.PosFeeBsmvRate,
                    PosFeeVatRate = tx.PosFeeVatRate,
                    PosFeeBsmvAmount = tx.PosFeeBsmvAmount,
                    PosFeeVatAmount = tx.PosFeeVatAmount,
                    // Çıplak komisyon SAKLANMAZ, brütten türetilir: üç bileşenin toplamı
                    // hesaptan düşen tutara birebir eşit kalsın diye tek kaynak brüttür.
                    PosFeeNetAmount = tx.CurrencyAmount - tx.PosFeeBsmvAmount - tx.PosFeeVatAmount,
                    CreateUser = tx.CreateUser
                })
            .Take(take)
            .ToListAsync(cancellationToken);

        return Ok(new { success = true, data });
    }

    public sealed class GetBalanceResponse
    {
        public int BankAccountDefinitionId { get; set; }
        public decimal Balance { get; set; }
        public decimal Budget { get; set; }
        public decimal InAmount { get; set; }
        public decimal OutAmount { get; set; }
    }

    public sealed class CurrencyBalanceDto
    {
        public int CurrencyTypeId { get; set; }
        public string CurrencyCode { get; set; } = string.Empty;
        public decimal Balance { get; set; }
    }

    public sealed class GetMultiCurrencyBalanceResponse
    {
        public int BankAccountDefinitionId { get; set; }
        public List<CurrencyBalanceDto> Balances { get; set; } = new();
    }

    [HttpGet("{id:int}/balance")]
    [AuthorizePage("bank", "bankaHavaleEft")]
    public async Task<IActionResult> Balance([FromRoute] int id, CancellationToken cancellationToken = default)
    {
        if (id <= 0) return BadRequest(new { success = false, message = "Geçersiz id" });

        var bank = await _dbContext.BankAccountDefinitions
            .AsNoTracking()
            .Select(x => new { x.Id, x.Budget, x.CurrencyTypeId })
            .FirstOrDefaultAsync(x => x.Id == id, cancellationToken);

        if (bank is null) return NotFound(new { success = false, message = "Banka hesabı bulunamadı" });

        // Group per currency and pick the matching bucket in memory: the "0 and 1 are both TRY"
        // rule cannot be expressed in SQL, and comparing the raw ids dropped every movement
        // of a TRY account stored as 1 against transactions stored as 0 (and vice versa).
        var rawSums = await _dbContext.BankAccountTransactions
            .AsNoTracking()
            .Where(x => x.BankAccountDefinitionId == id)
            .GroupBy(x => x.CurrencyTypeId)
            .Select(g => new
            {
                CurrencyTypeId = g.Key,
                InTry = g.Where(x => x.Direction == BankAccountTransactionDirection.In).Sum(x => (decimal?)x.Amount) ?? 0m,
                OutTry = g.Where(x => x.Direction == BankAccountTransactionDirection.Out).Sum(x => (decimal?)x.Amount) ?? 0m,
                InCurrency = g.Where(x => x.Direction == BankAccountTransactionDirection.In).Sum(x => (decimal?)x.CurrencyAmount) ?? 0m,
                OutCurrency = g.Where(x => x.Direction == BankAccountTransactionDirection.Out).Sum(x => (decimal?)x.CurrencyAmount) ?? 0m
            })
            .ToListAsync(cancellationToken);

        var accountCurrency = CurrencyTypeHelper.Normalize(bank.CurrencyTypeId);
        var accountIsTry = CurrencyTypeHelper.IsTry(accountCurrency);

        var inAmt = 0m;
        var outAmt = 0m;
        foreach (var g in rawSums)
        {
            // Movements booked in another currency than the account are not comparable
            if (!CurrencyTypeHelper.SameCurrency(accountCurrency, g.CurrencyTypeId)) continue;

            inAmt += accountIsTry ? g.InTry : g.InCurrency;
            outAmt += accountIsTry ? g.OutTry : g.OutCurrency;
        }

        var balance = bank.Budget + (inAmt - outAmt);

        return Ok(new
        {
            success = true,
            data = new GetBalanceResponse
            {
                BankAccountDefinitionId = id,
                Budget = bank.Budget,
                InAmount = inAmt,
                OutAmount = outAmt,
                Balance = balance
            }
        });
    }

    [HttpPost]
    [AuthorizePage("bank", "bankaHavaleEft")]
    public async Task<IActionResult> Create([FromBody] CreateBankAccountTransactionRequest request, CancellationToken cancellationToken)
    {
        if (!ModelState.IsValid) return ValidationProblem(ModelState);

        var allowedBankIds = await GetUserAssignedBankAccountIdsAsync(cancellationToken);
        if (allowedBankIds != null && !allowedBankIds.Contains(request.BankAccountDefinitionId))
        {
            return StatusCode(403, new { success = false, message = "Atanan banka hesaplarınız haricinde başka bir hesaba işlem yapma yetkiniz bulunmamaktadır." });
        }

        if (request.Direction != BankAccountTransactionDirection.In && request.Direction != BankAccountTransactionDirection.Out)
        {
            return BadRequest(new { success = false, message = "Geçersiz işlem yönü" });
        }

        if (request.CounterpartyType != BankAccountTransactionCounterpartyType.Bank
            && request.CounterpartyType != BankAccountTransactionCounterpartyType.Customer
            && request.CounterpartyType != BankAccountTransactionCounterpartyType.Supplier)
        {
            return BadRequest(new { success = false, message = "Geçersiz hesap tipi" });
        }

        var bankAcc = await _dbContext.BankAccountDefinitions
            .AsNoTracking()
            .Select(x => new { x.Id, x.AccountCode, x.AccountName, x.CurrencyTypeId })
            .FirstOrDefaultAsync(x => x.Id == request.BankAccountDefinitionId, cancellationToken);

        if (bankAcc is null)
        {
            return BadRequest(new { success = false, message = "Banka hesabı bulunamadı" });
        }

        // Normalize transaction currency to the bank account's configured currency.
        // Amount is stored as TRY in Amount, and as account currency in CurrencyAmount.
        var accountCurrencyTypeId = CurrencyTypeHelper.Normalize(bankAcc.CurrencyTypeId);
        var currencyRate = request.CurrencyRate;

        // TRY is stored as 0 (legacy) or 1 — both must pin the rate to 1
        if (CurrencyTypeHelper.IsTry(accountCurrencyTypeId))
        {
            currencyRate = 1m;
        }
        else
        {
            if (currencyRate <= 0)
            {
                var code = MapCurrencyTypeIdToCode(accountCurrencyTypeId);
                if (string.IsNullOrWhiteSpace(code))
                {
                    return BadRequest(new { success = false, message = "Geçersiz para birimi" });
                }

                try
                {
                    currencyRate = await _money.GetLatestTryRateAsync(code, cancellationToken);
                }
                catch
                {
                    return StatusCode(StatusCodes.Status503ServiceUnavailable, new
                    {
                        success = false,
                        message = "Kur bilgisi alınamadı. Lütfen kuru elle girin."
                    });
                }

                if (currencyRate <= 0)
                {
                    return StatusCode(StatusCodes.Status503ServiceUnavailable, new
                    {
                        success = false,
                        message = "Kur bilgisi alınamadı. Lütfen kuru elle girin."
                    });
                }
            }
        }

        var currencyAmount = CurrencyTypeHelper.IsTry(accountCurrencyTypeId)
            ? request.Amount
            : (currencyRate > 0 ? request.Amount / currencyRate : 0m);

        // GELEN PARA İLE HESAP AYRI OLABİLİR (2026-08-17): 1.000 DOLAR yatırılıp TL hesaba
        // günün kuruyla işlenebilir. Kasa kardeşiyle birebir aynı kural; TL çapası gelen
        // paradan üretilir, hesap tutarı da o çapadan türer (bkz. TenderConversion).
        var tenderCurrencyTypeId = request.TenderCurrencyTypeId > 0
            ? CurrencyTypeHelper.Normalize(request.TenderCurrencyTypeId)
            : accountCurrencyTypeId;
        var tenderRate = request.TenderRate;
        var tenderAmount = request.TenderAmount;
        var amountForEntity = request.Amount;
        string? exchangeCode = null;

        if (tenderCurrencyTypeId != accountCurrencyTypeId && tenderAmount > 0m)
        {
            if (tenderRate <= 0m)
            {
                var tenderCode = MapCurrencyTypeIdToCode(tenderCurrencyTypeId);
                try
                {
                    tenderRate = string.IsNullOrWhiteSpace(tenderCode)
                        ? 0m
                        : await _money.GetLatestTryRateAsync(tenderCode, cancellationToken);
                }
                catch
                {
                    tenderRate = 0m;
                }

                if (tenderRate <= 0m)
                {
                    return StatusCode(StatusCodes.Status503ServiceUnavailable, new
                    {
                        success = false,
                        message = "Gelen paranın kuru alınamadı. Lütfen kuru elle girin."
                    });
                }
            }

            var conv = TenderConversion.Resolve(
                accountCurrencyTypeId, currencyRate,
                tenderCurrencyTypeId, tenderRate, tenderAmount);

            amountForEntity = conv.TryAmount;
            currencyAmount = conv.AccountAmount;
            tenderRate = conv.TenderRate;
            exchangeCode = await ExchangeCodeGenerator.NextAsync(_dbContext, NormalizeUtc(request.Date), cancellationToken);
        }
        else
        {
            tenderCurrencyTypeId = accountCurrencyTypeId;
            tenderRate = currencyRate;
            tenderAmount = currencyAmount;
        }

        string counterpartyCode;
        string counterpartyName;

        if (request.CounterpartyType == BankAccountTransactionCounterpartyType.Bank)
        {
            var target = await _dbContext.BankAccountDefinitions
                .AsNoTracking()
                .Select(x => new { x.Id, x.AccountCode, x.AccountName })
                .FirstOrDefaultAsync(x => x.AccountCode == request.CounterpartyCode, cancellationToken);

            if (target is null)
            {
                return BadRequest(new { success = false, message = "Karşı banka hesabı bulunamadı" });
            }

            counterpartyCode = (target.AccountCode ?? string.Empty).Trim();
            counterpartyName = (target.AccountName ?? string.Empty).Trim();
        }
        else if (request.CounterpartyType == BankAccountTransactionCounterpartyType.Customer)
        {
            var customer = await _dbContext.Customers
                .AsNoTracking()
                .Select(x => new { x.CustomerCode, x.Name })
                .FirstOrDefaultAsync(x => x.CustomerCode == request.CounterpartyCode, cancellationToken);

            if (customer is null)
            {
                return BadRequest(new { success = false, message = "Cari bulunamadı" });
            }

            counterpartyCode = (customer.CustomerCode ?? string.Empty).Trim();
            counterpartyName = (customer.Name ?? string.Empty).Trim();
        }
        else
        {
            var supplier = await _dbContext.Suppliers
                .AsNoTracking()
                .Select(x => new { x.SupplierCode, x.FullName })
                .FirstOrDefaultAsync(x => x.SupplierCode == request.CounterpartyCode, cancellationToken);

            if (supplier is null)
            {
                return BadRequest(new { success = false, message = "Tedarikçi bulunamadı" });
            }

            counterpartyCode = (supplier.SupplierCode ?? string.Empty).Trim();
            counterpartyName = (supplier.FullName ?? string.Empty).Trim();
        }

        var now = DateTime.UtcNow;
        var username = User.FindFirst(ClaimTypes.Name)?.Value;
        if (string.IsNullOrWhiteSpace(username)) username = "System";

        var rawDate = NormalizeUtc(request.Date);
        var date = DateTime.SpecifyKind(rawDate.Date + now.TimeOfDay, DateTimeKind.Utc);

        await using var tx = await _dbContext.Database.BeginTransactionAsync(cancellationToken);

        var entity = new BankAccountTransaction
        {
            BankAccountDefinitionId = request.BankAccountDefinitionId,
            Date = date,
            Direction = request.Direction,
            Amount = amountForEntity,
            CurrencyTypeId = accountCurrencyTypeId,
            CurrencyRate = currencyRate,
            CurrencyAmount = currencyAmount,
            TenderCurrencyTypeId = tenderCurrencyTypeId,
            TenderRate = tenderRate,
            TenderAmount = tenderAmount,
            ExchangeCode = exchangeCode,
            CounterpartyType = request.CounterpartyType,
            CounterpartyCode = counterpartyCode,
            CounterpartyName = counterpartyName,
            DocumentNo = string.IsNullOrWhiteSpace(request.DocumentNo) ? null : request.DocumentNo.Trim(),
            MaturityDate = request.MaturityDate.HasValue ? NormalizeUtc(request.MaturityDate.Value) : null,
            Description = string.IsNullOrWhiteSpace(request.Description) ? null : request.Description.Trim(),
            IsPosFee = false,
            CreateUser = username,
            CreateTime = now
        };

        _dbContext.BankAccountTransactions.Add(entity);

        if (request.CounterpartyType == BankAccountTransactionCounterpartyType.Bank)
        {
            // create mirror transaction for the counterparty bank so its balance/report also updates
            var targetBank = await _dbContext.BankAccountDefinitions
                .AsNoTracking()
                .Select(x => new { x.Id, x.AccountCode, x.AccountName, x.CurrencyTypeId })
                .FirstOrDefaultAsync(x => x.AccountCode == counterpartyCode, cancellationToken);

            if (targetBank is not null)
            {
                var mirrorDir = request.Direction == BankAccountTransactionDirection.In
                    ? BankAccountTransactionDirection.Out
                    : BankAccountTransactionDirection.In;

                // Ayna kayıt KARŞI hesabın para biriminde durmalı.
                //
                // Öncesinde `CurrencyTypeId` HİÇ yazılmıyordu (ham 0'a düşüyordu) ve üstüne
                // KAYNAK hesabın kuru/döviz tutarı kopyalanıyordu. İki sonucu vardı:
                // (a) karşı hesap dövizliyse bakiye sorgusu `SameCurrency` süzgecinde bu satırı
                //     atlıyor, para karşı tarafın bakiyesinde hiç görünmüyordu;
                // (b) TL hesapta bile liste TL'yi 1 ile aradığı için satır ekranlardan
                //     kayboluyordu (POS masrafında düzeltilen hatanın aynısı, burası atlanmış).
                // TL çapası (`Amount`) iki tarafta da aynı olduğu için çapraz kur GEREKMEZ:
                // döviz karşılığı doğrudan hedefin kendi kurundan hesaplanıyor.
                var mirrorCurrencyTypeId = CurrencyTypeHelper.Normalize(targetBank.CurrencyTypeId);
                var mirrorRate = currencyRate;

                if (!CurrencyTypeHelper.SameCurrency(mirrorCurrencyTypeId, accountCurrencyTypeId))
                {
                    if (CurrencyTypeHelper.IsTry(mirrorCurrencyTypeId))
                    {
                        mirrorRate = 1m;
                    }
                    else
                    {
                        var mirrorCode = MapCurrencyTypeIdToCode(mirrorCurrencyTypeId);
                        try
                        {
                            mirrorRate = string.IsNullOrWhiteSpace(mirrorCode)
                                ? 0m
                                : await _money.GetLatestTryRateAsync(mirrorCode, cancellationToken);
                        }
                        catch
                        {
                            mirrorRate = 0m;
                        }

                        if (mirrorRate <= 0m)
                        {
                            return StatusCode(StatusCodes.Status503ServiceUnavailable, new
                            {
                                success = false,
                                message = "Karşı hesabın para birimi için kur bilgisi alınamadı."
                            });
                        }
                    }
                }

                var mirrorCurrencyAmount = CurrencyTypeHelper.IsTry(mirrorCurrencyTypeId)
                    ? request.Amount
                    : (mirrorRate > 0 ? request.Amount / mirrorRate : 0m);

                _dbContext.BankAccountTransactions.Add(new BankAccountTransaction
                {
                    BankAccountDefinitionId = targetBank.Id,
                    Date = date,
                    Direction = mirrorDir,
                    Amount = request.Amount,
                    CurrencyTypeId = mirrorCurrencyTypeId,
                    CurrencyRate = mirrorRate,
                    CurrencyAmount = mirrorCurrencyAmount,
                    CounterpartyType = BankAccountTransactionCounterpartyType.Bank,
                    CounterpartyCode = (bankAcc.AccountCode ?? string.Empty).Trim(),
                    CounterpartyName = (bankAcc.AccountName ?? string.Empty).Trim(),
                    DocumentNo = string.IsNullOrWhiteSpace(request.DocumentNo) ? null : request.DocumentNo.Trim(),
                    MaturityDate = request.MaturityDate.HasValue ? NormalizeUtc(request.MaturityDate.Value) : null,
                    Description = string.IsNullOrWhiteSpace(request.Description) ? null : request.Description.Trim(),
                    IsPosFee = false,
                    CreateUser = username,
                    CreateTime = now
                });
            }
        }

        try
        {
            await _dbContext.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException dbEx) when (dbEx.InnerException is Npgsql.PostgresException pgEx && pgEx.SqlState == "42703")
        {
            // Auto-heal schema drift: some tenant DBs may not yet have BankAccountTransactions.CurrencyTypeId.
            // Try to add the column and retry once.
            if ((pgEx.MessageText ?? string.Empty).Contains("CurrencyTypeId", StringComparison.OrdinalIgnoreCase)
                && (pgEx.MessageText ?? string.Empty).Contains("BankAccountTransactions", StringComparison.OrdinalIgnoreCase))
            {
                await _dbContext.Database.ExecuteSqlRawAsync(@"ALTER TABLE ""BankAccountTransactions"" ADD COLUMN IF NOT EXISTS ""CurrencyTypeId"" integer NOT NULL DEFAULT 0;", cancellationToken);
                await _dbContext.SaveChangesAsync(cancellationToken);
            }
            else
            {
                throw;
            }
        }

        // EKRANDA GİRİLEN AÇIKLAMA EKSTREYE DE GEÇER (2026-08-21 kullanıcı kuralı).
        //
        // AÇIKLAMA alanı banka hareketinde saklanıyordu ama cari/tedarikçi ekstresine hiç
        // yazılmıyordu: ekstrede yalnız sabit "Banka Havale/EFT (hesap)" metni görünüyor,
        // kullanıcının yazdığı not kayboluyordu.
        //
        // Biçim: "<açıklama> Banka Havale/EFT (hesap)" — açıklama BAŞTA, arada tek boşluk,
        // sabit metin olduğu gibi arkada kalır. Açıklama boşsa satır eskisi gibi görünür.
        var ledgerNote = string.IsNullOrWhiteSpace(request.Description) ? null : request.Description.Trim();
        string LedgerDescription(string label)
        {
            var baseText = $"Banka Havale/EFT ({label})";
            return ledgerNote is null ? baseText : $"{ledgerNote} {baseText}";
        }

        if (request.CounterpartyType == BankAccountTransactionCounterpartyType.Customer)
        {
            // write to customer ledger so Cari Ekstre reflects bank transfer
            var ledgerDir = request.Direction == BankAccountTransactionDirection.In
                ? CustomerLedgerEntryDirection.Credit
                : CustomerLedgerEntryDirection.Debit;

            var bankLabel = !string.IsNullOrWhiteSpace(bankAcc.AccountName)
                ? $"{bankAcc.AccountCode} - {bankAcc.AccountName}"
                : bankAcc.AccountCode;

            // ═══════════════════════════════════════════════════════════════════════
            // CARİ HAREKETİ ÖDEMENİN KENDİ PARA BİRİMİNDE YAZILIR (2026-08-19).
            //
            // Kasa kardeşiyle BİREBİR aynı kural — gerekçe ve kanıt için
            // `CashAccountTransactionsController`taki nota bakınız (1.500 £ → ekstrede
            // 31,66 €). Burada da ÇAPRAZ KUR vardı; kaldırıldı.
            // SATIR, SEÇİLEN CARİ HESABIN PARA BİRİMİNE TL ÇAPASINDAN ÇEVRİLİR
            // (2026-08-20 kullanıcı kararı) — kasa kardeşiyle BİREBİR aynı kural.
            // Her iki bacak da "1 döviz = X ₺" yönünde; çapraz kur kullanılmaz.
            // ═══════════════════════════════════════════════════════════════════════
            var bankCurrTypeId = CurrencyTypeHelper.Normalize(accountCurrencyTypeId);
            var tenderTypeId = CurrencyTypeHelper.Normalize(tenderCurrencyTypeId > 0 ? tenderCurrencyTypeId : bankCurrTypeId);
            var tenderAmountVal = tenderAmount > 0m ? tenderAmount : amountForEntity;

            // Yön DAİMA "1 döviz = X ₺".
            var tenderTryRate = CurrencyTypeHelper.IsTry(tenderTypeId)
                ? 1m
                : (tenderRate > 0m ? tenderRate : await ResolveTryRateAsync(tenderTypeId, 0m, cancellationToken));

            // TL ÇAPASI: gelen paranın TL karşılığı; hedef hesaba çevrimin girdisi budur.
            var tenderAmountTry = Math.Round(tenderAmountVal * tenderTryRate, 2, MidpointRounding.AwayFromZero);

            var activePeriodId = await _dbContext.AccountingPeriods
                .AsNoTracking()
                .Where(p => p.IsActive)
                .Select(p => (int?)p.Id)
                .FirstOrDefaultAsync(cancellationToken);

            // Hedef cari hesabı: ekrandan gelen seçim; yoksa/bilinmiyorsa ödemenin para birimi.
            var targetAccountCurrencyTypeId =
                request.CustomerAccountCurrencyTypeId is int reqTargetAcc && CurrencyTypeHelper.IsKnown(reqTargetAcc)
                    ? CurrencyTypeHelper.Normalize(reqTargetAcc)
                    : tenderTypeId;

            // Hedef hesabın TL kuru — yön yine "1 döviz = X ₺".
            var targetTryRate = CurrencyTypeHelper.IsTry(targetAccountCurrencyTypeId)
                ? 1m
                : await ResolveTryRateAsync(targetAccountCurrencyTypeId, 0m, cancellationToken);

            // TL çapasından hedef hesabın parasına. Kur çekilemezse çevrim yapılmaz.
            var cariAmountInTargetCurrency = targetTryRate > 0m
                ? Math.Round(tenderAmountTry / targetTryRate, 2, MidpointRounding.AwayFromZero)
                : tenderAmountVal;

            // Cari tarafında çevrim varsa iki uç aynı çevrim koduyla bağlanır; banka tarafında
            // kod zaten üretilmişse o korunur.
            if (!CurrencyTypeHelper.SameCurrency(targetAccountCurrencyTypeId, tenderTypeId)
                && string.IsNullOrWhiteSpace(exchangeCode))
            {
                exchangeCode = await ExchangeCodeGenerator.NextAsync(_dbContext, date, cancellationToken);
            }

            _dbContext.CustomerLedgerEntries.Add(new CustomerLedgerEntry
            {
                CustomerCode = counterpartyCode,
                TargetAccountCurrencyTypeId = targetAccountCurrencyTypeId,
                Date = date,
                DueDate = date,
                Direction = ledgerDir,
                Amount = tenderAmountTry,
                // Satırın para birimi HEDEF CARİ HESABIdır; `Payment*` gelen parayı saklar.
                CurrencyTypeId = targetAccountCurrencyTypeId,
                CurrencyRate = targetTryRate,
                CurrencyAmount = cariAmountInTargetCurrency,
                PaymentCurrencyTypeId = tenderTypeId,
                PaymentCurrencyRate = tenderTryRate,
                PaymentCurrencyAmount = tenderAmountVal,
                // Çevrim kodu: banka ile ödeme dövizi ya da cari hedef hesabı ile ödeme dövizi
                // ayrıştığında dolu.
                ExchangeCode = exchangeCode,
                DocumentNo = string.IsNullOrWhiteSpace(request.DocumentNo) ? null : request.DocumentNo.Trim(),
                Description = LedgerDescription(bankLabel),
                TransactionType = "Banka",
                DeliveryCustomerCode = null,
                ReferenceType = CustomerLedgerEntryReferenceType.Bank,
                ReferenceId = entity.Id,
                AccountingPeriodId = activePeriodId,
                CreateUser = username,
                CreateTime = now
            });
        }
        else if (request.CounterpartyType == BankAccountTransactionCounterpartyType.Supplier)
        {
            var ledgerDir = request.Direction == BankAccountTransactionDirection.In
                ? SupplierLedgerEntryDirection.Credit
                : SupplierLedgerEntryDirection.Debit;

            var bankLabel = !string.IsNullOrWhiteSpace(bankAcc.AccountName)
                ? $"{bankAcc.AccountCode} - {bankAcc.AccountName}"
                : bankAcc.AccountCode;

            _dbContext.SupplierLedgerEntries.Add(new SupplierLedgerEntry
            {
                SupplierCode = counterpartyCode,
                Date = date,
                DueDate = date,
                Direction = ledgerDir,
                Amount = request.Amount,
                // Tedarikçi dalı sabit TL yazıyordu (müşteri dalı — hemen yukarıda — dövizi
                // çapraz kurla birlikte doğru işliyordu). Dövizli banka hesabından yapılan
                // tedarikçi ödemesi deftere TL olarak düşüyordu.
                //
                // `Supplier` varlığında takip dövizi ALANI YOK; bu yüzden hareketin para birimi
                // fiilen paranın çıktığı BANKA HESABINDAN alınır — bilinen ve savunulabilir tek
                // kaynak budur. Tedarikçiye takip dövizi eklenirse burası da ona bağlanmalı.
                CurrencyTypeId = CurrencyTypeHelper.Normalize(accountCurrencyTypeId),
                CurrencyRate = currencyRate > 0 ? currencyRate : 1m,
                CurrencyAmount = currencyAmount > 0 ? currencyAmount : request.Amount,
                DocumentNo = string.IsNullOrWhiteSpace(request.DocumentNo) ? null : request.DocumentNo.Trim(),
                Description = LedgerDescription(bankLabel),
                TransactionType = "Banka",
                ReferenceType = SupplierLedgerEntryReferenceType.BankTransaction,
                ReferenceId = entity.Id,
                CreateUser = username,
                CreateTime = now
            });
        }

        if (request.PosFee > 0)
        {
            /*
              MASRAF, PARANIN ÇIKTIĞI HESABIN PARA BİRİMİNDEDİR (2026-08-20).

              Burası masrafı SABİT TL damgalıyordu (`CurrencyTypeId = Try, CurrencyRate = 1`).
              TL hesapta doğru sonuç veriyordu, dövizli hesapta üç şeyi birden bozuyordu:
              hesabın ekstresi kendi para birimiyle süzdüğü için satır GÖRÜNMÜYOR, bakiye
              sorgusu farklı para birimini atladığı için masraf hesaptan DÜŞMÜYOR, masraf
              raporu da dolar masrafını TL sanıyordu. Kardeşi olan aktarım yolu
              (`BankAccountTransfersController`) bunu zaten doğru yazıyordu; iki yol ayrışmıştı.

              `request.PosFee` ekrandan TL olarak gelir (`posFeeTryAmount`) — bu DEĞİŞMEDİ.
              TL tutar `Amount` çapasında durur, hesabın parasındaki karşılığı hesaplanır.
              TL hesapta kur 1 olduğu için sonuç birebir eskisiyle aynıdır.
            */
            var posFeeGrossInAccountCurrency = CurrencyTypeHelper.IsTry(accountCurrencyTypeId)
                ? request.PosFee
                : (currencyRate > 0
                    ? Math.Round(request.PosFee / currencyRate, 2, MidpointRounding.AwayFromZero)
                    : request.PosFee);

            // Brütün içindeki BSMV/KDV ayrıştırılır (denetim md. A4). Oranlar elle girilir,
            // girilmezse sıfır döner ve satır bugüne kadarki hâliyle birebir aynı yazılır.
            // Ayrıştırma HESABIN parasındaki brüt üzerinden yapılır ki üç bileşenin toplamı
            // `CurrencyAmount`a birebir eşit kalsın.
            var posFeeVergi = Core.Helpers.PosFeeTaxBreakdown.Split(
                posFeeGrossInAccountCurrency, request.PosFeeBsmvRate ?? 0m, request.PosFeeVatRate ?? 0m);

            _dbContext.BankAccountTransactions.Add(new BankAccountTransaction
            {
                BankAccountDefinitionId = request.BankAccountDefinitionId,
                Date = date,
                Direction = BankAccountTransactionDirection.Out,
                Amount = request.PosFee,
                CurrencyTypeId = accountCurrencyTypeId,
                CurrencyRate = currencyRate > 0 ? currencyRate : 1m,
                CurrencyAmount = posFeeGrossInAccountCurrency,
                CounterpartyType = BankAccountTransactionCounterpartyType.Bank,
                CounterpartyCode = (bankAcc.AccountCode ?? string.Empty).Trim(),
                CounterpartyName = (bankAcc.AccountName ?? string.Empty).Trim(),
                Description = !string.IsNullOrWhiteSpace(request.PosFeeDescription)
                    ? request.PosFeeDescription.Trim()
                    : $"Havale/EFT Masrafı: {(bankAcc.AccountName ?? bankAcc.AccountCode ?? string.Empty).Trim()} → {counterpartyName}",
                /*
                  BURASI HAVALE/EFT EKRANI — MASRAF DA HAVALE/EFT MASRAFIDIR (2026-08-23).

                  Satır "POS Masrafı" diye damgalanıyordu. Sebebi tarihsel: masraf alanı bir
                  zamanlar yalnızca POS için vardı ve tek bir `IsPosFee` bayrağıyla tutuluyordu.
                  Masraf türleri açıldıktan sonra da bu yol eski damgayı yazmaya devam etti;
                  sonuç, Banka Masrafları ekranında havale masrafının POS masraf hesabına
                  düşmesi ve "ne kadar POS komisyonu ödedik" sorusunun yanlış cevaplanmasıydı.

                  `IsPosFee` bilerek FALSE: varlıkta yazılı olan kural `IsPosFee ==
                  (ExpenseType == PosFee)`. İkisini birden true bırakmak, aynı satırı iki ayrı
                  masraf hesabına ait gösterirdi.
                */
                IsPosFee = false,
                ExpenseType = (int)BankExpenseType.TransferFee,
                PosFeeBsmvRate = request.PosFeeBsmvRate ?? 0m,
                PosFeeVatRate = request.PosFeeVatRate ?? 0m,
                PosFeeBsmvAmount = posFeeVergi.BsmvAmount,
                PosFeeVatAmount = posFeeVergi.VatAmount,
                CreateUser = username,
                CreateTime = now
            });
        }

        await _dbContext.SaveChangesAsync(cancellationToken);
        await tx.CommitAsync(cancellationToken);

        return StatusCode(StatusCodes.Status201Created, new { success = true, data = new { id = entity.Id } });
    }

    [HttpDelete("{id:int}")]
    [AuthorizePage("bank", "bankaHavaleEft")]
    public async Task<IActionResult> Delete([FromRoute] int id, CancellationToken cancellationToken)
    {
        if (id <= 0) return BadRequest(new { success = false, message = "Geçersiz id" });

        var entity = await _dbContext.BankAccountTransactions.FirstOrDefaultAsync(x => x.Id == id, cancellationToken);
        if (entity is null) return NotFound(new { success = false, message = "Kayıt bulunamadı" });

        if (await PersonnelPaymentLock.IsLockedAsync(_dbContext, PersonnelPaymentLock.KindBank, id, cancellationToken))
        {
            return BadRequest(new { success = false, message = PersonnelPaymentLock.Message });
        }

        var silmeKurali = await this.DeleteRuleViolationAsync(_dbContext, entity, "deleteRule/bankaHareket", cancellationToken);
        if (silmeKurali is not null) return silmeKurali;

        // Kredi taksit ödemesinin oluşturduğu hareket BURADAN silinemez.
        //
        // Silinebilseydi ödeme kaydı sahipsiz kalırdı: kredi ekranı taksiti "ödendi" göstermeye
        // devam eder, banka hesabından ise para hiç çıkmamış olurdu. Geri alma tek kapıdan
        // yapılır (LoansController.DeletePayment) ve ikisini birlikte siler.
        var loanPayment = await _dbContext.LoanPayments
            .AsNoTracking()
            .Where(x => x.BankAccountTransactionId == id)
            .Select(x => new { x.Id, x.LoanId })
            .FirstOrDefaultAsync(cancellationToken);

        if (loanPayment != null)
        {
            var loanCode = await _dbContext.Loans
                .AsNoTracking()
                .Where(x => x.Id == loanPayment.LoanId)
                .Select(x => x.LoanCode)
                .FirstOrDefaultAsync(cancellationToken);

            return BadRequest(new
            {
                success = false,
                message = $"Bu hareket {loanCode} kredisinin taksit ödemesine ait. Silmek için Krediler ekranından ödemeyi geri alın."
            });
        }

        await using var tx = await _dbContext.Database.BeginTransactionAsync(cancellationToken);

        var custLedgers = new List<CustomerLedgerEntry>();
        var supLedgers = new List<SupplierLedgerEntry>();

        // If the bank transaction is linked to an invoice payment (via DocumentNo)
        if (!string.IsNullOrWhiteSpace(entity.DocumentNo))
        {
            var invoice = await _dbContext.Set<Invoice>()
                .FirstOrDefaultAsync(x => x.InvoiceNo == entity.DocumentNo, cancellationToken);
            if (invoice is not null)
            {
                invoice.IsManuallyPaid = false;
                _dbContext.Set<Invoice>().Update(invoice);
            }

            // Delete invoice-payment CustomerLedgerEntries (even if invoice is null/deleted)
            custLedgers = await _dbContext.CustomerLedgerEntries
                .Where(x => x.ReferenceType == CustomerLedgerEntryReferenceType.Invoice 
                            && x.DocumentNo == entity.DocumentNo 
                            && (x.TransactionType == "Banka" 
                                || x.TransactionType == "İade Faturası" 
                                || x.TransactionType == "POS"))
                .ToListAsync(cancellationToken);
            if (custLedgers.Count > 0)
            {
                _dbContext.CustomerLedgerEntries.RemoveRange(custLedgers);
            }

            // Delete invoice-payment SupplierLedgerEntries (even if invoice is null/deleted)
            supLedgers = await _dbContext.SupplierLedgerEntries
                .Where(x => (x.ReferenceType == SupplierLedgerEntryReferenceType.BankTransaction || x.ReferenceType == SupplierLedgerEntryReferenceType.Invoice)
                            && x.DocumentNo == entity.DocumentNo 
                            && (x.TransactionType == "Banka" 
                                || x.TransactionType == "İade Faturası" 
                                || x.TransactionType == "POS"))
                .ToListAsync(cancellationToken);
            if (supLedgers.Count > 0)
            {
                _dbContext.SupplierLedgerEntries.RemoveRange(supLedgers);
            }
        }

        // Delete associated CustomerLedgerEntry if exists (standard manual flow)
        var customerLedger = await _dbContext.CustomerLedgerEntries
            .FirstOrDefaultAsync(x => x.ReferenceType == CustomerLedgerEntryReferenceType.Bank && x.ReferenceId == entity.Id, cancellationToken);
        if (customerLedger is not null)
        {
            _dbContext.CustomerLedgerEntries.Remove(customerLedger);
            custLedgers.Add(customerLedger);
        }

        // Delete associated SupplierLedgerEntry if exists (standard manual flow)
        var supplierLedger = await _dbContext.SupplierLedgerEntries
            .FirstOrDefaultAsync(x => x.ReferenceType == SupplierLedgerEntryReferenceType.BankTransaction && x.ReferenceId == entity.Id, cancellationToken);
        if (supplierLedger is not null)
        {
            _dbContext.SupplierLedgerEntries.Remove(supplierLedger);
            supLedgers.Add(supplierLedger);
        }

        // BANKA→BANKA AYNA HAREKETİ DE SİLİNMELİ.
        //
        // Karşı hesaba yazılan ayna kayıt (bkz. Create, `CounterpartyType == Bank` dalı) bu
        // harekete bir kolonla BAĞLI DEĞİL (`BankAccountTransaction`da bağ alanı yok), o yüzden
        // silme yolu onu hiç bulamıyor ve bir bacak silinince diğeri bankada asılı kalıyordu:
        // para tek yönlü kayboluyor/çoğalıyor. Eşleştirme, aynanın yazılışındaki alanların
        // tersiyle yapılıyor (hesap + ters yön + tutar + tarih + karşı hesap kodu).
        // Aynı gün aynı iki hesap arasında birebir aynı iki transfer varsa hangisinin
        // silindiği fark etmez — ikisi de aynı çifti temsil eder.
        if (entity.CounterpartyType == BankAccountTransactionCounterpartyType.Bank
            && !string.IsNullOrWhiteSpace(entity.CounterpartyCode))
        {
            var sourceAccountCode = await _dbContext.BankAccountDefinitions
                .AsNoTracking()
                .Where(x => x.Id == entity.BankAccountDefinitionId)
                .Select(x => x.AccountCode)
                .FirstOrDefaultAsync(cancellationToken);

            var counterpartyBankId = await _dbContext.BankAccountDefinitions
                .AsNoTracking()
                .Where(x => x.AccountCode == entity.CounterpartyCode)
                .Select(x => (int?)x.Id)
                .FirstOrDefaultAsync(cancellationToken);

            if (counterpartyBankId.HasValue && !string.IsNullOrWhiteSpace(sourceAccountCode))
            {
                var oppositeDirection = entity.Direction == BankAccountTransactionDirection.In
                    ? BankAccountTransactionDirection.Out
                    : BankAccountTransactionDirection.In;

                var mirrorTx = await _dbContext.BankAccountTransactions
                    .FirstOrDefaultAsync(x => x.Id != entity.Id
                        && x.BankAccountDefinitionId == counterpartyBankId.Value
                        && x.CounterpartyType == BankAccountTransactionCounterpartyType.Bank
                        && x.CounterpartyCode == sourceAccountCode
                        && x.Direction == oppositeDirection
                        && x.Amount == entity.Amount
                        && x.Date == entity.Date
                        // Masraf satırı aynanın kendisi olamaz. Ölçüt `!IsPosFee` idi; masraf
                        // türleri açıldıktan sonra POS DIŞI bir masraf (havale, hesap işletim…)
                        // bu süzgeçten geçip ayna sanılabiliyordu. Tür damgası hepsini kapsar.
                        && x.ExpenseType == 0, cancellationToken);

                if (mirrorTx is not null)
                {
                    _dbContext.BankAccountTransactions.Remove(mirrorTx);
                }
            }
        }

        var backupData = new
        {
            entity.Id,
            entity.BankAccountDefinitionId,
            entity.Date,
            entity.Direction,
            entity.Amount,
            entity.CurrencyTypeId,
            entity.CurrencyRate,
            entity.CurrencyAmount,
            entity.CounterpartyType,
            entity.CounterpartyCode,
            entity.CounterpartyName,
            entity.DocumentNo,
            entity.Description,
            entity.IsPosFee,
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
            ModuleKey = "bank",
            PageKey = "bankaHavaleEft",
            RecordType = "BankaHareketi",
            RecordId = entity.Id.ToString(),
            ParentType = null,
            ParentId = null,
            Description = $"Banka hareketi silindi: {entity.Amount:N2} TL ({entity.Description})",
            DetailsJson = JsonSerializer.Serialize(backupData),
            CreateUser = username,
            CreateTime = DateTime.UtcNow
        });

        _dbContext.BankAccountTransactions.Remove(entity);
        await _dbContext.SaveChangesAsync(cancellationToken);
        await tx.CommitAsync(cancellationToken);

        return Ok(new { success = true });
    }
}
