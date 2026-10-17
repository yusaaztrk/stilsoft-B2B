using System.Security.Claims;
using B2B.Erp.Api.Core.Http;
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
public sealed class EmployeePaymentsController : ControllerBase
{
    private readonly AppDbContext _dbContext;
    private readonly ICurrencyRateService _money;

    public EmployeePaymentsController(AppDbContext dbContext, ICurrencyRateService money)
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

        var q = _dbContext.Set<EmployeePayment>().AsNoTracking().AsQueryable();
        if (employeeId.HasValue && employeeId.Value > 0)
        {
            q = q.Where(x => x.EmployeeId == employeeId.Value);
        }

        var data = await q
            .OrderByDescending(x => x.PaymentDate)
            .ThenByDescending(x => x.Id)
            .Take(take)
            .Select(x => new EmployeePaymentListItemResponse
            {
                Id = x.Id,
                EmployeeId = x.EmployeeId,
                Type = x.Type,
                Amount = x.Amount,
                PaymentDate = x.PaymentDate,
                Description = x.Description,
                DeductFromSalary = x.DeductFromSalary,
                SalaryDeductedAt = x.SalaryDeductedAt,
                CreateUser = x.CreateUser,
                CreateTime = x.CreateTime
            })
            .ToListAsync(cancellationToken);

        return Ok(new { success = true, data });
    }

    [AtomicRequest]
    [HttpPost]
    public async Task<IActionResult> Create([FromBody] CreateEmployeePaymentRequest request, CancellationToken cancellationToken)
    {
        if (!ModelState.IsValid) return ValidationProblem(ModelState);
        if (request.EmployeeId <= 0) return BadRequest(new { success = false, message = "Geçersiz çalışan" });
        if (request.Amount <= 0) return BadRequest(new { success = false, message = "Tutar geçersiz" });

        var employeeExists = await _dbContext.Employees.AsNoTracking().AnyAsync(x => x.Id == request.EmployeeId, cancellationToken);
        if (!employeeExists) return BadRequest(new { success = false, message = "Çalışan bulunamadı" });

        var now = DateTime.UtcNow;
        var username = GetUsername();
        var paymentDate = NormalizeUtc(request.PaymentDate ?? now);

        var description = string.IsNullOrWhiteSpace(request.Description) ? null : request.Description.Trim();
        var createsMovement = request.Type == EmployeePaymentType.CashAdvance && request.Amount > 0;

        // Hesabın para birimi ve kuru, ödeme kaydı YAZILMADAN ÖNCE çözülür: kur alınamazsa
        // 503 dönülür ve ortada hareketi olmayan bir ödeme kaydı kalmaz.
        BankAccountDefinition? bankAcc = null;
        CashAccount? cashAcc = null;
        (int CurrencyTypeId, decimal Rate, decimal CurrencyAmount) movement = default;

        if (createsMovement)
        {
            if (request.BankAccountDefinitionId.HasValue && request.BankAccountDefinitionId.Value > 0)
            {
                bankAcc = await _dbContext.BankAccountDefinitions
                    .AsNoTracking()
                    .FirstOrDefaultAsync(x => x.Id == request.BankAccountDefinitionId.Value, cancellationToken);

                if (bankAcc is null)
                    return BadRequest(new { success = false, message = "Banka hesabı bulunamadı" });
            }
            else if (request.CashAccountId.HasValue && request.CashAccountId.Value > 0)
            {
                cashAcc = await _dbContext.CashAccounts
                    .AsNoTracking()
                    .FirstOrDefaultAsync(x => x.Id == request.CashAccountId.Value, cancellationToken);

                if (cashAcc is null)
                    return BadRequest(new { success = false, message = "Kasa bulunamadı" });
            }

            var accountCurrency = bankAcc?.CurrencyTypeId ?? cashAcc?.CurrencyTypeId;
            if (accountCurrency.HasValue)
            {
                try
                {
                    movement = await AccountMovementCurrency.ResolveAsync(_money, accountCurrency.Value, request.Amount, cancellationToken);
                }
                catch (InvalidOperationException ex)
                {
                    return StatusCode(StatusCodes.Status503ServiceUnavailable, new { success = false, message = ex.Message });
                }
            }
        }

        var entity = new EmployeePayment
        {
            EmployeeId = request.EmployeeId,
            Type = request.Type,
            Amount = request.Amount,
            PaymentDate = paymentDate,
            Description = description,
            DeductFromSalary = request.Type == EmployeePaymentType.CashAdvance && request.DeductFromSalary,
            BankAccountDefinitionId = request.BankAccountDefinitionId,
            CashAccountId = request.CashAccountId,
            CreateUser = username,
            CreateTime = now
        };

        _dbContext.Set<EmployeePayment>().Add(entity);
        await _dbContext.SaveChangesAsync(cancellationToken);

        if (createsMovement && (bankAcc is not null || cashAcc is not null))
        {
            var desc = entity.Description ?? "Nakit Avans";

            if (bankAcc is not null)
            {
                _dbContext.BankAccountTransactions.Add(new BankAccountTransaction
                {
                    BankAccountDefinitionId = bankAcc.Id,
                    Date = paymentDate,
                    Direction = BankAccountTransactionDirection.Out,
                    Amount = request.Amount,
                    CurrencyTypeId = movement.CurrencyTypeId,
                    CurrencyRate = movement.Rate,
                    CurrencyAmount = movement.CurrencyAmount,
                    CounterpartyType = BankAccountTransactionCounterpartyType.Bank,
                    CounterpartyCode = string.Empty,
                    CounterpartyName = string.Empty,
                    Description = desc,
                    IsPosFee = false,
                    CreateUser = username,
                    CreateTime = now
                });
            }
            else if (cashAcc is not null)
            {
                _dbContext.Set<CashAccountTransaction>().Add(new CashAccountTransaction
                {
                    CashAccountId = cashAcc.Id,
                    Date = paymentDate,
                    Direction = CashAccountTransactionDirection.Out,
                    Amount = request.Amount,
                    CurrencyTypeId = movement.CurrencyTypeId,
                    CurrencyRate = movement.Rate,
                    CurrencyAmount = movement.CurrencyAmount,
                    CounterpartyType = CashAccountTransactionCounterpartyType.Muhtelif,
                    CounterpartyCode = string.Empty,
                    CounterpartyName = string.Empty,
                    ReferenceType = CashAccountTransactionReferenceType.Manual,
                    Description = desc,
                    CreateUser = username,
                    CreateTime = now
                });
            }

            await _dbContext.SaveChangesAsync(cancellationToken);
        }

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

        var description = string.IsNullOrWhiteSpace(request.Description) ? "Maaş Ödemesi" : request.Description.Trim();

        decimal totalAmount = 0m;

        var salaryMonthStart = new DateTime(paymentDate.Year, paymentDate.Month, 1, 0, 0, 0, DateTimeKind.Utc);
        var salaryMonthEnd = salaryMonthStart.AddMonths(1);

        var advances = await _dbContext.Set<EmployeePayment>()
            .Where(x => x.Type == EmployeePaymentType.CashAdvance)
            .Where(x => x.DeductFromSalary)
            .Where(x => x.SalaryDeductedAt == null)
            .Where(x => ids.Contains(x.EmployeeId))
            .Where(x => x.PaymentDate >= salaryMonthStart && x.PaymentDate < salaryMonthEnd)
            .Select(x => new { x.Id, x.EmployeeId, x.Amount })
            .ToListAsync(cancellationToken);

        var advanceSumByEmployeeId = advances
            .GroupBy(x => x.EmployeeId)
            .ToDictionary(g => g.Key, g => g.Sum(a => a.Amount));

        var over = employees
            .Select(e => new
            {
                e.Id,
                Salary = Math.Max(0, e.Salary),
                Advance = advanceSumByEmployeeId.TryGetValue(e.Id, out var a) ? Math.Max(0, a) : 0m,
                Name = ($"{e.FirstName} {e.LastName}").Trim()
            })
            .FirstOrDefault(x => x.Advance > x.Salary);

        if (over is not null)
        {
            return BadRequest(new
            {
                success = false,
                message = $"Avans tutarı maaşı aşıyor: {over.Name} (ID:{over.Id}) | Maaş: {over.Salary} | Avans: {over.Advance}"
            });
        }

        foreach (var e in employees)
        {
            var salary = Math.Max(0, e.Salary);
            var adv = advanceSumByEmployeeId.TryGetValue(e.Id, out var a) ? Math.Max(0, a) : 0m;
            var amount = Math.Max(0m, salary - adv);
            if (amount <= 0) continue;

            totalAmount += amount;

            _dbContext.Set<EmployeePayment>().Add(new EmployeePayment
            {
                EmployeeId = e.Id,
                Type = EmployeePaymentType.Salary,
                Amount = amount,
                PaymentDate = paymentDate,
                Description = description,
                BankAccountDefinitionId = request.BankAccountDefinitionId,
                CashAccountId = request.CashAccountId,
                CreateUser = username,
                CreateTime = now
            });
        }

        if (advances.Count > 0)
        {
            var advanceIds = advances.Select(x => x.Id).ToList();
            var entities = await _dbContext.Set<EmployeePayment>()
                .Where(x => advanceIds.Contains(x.Id))
                .ToListAsync(cancellationToken);

            foreach (var a in entities)
            {
                a.SalaryDeductedAt = now;
            }
        }

        if (totalAmount > 0)
        {
            if (request.BankAccountDefinitionId.HasValue && request.BankAccountDefinitionId.Value > 0)
            {
                var bankAcc = await _dbContext.BankAccountDefinitions
                    .AsNoTracking()
                    .FirstOrDefaultAsync(x => x.Id == request.BankAccountDefinitionId.Value, cancellationToken);

                if (bankAcc is null)
                    return BadRequest(new { success = false, message = "Banka hesabı bulunamadı" });

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
                    Date = paymentDate,
                    Direction = BankAccountTransactionDirection.Out,
                    Amount = totalAmount,
                    CurrencyTypeId = mv.CurrencyTypeId,
                    CurrencyRate = mv.Rate,
                    CurrencyAmount = mv.CurrencyAmount,
                    CounterpartyType = BankAccountTransactionCounterpartyType.Bank,
                    CounterpartyCode = string.Empty,
                    CounterpartyName = string.Empty,
                    Description = "Maaş Ödemesi",
                    IsPosFee = false,
                    CreateUser = username,
                    CreateTime = now
                });
            }
            else if (request.CashAccountId.HasValue && request.CashAccountId.Value > 0)
            {
                var cashAcc = await _dbContext.CashAccounts
                    .AsNoTracking()
                    .FirstOrDefaultAsync(x => x.Id == request.CashAccountId.Value, cancellationToken);

                if (cashAcc is null)
                    return BadRequest(new { success = false, message = "Kasa bulunamadı" });

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
                    Date = paymentDate,
                    Direction = CashAccountTransactionDirection.Out,
                    Amount = totalAmount,
                    CurrencyTypeId = mv.CurrencyTypeId,
                    CurrencyRate = mv.Rate,
                    CurrencyAmount = mv.CurrencyAmount,
                    CounterpartyType = CashAccountTransactionCounterpartyType.Muhtelif,
                    CounterpartyCode = string.Empty,
                    CounterpartyName = string.Empty,
                    ReferenceType = CashAccountTransactionReferenceType.Manual,
                    Description = "Maaş Ödemesi"
                });
            }
        }

        await _dbContext.SaveChangesAsync(cancellationToken);
        return Ok(new { success = true });
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
        var description = string.IsNullOrWhiteSpace(request.Description) ? "Yemek Ödemesi" : request.Description.Trim();

        decimal totalAmount = 0m;

        foreach (var e in employees)
        {
            var amount = Math.Max(0m, e.MealAmount);
            if (amount <= 0) continue;

            totalAmount += amount;

            _dbContext.Set<EmployeePayment>().Add(new EmployeePayment
            {
                EmployeeId = e.Id,
                Type = EmployeePaymentType.Meal,
                Amount = amount,
                PaymentDate = paymentDate,
                Description = description,
                BankAccountDefinitionId = request.BankAccountDefinitionId,
                CashAccountId = request.CashAccountId,
                CreateUser = username,
                CreateTime = now
            });
        }

        if (totalAmount > 0)
        {
            if (request.BankAccountDefinitionId.HasValue && request.BankAccountDefinitionId.Value > 0)
            {
                var bankAcc = await _dbContext.BankAccountDefinitions
                    .AsNoTracking()
                    .FirstOrDefaultAsync(x => x.Id == request.BankAccountDefinitionId.Value, cancellationToken);

                if (bankAcc is null)
                    return BadRequest(new { success = false, message = "Banka hesabı bulunamadı" });

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
                    Date = paymentDate,
                    Direction = BankAccountTransactionDirection.Out,
                    Amount = totalAmount,
                    CurrencyTypeId = mv.CurrencyTypeId,
                    CurrencyRate = mv.Rate,
                    CurrencyAmount = mv.CurrencyAmount,
                    CounterpartyType = BankAccountTransactionCounterpartyType.Bank,
                    CounterpartyCode = string.Empty,
                    CounterpartyName = string.Empty,
                    Description = description,
                    IsPosFee = false,
                    CreateUser = username,
                    CreateTime = now
                });
            }
            else if (request.CashAccountId.HasValue && request.CashAccountId.Value > 0)
            {
                var cashAcc = await _dbContext.CashAccounts
                    .AsNoTracking()
                    .FirstOrDefaultAsync(x => x.Id == request.CashAccountId.Value, cancellationToken);

                if (cashAcc is null)
                    return BadRequest(new { success = false, message = "Kasa bulunamadı" });

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
                    Date = paymentDate,
                    Direction = CashAccountTransactionDirection.Out,
                    Amount = totalAmount,
                    CurrencyTypeId = mv.CurrencyTypeId,
                    CurrencyRate = mv.Rate,
                    CurrencyAmount = mv.CurrencyAmount,
                    CounterpartyType = CashAccountTransactionCounterpartyType.Muhtelif,
                    CounterpartyCode = string.Empty,
                    CounterpartyName = string.Empty,
                    ReferenceType = CashAccountTransactionReferenceType.Manual,
                    Description = description
                });
            }
        }

        await _dbContext.SaveChangesAsync(cancellationToken);
        return Ok(new { success = true });
    }

    [HttpDelete("{id:int}")]
    public async Task<IActionResult> Delete([FromRoute] int id, CancellationToken cancellationToken)
    {
        if (id <= 0) return BadRequest(new { success = false, message = "Geçersiz id" });

        var entity = await _dbContext.Set<EmployeePayment>().FirstOrDefaultAsync(x => x.Id == id, cancellationToken);
        if (entity is null) return NotFound(new { success = false, message = "Kayıt bulunamadı" });

        var now = DateTime.UtcNow;
        var username = GetUsername();

        if (entity.BankAccountDefinitionId.HasValue && entity.Amount > 0)
        {
            var bankAcc = await _dbContext.BankAccountDefinitions
                .AsNoTracking()
                .FirstOrDefaultAsync(x => x.Id == entity.BankAccountDefinitionId.Value, cancellationToken);
            if (bankAcc is not null)
            {
                (int CurrencyTypeId, decimal Rate, decimal CurrencyAmount) mv;
                try
                {
                    mv = await AccountMovementCurrency.ResolveAsync(_money, bankAcc.CurrencyTypeId, entity.Amount, cancellationToken);
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
                    Amount = entity.Amount,
                    CurrencyTypeId = mv.CurrencyTypeId,
                    CurrencyRate = mv.Rate,
                    CurrencyAmount = mv.CurrencyAmount,
                    CounterpartyType = BankAccountTransactionCounterpartyType.Bank,
                    CounterpartyCode = string.Empty,
                    CounterpartyName = string.Empty,
                    Description = $"{entity.Description ?? "Ödeme"} - İptal",
                    IsPosFee = false,
                    CreateUser = username,
                    CreateTime = now
                });
            }
        }
        else if (entity.CashAccountId.HasValue && entity.Amount > 0)
        {
            var cashAcc = await _dbContext.CashAccounts
                .AsNoTracking()
                .FirstOrDefaultAsync(x => x.Id == entity.CashAccountId.Value, cancellationToken);
            if (cashAcc is not null)
            {
                (int CurrencyTypeId, decimal Rate, decimal CurrencyAmount) mv;
                try
                {
                    mv = await AccountMovementCurrency.ResolveAsync(_money, cashAcc.CurrencyTypeId, entity.Amount, cancellationToken);
                }
                catch (InvalidOperationException ex)
                {
                    return StatusCode(StatusCodes.Status503ServiceUnavailable, new { success = false, message = ex.Message });
                }

                _dbContext.CashAccountTransactions.Add(new CashAccountTransaction
                {
                    CashAccountId = cashAcc.Id,
                    Date = now,
                    Direction = CashAccountTransactionDirection.In,
                    Amount = entity.Amount,
                    CurrencyTypeId = mv.CurrencyTypeId,
                    CurrencyRate = mv.Rate,
                    CurrencyAmount = mv.CurrencyAmount,
                    CounterpartyType = CashAccountTransactionCounterpartyType.Muhtelif,
                    CounterpartyCode = string.Empty,
                    CounterpartyName = string.Empty,
                    ReferenceType = CashAccountTransactionReferenceType.Manual,
                    Description = $"{entity.Description ?? "Ödeme"} - İptal"
                });
            }
        }

        _dbContext.Set<EmployeePayment>().Remove(entity);
        await _dbContext.SaveChangesAsync(cancellationToken);
        return Ok(new { success = true });
    }
}
