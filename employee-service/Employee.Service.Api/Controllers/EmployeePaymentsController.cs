using System.Security.Claims;
using B2B.Erp.Api.Core.Authorization;
using B2B.Erp.Api.Core.Services;
using B2B.Erp.Api.Core.Time;
using B2B.Erp.Api.Data;
using B2B.Erp.Api.Dtos.Employees;
using B2B.Erp.Api.Entities;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace B2B.Erp.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
[Authorize]
[AuthorizePage("employee", "calisan")]
[AuthorizePage("users", "calisan")]
public sealed class EmployeePaymentsController : ControllerBase
{
    private readonly AppDbContext _dbContext;
    private readonly EmployeeCashService _cash;
    private readonly EmployeeAccrualService _accruals;
    private readonly WorkCalendarService _calendar;
    private readonly bool _accountMovementsEnabled;
    private readonly ErpPaymentAccountService _erp;

    public EmployeePaymentsController(AppDbContext dbContext, EmployeeCashService cash, EmployeeAccrualService accruals, WorkCalendarService calendar, IConfiguration configuration, ErpPaymentAccountService erp)
    {
        _dbContext = dbContext;
        _erp = erp;
        _cash = cash;
        _accruals = accruals;
        _calendar = calendar;
        _accountMovementsEnabled = AccountMovementSettings.IsEnabled(configuration);
    }

    private static DateTime NormalizeUtc(DateTime dt)
    {
        if (dt == default) return DateTime.UtcNow;
        return dt.Kind == DateTimeKind.Utc ? dt : DateTime.SpecifyKind(dt, DateTimeKind.Utc);
    }

    private string GetUsername()
    {
        var username = User.FindFirst(ClaimTypes.Name)?.Value;
        return string.IsNullOrWhiteSpace(username) ? "System" : username;
    }

    private async Task<int?> GetBankCurrencyTypeId(int bankAccountDefinitionId, CancellationToken cancellationToken)
    {
        var currencyTypeId = await _dbContext.Database
            .SqlQuery<int?>($"SELECT \"CurrencyTypeId\" AS \"Value\" FROM \"BankAccountDefinitions\" WHERE \"Id\" = {bankAccountDefinitionId} LIMIT 1")
            .FirstOrDefaultAsync(cancellationToken);

        return currencyTypeId;
    }

    private async Task<int?> GetCashCurrencyTypeId(int cashAccountId, CancellationToken cancellationToken)
    {
        var currencyTypeId = await _dbContext.Database
            .SqlQuery<int?>($"SELECT \"CurrencyTypeId\" AS \"Value\" FROM \"CashAccounts\" WHERE \"Id\" = {cashAccountId} LIMIT 1")
            .FirstOrDefaultAsync(cancellationToken);

        return currencyTypeId;
    }

    /// <summary>
    /// Personel ödemesinin tutarı TL'dir; kasa/banka hareketi ise HESABIN kendi para
    /// birimindedir. Burada kur sabit <c>1</c> ve döviz tutarı ham TL rakamı yazılıyordu:
    /// 38.000 ₺ maaş dolar hesaptan ödendiğinde hesaptan 1.000 $ yerine 38.000 $ düşüyor,
    /// bakiye ~38 kat eriyordu. Ana API'deki <c>AccountMovementCurrency</c> ile aynı kural;
    /// bu mikroservis o projeye referans vermediği için kur doğrudan
    /// <c>ExchangeRates</c> tablosundan okunuyor (ana API'nin TCMB senkronu doldurur).
    ///
    /// <para>Kodlama ana API ile aynı: 0/1 = TRY, 2 = EUR, 3 = USD, 4 = GBP.</para>
    /// </summary>
    /// <exception cref="InvalidOperationException">
    /// Döviz hesapta kur bulunamazsa. Çağıran 503 döndürmeli — sessizce 1 yazmak bakiyeyi bozar.
    /// </exception>
    private async Task<(int CurrencyTypeId, decimal Rate, decimal CurrencyAmount)> ResolveAccountMovementAsync(
        int accountCurrencyTypeId,
        decimal tryAmount,
        CancellationToken cancellationToken)
    {
        var normalized = accountCurrencyTypeId == 0 ? 1 : accountCurrencyTypeId;

        if (normalized == 1) return (1, 1m, tryAmount);

        var code = normalized switch
        {
            2 => "EUR",
            3 => "USD",
            4 => "GBP",
            _ => null
        };

        if (code is null)
        {
            throw new InvalidOperationException($"Hesabın para birimi tanınmıyor (kod {accountCurrencyTypeId}).");
        }

        var rate = await _dbContext.Database
            .SqlQuery<decimal?>($@"
SELECT CASE WHEN ""SellingRate"" > 0 THEN ""SellingRate"" ELSE ""BuyingRate"" END AS ""Value""
FROM ""ExchangeRates""
WHERE ""CurrencyCode"" = {code}
ORDER BY ""RateDate"" DESC
LIMIT 1")
            .FirstOrDefaultAsync(cancellationToken);


        if (rate is not > 0m)
        {
            throw new InvalidOperationException($"{code} kuru alınamadı, ödeme kaydedilmedi. Lütfen sonra tekrar deneyin.");
        }

        return (normalized, rate.Value, Math.Round(tryAmount / rate.Value, 2, MidpointRounding.AwayFromZero));
    }

    private async Task InsertBankAccountTransaction(
        int bankAccountDefinitionId,
        DateTime dateUtc,
        int direction,
        decimal amount,
        int currencyTypeId,
        decimal currencyRate,
        decimal currencyAmount,
        string counterpartyCode,
        string counterpartyName,
        string description,
        string username,
        DateTime nowUtc,
        CancellationToken cancellationToken)
    {
        await _dbContext.Database.ExecuteSqlInterpolatedAsync($@"
INSERT INTO ""BankAccountTransactions""(
  ""BankAccountDefinitionId"", ""Date"", ""Direction"", ""Amount"",
  ""CurrencyTypeId"", ""CurrencyRate"", ""CurrencyAmount"",
  ""CounterpartyType"", ""CounterpartyCode"", ""CounterpartyName"",
  ""DocumentNo"", ""MaturityDate"", ""Description"", ""IsPosFee"",
  ""CreateUser"", ""CreateTime"", ""EditUser"", ""EditTime"")
VALUES (
  {bankAccountDefinitionId}, {dateUtc}, {direction}, {amount},
  {currencyTypeId}, {currencyRate}, {currencyAmount},
  {2}, {counterpartyCode}, {counterpartyName},
  NULL, NULL, {description}, FALSE,
  {username}, {nowUtc}, NULL, NULL
)
", cancellationToken);
    }

    private async Task InsertCashAccountTransaction(
        int cashAccountId,
        DateTime dateUtc,
        int direction,
        decimal amount,
        int currencyTypeId,
        decimal currencyRate,
        decimal currencyAmount,
        string counterpartyCode,
        string counterpartyName,
        string description,
        string username,
        DateTime nowUtc,
        string? referenceNo,
        CancellationToken cancellationToken)
    {
        await _dbContext.Database.ExecuteSqlInterpolatedAsync($@"
INSERT INTO ""CashAccountTransactions""(
  ""CashAccountId"", ""Date"", ""Direction"", ""Amount"",
  ""CurrencyTypeId"", ""CurrencyRate"", ""CurrencyAmount"",
  ""CounterpartyType"", ""CounterpartyCode"", ""CounterpartyName"",
  ""ReferenceType"", ""ReferenceId"", ""LinkedBankAccountTransactionId"",
  ""ReferenceNo"", ""Description"", ""CreateUser"", ""CreateTime"", ""EditUser"", ""EditTime"")
VALUES (
  {cashAccountId}, {dateUtc}, {direction}, {amount},
  {currencyTypeId}, {currencyRate}, {currencyAmount},
  {3}, {counterpartyCode}, {counterpartyName},
  {1}, NULL, NULL,
  {referenceNo}, {description}, {username}, {nowUtc}, NULL, NULL
)
", cancellationToken);
    }


    /// <summary>Kasa/banka hareketi yazma sonucu.</summary>
    private sealed record MovementResult(bool Ok, string? Error, int? CurrencyTypeId, decimal? Rate, decimal? CurrencyAmount);

    /// <summary>
    /// Ödeme için kasa/banka hareketi yazar.
    ///
    /// <para>Maaş ve yemek toplu ödemelerinde bu adım HİÇ çalışmıyordu: tutar hesaplanıyor,
    /// "kasa/banka tarafı ana ERP'de hallediliyor" notuyla atlanıyordu. Sonuç olarak maaş
    /// ödendiği hâlde kasadan/bankadan hiç para çıkmıyor, bakiye şişiyordu.</para>
    ///
    /// <para><paramref name="knownRate"/> doluysa kur yeniden çözülmez; iptal (ters kayıt)
    /// yolunda orijinal hareketin kuru kullanılır ki döviz hesapta bakiye tam sıfırlansın.</para>
    /// </summary>
    private async Task<MovementResult> WriteAccountMovementAsync(
        int? bankAccountDefinitionId,
        int? cashAccountId,
        decimal amount,
        DateTime dateUtc,
        int direction,
        string description,
        string username,
        DateTime nowUtc,
        (int CurrencyTypeId, decimal Rate)? knownRate,
        CancellationToken cancellationToken,
        string? referenceNo = null)

    {
        if (amount <= 0) return new MovementResult(true, null, null, null, null);

        // Kasa/banka bağlantısı pasifken yeni çıkış hareketi yazılmaz; ödeme servis içinde
        // "ödendi" olarak kalır. Ters kayıt (direction 1) hariç tutulur: kuru kayıtlı bir
        // hareket gerçekten yazılmışsa iptalde para hesaba geri dönmek zorunda.
        var isReversalOfWrittenMovement = direction == 1 && knownRate is { Rate: > 0m };
        if (!_accountMovementsEnabled && !isReversalOfWrittenMovement)
        {
            return new MovementResult(true, null, null, null, null);
        }

        var hasBank = bankAccountDefinitionId is > 0;
        var hasCash = cashAccountId is > 0;

        if (!hasBank && !hasCash)
        {
            return new MovementResult(false, "Ödeme kaynağı (banka/kasa) seçilmedi.", null, null, null);
        }

        var accountCurrencyTypeId = hasBank
            ? await GetBankCurrencyTypeId(bankAccountDefinitionId!.Value, cancellationToken)
            : await GetCashCurrencyTypeId(cashAccountId!.Value, cancellationToken);

        if (!accountCurrencyTypeId.HasValue)
        {
            return new MovementResult(false, hasBank ? "Banka hesabı bulunamadı" : "Kasa bulunamadı", null, null, null);
        }

        (int CurrencyTypeId, decimal Rate, decimal CurrencyAmount) mv;

        if (knownRate.HasValue && knownRate.Value.Rate > 0m)
        {
            var known = knownRate.Value;
            mv = (known.CurrencyTypeId, known.Rate, Math.Round(amount / known.Rate, 2, MidpointRounding.AwayFromZero));
        }
        else
        {
            try
            {
                mv = await ResolveAccountMovementAsync(accountCurrencyTypeId.Value, amount, cancellationToken);
            }
            catch (InvalidOperationException ex)
            {
                return new MovementResult(false, ex.Message, null, null, null);
            }
        }

        if (hasBank)
        {
            await InsertBankAccountTransaction(
                bankAccountDefinitionId!.Value, dateUtc, direction, amount,
                mv.CurrencyTypeId, mv.Rate, mv.CurrencyAmount,
                string.Empty, string.Empty, description, username, nowUtc, cancellationToken);
        }
        else
        {
            await InsertCashAccountTransaction(
                cashAccountId!.Value, dateUtc, direction, amount,
                mv.CurrencyTypeId, mv.Rate, mv.CurrencyAmount,
                string.Empty, string.Empty, description, username, nowUtc, referenceNo, cancellationToken);
        }

        return new MovementResult(true, null, mv.CurrencyTypeId, mv.Rate, mv.CurrencyAmount);
    }


    private static string DescribePaymentType(EmployeePaymentType type) => type switch
    {
        EmployeePaymentType.Salary => "Maaş Ödemesi",
        EmployeePaymentType.Bonus => "Prim Ödemesi",
        EmployeePaymentType.CashAdvance => "Nakit Avans",
        EmployeePaymentType.Meal => "Yemek Ödemesi",
        _ => "Personel Ödemesi"
    };

    /// <summary>Dönem "yyyy-MM" değilse ödeme tarihinin (yerel) ayına düşer.</summary>
    /// <summary>
    /// MÜKERRER MAAŞ KAPISI (2026-10-16). Tamamı ödenmiş döneme ikinci maaş, kalanı aşan maaş
    /// çıkmaz. Eskiden toplu ödeme kalanı 0 olan personele net hakedişi yeniden gönderiyordu;
    /// "tümünü seç → öde" ödenmiş herkese ikinci maaş çıkarıyordu. Hakedişi bilinmeyen dönemde
    /// (tanımsız, düzenlemesiz) kapı uygulanmaz.
    /// </summary>
    private static string? SalaryOverpayError(SalaryPeriodBalance.Row? row, decimal amount)
    {
        if (row is null) return null;
        if (row.Remaining <= 0.004m)
            return $"{row.Period} dönemi maaşı tamamen ödenmiş (net {row.Net:N2}, ödenen {row.Paid:N2}). İkinci maaş ödemesi yapılmadı.";
        if (amount > row.Remaining + 0.01m)
            return $"{row.Period} dönemi için kalan maaş {row.Remaining:N2}; girilen {amount:N2} bunu aşıyor. Fazlası prim ya da avans olarak girilmeli.";
        return null;
    }

    private static string NormalizePeriod(string? requested, DateTime paymentDateUtc)
    {
        var s = (requested ?? string.Empty).Trim();
        if (s.Length == 7 && s[4] == '-'
            && int.TryParse(s.AsSpan(0, 4), out var y)
            && int.TryParse(s.AsSpan(5, 2), out var m)
            && y is >= 2000 and <= 2100 && m is >= 1 and <= 12)
        {
            return $"{y:D4}-{m:D2}";
        }

        return TurkeyTime.PeriodOf(TurkeyTime.LocalDate(paymentDateUtc));
    }

    /// <summary>
    /// Ödeme ekranının davranışını belirleyen ayarlar. Kasa/banka bağlantısı pasifken arayüz
    /// ödeme kaynağı sormaz; ödeme servis içinde "ödendi" olarak kaydedilir.
    /// </summary>
    [HttpGet("settings")]
    public IActionResult GetSettings()
        => Ok(new { success = true, data = new { accountMovementsEnabled = _accountMovementsEnabled, erpAccountsEnabled = true } });

    /// <summary>
    /// Ödeme ekranındaki "Kasa / Banka" seçimi: kullanıcının B2B'de yetkili olduğu kasa ve
    /// bankalar, para birimi ve TCMB döviz satış kuruyla (bkz. <see cref="ErpPaymentAccountService"/>).
    /// </summary>
    [HttpGet("erp-accounts")]
    public async Task<IActionResult> GetErpAccounts(CancellationToken cancellationToken)
    {
        var list = await _erp.ListForUserAsync(User, cancellationToken);
        return Ok(new { success = true, data = list });
    }

    /// <summary>
    /// Odeme dokumu. Tur bazli rapor sayfalarinin tamami bu ucu kullanir:
    /// <c>type</c> ile tur, <c>from</c>/<c>to</c> ile tarih araligi, <c>period</c> ile maas donemi
    /// suzulur. Yanitta calisan adi ve kodu da doner; ayrica donen <c>summary</c> suzulmus
    /// kumenin TAMAMININ toplamidir (take ile kesilen sayfanin degil).
    /// </summary>
    [HttpGet]
    public async Task<IActionResult> List(
        [FromQuery] int? employeeId,
        [FromQuery] string? period,
        [FromQuery] EmployeePaymentType? type,
        [FromQuery] DateTime? from,
        [FromQuery] DateTime? to,
        [FromQuery] int take = 200,
        CancellationToken cancellationToken = default)
    {
        take = Math.Clamp(take, 1, 1000);

        var q = _dbContext.Set<EmployeePayment>().AsNoTracking().AsQueryable();
        if (employeeId.HasValue && employeeId.Value > 0)
        {
            q = q.Where(x => x.EmployeeId == employeeId.Value);
        }

        if (!string.IsNullOrWhiteSpace(period))
        {
            var normalized = period.Trim();
            q = q.Where(x => x.SalaryPeriod == normalized);
        }

        if (type.HasValue)
        {
            q = q.Where(x => x.Type == type.Value);
        }

        // Gun siniri TURKIYE saatine gore. UTC gunu kullanilirsa 1 Agustos'ta yapilan bir
        // odeme 31 Temmuz 21:00Z olarak saklandigi icin "1 Agustos'tan itibaren" suzgecinden
        // dusuyordu; ayni kayit ekstrede 1 Agustos'ta gorunup raporda kayboluyordu.
        if (from.HasValue)
        {
            var fromUtc = TurkeyTime.StartOfDayUtc(DateOnly.FromDateTime(from.Value.Date));
            q = q.Where(x => x.PaymentDate >= fromUtc);
        }

        if (to.HasValue)
        {
            // Bitis gunu DAHIL: ertesi gunun basindan kucuk olanlar alinir.
            var toUtc = TurkeyTime.EndOfDayUtc(DateOnly.FromDateTime(to.Value.Date));
            q = q.Where(x => x.PaymentDate < toUtc);
        }

        var summary = await q
            .GroupBy(_ => 1)
            .Select(g => new
            {
                count = g.Count(),
                total = g.Sum(x => (decimal?)x.Amount) ?? 0m,
                employeeCount = g.Select(x => x.EmployeeId).Distinct().Count()
            })
            .FirstOrDefaultAsync(cancellationToken);

        var data = await q
            .OrderByDescending(x => x.PaymentDate)
            .ThenByDescending(x => x.Id)
            .Take(take)
            .Join(_dbContext.Employees.AsNoTracking(),
                  pay => pay.EmployeeId,
                  emp => emp.Id,
                  (pay, emp) => new EmployeePaymentListItemResponse
                  {
                      Id = pay.Id,
                      EmployeeId = pay.EmployeeId,
                      Type = pay.Type,
                      Amount = pay.Amount,
                      PaymentDate = pay.PaymentDate,
                      Description = pay.Description,
                      DeductFromSalary = pay.DeductFromSalary,
                      SalaryDeductedAt = pay.SalaryDeductedAt,
                      SalaryPeriod = pay.SalaryPeriod,
                      CreateUser = pay.CreateUser,
                      CreateTime = pay.CreateTime,
                      EmployeeName = (emp.FirstName + " " + emp.LastName).Trim(),
                      EmployeeCode = emp.EmployeeCode
                  })
            .ToListAsync(cancellationToken);

        return Ok(new
        {
            success = true,
            data,
            summary = new
            {
                count = summary?.count ?? 0,
                total = summary?.total ?? 0m,
                employeeCount = summary?.employeeCount ?? 0
            }
        });
    }

    [HttpPost]
    public async Task<IActionResult> Create([FromBody] CreateEmployeePaymentRequest request, CancellationToken cancellationToken)
    {
        if (!ModelState.IsValid) return ValidationProblem(ModelState);
        if (request.EmployeeId <= 0) return BadRequest(new { success = false, message = "Geçersiz çalışan" });
        if (request.Amount <= 0) return BadRequest(new { success = false, message = "Tutar geçersiz" });

        var employee = await _dbContext.Employees
            .AsNoTracking()
            .Where(x => x.Id == request.EmployeeId)
            .Select(x => new { x.Id, x.EmployeeCode, x.FirstName, x.LastName })
            .FirstOrDefaultAsync(cancellationToken);
        if (employee is null) return BadRequest(new { success = false, message = "Çalışan bulunamadı" });

        var now = DateTime.UtcNow;
        var username = GetUsername();
        var paymentDate = NormalizeUtc(request.PaymentDate ?? now);
        var period = NormalizePeriod(request.SalaryPeriod, paymentDate);

        if (request.Type == EmployeePaymentType.Salary)
        {
            // DÖNEMSİZ MAAŞ ÖDEMESİ EN ESKİ AÇIK DÖNEME (2026-10-16). Dönem verilmezse ödeme
            // tarihinin ayına yazılıyordu: ağustos maaşı 3 eylülde ödenince ağustos "Gecikti"
            // kalıyor, eylül peşin ödenmiş görünüyordu.
            var rows = (await SalaryPeriodBalance.LoadAsync(_dbContext, new[] { request.EmployeeId }, cancellationToken))[request.EmployeeId];
            if (string.IsNullOrWhiteSpace(request.SalaryPeriod))
            {
                period = SalaryPeriodBalance.Allocate(rows, request.Amount, period)[0].Period;
            }

            var guard = SalaryOverpayError(rows.FirstOrDefault(x => x.Period == period), request.Amount);
            if (guard is not null) return Conflict(new { success = false, message = guard });
        }

        await using var tx = await _dbContext.Database.BeginTransactionAsync(cancellationToken);

        var entity = new EmployeePayment
        {
            EmployeeId = request.EmployeeId,
            Type = request.Type,
            Amount = request.Amount,
            PaymentDate = paymentDate,
            SalaryPeriod = period,
            Description = string.IsNullOrWhiteSpace(request.Description) ? null : request.Description.Trim(),
            DeductFromSalary = request.Type == EmployeePaymentType.CashAdvance && request.DeductFromSalary,
            BankAccountDefinitionId = request.BankAccountDefinitionId,
            CashAccountId = request.CashAccountId,
            CreateUser = username,
            CreateTime = now
        };

        entity.ReferenceNo = await ReferenceNumberGenerator.NextAsync(
            _dbContext, ReferencePrefix(request.Type), period, cancellationToken);

        _dbContext.Set<EmployeePayment>().Add(entity);
        await _dbContext.SaveChangesAsync(cancellationToken);

        // Personel kasasindan cikis: ERP hesap hareketinden BAGIMSIZ, her zaman yazilir.
        // Avans/prim gibi anlik odemeler de kasada ve cari ekstrede gorunmek zorunda.
        var personnelCash = await _cash.GetOrCreateDefaultAccountAsync(null, cancellationToken);
        var singleTx = _cash.AddSingleOut(
            personnelCash.Id,
            entity,
            $"{employee.FirstName} {employee.LastName}".Trim(),
            entity.Description ?? DescribePaymentType(request.Type),
            username);

        if (request.ErpSource is not null)
        {
            var erpHata = await _erp.AttachAsync(singleTx, request.ErpSource, User, username, cancellationToken);
            if (erpHata is not null) return BadRequest(new { success = false, message = erpHata });
        }
        await _dbContext.SaveChangesAsync(cancellationToken);

        // Kaynak seçildiyse HER ödeme tipi için hareket yazılır. Eskiden yalnızca nakit avans
        // hareket oluşturuyordu; tekil prim/maaş/yemek ödemesi kasaya hiç düşmüyordu.
        if (request.BankAccountDefinitionId is > 0 || request.CashAccountId is > 0)
        {
            var txnDescription = string.IsNullOrWhiteSpace(entity.Description)
                ? DescribePaymentType(request.Type)
                : entity.Description;

            var movement = await WriteAccountMovementAsync(
                request.BankAccountDefinitionId,
                request.CashAccountId,
                request.Amount,
                paymentDate,
                direction: 2,
                txnDescription,
                username,
                now,
                knownRate: null,
                cancellationToken);

            if (!movement.Ok)
            {
                return StatusCode(StatusCodes.Status503ServiceUnavailable, new { success = false, message = movement.Error });
            }

            entity.MovementCurrencyTypeId = movement.CurrencyTypeId;
            entity.MovementCurrencyRate = movement.Rate;
            entity.MovementCurrencyAmount = movement.CurrencyAmount;
            await _dbContext.SaveChangesAsync(cancellationToken);
        }

        // Maas odendiyse o donemin mahsup edilecek avanslari damgalanir; damgali avans
        // silinemez. Damga basilmazsa, avans dusulerek net odenmis maasa ragmen avans kaydi
        // silinebilir ve personel olmadigi hâlde alacakli gorunur.
        if (request.Type == EmployeePaymentType.Salary)
        {
            await AdvanceSettlement.MarkDeductedAsync(_dbContext, new[] { entity.EmployeeId }, period, now, cancellationToken);
            await _dbContext.SaveChangesAsync(cancellationToken);
        }

        await tx.CommitAsync(cancellationToken);

        return StatusCode(StatusCodes.Status201Created, new { success = true, data = new CreateEmployeePaymentResponse { Id = entity.Id } });
    }

    [HttpPost("bulk-salary")]
    public async Task<IActionResult> BulkSalary([FromBody] BulkSalaryPaymentRequest request, CancellationToken cancellationToken)
    {
        if (!ModelState.IsValid) return ValidationProblem(ModelState);

        var ids = (request.EmployeeIds ?? new List<int>())
            .Where(x => x > 0)
            .Distinct()
            .ToList();

        if (ids.Count == 0) return BadRequest(new { success = false, message = "Çalışan seçilmedi" });

        var employees = await _dbContext.Employees
            .AsNoTracking()
            .Where(x => ids.Contains(x.Id))
            .Select(x => new { x.Id, x.Salary, x.FirstName, x.LastName })
            .ToListAsync(cancellationToken);

        if (employees.Count == 0) return BadRequest(new { success = false, message = "Çalışan bulunamadı" });

        var now = DateTime.UtcNow;
        var username = GetUsername();
        var paymentDate = NormalizeUtc(request.PaymentDate ?? now);
        var period = NormalizePeriod(request.SalaryPeriod, paymentDate);
        var description = string.IsNullOrWhiteSpace(request.Description) ? "Maaş Ödemesi" : request.Description.Trim();

        // MÜKERRER ÖDEME KORUMASI.
        //
        // Dönem kavramı olmadığı için aynı ay iki kez "maaş öde" denildiğinde iki kayıt birden
        // oluşuyor, personele iki kez ödeme yapılmış görünüyordu. Artık dönem başına tek maaş
        // kaydı; düzeltme gerekiyorsa çağıran AllowDuplicatePeriod gönderir.
        // Mükerrer koruma artık tutar hesabında: dönemde ödenen düşüldüğü için tamamı ödenmiş
        // personele ikinci kez maaş çıkmaz. Aşağıdaki kontrol, açıkça "ikinci ödeme yok" isteyen
        // eski davranışı korur (kısmi ödemeli personel için AllowDuplicatePeriod gönderilir).
        if (!request.AllowDuplicatePeriod)
        {
            var alreadyPaidIds = await _dbContext.Set<EmployeePayment>()
                .AsNoTracking()
                .Where(x => x.Type == EmployeePaymentType.Salary)
                .Where(x => x.SalaryPeriod == period)
                .Where(x => ids.Contains(x.EmployeeId))
                .Select(x => x.EmployeeId)
                .Distinct()
                .ToListAsync(cancellationToken);

            if (alreadyPaidIds.Count > 0)
            {
                var names = employees
                    .Where(e => alreadyPaidIds.Contains(e.Id))
                    .Select(e => $"{e.FirstName} {e.LastName}".Trim())
                    .ToList();

                return Conflict(new
                {
                    success = false,
                    message = $"{period} dönemi için zaten maaş ödemesi yapılmış: {string.Join(", ", names)}",
                    data = new { period, employeeIds = alreadyPaidIds }
                });
            }
        }

        // Avans mahsubu DÖNEME göre yapılır. Eskiden ödeme TARİHİNİN ayına bakılıyordu:
        // ağustos maaşı 5 eylülde ödendiğinde ağustos avansları düşülmüyor, eylül avansları
        // düşülüyordu. Dönemi olmayan eski kayıtlar için ödeme tarihi ayına bakılır.
        var (periodYear, periodMonth) = TurkeyTime.ParsePeriod(period);
        var periodStart = TurkeyTime.StartOfDayUtc(new DateOnly(periodYear, periodMonth, 1));
        var periodEnd = TurkeyTime.StartOfDayUtc(new DateOnly(periodYear, periodMonth, 1).AddMonths(1));

        var advances = await _dbContext.Set<EmployeePayment>()
            .Where(x => x.Type == EmployeePaymentType.CashAdvance)
            .Where(x => x.DeductFromSalary)
            .Where(x => x.SalaryDeductedAt == null)
            .Where(x => ids.Contains(x.EmployeeId))
            .Where(x => x.SalaryPeriod == period
                        || (x.SalaryPeriod == null && x.PaymentDate >= periodStart && x.PaymentDate < periodEnd))
            .Select(x => new { x.Id, x.EmployeeId, x.Amount })
            .ToListAsync(cancellationToken);

        var advanceSumByEmployeeId = advances
            .GroupBy(x => x.EmployeeId)
            .ToDictionary(g => g.Key, g => g.Sum(a => a.Amount));

        /*
          ÖDENECEK TUTAR HAKEDİŞTEN (2026-10-04 uçtan uca testte bulundu).

          Bu uç personelin SÖZLEŞME maaşını (aylık maaş − avans) ödüyordu: hakedişe, aya özel
          düzenlemeye ve dönemde zaten ödenen kısma hiç bakmıyordu. Ay boyunca 27.943 TL hak eden
          personele 25.000, hiç gelmeyene tam maaş çıkıyor; ekranın "kalan" dediği tutarla
          ödenen tutar tutmuyordu. Artık maaş durumu ekranıyla AYNI kural: tanımlı hakediş
          (yoksa aya özel düzenleme) − dönemin mahsup edilecek avansları − dönemde ödenen maaş.
          Hakedişi tanımlanmamış personel ödenmez, adı yanıtta döner.
        */
        var definedByEmployee = await _dbContext.EmployeeSalaryAccruals
            .AsNoTracking()
            .Where(x => x.Period == period && ids.Contains(x.EmployeeId))
            .ToDictionaryAsync(x => x.EmployeeId, x => x.Amount, cancellationToken);

        var overrideByEmployee = await _dbContext.EmployeeMonthlyOverrides
            .AsNoTracking()
            .Where(x => x.Period == period && x.OverrideType == MonthlyOverrideType.Salary && ids.Contains(x.EmployeeId))
            .ToDictionaryAsync(x => x.EmployeeId, x => x.OverrideAmount, cancellationToken);

        var allPeriodAdvances = await _dbContext.Set<EmployeePayment>()
            .AsNoTracking()
            .Where(x => !x.IsCancelled)
            .Where(x => x.Type == EmployeePaymentType.CashAdvance && x.DeductFromSalary)
            .Where(x => ids.Contains(x.EmployeeId))
            .Where(x => x.SalaryPeriod == period
                        || (x.SalaryPeriod == null && x.PaymentDate >= periodStart && x.PaymentDate < periodEnd))
            .GroupBy(x => x.EmployeeId)
            .Select(g => new { EmployeeId = g.Key, Total = g.Sum(x => x.Amount) })
            .ToDictionaryAsync(x => x.EmployeeId, x => x.Total, cancellationToken);

        var paidByEmployee = await _dbContext.Set<EmployeePayment>()
            .AsNoTracking()
            .Where(x => x.Type == EmployeePaymentType.Salary && x.SalaryPeriod == period && ids.Contains(x.EmployeeId))
            .GroupBy(x => x.EmployeeId)
            .Select(g => new { EmployeeId = g.Key, Total = g.Sum(x => x.Amount) })
            .ToDictionaryAsync(x => x.EmployeeId, x => x.Total, cancellationToken);

        var noAccrual = new List<string>();

        await using var tx = await _dbContext.Database.BeginTransactionAsync(cancellationToken);

        decimal totalAmount = 0m;
        var created = new List<EmployeePayment>();

        foreach (var e in employees)
        {
            decimal gross;
            if (definedByEmployee.TryGetValue(e.Id, out var def)) gross = def;
            else if (overrideByEmployee.TryGetValue(e.Id, out var ovAmount)) gross = ovAmount;
            else
            {
                noAccrual.Add($"{e.FirstName} {e.LastName}".Trim());
                continue;
            }

            var adv = allPeriodAdvances.TryGetValue(e.Id, out var a) ? Math.Max(0m, a) : 0m;
            var paid = paidByEmployee.TryGetValue(e.Id, out var pd) ? pd : 0m;
            var amount = Math.Round(Math.Max(0m, gross - adv - paid), 2, MidpointRounding.AwayFromZero);
            if (amount <= 0) continue;

            totalAmount += amount;

            var payment = new EmployeePayment
            {
                EmployeeId = e.Id,
                Type = EmployeePaymentType.Salary,
                Amount = amount,
                PaymentDate = paymentDate,
                SalaryPeriod = period,
                Description = description,
                BankAccountDefinitionId = request.BankAccountDefinitionId,
                CashAccountId = request.CashAccountId,
                CreateUser = username,
                CreateTime = now
            };

            created.Add(payment);
            _dbContext.Set<EmployeePayment>().Add(payment);
        }

        if (created.Count == 0)
        {
            return Ok(new
            {
                success = true,
                paidCount = 0,
                skippedNoAccrual = noAccrual,
                message = noAccrual.Count > 0
                    ? $"Hakedişi tanımlanmamış personel ödenmedi: {string.Join(", ", noAccrual)}"
                    : "Ödenecek kalan tutar yok."
            });
        }

        if (advances.Count > 0)
        {
            var advanceIds = advances.Select(x => x.Id).ToList();
            var advanceEntities = await _dbContext.Set<EmployeePayment>()
                .Where(x => advanceIds.Contains(x.Id))
                .ToListAsync(cancellationToken);

            foreach (var a in advanceEntities)
            {
                a.SalaryDeductedAt = now;
            }
        }

        await _dbContext.SaveChangesAsync(cancellationToken);


        // --- Personel kasasi ---
        // Bu yol da kasadan para cikarir: ERP hesap hareketi kapali olsa bile personel kasasina
        // yazilir. Eskiden yalnizca odeme kaydi olusuyor, kasa hic hareket gormuyordu; kasa
        // bakiyesi yapilan odemeleri gostermiyordu.
        var personnelCash = await _cash.GetOrCreateDefaultAccountAsync(request.CashAccountId, cancellationToken);
        var bulkRef = await ReferenceNumberGenerator.NextAsync(_dbContext, "BULK", period, cancellationToken);
        var bulkDesc = $"{description} ({created.Count} personel - {period})";

        var parentTx = _cash.AddBulkParent(
            personnelCash.Id, paymentDate, totalAmount, (int)EmployeePaymentType.Salary, period, bulkRef, bulkDesc, username);

        if (request.ErpSource is not null)
        {
            var erpHata = await _erp.AttachAsync(parentTx, request.ErpSource, User, username, cancellationToken);
            if (erpHata is not null) return BadRequest(new { success = false, message = erpHata });
        }
        await _dbContext.SaveChangesAsync(cancellationToken);

        var cashNameById = employees.ToDictionary(x => x.Id, x => ($"{x.FirstName} {x.LastName}").Trim());
        foreach (var payment in created)
        {
            _cash.AddBulkChild(
                personnelCash.Id, parentTx.Id, payment,
                cashNameById.TryGetValue(payment.EmployeeId, out var nm) ? nm : string.Empty,
                payment.Description ?? bulkDesc, username);
        }

        await _dbContext.SaveChangesAsync(cancellationToken);

        if (totalAmount > 0 && (request.BankAccountDefinitionId is > 0 || request.CashAccountId is > 0))
        {
            var movement = await WriteAccountMovementAsync(
                request.BankAccountDefinitionId,
                request.CashAccountId,
                totalAmount,
                paymentDate,
                direction: 2,
                $"{description} ({period})",
                username,
                now,
                knownRate: null,
                cancellationToken);

            if (!movement.Ok)
            {
                return StatusCode(StatusCodes.Status503ServiceUnavailable, new { success = false, message = movement.Error });
            }

            foreach (var payment in created)
            {
                payment.MovementCurrencyTypeId = movement.CurrencyTypeId;
                payment.MovementCurrencyRate = movement.Rate;
            }

            await _dbContext.SaveChangesAsync(cancellationToken);
        }

        await tx.CommitAsync(cancellationToken);

        return Ok(new { success = true, paidCount = created.Count, period, totalAmount, skippedNoAccrual = noAccrual });
    }

    [HttpPost("bulk-meal")]
    public async Task<IActionResult> BulkMeal([FromBody] BulkMealPaymentRequest request, CancellationToken cancellationToken)
    {
        if (!ModelState.IsValid) return ValidationProblem(ModelState);

        var ids = (request.EmployeeIds ?? new List<int>())
            .Where(x => x > 0)
            .Distinct()
            .ToList();

        if (ids.Count == 0) return BadRequest(new { success = false, message = "Çalışan seçilmedi" });

        var employees = await _dbContext.Employees
            .AsNoTracking()
            .Where(x => ids.Contains(x.Id))
            .Select(x => new { x.Id, x.MealAmount })
            .ToListAsync(cancellationToken);

        if (employees.Count == 0) return BadRequest(new { success = false, message = "Çalışan bulunamadı" });

        var now = DateTime.UtcNow;
        var username = GetUsername();
        var paymentDate = NormalizeUtc(request.PaymentDate ?? now);
        var period = NormalizePeriod(null, paymentDate);
        var description = string.IsNullOrWhiteSpace(request.Description) ? "Yemek Ödemesi" : request.Description.Trim();

        await using var tx = await _dbContext.Database.BeginTransactionAsync(cancellationToken);

        decimal totalAmount = 0m;
        var created = new List<EmployeePayment>();

        foreach (var e in employees)
        {
            var amount = Math.Max(0m, e.MealAmount);
            if (amount <= 0) continue;

            totalAmount += amount;

            var payment = new EmployeePayment
            {
                EmployeeId = e.Id,
                Type = EmployeePaymentType.Meal,
                Amount = amount,
                PaymentDate = paymentDate,
                SalaryPeriod = period,
                Description = description,
                BankAccountDefinitionId = request.BankAccountDefinitionId,
                CashAccountId = request.CashAccountId,
                CreateUser = username,
                CreateTime = now
            };

            created.Add(payment);
            _dbContext.Set<EmployeePayment>().Add(payment);
        }

        if (created.Count == 0)
        {
            return Ok(new { success = true, paidCount = 0 });
        }

        await _dbContext.SaveChangesAsync(cancellationToken);

        // --- Personel kasasi ---
        // Bu yol da kasadan para cikarir: ERP hesap hareketi kapali olsa bile personel kasasina
        // yazilir. Eskiden yalnizca odeme kaydi olusuyor, kasa hic hareket gormuyordu.
        var personnelCashMeal = await _cash.GetOrCreateDefaultAccountAsync(request.CashAccountId, cancellationToken);
        var bulkRefMeal = await ReferenceNumberGenerator.NextAsync(_dbContext, "BULK", period, cancellationToken);
        var bulkDescMeal = $"{description} ({created.Count} personel - {period})";

        var parentTxMeal = _cash.AddBulkParent(
            personnelCashMeal.Id, paymentDate, totalAmount, (int)EmployeePaymentType.Meal, period, bulkRefMeal, bulkDescMeal, username);

        if (request.ErpSource is not null)
        {
            var erpHata = await _erp.AttachAsync(parentTxMeal, request.ErpSource, User, username, cancellationToken);
            if (erpHata is not null) return BadRequest(new { success = false, message = erpHata });
        }
        await _dbContext.SaveChangesAsync(cancellationToken);

        // bulk-meal'in employees projeksiyonunda ad alanlari yok; kasa satirinda personel adi
        // gorunsun diye ayrica okunur.
        var mealEmpIds = created.Select(x => x.EmployeeId).Distinct().ToList();
        var mealNameById = await _dbContext.Employees
            .AsNoTracking()
            .Where(x => mealEmpIds.Contains(x.Id))
            .ToDictionaryAsync(x => x.Id, x => ((x.FirstName ?? "") + " " + (x.LastName ?? "")).Trim(), cancellationToken);
        foreach (var payment in created)
        {
            _cash.AddBulkChild(
                personnelCashMeal.Id, parentTxMeal.Id, payment,
                mealNameById.TryGetValue(payment.EmployeeId, out var nm) ? nm : string.Empty,
                payment.Description ?? bulkDescMeal, username);
        }

        await _dbContext.SaveChangesAsync(cancellationToken);

        if (totalAmount > 0 && (request.BankAccountDefinitionId is > 0 || request.CashAccountId is > 0))
        {
            var movement = await WriteAccountMovementAsync(
                request.BankAccountDefinitionId,
                request.CashAccountId,
                totalAmount,
                paymentDate,
                direction: 2,
                description,
                username,
                now,
                knownRate: null,
                cancellationToken);

            if (!movement.Ok)
            {
                return StatusCode(StatusCodes.Status503ServiceUnavailable, new { success = false, message = movement.Error });
            }

            foreach (var payment in created)
            {
                payment.MovementCurrencyTypeId = movement.CurrencyTypeId;
                payment.MovementCurrencyRate = movement.Rate;
            }

            await _dbContext.SaveChangesAsync(cancellationToken);
        }

        await tx.CommitAsync(cancellationToken);

        return Ok(new { success = true, paidCount = created.Count, totalAmount });
    }

    [HttpDelete("{id:int}")]
    public async Task<IActionResult> Delete([FromRoute] int id, CancellationToken cancellationToken)
    {
        if (id <= 0) return BadRequest(new { success = false, message = "Geçersiz id" });

        var entity = await _dbContext.Set<EmployeePayment>().FirstOrDefaultAsync(x => x.Id == id, cancellationToken);
        if (entity is null) return NotFound(new { success = false, message = "Kayıt bulunamadı" });

        // Mahsup edilmiş avans silinirse maaş net ödendiği hâlde borç kaydı kayboluyordu.
        if (entity.Type == EmployeePaymentType.CashAdvance && entity.SalaryDeductedAt.HasValue)
        {
            return BadRequest(new
            {
                success = false,
                message = "Bu avans maaştan mahsup edilmiş, silinemez. Önce ilgili maaş ödemesini iptal edin."
            });
        }

        var now = DateTime.UtcNow;
        var username = GetUsername();

        await using var tx = await _dbContext.Database.BeginTransactionAsync(cancellationToken);

        // Silinen ödemenin kasa/banka hareketi ters kayıtla geri alınır.
        //
        // İki hata birden düzeltildi: (1) yalnızca nakit avans ters kayıt alıyordu, maaş/prim/
        // yemek ödemesi silindiğinde para hesapta çıkmış olarak kalıyordu; (2) ters kayıt
        // BUGÜNÜN kuruyla yazıldığı için döviz hesapta bakiye sıfırlanmıyordu. Artık orijinal
        // hareketin kuru (MovementCurrencyRate) kullanılır.
        // Maas odemesi geri alindiginda avans mahsup damgasi kalkar; kalmazsa avans kalici
        // olarak silinemez hâle gelir ve duzeltme yapilamaz.
        if (entity.Type == EmployeePaymentType.Salary)
        {
            await AdvanceSettlement.UnmarkAsync(_dbContext, entity.EmployeeId, entity.SalaryPeriod, cancellationToken, entity.Id);
        }

        // Personel kasasi ayri tabloda: once oradaki hareket kaldirilir (toplu odemede ust
        // kaydin tutari duser). Bu, ERP hesap hareketinden bagimsizdir ve her zaman calisir.
        await _cash.RemoveByPaymentIdAsync(entity.Id, cancellationToken, username);

        // ERP hesap hareketinin TERS KAYDI yalnizca gercekten hareket YAZILMIS odemeler icin
        // atilir. Isaret: MovementCurrencyTypeId dolu olmasi. Kasa/banka baglantisi kapaliyken
        // olusan odemelerde bu alan bostur; CashAccountId ise artik PERSONEL kasasinin kimligi,
        // ERP'nin CashAccounts kimligi degil - ona bakip ters kayit atmak yanlis hesabi vururdu.
        if (entity.MovementCurrencyTypeId.HasValue &&
            (entity.BankAccountDefinitionId is > 0 || entity.CashAccountId is > 0))
        {
            var reversalDesc = $"{entity.Description ?? DescribePaymentType(entity.Type)} - İptal";

            (int CurrencyTypeId, decimal Rate)? knownRate = null;
            if (entity.MovementCurrencyTypeId.HasValue && entity.MovementCurrencyRate is > 0m)
            {
                knownRate = (entity.MovementCurrencyTypeId.Value, entity.MovementCurrencyRate.Value);
            }

            var movement = await WriteAccountMovementAsync(
                entity.BankAccountDefinitionId,
                entity.CashAccountId,
                entity.Amount,
                dateUtc: now,
                direction: 1,
                reversalDesc,
                username,
                now,
                knownRate,
                cancellationToken);

            if (!movement.Ok)
            {
                return StatusCode(StatusCodes.Status503ServiceUnavailable, new { success = false, message = movement.Error });
            }
        }

        _dbContext.Set<EmployeePayment>().Remove(entity);
        await _dbContext.SaveChangesAsync(cancellationToken);

        await tx.CommitAsync(cancellationToken);
        return Ok(new { success = true });
    }

    public sealed class UpdateEmployeePaymentRequest
    {
        public decimal Amount { get; set; }
        public DateTime? PaymentDate { get; set; }
        public string? Description { get; set; }

        /// <summary>
        /// Ödemenin ait olduğu dönem "yyyy-MM". Doluysa değiştirilir — yanlış aya yazılmış eski
        /// maaş ödemesini (ağustos maaşı eylüle düşmüş) onarmanın yolu budur.
        /// </summary>
        public string? SalaryPeriod { get; set; }
    }

    /// <summary>
    /// ÖDEME DÜZENLEME (2026-09-27 kullanıcı isteği: "silme ve düzenlemeyi atlama").
    ///
    /// <para>Tutar, tarih ve açıklama değişir; personel kasa satırı ve B2B'deki "Personel Ödemesi"
    /// satırı AYNI KURLA güncellenir. Toplu ödemede bir kişinin tutarı değişirse B2B'deki toplam
    /// satır farkı kadar değişir. Kasa/banka değiştirmek düzenleme değildir: geri alıp yeniden
    /// ödenir (B2B satırı kilitli olduğu için tek doğru yol bu).</para>
    /// </summary>
    [HttpPut("{id:int}")]
    public async Task<IActionResult> Update([FromRoute] int id, [FromBody] UpdateEmployeePaymentRequest request, CancellationToken cancellationToken)
    {
        if (id <= 0) return BadRequest(new { success = false, message = "Geçersiz id" });
        if (request.Amount <= 0m) return BadRequest(new { success = false, message = "Tutar geçersiz" });

        var entity = await _dbContext.Set<EmployeePayment>().FirstOrDefaultAsync(x => x.Id == id, cancellationToken);
        if (entity is null) return NotFound(new { success = false, message = "Kayıt bulunamadı" });

        // Silmedeki kuralla aynı: mahsup edilmiş avansın tutarı değişirse maaş hesabı bozulur.
        if (entity.Type == EmployeePaymentType.CashAdvance && entity.SalaryDeductedAt.HasValue)
        {
            return BadRequest(new
            {
                success = false,
                message = "Bu avans maaştan mahsup edilmiş, düzenlenemez. Önce ilgili maaş ödemesini iptal edin."
            });
        }

        // Eski (kapalı) ERP yolu ile yazılmış hareketi burada güncelleyecek bir bağ yok.
        if (entity.MovementCurrencyTypeId.HasValue)
        {
            return BadRequest(new { success = false, message = "Bu ödeme eski kasa bağlantısıyla yazılmış, düzenlenemez. Geri alıp yeniden ödeyin." });
        }

        var oldPeriod = entity.SalaryPeriod;
        var newPeriod = string.IsNullOrWhiteSpace(request.SalaryPeriod)
            ? oldPeriod
            : NormalizePeriod(request.SalaryPeriod, entity.PaymentDate);

        if (entity.Type == EmployeePaymentType.Salary)
        {
            // Kapı bu ödemenin KENDİ tutarı hariç tutularak uygulanır: düzenlenen kayıt zaten
            // dönemin ödenen toplamının içinde.
            var row = (await SalaryPeriodBalance.LoadAsync(_dbContext, new[] { entity.EmployeeId }, cancellationToken))[entity.EmployeeId]
                .FirstOrDefault(x => x.Period == newPeriod);
            if (row is not null && newPeriod == oldPeriod) row = row with { Paid = row.Paid - entity.Amount };
            var guard = SalaryOverpayError(row, request.Amount);
            if (guard is not null) return Conflict(new { success = false, message = guard });
        }

        var username = GetUsername();
        var nowUtc = DateTime.UtcNow;
        await using var tx = await _dbContext.Database.BeginTransactionAsync(cancellationToken);

        entity.Amount = request.Amount;
        if (request.PaymentDate.HasValue) entity.PaymentDate = NormalizeUtc(request.PaymentDate.Value);
        if (request.Description is not null)
        {
            entity.Description = string.IsNullOrWhiteSpace(request.Description) ? null : request.Description.Trim();
        }
        entity.SalaryPeriod = newPeriod;
        entity.EditUser = username;
        entity.EditTime = nowUtc;

        await _dbContext.SaveChangesAsync(cancellationToken);

        // Maaşın dönemi değiştiyse avans mahsup damgası da taşınır: eski dönemde başka maaş
        // ödemesi kalmadıysa o dönemin avansları serbest kalır, yeni dönemin avansları damgalanır.
        if (entity.Type == EmployeePaymentType.Salary && newPeriod != oldPeriod && newPeriod is not null)
        {
            await AdvanceSettlement.UnmarkAsync(_dbContext, entity.EmployeeId, oldPeriod, cancellationToken, entity.Id);
            await AdvanceSettlement.MarkDeductedAsync(_dbContext, new[] { entity.EmployeeId }, newPeriod, nowUtc, cancellationToken);
            await _dbContext.SaveChangesAsync(cancellationToken);
        }

        await _cash.UpdateByPaymentAsync(entity, username, cancellationToken);

        await tx.CommitAsync(cancellationToken);
        return Ok(new { success = true });
    }

    public sealed class BulkCashPayoutRequest
    {
        public List<int> EmployeeIds { get; set; } = new();
        public int PaymentType { get; set; } = 1;
        public string? SalaryPeriod { get; set; }
        public decimal? CustomAmount { get; set; }
        public Dictionary<int, decimal>? CustomAmounts { get; set; }
        public string? Description { get; set; }
        public DateTime? PaymentDate { get; set; }
        public int? CashAccountId { get; set; }

        /// <summary>B2B kasa/banka kaynağı (2026-09-27). Doluysa seçilen hesaba tek "Personel Ödemesi" satırı yazılır.</summary>
        public ErpPaymentSource? ErpSource { get; set; }

        /// <summary>Toplu AVANSTA "maaştan düşülsün" — tekil avanstaki alanın aynısı (yalnız avansta anlamlı).</summary>
        public bool DeductFromSalary { get; set; }
    }

    /// <summary>
    /// Seçilen çalışanlar için hayali kasadan toplu ödeme çıkışı yapar.
    /// Kasa bakiyesi eksiye düşebilir.
    /// </summary>
    [HttpPost("bulk-cash-payout")]
    public async Task<IActionResult> BulkCashPayout([FromBody] BulkCashPayoutRequest request, CancellationToken cancellationToken)
    {
        if (request.EmployeeIds == null || request.EmployeeIds.Count == 0)
        {
            return BadRequest(new { success = false, message = "Çalışan seçilmedi" });
        }

        var ids = request.EmployeeIds.Where(x => x > 0).Distinct().ToList();
        var employees = await _dbContext.Employees
            .AsNoTracking()
            .Where(x => ids.Contains(x.Id))
            .ToListAsync(cancellationToken);

        if (employees.Count == 0) return BadRequest(new { success = false, message = "Çalışan bulunamadı" });

        var now = DateTime.UtcNow;
        var paymentDate = NormalizeUtc(request.PaymentDate ?? now);
        var period = NormalizePeriod(request.SalaryPeriod, paymentDate);
        var type = (EmployeePaymentType)request.PaymentType;
        var username = GetUsername();
        var baseDesc = string.IsNullOrWhiteSpace(request.Description) ? "Maaş toplu ödemesi" : request.Description.Trim();

        await using var tx = await _dbContext.Database.BeginTransactionAsync(cancellationToken);

        var cashAccount = await _cash.GetOrCreateDefaultAccountAsync(request.CashAccountId, cancellationToken);

        decimal totalPayout = 0m;
        var createdPayments = new List<EmployeePayment>();
        var namesById = employees.ToDictionary(x => x.Id, x => $"{x.FirstName} {x.LastName}".Trim());

        // MAAŞTA DÖNEM VE MÜKERRER KAPISI (2026-10-16).
        // - Dönem verildiyse (maaş ekranı) tamamı ödenmiş personel atlanır, tutar kalanla sınırlanır.
        //   Eskiden kalanı 0 olan personele net hakediş yeniden ödeniyordu.
        // - Dönem verilmediyse (cari ekstreden bakiye kapatma) tutar en eski açık dönemden başlayarak
        //   dönemlere dağıtılır. Eskiden ağustos+eylül borcu tek kayıt olarak ekime yazılıyor,
        //   ağustos ve eylül "Gecikti" kalıyordu.
        var explicitPeriod = !string.IsNullOrWhiteSpace(request.SalaryPeriod);
        var salaryRows = type == EmployeePaymentType.Salary
            ? await SalaryPeriodBalance.LoadAsync(_dbContext, ids, cancellationToken)
            : new Dictionary<int, List<SalaryPeriodBalance.Row>>();
        var skipped = new List<string>();

        foreach (var emp in employees)
        {
            decimal amt;
            if (request.CustomAmounts != null && request.CustomAmounts.TryGetValue(emp.Id, out var cust) && cust > 0m)
            {
                amt = cust;
            }
            else if (request.CustomAmount.HasValue && request.CustomAmount.Value > 0m)
            {
                amt = request.CustomAmount.Value;
            }
            else
            {
                // Tutar verilmediyse personel ATLANIR. Eskiden burada aylik maasa/yemek
                // bedeline dusuluyordu; bakiyesi olmayan personele de tam maas cikiyor ve
                // cari ekstre her toplu islemde eksiye kayiyordu. Toplu cikis bir BAKIYE
                // KAPATMA islemidir, maas tanimlama degil.
                amt = 0m;
            }

            if (amt <= 0m) continue;

            var parts = new List<(string Period, decimal Amount)> { (period, amt) };
            if (type == EmployeePaymentType.Salary)
            {
                var rows = salaryRows.TryGetValue(emp.Id, out var r) ? r : new List<SalaryPeriodBalance.Row>();
                if (explicitPeriod)
                {
                    var row = rows.FirstOrDefault(x => x.Period == period);
                    if (row is not null)
                    {
                        if (row.Remaining <= 0.004m)
                        {
                            skipped.Add($"{namesById[emp.Id]} ({period} maaşı zaten ödenmiş)");
                            continue;
                        }
                        parts[0] = (period, Math.Min(amt, row.Remaining));
                    }
                }
                else
                {
                    parts = SalaryPeriodBalance.Allocate(rows, amt, period);
                }
            }

            foreach (var part in parts)
            {
                totalPayout += part.Amount;

                var p = new EmployeePayment
                {
                    EmployeeId = emp.Id,
                    Type = type,
                    Amount = part.Amount,
                    PaymentDate = paymentDate,
                    SalaryPeriod = part.Period,
                    Description = (parts.Count > 1 ? $"{baseDesc} ({part.Period}) - {namesById[emp.Id]}" : $"{baseDesc} - {namesById[emp.Id]}").Trim(),
                    ReferenceNo = await ReferenceNumberGenerator.NextAsync(_dbContext, ReferencePrefix(type), part.Period, cancellationToken),
                    DeductFromSalary = type == EmployeePaymentType.CashAdvance && request.DeductFromSalary,
                    CashAccountId = cashAccount.Id,
                    CreateUser = username,
                    CreateTime = now
                };

                _dbContext.EmployeePayments.Add(p);
                createdPayments.Add(p);
            }
        }

        if (createdPayments.Count == 0)
        {
            await tx.RollbackAsync(cancellationToken);
            return Ok(new
            {
                success = true,
                paidCount = 0,
                skipped,
                message = skipped.Count > 0 ? $"Ödeme yapılmadı: {string.Join(", ", skipped)}" : "Ödenecek tutar bulunamadı"
            });
        }

        // Ust kaydin donemi: odemeler tek doneme dustuyse o, dagildiysa bos.
        var periodsUsed = createdPayments.Select(x => x.SalaryPeriod).Distinct().ToList();
        var parentPeriod = periodsUsed.Count == 1 ? periodsUsed[0] : null;

        await _dbContext.SaveChangesAsync(cancellationToken);

        // Kasaya 20 ayrı satır yerine TEK üst kayıt: "Maaş toplu ödemesi (20 personel - 2026-08)".
        // Personel kırılımı aynı üst kayda bağlı alt satırlarda durur; bakiyeye yalnız üst kayıt sayılır.
        var collectiveRef = await ReferenceNumberGenerator.NextAsync(_dbContext, "BULK", parentPeriod ?? period, cancellationToken);
        var personCount = createdPayments.Select(x => x.EmployeeId).Distinct().Count();
        var collectiveDesc = parentPeriod is not null
            ? $"{baseDesc} ({personCount} personel - {parentPeriod})"
            : $"{baseDesc} ({personCount} personel - {string.Join(", ", periodsUsed.OrderBy(x => x, StringComparer.Ordinal))})";

        var parent = _cash.AddBulkParent(
            cashAccount.Id, paymentDate, totalPayout, (int)type, parentPeriod, collectiveRef, collectiveDesc, username);

        if (request.ErpSource is not null)
        {
            var erpHata = await _erp.AttachAsync(parent, request.ErpSource, User, username, cancellationToken);
            if (erpHata is not null) return BadRequest(new { success = false, message = erpHata });
        }
        await _dbContext.SaveChangesAsync(cancellationToken);

        foreach (var p in createdPayments)
        {
            p.ParentPaymentId = null;
            _cash.AddBulkChild(
                cashAccount.Id, parent.Id, p,
                namesById.TryGetValue(p.EmployeeId, out var n) ? n : string.Empty,
                p.Description ?? collectiveDesc, username);
        }

        if (type == EmployeePaymentType.Salary)
        {
            // Avans mahsubu her ödemenin KENDİ dönemine göre: dağıtılmış ödemede ağustos parçası
            // ağustos avanslarını, eylül parçası eylül avanslarını damgalar.
            foreach (var g in createdPayments.GroupBy(x => x.SalaryPeriod!))
            {
                await AdvanceSettlement.MarkDeductedAsync(
                    _dbContext, g.Select(x => x.EmployeeId), g.Key, now, cancellationToken);
            }
        }

        await _dbContext.SaveChangesAsync(cancellationToken);
        await tx.CommitAsync(cancellationToken);

        return Ok(new
        {
            success = true,
            paidCount = personCount,
            paymentCount = createdPayments.Count,
            totalAmount = totalPayout,
            period = parentPeriod ?? period,
            periods = periodsUsed,
            skipped,
            referenceNo = collectiveRef,
            cashAccountId = cashAccount.Id
        });
    }

    private static string ReferencePrefix(EmployeePaymentType type) => type switch
    {
        EmployeePaymentType.Salary => "SAL",
        EmployeePaymentType.Bonus => "BON",
        EmployeePaymentType.CashAdvance => "ADV",
        EmployeePaymentType.Meal => "MEAL",
        _ => "PAY"
    };

    /// <summary>
    /// Personel kasasının bakiye ve hareket dökümü.
    ///
    /// <para>Bakiye toplu ödemenin ÜST kaydından ve tekil hareketlerden hesaplanır; toplu
    /// ödemenin personel kırılım satırları (<c>ParentTransactionId</c> dolu) sayılmaz, yoksa
    /// aynı para kasadan iki kez çıkmış görünürdü.</para>
    /// </summary>
    [HttpGet("cash-account-summary")]
    public async Task<IActionResult> GetCashAccountSummary(CancellationToken cancellationToken)
    {
        var cashAccount = await _cash.GetOrCreateDefaultAccountAsync(null, cancellationToken);

        var balanceRows = _dbContext.EmployeeCashTransactions
            .AsNoTracking()
            .Where(x => x.EmployeeCashAccountId == cashAccount.Id && x.ParentTransactionId == null);

        var totalIn = await balanceRows
            .Where(x => x.Direction == EmployeeCashDirection.In)
            .SumAsync(x => (decimal?)x.Amount, cancellationToken) ?? 0m;

        var totalOut = await balanceRows
            .Where(x => x.Direction == EmployeeCashDirection.Out)
            .SumAsync(x => (decimal?)x.Amount, cancellationToken) ?? 0m;

        var recent = await balanceRows
            .OrderByDescending(x => x.Date).ThenByDescending(x => x.Id)
            .Take(50)
            .Select(x => new CashTxItemDto
            {
                Id = x.Id,
                Date = x.Date,
                Direction = (int)x.Direction,
                Amount = x.Amount,
                Description = x.Description,
                CounterpartyName = x.CounterpartyName,
                CreateTime = x.CreateTime,
                ReferenceNo = x.ReferenceNo,
                IsBulk = x.IsBulk,
                PaymentType = x.PaymentType,
                SalaryPeriod = x.SalaryPeriod
            })
            .ToListAsync(cancellationToken);

        return Ok(new
        {
            success = true,
            data = new
            {
                id = cashAccount.Id,
                code = cashAccount.Code,
                name = cashAccount.Name,
                balance = totalIn - totalOut,
                totalIn,
                totalOut,
                transactions = recent
            }
        });
    }

    /// <summary>
    /// Maaş tablosu için personelin brüt maaşı, düşülen avansları, net ödenecek tutarı
    /// ve o ayki ödeme durumunu (Ödendi / Gecikti) döner.
    /// </summary>
    [HttpGet("salary-status")]
    public async Task<IActionResult> GetSalaryStatus([FromQuery] string? period, CancellationToken cancellationToken = default)
    {
        var (targetPeriod, rows) = await ComputeSalaryStatusAsync(period, cancellationToken);

        return Ok(new
        {
            success = true,
            period = targetPeriod,
            data = rows.Select(x => x.Payload),
            summary = new
            {
                totalEmployees = rows.Count,
                totalGross = rows.Sum(x => x.Gross),
                totalAdvances = rows.Sum(x => x.Advances),
                totalNetPayable = rows.Sum(x => x.NetPayable),
                totalPaid = rows.Sum(x => x.Paid),
                definedCount = rows.Count(x => x.AccrualDefined),
                paidCount = rows.Count(x => x.IsPaid),
                partialCount = rows.Count(x => x.IsPartial),
                delayedCount = rows.Count(x => x.IsDelayed)
            }
        });
    }

    /// <summary>Maaş durumu satırının hesapta kullanılan çekirdeği; <see cref="Payload"/> ekrana giden satırdır.</summary>
    private sealed record SalaryStatusRow(
        int EmployeeId,
        string EmployeeName,
        string? Workplace,
        decimal Gross,
        decimal Advances,
        decimal NetPayable,
        decimal Paid,
        decimal Remaining,
        bool AccrualDefined,
        bool IsPaid,
        bool IsPartial,
        bool IsDelayed,
        string Status,
        DateOnly DueDate,
        object Payload);

    /// <summary>
    /// GECİKEN MAAŞLAR (2026-10-16) — ana sayfanın kaynağı.
    ///
    /// <para>Ana sayfa yalnızca İÇİNDE BULUNULAN dönemin durumuna bakıyordu. O dönemin vadesi
    /// her zaman sonraki ayda olduğu için "Geciken Maaş" hep 0 çıkıyor, geçen ayın ödenmemiş
    /// maaşı hiçbir yerde görünmüyordu. "Maaşı yatırılmayanlar" listesi de ödeme TARİHİNİN ayına
    /// ve sözleşme maaşına bakıyordu: eylülde ödenen ağustos maaşı eylülü "ödendi" gösteriyor,
    /// ekimin ilk günlerinde herkes "yatırılmadı" görünüyordu.</para>
    ///
    /// <para>Burada son <paramref name="months"/> dönem maaş ekranıyla AYNI hesapla taranır;
    /// vadesi geçmiş ve kalanı olan dönemler döner. Ayrıca her personelin vadesi gelmiş SON
    /// döneminin durumu (<c>lastDue</c>) — ana sayfadaki "maaş ödeme durumu" kartı bunu gösterir.</para>
    /// </summary>
    [HttpGet("salary-overdue")]
    public async Task<IActionResult> GetSalaryOverdue([FromQuery] int months = 6, CancellationToken cancellationToken = default)
    {
        months = Math.Clamp(months, 1, 24);
        var today = TurkeyTime.LocalDate(DateTime.UtcNow);
        var current = new DateOnly(today.Year, today.Month, 1);

        // Icinde bulunulan donemin vadesi her zaman sonraki ayda: taramaya girmez.
        var all = new List<(string Period, SalaryStatusRow Row)>();
        for (var i = months; i >= 1; i--)
        {
            var p = TurkeyTime.PeriodOf(current.AddMonths(-i));
            var (_, rows) = await ComputeSalaryStatusAsync(p, cancellationToken);
            all.AddRange(rows.Select(r => (p, r)));
        }

        var overdue = all
            .Where(x => x.Row.IsDelayed && x.Row.Remaining > 0.004m)
            .GroupBy(x => x.Row.EmployeeId)
            .Select(g => new
            {
                employeeId = g.Key,
                employeeName = g.First().Row.EmployeeName,
                workplace = g.First().Row.Workplace,
                totalRemaining = g.Sum(x => x.Row.Remaining),
                periods = g.OrderBy(x => x.Period, StringComparer.Ordinal).Select(x => new
                {
                    period = x.Period,
                    dueDate = x.Row.DueDate.ToString("yyyy-MM-dd"),
                    netPayable = x.Row.NetPayable,
                    paid = x.Row.Paid,
                    remaining = x.Row.Remaining,
                    accrualDefined = x.Row.AccrualDefined
                }).ToList()
            })
            .OrderByDescending(x => x.totalRemaining)
            .ToList();

        // Her personelin vadesi BUGÜN ya da daha önce gelmiş, ödenecek tutarı olan en son dönemi.
        // Tutarı 0 olan dönem (hakediş yok) seçilirse önceki ayı ödenmiş personel sayılmıyordu.
        var lastDue = all
            .Where(x => x.Row.DueDate <= today && x.Row.NetPayable > 0m)
            .GroupBy(x => x.Row.EmployeeId)
            .Select(g => g.OrderByDescending(x => x.Period, StringComparer.Ordinal).First())
            .Select(x => new
            {
                employeeId = x.Row.EmployeeId,
                employeeName = x.Row.EmployeeName,
                period = x.Period,
                dueDate = x.Row.DueDate.ToString("yyyy-MM-dd"),
                netPayable = x.Row.NetPayable,
                paid = x.Row.Paid,
                remaining = x.Row.Remaining,
                isPaid = x.Row.IsPaid
            })
            .ToList();

        return Ok(new
        {
            success = true,
            fromPeriod = TurkeyTime.PeriodOf(current.AddMonths(-months)),
            toPeriod = TurkeyTime.PeriodOf(current.AddMonths(-1)),
            data = overdue,
            lastDue,
            summary = new
            {
                overdueEmployeeCount = overdue.Count,
                overdueTotal = overdue.Sum(x => x.totalRemaining),
                lastDueNet = lastDue.Sum(x => x.netPayable),
                lastDuePaid = lastDue.Sum(x => Math.Min(x.paid, x.netPayable)),
                lastDueRemaining = lastDue.Sum(x => x.remaining),
                lastDuePaidCount = lastDue.Count(x => x.isPaid),
                lastDueUnpaidCount = lastDue.Count(x => !x.isPaid)
            }
        });
    }

    private async Task<(string Period, List<SalaryStatusRow> Rows)> ComputeSalaryStatusAsync(string? period, CancellationToken cancellationToken)
    {
        var targetPeriod = string.IsNullOrWhiteSpace(period)
            ? TurkeyTime.PeriodOf(TurkeyTime.LocalDate(DateTime.UtcNow))
            : period.Trim();

        var (periodYear, periodMonth) = TurkeyTime.ParsePeriod(targetPeriod);
        var periodStart = TurkeyTime.StartOfDayUtc(new DateOnly(periodYear, periodMonth, 1));
        var periodEnd = TurkeyTime.StartOfDayUtc(new DateOnly(periodYear, periodMonth, 1).AddMonths(1));

        var employees = await _dbContext.Employees
            .AsNoTracking()
            .Where(x => x.IsActive)
            .Select(x => new
            {
                x.Id,
                x.EmployeeCode,
                x.FirstName,
                x.LastName,
                x.Workplace,
                x.Salary,
                x.SalaryDay,
                x.HireDate,
                x.BankAccountNo,
                x.CustomerNo,
                x.Iban,
                x.BankName
            })
            .OrderBy(x => x.FirstName)
            .ToListAsync(cancellationToken);

        // O dönem ödenen maaşlar
        var paidSalaries = await _dbContext.Set<EmployeePayment>()
            .AsNoTracking()
            .Where(x => x.Type == EmployeePaymentType.Salary && x.SalaryPeriod == targetPeriod)
            .GroupBy(x => x.EmployeeId)
            .Select(g => new { EmployeeId = g.Key, TotalPaid = g.Sum(x => x.Amount), LastPaidDate = g.Max(x => x.PaymentDate) })
            .ToDictionaryAsync(x => x.EmployeeId, cancellationToken);

        // O döneme ait veya o ay içinde maaştan düşülecek avanslar
        var advances = await _dbContext.Set<EmployeePayment>()
            .AsNoTracking()
            .Where(x => !x.IsCancelled)
            .Where(x => x.Type == EmployeePaymentType.CashAdvance && x.DeductFromSalary)
            .Where(x => x.SalaryPeriod == targetPeriod || (x.SalaryPeriod == null && x.PaymentDate >= periodStart && x.PaymentDate < periodEnd))
            .Select(x => new
            {
                x.Id,
                x.EmployeeId,
                x.Amount,
                x.Description,
                x.PaymentDate,
                x.SalaryDeductedAt,
                x.ReferenceNo
            })
            .ToListAsync(cancellationToken);

        var advancesByEmp = advances.GroupBy(x => x.EmployeeId).ToDictionary(g => g.Key, g => g.ToList());

        var salaryOverrides = await _dbContext.EmployeeMonthlyOverrides
            .AsNoTracking()
            .Where(x => x.Period == targetPeriod && x.OverrideType == MonthlyOverrideType.Salary)
            .ToDictionaryAsync(x => x.EmployeeId, cancellationToken);

        // TANIMLANMIS hakedis: cari ekstredeki maas alacaginin tek kaynagi. Tanimlanmamissa
        // ekranda yalnizca ONERI gosterilir, ekstreye hicbir sey yazilmaz.
        var definedAccruals = await _dbContext.EmployeeSalaryAccruals
            .AsNoTracking()
            .Where(x => x.Period == targetPeriod)
            .ToDictionaryAsync(x => x.EmployeeId, cancellationToken);

        var calculatedAccruals = await _accruals.CalculateAsync(targetPeriod, employees.Select(x => x.Id).ToList(), includeDays: false, cancellationToken);
        var accrualsByEmp = calculatedAccruals.ToDictionary(x => x.EmployeeId);

        // Kist hesabi icin mesai takvimi. Hakedis IS GUNLERI uzerinden oranlanir; takvim gunu
        // uzerinden oranlamak calisilmayan gunleri de hak edilmis gosteriyordu.
        var schedule = await _calendar.GetScheduleAsync(null, cancellationToken);
        var calendarFrom = new DateOnly(periodYear, periodMonth, 1);
        var workCalendar = await _calendar.BuildAsync(calendarFrom, calendarFrom.AddMonths(2).AddDays(-1), schedule, cancellationToken);

        var today = TurkeyTime.LocalDate(DateTime.UtcNow);
        var isCurrentOrPastMonth = new DateOnly(periodYear, periodMonth, 1) <= new DateOnly(today.Year, today.Month, 1);

        var result = employees.Select(e =>
        {
            var ov = salaryOverrides.TryGetValue(e.Id, out var o) ? o : null;
            var defined = definedAccruals.TryGetValue(e.Id, out var d) ? d : null;
            var calc = accrualsByEmp.TryGetValue(e.Id, out var c) ? c : null;

            var proration = SalaryProrationCalculator.Calculate(
                Math.Max(0m, (decimal)e.Salary), targetPeriod, e.SalaryDay, e.HireDate, workCalendar, DateTime.UtcNow);

            // Hakediş Belirleme Sırası:
            // 1. Tanımlanmış hakediş (EmployeeSalaryAccruals) -> defined.Amount
            // 2. Aya özel manuel düzenleme -> ov.OverrideAmount
            // 3. Fiili puantaj/mesai hesabı (çalışılan günler, devamsızlıklar, mesailer) -> calc.GrossAccrual (veya 0)
            // Çalışmadığı günler veya gelecekteki dönemler için otomatik maaş yazılmaz!
            decimal gross = 0m;
            if (defined != null)
            {
                gross = defined.Amount;
            }
            else if (ov != null)
            {
                gross = ov.OverrideAmount;
            }
            else if (calc is { GrossAccrual: > 0m })
            {
                gross = calc.GrossAccrual;
            }
            else
            {
                // MESAI KAYDI YOKSA HAKEDIS 0'DIR.
                //
                // Bir sure burada aylik maasin kist karsiligi "oneri" olarak gosteriliyordu;
                // ise hic gelmemis personel de ayin gecen kismi kadar hak etmis gorunuyor,
                // 35 kisinin cogunda ayni 30.816 TL cikiyordu. Hakedis calismadan dogmaz:
                // gelmeyen personel icin tutar 0'dir. Yine de odenecekse yol acik — satirdaki
                // "Duzenle" ile aya ozel tutar girilir, hakedis ondan tanimlanir.
                gross = 0m;
            }

            var empAdvances = advancesByEmp.TryGetValue(e.Id, out var advList) ? advList : new();
            var advanceTotal = empAdvances.Sum(a => a.Amount);
            var netPayable = Math.Max(0m, gross - advanceTotal);

            var paidInfo = paidSalaries.TryGetValue(e.Id, out var p) ? p : null;
            var paidAmount = paidInfo?.TotalPaid ?? 0m;
            var isPaid = netPayable > 0m && paidAmount >= netPayable;
            var isPartial = paidAmount > 0m && paidAmount < netPayable;
            var remainingAmount = Math.Max(0m, netPayable - paidAmount);

            // VADE = donem penceresinden sonraki MAAS GUNU (4'u maas gunu ise agustos donemi 3 Eylul'de
            // biter, maas 4 Eylul'de odenir). Icinde bulunulan ayin maas gunune bakmak, agustos
            // maasini 18 Agustos'ta "gecikti" gosteriyordu. Vade bir sure pencerenin SON gunuydu:
            // maas gunu sabahi daha odeme yapilmadan "Gecikti" yaniyordu (2026-10-16).
            var dueDate = proration.PeriodEnd.AddDays(1);

            var isDelayed = !isPaid && netPayable > 0m && today > dueDate;

            var status = isPaid
                ? "paid"
                : isPartial
                    ? "partial"
                    : defined != null
                        ? (isDelayed ? "delayed" : "accrued")
                        : (gross > 0m ? (isDelayed ? "delayed" : "accrualMissing") : "waiting");

            var payload = new
            {
                employeeId = e.Id,
                employeeCode = e.EmployeeCode,
                employeeName = $"{e.FirstName} {e.LastName}".Trim(),
                workplace = e.Workplace,
                salaryDay = e.SalaryDay,
                dueDate = dueDate.ToString("yyyy-MM-dd"),
                bankAccountNo = e.BankAccountNo,
                customerNo = e.CustomerNo,
                iban = e.Iban,
                bankName = e.BankName,
                grossSalary = gross,
                accrualDefined = defined != null,
                accrualId = defined?.Id,
                // Dakika bazli hakedis dokumu: maas / donemin beklenen dakikasi = dakika ucreti.
                proratedSuggestion = proration.Amount,
                elapsedMinutes = proration.ElapsedMinutes,
                totalMinutes = proration.TotalMinutes,
                minuteWage = proration.MinuteWage,
                earnedDays = proration.EarnedDays,
                totalWorkDays = proration.TotalWorkDays,
                periodStart = proration.PeriodStart.ToString("yyyy-MM-dd"),
                periodEnd = proration.PeriodEnd.ToString("yyyy-MM-dd"),
                // Mesai kaydindan gelen fiili degerler (oneri degil, gerceklesen).
                attendedDays = calc?.AttendedDays ?? 0,
                workedMinutes = calc?.WorkedMinutes ?? 0,
                accrualAmount = defined?.Amount,
                accrualReferenceNo = defined?.ReferenceNo,
                accrualCalculated = defined?.CalculatedAmount ?? calc?.GrossAccrual ?? 0m,
                hasSalaryOverride = ov != null,
                salaryOverrideAmount = ov?.OverrideAmount,
                salaryOverrideDescription = ov?.Description,
                advanceTotal,
                netPayable,
                paidAmount,
                remainingAmount,
                isPaid,
                isPartial,
                isDelayed,
                status,
                lastPaidDate = paidInfo?.LastPaidDate,
                // KESINTI DOKUMU: "Kalan: 90.000" yazmak yetmez, tutarin neden dustugu
                // satir satir gorunmeli. Kalemler ekstredeki karsiliklariyla ayni yonde:
                // hakedis alacak (+), avans ve odemeler borc (-).
                breakdown = new object[]
                {
                    new { key = "accrual",  label = "Brüt Hakediş",     amount = gross,          sign = "+" },
                    new { key = "advance",  label = "Avans Kesintisi",  amount = -advanceTotal,  sign = "-" },
                    new { key = "net",      label = "Net Hakediş",      amount = netPayable,     sign = "=" },
                    new { key = "paid",     label = "Ödenen",           amount = -paidAmount,    sign = "-" },
                    new { key = "remaining",label = "Kalan",            amount = remainingAmount,sign = "=" }
                },
                advances = empAdvances.Select(a => new
                {
                    id = a.Id,
                    amount = a.Amount,
                    description = a.Description,
                    paymentDate = a.PaymentDate,
                    isDeducted = a.SalaryDeductedAt != null,
                    referenceNo = a.ReferenceNo
                })
            };

            return new SalaryStatusRow(
                e.Id, payload.employeeName, e.Workplace, gross, advanceTotal, netPayable, paidAmount, remainingAmount,
                defined != null, isPaid, isPartial, isDelayed, status, dueDate, payload);
        }).ToList();

        return (targetPeriod, result);
    }

    /// <summary>
    /// Avans ve prim ekranlarının personel listesi: her personelin sağında ilgili dönemdeki
    /// durumu döner. Maaş/yemek tarafının karşılığı <c>salary-status</c> ve hakediş uçlarıdır;
    /// avans ve primde "hakediş" yoktur, bu yüzden ölçü verilen/bekleyen tutardır.
    ///
    /// <para><b>Avans:</b> dönemde verilen toplam, maaştan düşülecek olan, mahsup edilmiş ve
    /// mahsubu bekleyen tutar. <b>Prim:</b> ödenmeyi bekleyen prim planı toplamı ile dönemde
    /// ödenen prim toplamı.</para>
    /// </summary>
    [HttpGet("type-status")]
    public async Task<IActionResult> GetTypeStatus(
        [FromQuery] int type,
        [FromQuery] string? period,
        CancellationToken cancellationToken = default)
    {
        if (type != (int)EmployeePaymentType.CashAdvance && type != (int)EmployeePaymentType.Bonus)
        {
            return BadRequest(new { success = false, message = "Bu uç yalnızca avans (3) ve prim (2) için kullanılır." });
        }

        var targetPeriod = string.IsNullOrWhiteSpace(period)
            ? TurkeyTime.PeriodOf(TurkeyTime.LocalDate(DateTime.UtcNow))
            : period.Trim();

        var (py, pm) = TurkeyTime.ParsePeriod(targetPeriod);
        var periodStart = TurkeyTime.StartOfDayUtc(new DateOnly(py, pm, 1));
        var periodEnd = TurkeyTime.StartOfDayUtc(new DateOnly(py, pm, 1).AddMonths(1));
        var paymentType = (EmployeePaymentType)type;

        var employees = await _dbContext.Employees
            .AsNoTracking()
            .Where(x => x.IsActive)
            .Select(x => new { x.Id, x.EmployeeCode, x.FirstName, x.LastName, x.Workplace })
            .OrderBy(x => x.FirstName)
            .ToListAsync(cancellationToken);

        // Donem esleştirmesi maasla ayni kural: SalaryPeriod doluysa ona, degilse odeme
        // TARIHININ ayina bakilir. Ikisini karistirmak eylulde odenen agustos avansini
        // yanlis aya yaziyordu.
        var payments = await _dbContext.Set<EmployeePayment>()
            .AsNoTracking()
            .Where(x => !x.IsCancelled && x.Type == paymentType)
            .Where(x => x.SalaryPeriod == targetPeriod ||
                        (x.SalaryPeriod == null && x.PaymentDate >= periodStart && x.PaymentDate < periodEnd))
            .Select(x => new
            {
                x.Id,
                x.EmployeeId,
                x.Amount,
                x.Description,
                x.PaymentDate,
                x.DeductFromSalary,
                x.SalaryDeductedAt,
                x.ReferenceNo
            })
            .ToListAsync(cancellationToken);

        var byEmployee = payments.GroupBy(x => x.EmployeeId).ToDictionary(g => g.Key, g => g.ToList());

        // Prim tarafinda "bekleyen" olcusu odenmemis prim PLANLARIDIR.
        var pendingBonusByEmp = new Dictionary<int, decimal>();
        if (paymentType == EmployeePaymentType.Bonus)
        {
            pendingBonusByEmp = await _dbContext.Set<EmployeeBonusPlan>()
                .AsNoTracking()
                .Where(x => x.Status == EmployeeBonusPlanStatus.Planned)
                .GroupBy(x => x.EmployeeId)
                .Select(g => new { EmployeeId = g.Key, Total = g.Sum(x => x.Amount) })
                .ToDictionaryAsync(x => x.EmployeeId, x => x.Total, cancellationToken);
        }

        var result = employees.Select(e =>
        {
            var list = byEmployee.TryGetValue(e.Id, out var l) ? l : new();
            var total = list.Sum(x => x.Amount);
            var deductible = list.Where(x => x.DeductFromSalary).Sum(x => x.Amount);
            var deducted = list.Where(x => x.SalaryDeductedAt != null).Sum(x => x.Amount);
            var pendingBonus = pendingBonusByEmp.TryGetValue(e.Id, out var pb) ? pb : 0m;

            return new
            {
                employeeId = e.Id,
                employeeCode = e.EmployeeCode,
                employeeName = $"{e.FirstName} {e.LastName}".Trim(),
                workplace = e.Workplace,
                periodTotal = total,
                deductibleTotal = deductible,
                deductedTotal = deducted,
                pendingDeductionTotal = Math.Max(0m, deductible - deducted),
                pendingPlanTotal = pendingBonus,
                lastDate = list.Count == 0 ? (DateTime?)null : list.Max(x => x.PaymentDate),
                items = list.OrderByDescending(x => x.PaymentDate).Select(x => new
                {
                    id = x.Id,
                    amount = x.Amount,
                    description = x.Description,
                    paymentDate = x.PaymentDate,
                    deductFromSalary = x.DeductFromSalary,
                    isDeducted = x.SalaryDeductedAt != null,
                    referenceNo = x.ReferenceNo
                })
            };
        }).ToList();

        return Ok(new
        {
            success = true,
            period = targetPeriod,
            type,
            data = result,
            summary = new
            {
                totalEmployees = result.Count,
                totalAmount = result.Sum(x => x.periodTotal),
                totalDeductible = result.Sum(x => x.deductibleTotal),
                totalPendingDeduction = result.Sum(x => x.pendingDeductionTotal),
                totalPendingPlan = result.Sum(x => x.pendingPlanTotal),
                receivedCount = result.Count(x => x.periodTotal > 0m)
            }
        });
    }

    /// <summary>
    /// Yemek ekranının personel listesi — maaş tarafındaki <c>salary-status</c>'ün karşılığı.
    ///
    /// <para>Yemek sabit aylık ödeme değildir: günlük bedel × gelinen gün. Giriş/çıkış kaydı
    /// yoksa dönemin bugüne kadar geçen İŞ GÜNÜ sayısı üzerinden ÖNERİ gösterilir; ekstreye
    /// hiçbir şey yazılmaz. Alacak yalnızca "Hakediş Tanımla" ile
    /// (<c>EmployeeMealPlans</c>) doğar.</para>
    /// </summary>
    [HttpGet("meal-status")]
    public async Task<IActionResult> GetMealStatus(
        [FromQuery] string? period,
        CancellationToken cancellationToken = default)
    {
        var targetPeriod = string.IsNullOrWhiteSpace(period)
            ? TurkeyTime.PeriodOf(TurkeyTime.LocalDate(DateTime.UtcNow))
            : period.Trim();

        var (py, pm) = TurkeyTime.ParsePeriod(targetPeriod);
        var periodStartUtc = TurkeyTime.StartOfDayUtc(new DateOnly(py, pm, 1));
        var periodEndUtc = TurkeyTime.EndOfDayUtc(new DateOnly(py, pm, 1).AddMonths(1).AddDays(-1));

        var employees = await _dbContext.Employees
            .AsNoTracking()
            .Where(x => x.IsActive)
            .Select(x => new { x.Id, x.EmployeeCode, x.FirstName, x.LastName, x.Workplace, x.MealAmount, x.HasMealAllowance, x.SalaryDay, x.HireDate })
            .OrderBy(x => x.FirstName)
            .ToListAsync(cancellationToken);

        var ids = employees.Select(x => x.Id).ToList();

        var plans = await _dbContext.Set<EmployeeMealPlan>()
            .AsNoTracking()
            .Where(x => x.PlannedDate >= periodStartUtc && x.PlannedDate <= periodEndUtc)
            .Where(x => x.Status != EmployeeMealPlanStatus.Cancelled)
            .ToListAsync(cancellationToken);

        var paid = await _dbContext.Set<EmployeePayment>()
            .AsNoTracking()
            .Where(x => !x.IsCancelled && x.Type == EmployeePaymentType.Meal && x.SalaryPeriod == targetPeriod)
            .GroupBy(x => x.EmployeeId)
            .Select(g => new { EmployeeId = g.Key, Total = g.Sum(x => x.Amount) })
            .ToDictionaryAsync(x => x.EmployeeId, x => x.Total, cancellationToken);

        var overrides = await _dbContext.EmployeeMonthlyOverrides
            .AsNoTracking()
            .Where(x => x.Period == targetPeriod && x.OverrideType == MonthlyOverrideType.Meal)
            .ToDictionaryAsync(x => x.EmployeeId, cancellationToken);

        var calculated = await _accruals.CalculateAsync(targetPeriod, ids, includeDays: false, cancellationToken);
        var calcByEmp = calculated.ToDictionary(x => x.EmployeeId);

        var schedule = await _calendar.GetScheduleAsync(null, cancellationToken);
        var calFrom = new DateOnly(py, pm, 1);
        var workCalendar = await _calendar.BuildAsync(calFrom, calFrom.AddMonths(2).AddDays(-1), schedule, cancellationToken);

        var result = employees.Select(e =>
        {
            var plan = plans.FirstOrDefault(x => x.EmployeeId == e.Id);
            var ov = overrides.TryGetValue(e.Id, out var o) ? o : null;
            var calc = calcByEmp.TryGetValue(e.Id, out var c) ? c : null;

            // Yemek GUN bazlidir: gunu tam dolduran o gunun yemegini tam alir. Oneri de ayni
            // kurala gore uretilir; motorun hesabi varsa o oncelikli.
            var pro = SalaryProrationCalculator.Calculate(
                Math.Max(0m, e.MealAmount), targetPeriod, e.SalaryDay, e.HireDate, workCalendar, DateTime.UtcNow);
            var suggestion = e.HasMealAllowance ? pro.Amount : 0m;

            // Maasla AYNI kural: mesai kaydi yoksa yemek hakedisi de 0'dir. Kist "oneri"
            // gosterildiginde ise hic gelmemis personel de yemek hak etmis gorunuyordu.
            // Yemek verilmeyen personelde hakedis her hâlükârda 0 — tanimli plan varsa o durur
            // (gecmise donuk kayit silinmez), ama yeni hesap uretilmez.
            var accrual = plan != null
                ? plan.Amount
                : !e.HasMealAllowance
                    ? 0m
                    : ov != null
                        ? ov.OverrideAmount
                        : (calc?.MealAccrual ?? 0m);

            var paidAmount = paid.TryGetValue(e.Id, out var pd) ? pd : 0m;
            var remaining = Math.Max(0m, accrual - paidAmount);
            var isPaid = accrual > 0m && paidAmount >= accrual;
            var isPartial = paidAmount > 0m && paidAmount < accrual;

            var status = isPaid
                ? "paid"
                : isPartial
                    ? "partial"
                    : plan != null
                        ? "accrued"
                        : accrual > 0m ? "accrualMissing" : "waiting";

            return new
            {
                employeeId = e.Id,
                employeeCode = e.EmployeeCode,
                employeeName = $"{e.FirstName} {e.LastName}".Trim(),
                workplace = e.Workplace,
                monthlyMealAmount = e.MealAmount,
                hasMealAllowance = e.HasMealAllowance,
                attendedDays = calc?.AttendedDays ?? 0,
                earnedWorkDays = pro.EarnedDays,
                totalWorkDays = pro.TotalWorkDays,
                elapsedMinutes = pro.ElapsedMinutes,
                totalMinutes = pro.TotalMinutes,
                mealAccrual = accrual,
                proratedSuggestion = suggestion,
                accrualDefined = plan != null,
                planId = plan?.Id,
                hasMealOverride = ov != null,
                mealOverrideAmount = ov?.OverrideAmount,
                paidAmount,
                remainingAmount = remaining,
                isPaid,
                isPartial,
                status
            };
        }).ToList();

        return Ok(new
        {
            success = true,
            period = targetPeriod,
            data = result,
            summary = new
            {
                totalEmployees = result.Count,
                totalAccrual = result.Sum(x => x.mealAccrual),
                totalPaid = result.Sum(x => x.paidAmount),
                totalRemaining = result.Sum(x => x.remainingAmount),
                definedCount = result.Count(x => x.accrualDefined),
                paidCount = result.Count(x => x.isPaid)
            }
        });
    }

    /// <summary>
    /// Kasa hareketleri ekranının kaynağı. Varsayılan olarak yalnızca bakiyeye sayılan
    /// satırları (tekil hareket + toplu ödemenin üst kaydı) döner.
    /// <paramref name="parentId"/> verilirse o toplu ödemenin personel kırılımını döner.
    /// </summary>
    [HttpGet("cash-transactions")]
    public async Task<IActionResult> GetCashTransactions(
        [FromQuery] int? cashAccountId,
        [FromQuery] int? parentId,
        [FromQuery] string? from,
        [FromQuery] string? to,
        CancellationToken cancellationToken = default)
    {
        var cashAccount = await _cash.GetOrCreateDefaultAccountAsync(cashAccountId, cancellationToken);

        var query = _dbContext.EmployeeCashTransactions
            .AsNoTracking()
            .Where(x => x.EmployeeCashAccountId == cashAccount.Id);

        query = parentId is > 0
            ? query.Where(x => x.ParentTransactionId == parentId.Value)
            : query.Where(x => x.ParentTransactionId == null);

        // Gun siniri TurkeyTime ile: UTC gunune gore suzulurse gun basindaki hareket rapordan duser.
        if (!string.IsNullOrWhiteSpace(from) && DateOnly.TryParse(from, out var fromDate))
        {
            var fromUtc = TurkeyTime.StartOfDayUtc(fromDate);
            query = query.Where(x => x.Date >= fromUtc);
        }

        if (!string.IsNullOrWhiteSpace(to) && DateOnly.TryParse(to, out var toDate))
        {
            var toUtc = TurkeyTime.EndOfDayUtc(toDate);
            query = query.Where(x => x.Date <= toUtc);
        }

        var list = await query
            .OrderByDescending(x => x.Date).ThenByDescending(x => x.Id)
            .Take(500)
            .Select(x => new CashTxItemDto
            {
                Id = x.Id,
                Date = x.Date,
                Direction = (int)x.Direction,
                Amount = x.Amount,
                Description = x.Description,
                CounterpartyName = x.CounterpartyName,
                CreateTime = x.CreateTime,
                ReferenceNo = x.ReferenceNo,
                IsBulk = x.IsBulk,
                PaymentType = x.PaymentType,
                SalaryPeriod = x.SalaryPeriod,
                EmployeeId = x.EmployeeId,
                CreateUser = x.CreateUser,
                ErpAccountKind = x.ErpAccountKind,
                ErpAccountName = x.ErpAccountName,
                ErpCurrencyTypeId = x.ErpCurrencyTypeId,
                ErpRate = x.ErpRate,
                ErpCurrencyAmount = x.ErpCurrencyAmount
            })
            .ToListAsync(cancellationToken);

        return Ok(new { success = true, cashAccountId = cashAccount.Id, cashAccountName = cashAccount.Name, data = list });
    }

    public sealed class CashAccountDto
    {
        public int Id { get; set; }
        public string Code { get; set; } = string.Empty;
        public string Name { get; set; } = string.Empty;
        public int CurrencyTypeId { get; set; }
    }



    public sealed class CashTotalsDto
    {
        public decimal TotalIn { get; set; }
        public decimal TotalOut { get; set; }
    }

    public sealed class CashTxItemDto
    {
        public int Id { get; set; }
        public DateTime Date { get; set; }
        public int Direction { get; set; }
        public decimal Amount { get; set; }
        public string? Description { get; set; }
        public string? CounterpartyName { get; set; }
        public DateTime CreateTime { get; set; }
        public string? ReferenceNo { get; set; }
        public bool IsBulk { get; set; }
        public int? PaymentType { get; set; }
        public string? SalaryPeriod { get; set; }
        public int? EmployeeId { get; set; }
        public string? CreateUser { get; set; }

        /// <summary>B2B kasa/banka bağı (yalnız üst kayıtta dolu). 1 kasa, 2 banka.</summary>
        public int? ErpAccountKind { get; set; }
        public string? ErpAccountName { get; set; }
        public int? ErpCurrencyTypeId { get; set; }
        public decimal? ErpRate { get; set; }
        public decimal? ErpCurrencyAmount { get; set; }
    }
}

