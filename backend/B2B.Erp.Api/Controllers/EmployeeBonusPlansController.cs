using System.Security.Claims;
using B2B.Erp.Api.Core.Authorization;
using B2B.Erp.Api.Core.Helpers;
using B2B.Erp.Api.Data;
using B2B.Erp.Api.Dtos.Employees;
using B2B.Erp.Api.Entities;
using B2B.Erp.Api.Features.Currency;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace B2B.Erp.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
[Authorize]
[AuthorizePage("employee", "calisan")]
public sealed class EmployeeBonusPlansController : ControllerBase
{
    private readonly AppDbContext _dbContext;
    private readonly ICurrencyRateService _money;

    public EmployeeBonusPlansController(AppDbContext dbContext, ICurrencyRateService money)
    {
        _dbContext = dbContext;
        _money = money;
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

    [HttpGet]
    public async Task<IActionResult> List([FromQuery] int? employeeId, [FromQuery] int take = 200, CancellationToken cancellationToken = default)
    {
        take = Math.Clamp(take, 1, 1000);

        var q = _dbContext.Set<EmployeeBonusPlan>().AsNoTracking().AsQueryable();
        if (employeeId.HasValue && employeeId.Value > 0)
        {
            q = q.Where(x => x.EmployeeId == employeeId.Value);
        }

        var data = await q
            .OrderByDescending(x => x.PlannedDate)
            .ThenByDescending(x => x.Id)
            .Take(take)
            .Select(x => new EmployeeBonusPlanListItemResponse
            {
                Id = x.Id,
                EmployeeId = x.EmployeeId,
                PlannedDate = x.PlannedDate,
                Amount = x.Amount,
                Description = x.Description,
                Status = x.Status,
                PaidPaymentId = x.PaidPaymentId,
                CreateUser = x.CreateUser,
                CreateTime = x.CreateTime
            })
            .ToListAsync(cancellationToken);

        return Ok(new { success = true, data });
    }

    [HttpPost]
    public async Task<IActionResult> Create([FromBody] CreateEmployeeBonusPlanRequest request, CancellationToken cancellationToken)
    {
        if (!ModelState.IsValid) return ValidationProblem(ModelState);
        if (request.EmployeeId <= 0) return BadRequest(new { success = false, message = "Geçersiz çalışan" });
        if (request.Amount <= 0) return BadRequest(new { success = false, message = "Tutar geçersiz" });

        var employeeExists = await _dbContext.Employees.AsNoTracking().AnyAsync(x => x.Id == request.EmployeeId, cancellationToken);
        if (!employeeExists) return BadRequest(new { success = false, message = "Çalışan bulunamadı" });

        var now = DateTime.UtcNow;
        var username = GetUsername();
        var plannedDate = NormalizeUtc(request.PlannedDate);

        var entity = new EmployeeBonusPlan
        {
            EmployeeId = request.EmployeeId,
            PlannedDate = plannedDate,
            Amount = request.Amount,
            Description = string.IsNullOrWhiteSpace(request.Description) ? null : request.Description.Trim(),
            Status = EmployeeBonusPlanStatus.Planned,
            PaidPaymentId = null,
            CreateUser = username,
            CreateTime = now
        };

        _dbContext.Set<EmployeeBonusPlan>().Add(entity);
        await _dbContext.SaveChangesAsync(cancellationToken);

        return StatusCode(StatusCodes.Status201Created, new { success = true, data = new { id = entity.Id } });
    }

    [HttpPut("{id:int}/status")]
    public async Task<IActionResult> UpdateStatus([FromRoute] int id, [FromBody] UpdateEmployeeBonusPlanStatusRequest request, CancellationToken cancellationToken)
    {
        if (id <= 0) return BadRequest(new { success = false, message = "Geçersiz id" });
        if (!ModelState.IsValid) return ValidationProblem(ModelState);

        var entity = await _dbContext.Set<EmployeeBonusPlan>().FirstOrDefaultAsync(x => x.Id == id, cancellationToken);
        if (entity is null) return NotFound(new { success = false, message = "Kayıt bulunamadı" });

        entity.Status = request.Status;
        entity.EditUser = GetUsername();
        entity.EditTime = DateTime.UtcNow;

        await _dbContext.SaveChangesAsync(cancellationToken);
        return Ok(new { success = true });
    }

    [HttpPost("bulk-pay")]
    public async Task<IActionResult> BulkPayPlanned([FromBody] BulkPlannedBonusPaymentRequest request, CancellationToken cancellationToken)
    {
        if (!ModelState.IsValid) return ValidationProblem(ModelState);

        var ids = (request.EmployeeIds ?? new List<int>())
            .Where(x => x > 0)
            .Distinct()
            .ToList();

        if (ids.Count == 0) return BadRequest(new { success = false, message = "Çalışan seçilmedi" });

        var now = DateTime.UtcNow;
        var username = GetUsername();
        var description = string.IsNullOrWhiteSpace(request.Description) ? "Prim Ödemesi" : request.Description.Trim();

        // Hesap ÖNCE doğrulanır: aşağıdaki hareket yazımı hesabı bulamazsa sessizce
        // atlanıyordu, planlar "Ödendi" işaretlenip ödeme kayıtları commit ediliyor ve
        // kasa/banka hareketi hiç oluşmuyordu. Tekil ödeme ile toplu maaş kardeşleri
        // bu durumda BadRequest dönüyor; bu yol atlanmıştı.
        if (request.BankAccountDefinitionId.HasValue && request.BankAccountDefinitionId.Value > 0)
        {
            var bankExists = await _dbContext.BankAccountDefinitions.AsNoTracking()
                .AnyAsync(x => x.Id == request.BankAccountDefinitionId.Value, cancellationToken);
            if (!bankExists) return BadRequest(new { success = false, message = "Banka hesabı bulunamadı" });
        }
        else if (request.CashAccountId.HasValue && request.CashAccountId.Value > 0)
        {
            var cashExists = await _dbContext.CashAccounts.AsNoTracking()
                .AnyAsync(x => x.Id == request.CashAccountId.Value, cancellationToken);
            if (!cashExists) return BadRequest(new { success = false, message = "Kasa hesabı bulunamadı" });
        }

        await using var tx = await _dbContext.Database.BeginTransactionAsync(cancellationToken);

        var plans = await _dbContext.Set<EmployeeBonusPlan>()
            .Where(x => ids.Contains(x.EmployeeId) && x.Status == EmployeeBonusPlanStatus.Planned)
            .OrderBy(x => x.EmployeeId)
            .ThenBy(x => x.PlannedDate)
            .ThenBy(x => x.Id)
            .ToListAsync(cancellationToken);

        if (plans.Count == 0)
        {
            return Ok(new { success = true, paidCount = 0 });
        }

        var payments = new List<EmployeePayment>(plans.Count);
        foreach (var p in plans)
        {
            if (p.Amount <= 0) continue;
            payments.Add(new EmployeePayment
            {
                EmployeeId = p.EmployeeId,
                Type = EmployeePaymentType.Bonus,
                Amount = p.Amount,
                PaymentDate = now,
                Description = description,
                BankAccountDefinitionId = request.BankAccountDefinitionId,
                CashAccountId = request.CashAccountId,
                CreateUser = username,
                CreateTime = now
            });
        }

        if (payments.Count == 0)
        {
            return Ok(new { success = true, paidCount = 0 });
        }

        _dbContext.Set<EmployeePayment>().AddRange(payments);
        await _dbContext.SaveChangesAsync(cancellationToken);

        var payIdx = 0;
        foreach (var plan in plans)
        {
            if (plan.Amount <= 0) continue;
            var paidPayment = payments[payIdx++];
            plan.Status = EmployeeBonusPlanStatus.Paid;
            plan.PaidPaymentId = paidPayment.Id;
            plan.EditUser = username;
            plan.EditTime = now;
        }

        await _dbContext.SaveChangesAsync(cancellationToken);

        var totalAmount = payments.Sum(p => p.Amount);
        if (totalAmount > 0)
        {
            if (request.BankAccountDefinitionId.HasValue && request.BankAccountDefinitionId.Value > 0)
            {
                var bankAcc = await _dbContext.BankAccountDefinitions
                    .AsNoTracking()
                    .FirstOrDefaultAsync(x => x.Id == request.BankAccountDefinitionId.Value, cancellationToken);

                if (bankAcc is not null)
                {
                    (int CurrencyTypeId, decimal Rate, decimal CurrencyAmount) mv;
                    try
                    {
                        mv = await AccountMovementCurrency.ResolveAsync(_money, bankAcc.CurrencyTypeId, totalAmount, cancellationToken);
                    }
                    catch (InvalidOperationException ex)
                    {
                        return StatusCode(StatusCodes.Status503ServiceUnavailable, new { success = false, message = ex.Message });
                    }

                    _dbContext.BankAccountTransactions.Add(new BankAccountTransaction
                    {
                        BankAccountDefinitionId = bankAcc.Id,
                        Date = now,
                        Direction = BankAccountTransactionDirection.Out,
                        Amount = totalAmount,
                        CurrencyTypeId = mv.CurrencyTypeId,
                        CurrencyRate = mv.Rate,
                        CurrencyAmount = mv.CurrencyAmount,
                        CounterpartyType = BankAccountTransactionCounterpartyType.Bank,
                        CounterpartyCode = string.Empty,
                        CounterpartyName = string.Empty,
                        Description = "Prim Ödemesi",
                        IsPosFee = false,
                        CreateUser = username,
                        CreateTime = now
                    });
                    await _dbContext.SaveChangesAsync(cancellationToken);
                }
            }
            else if (request.CashAccountId.HasValue && request.CashAccountId.Value > 0)
            {
                var cashAcc = await _dbContext.CashAccounts
                    .AsNoTracking()
                    .FirstOrDefaultAsync(x => x.Id == request.CashAccountId.Value, cancellationToken);

                if (cashAcc is not null)
                {
                    (int CurrencyTypeId, decimal Rate, decimal CurrencyAmount) mv;
                    try
                    {
                        mv = await AccountMovementCurrency.ResolveAsync(_money, cashAcc.CurrencyTypeId, totalAmount, cancellationToken);
                    }
                    catch (InvalidOperationException ex)
                    {
                        return StatusCode(StatusCodes.Status503ServiceUnavailable, new { success = false, message = ex.Message });
                    }

                    _dbContext.Set<CashAccountTransaction>().Add(new CashAccountTransaction
                    {
                        CashAccountId = cashAcc.Id,
                        Date = now,
                        Direction = CashAccountTransactionDirection.Out,
                        Amount = totalAmount,
                        CurrencyTypeId = mv.CurrencyTypeId,
                        CurrencyRate = mv.Rate,
                        CurrencyAmount = mv.CurrencyAmount,
                        CounterpartyType = CashAccountTransactionCounterpartyType.Muhtelif,
                        CounterpartyCode = string.Empty,
                        CounterpartyName = string.Empty,
                        ReferenceType = CashAccountTransactionReferenceType.Manual,
                        Description = "Prim Ödemesi"
                    });
                    await _dbContext.SaveChangesAsync(cancellationToken);
                }
            }
        }

        await tx.CommitAsync(cancellationToken);

        return Ok(new { success = true, paidCount = payments.Count });
    }

    [HttpDelete("{id:int}")]
    public async Task<IActionResult> Delete([FromRoute] int id, CancellationToken cancellationToken)
    {
        if (id <= 0) return BadRequest(new { success = false, message = "Geçersiz id" });

        var entity = await _dbContext.Set<EmployeeBonusPlan>().FirstOrDefaultAsync(x => x.Id == id, cancellationToken);
        if (entity is null) return NotFound(new { success = false, message = "Kayıt bulunamadı" });

        if (entity.Status != EmployeeBonusPlanStatus.Planned)
        {
            return BadRequest(new { success = false, message = "Sadece planlandı durumundaki prim planı iptal edilebilir" });
        }

        _dbContext.Set<EmployeeBonusPlan>().Remove(entity);
        await _dbContext.SaveChangesAsync(cancellationToken);
        return Ok(new { success = true });
    }

    [HttpPost("{id:int}/undo-pay")]
    public async Task<IActionResult> UndoPay([FromRoute] int id, CancellationToken cancellationToken)
    {
        if (id <= 0) return BadRequest(new { success = false, message = "Geçersiz id" });

        var now = DateTime.UtcNow;
        var username = GetUsername();

        await using var tx = await _dbContext.Database.BeginTransactionAsync(cancellationToken);

        var entity = await _dbContext.Set<EmployeeBonusPlan>().FirstOrDefaultAsync(x => x.Id == id, cancellationToken);
        if (entity is null) return NotFound(new { success = false, message = "Kayıt bulunamadı" });

        if (entity.Status != EmployeeBonusPlanStatus.Paid || !entity.PaidPaymentId.HasValue)
        {
            return BadRequest(new { success = false, message = "Sadece ödendi durumundaki prim planı geri alınabilir" });
        }

        var paymentId = entity.PaidPaymentId.Value;
        var payment = await _dbContext.Set<EmployeePayment>().FirstOrDefaultAsync(x => x.Id == paymentId, cancellationToken);
        if (payment is not null)
        {
            if (payment.BankAccountDefinitionId.HasValue && payment.Amount > 0)
            {
                var bankAcc = await _dbContext.BankAccountDefinitions
                    .AsNoTracking()
                    .FirstOrDefaultAsync(x => x.Id == payment.BankAccountDefinitionId.Value, cancellationToken);
                if (bankAcc is not null)
                {
                    // İptal bugünün kuruyla yazılır: ödeme kaydı hangi harekete karşılık
                    // geldiğini tutmuyor, orijinal kur okunamıyor. Aynı gün iptalde fark yok;
                    // günler sonra iptalde döviz hesapta küçük bir kur farkı kalır.
                    (int CurrencyTypeId, decimal Rate, decimal CurrencyAmount) mv;
                    try
                    {
                        mv = await AccountMovementCurrency.ResolveAsync(_money, bankAcc.CurrencyTypeId, payment.Amount, cancellationToken);
                    }
                    catch (InvalidOperationException ex)
                    {
                        return StatusCode(StatusCodes.Status503ServiceUnavailable, new { success = false, message = ex.Message });
                    }

                    _dbContext.BankAccountTransactions.Add(new BankAccountTransaction
                    {
                        BankAccountDefinitionId = bankAcc.Id,
                        Date = now,
                        Direction = BankAccountTransactionDirection.In,
                        Amount = payment.Amount,
                        CurrencyTypeId = mv.CurrencyTypeId,
                        CurrencyRate = mv.Rate,
                        CurrencyAmount = mv.CurrencyAmount,
                        CounterpartyType = BankAccountTransactionCounterpartyType.Bank,
                        CounterpartyCode = string.Empty,
                        CounterpartyName = string.Empty,
                        Description = $"{payment.Description ?? "Prim Ödemesi"} - İptal",
                        IsPosFee = false,
                        CreateUser = username,
                        CreateTime = now
                    });
                    await _dbContext.SaveChangesAsync(cancellationToken);
                }
            }
            else if (payment.CashAccountId.HasValue && payment.Amount > 0)
            {
                var cashAcc = await _dbContext.CashAccounts
                    .AsNoTracking()
                    .FirstOrDefaultAsync(x => x.Id == payment.CashAccountId.Value, cancellationToken);
                if (cashAcc is not null)
                {
                    (int CurrencyTypeId, decimal Rate, decimal CurrencyAmount) mv;
                    try
                    {
                        mv = await AccountMovementCurrency.ResolveAsync(_money, cashAcc.CurrencyTypeId, payment.Amount, cancellationToken);
                    }
                    catch (InvalidOperationException ex)
                    {
                        return StatusCode(StatusCodes.Status503ServiceUnavailable, new { success = false, message = ex.Message });
                    }

                    _dbContext.Set<CashAccountTransaction>().Add(new CashAccountTransaction
                    {
                        CashAccountId = cashAcc.Id,
                        Date = now,
                        Direction = CashAccountTransactionDirection.In,
                        Amount = payment.Amount,
                        CurrencyTypeId = mv.CurrencyTypeId,
                        CurrencyRate = mv.Rate,
                        CurrencyAmount = mv.CurrencyAmount,
                        CounterpartyType = CashAccountTransactionCounterpartyType.Muhtelif,
                        CounterpartyCode = string.Empty,
                        CounterpartyName = string.Empty,
                        ReferenceType = CashAccountTransactionReferenceType.Manual,
                        Description = $"{payment.Description ?? "Prim Ödemesi"} - İptal",
                        // İade hareketinde denetim alanları boş kalıyordu: kasa ekstresinde bu
                        // satırın kim tarafından ve ne zaman oluşturulduğu görünmüyordu.
                        CreateUser = username,
                        CreateTime = now
                    });
                    await _dbContext.SaveChangesAsync(cancellationToken);
                }
            }

            _dbContext.Set<EmployeePayment>().Remove(payment);
            await _dbContext.SaveChangesAsync(cancellationToken);
        }

        entity.Status = EmployeeBonusPlanStatus.Planned;
        entity.PaidPaymentId = null;
        entity.EditUser = username;
        entity.EditTime = now;

        await _dbContext.SaveChangesAsync(cancellationToken);
        await tx.CommitAsync(cancellationToken);

        return Ok(new { success = true });
    }
}
